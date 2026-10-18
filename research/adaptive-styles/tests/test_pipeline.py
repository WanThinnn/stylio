"""Actual renderer parity, duplicate grouping, supervised loss and export contracts."""

import csv
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"src"))

from adaptive_styles.prepare import prepare
from adaptive_styles.styles import candidates, load_contract, render


class PipelineTests(unittest.TestCase):
    def setUp(self):
        folder = ROOT/"outputs/test-temp"
        folder.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=folder)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_renderer_matches_real_app(self):
        if not shutil.which("node"): self.skipTest("Node needed for app renderer parity")
        contract = load_contract(ROOT)
        options = candidates(contract)
        pixels = np.random.default_rng(42).integers(0,256,(12,16,3),dtype=np.uint8)
        pixels[0,0] = 0
        rgba = np.concatenate([pixels, np.full((*pixels.shape[:2],1),255,dtype=np.uint8)],axis=-1)
        result = subprocess.run(["node",str(ROOT/"tests/renderer-parity.mjs")],
                                input=json.dumps({"rgba":rgba.ravel().tolist(),"candidates":options}),
                                capture_output=True,text=True,check=True)
        actual = json.loads(result.stdout)
        for option, app in zip(options,actual):
            app = np.asarray(app).reshape(*pixels.shape[:2],4)[...,:3]
            np.testing.assert_array_equal(render(pixels,option,contract),app)
        np.testing.assert_array_equal(render(pixels,options[0],contract),pixels)

    def test_prepare_freezes_duplicate_groups_and_splits(self):
        source = self.directory/"sources"
        source.mkdir()
        rng = np.random.default_rng(12)
        for i in range(12):
            image = Image.fromarray(rng.integers(0,256,(256,384,3),dtype=np.uint8))
            image.save(source/f"{i}.png")
            if i == 0:
                image.save(source/"same-scene-variant.jpg",quality=98)
                image.save(source/"exact-copy.png")
        Image.new("RGB",(256,256),(100,100,100)).save(source/"monochrome.png")
        destination = self.directory/"prepared"
        manifest = prepare(ROOT,destination,source_roots=[source])
        rows = manifest["records"]
        by_group = {}
        for row in rows:
            previous = by_group.setdefault(row["group_id"],row["split"])
            self.assertEqual(previous,row["split"])
        a = next(r for r in rows if r["source"].endswith(("/0.png","/exact-copy.png")))
        b = next(r for r in rows if r["source"].endswith("same-scene-variant.jpg"))
        self.assertEqual(a["group_id"],b["group_id"])
        self.assertEqual(set(r["split"] for r in rows),{"train","validation","test"})
        self.assertTrue(any("duplicate" in r["reason"] for r in manifest["excluded"]))
        with self.assertRaises(FileExistsError): prepare(ROOT,destination,source_roots=[source])

    def test_student_bounds_and_real_optimizer_update(self):
        import torch
        from adaptive_styles.model import StyleStudent
        from adaptive_styles.training import losses
        torch.set_num_threads(2)
        ids = [s["styleId"] for s in load_contract(ROOT)["styles"]]
        model = StyleStudent(ids,pretrained=False)
        model.configure_backbone(0);model.train()
        optimizer = torch.optim.AdamW(model.parameters(),lr=.01)
        before = model.style_head.weight.detach().clone()
        logits,parameters = model(torch.randn(2,3,224,224))
        targets = torch.zeros(2,len(ids));targets[:,3] = 1
        desired = torch.zeros(2,len(ids),3);desired[:,:,2] = .7
        loss = losses(logits,parameters,targets,desired)
        loss.backward();optimizer.step()
        self.assertFalse(torch.equal(before,model.style_head.weight))
        self.assertTrue(torch.isfinite(loss))
        self.assertTrue((parameters[:,:,:2].abs() <= 1).all())
        self.assertTrue(((parameters[:,:,2] >= 0) & (parameters[:,:,2] <= 1)).all())
        self.assertTrue((parameters[:,ids.index(1),2] == 1).all())
        self.assertTrue(all(p.grad is None for p in model.features.parameters()))

    def test_reviewed_labels_and_dataset_fingerprint(self):
        from adaptive_styles.label import read_jsonl
        from adaptive_styles.training import labeled_records
        data = self.directory/"data"
        data.mkdir()
        contract = load_contract(ROOT)
        options = candidates(contract)
        ids = [s["styleId"] for s in contract["styles"]]
        rows, labels = [], []
        for i, split in enumerate(("train","validation","test")):
            Image.new("RGB",(224,224),(120+i,80,50)).save(data/f"{i}.png")
            rows.append({"image_id":str(i),"path":f"{i}.png","source":f"fixture-{i}","group_id":str(i),"split":split})
            labels.append({"image_id":str(i),"group_id":str(i),"split":split,"selected_candidate_id":0,
                           "style_probabilities":[1.]+[0.]*(len(ids)-1),"style_parameters":[[0.,0.,1.]]*len(ids)})
        manifest = {"records":rows,"contract_sha256":contract["sha256"]}
        (data/"manifest.json").write_text(json.dumps(manifest))
        (data/"labels-config.json").write_text(json.dumps({"candidates":options,"manifest_sha256":hashlib.sha256((data/"manifest.json").read_bytes()).hexdigest()}))
        (data/"labels.jsonl").write_text("\n".join(map(json.dumps,labels))+"\n")
        initial = labeled_records(data)
        overrides = data/"overrides.csv"
        choice = next(o for o in options if o["styleId"] == 4)
        overrides.write_text(f"image_id,candidate_id,accept\n0,{choice['candidate_id']},1\n")
        reviewed = labeled_records(data,overrides)
        self.assertNotEqual(initial[-1],reviewed[-1])
        self.assertEqual(reviewed[2][0]["target_class"],ids.index(4))
        self.assertEqual(reviewed[2][0]["label_source"],"human_review")
        Image.new("RGB",(224,224),(30,70,20)).save(data/"0.png")
        self.assertNotEqual(initial[-1],labeled_records(data)[-1])
        journal = data/"interrupted.jsonl"
        journal.write_text('{"image_id":"ok"}\n{"image_id":')
        self.assertEqual(read_jsonl(journal,repair_tail=True),[{"image_id":"ok"}])
        self.assertEqual(read_jsonl(journal),[{"image_id":"ok"}])


if __name__ == "__main__": unittest.main()
