"""Train/evaluate the mobile student against explicit teacher or reviewed labels."""

import csv
import hashlib
import json
import random
import platform
import math
from importlib.metadata import version
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

from adaptive_styles.label import read_jsonl
from adaptive_styles.model import MEAN, STD, StyleStudent
from adaptive_styles.prepare import letterbox, load_rgb
from adaptive_styles.styles import canonical_json, load_contract


def image_tensor(image):
    rgb = np.asarray(letterbox(image), dtype=np.float32).copy()/255
    values = torch.from_numpy(rgb).permute(2,0,1)
    return (values-torch.tensor(MEAN)[:,None,None])/torch.tensor(STD)[:,None,None]


def labeled_records(data, overrides=None):
    data = Path(data)
    manifest = json.loads((data/"manifest.json").read_text(encoding="utf-8"))
    config = json.loads((data/"labels-config.json").read_text(encoding="utf-8"))
    expected = hashlib.sha256((data/"manifest.json").read_bytes()).hexdigest()
    if config["manifest_sha256"] != expected: raise ValueError("Prepared manifest changed after labeling")
    labels = {row["image_id"]: row for row in read_jsonl(data/"labels.jsonl")}
    missing = [row["image_id"] for row in manifest["records"] if row["image_id"] not in labels]
    if missing: raise ValueError(f"Labeling is incomplete: {len(missing)} photos missing. Rerun label.")
    choices, excluded = {}, set()
    if overrides:
        with Path(overrides).open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if row["image_id"] not in labels: raise ValueError("Review references an unknown image")
                if row.get("accept", "1").strip().lower() in ("0", "false", "no"):
                    excluded.add(row["image_id"])
                elif row.get("candidate_id", "").strip(): choices[row["image_id"]] = int(row["candidate_id"])
    style_ids = list(dict.fromkeys(option["styleId"] for option in config["candidates"]))
    options = {option["candidate_id"]: option for option in config["candidates"]}
    records = []
    for source in manifest["records"]:
        if source["image_id"] in excluded: continue
        label = json.loads(json.dumps(labels[source["image_id"]]))
        if label["group_id"] != source["group_id"] or label["split"] != source["split"]:
            raise ValueError("Label split/group does not match frozen manifest")
        if source["image_id"] in choices:
            candidate_id = choices[source["image_id"]]
            if candidate_id not in options: raise ValueError("Reviewed candidate_id is outside the candidate grid")
            candidate = options[candidate_id]
            index = style_ids.index(candidate["styleId"])
            label["style_probabilities"] = [float(i == index) for i in range(len(style_ids))]
            label["style_parameters"][index] = [candidate[k] for k in ("tone", "color", "palette")]
            label["selected_candidate_id"] = candidate["candidate_id"]
            label["label_source"] = "human_review"
        probabilities = np.asarray(label["style_probabilities"])
        parameters = np.asarray(label["style_parameters"])
        if probabilities.shape != (len(style_ids),) or parameters.shape != (len(style_ids), 3):
            raise ValueError("Malformed label shape")
        if not np.isfinite(parameters).all() or not np.isfinite(probabilities).all() or np.any(probabilities < 0) or not np.isclose(probabilities.sum(), 1):
            raise ValueError("Invalid label values")
        if np.any(np.abs(parameters[:,:2]) > 1) or np.any((parameters[:,2] < 0) | (parameters[:,2] > 1)):
            raise ValueError("Parameters outside app contract")
        winner = options[label["selected_candidate_id"]]
        records.append({**source, **label, "target_class": style_ids.index(winner["styleId"])})
    # Hash the actual reviewed labels as well as working-copy bytes, so resume cannot
    # silently switch supervision or image contents beneath an existing run.
    digest = hashlib.sha256(canonical_json({"manifest": manifest, "labels": records, "config": config}).encode())
    for row in records:
        digest.update(hashlib.sha256((data/row["path"]).read_bytes()).digest())
    return manifest, config, records, style_ids, digest.hexdigest()


class StyleDataset(Dataset):
    def __init__(self, data, rows): self.data, self.rows = Path(data), rows
    def __len__(self): return len(self.rows)
    def __getitem__(self, index):
        row = self.rows[index]
        with Image.open(self.data/row["path"]) as image: inputs = image_tensor(image.convert("RGB"))
        return inputs, torch.tensor(row["style_probabilities"], dtype=torch.float32), torch.tensor(row["style_parameters"], dtype=torch.float32), row["target_class"]


def losses(logits, parameters, probabilities, targets):
    classification = -(probabilities*logits.log_softmax(-1)).sum(-1).mean()
    error = F.smooth_l1_loss(parameters, targets, reduction="none").mean(-1)
    regression = (error*probabilities).sum(-1).mean()
    return classification + 2*regression


@torch.inference_mode()
def evaluate_loader(model, loader, device):
    model.eval()
    total, loss_sum, hits, mae = 0, 0., 0, 0.
    for inputs, probabilities, targets, classes in loader:
        inputs, probabilities, targets, classes = (value.to(device) for value in (inputs, probabilities, targets, classes))
        logits, parameters = model(inputs)
        count = len(inputs)
        loss_sum += float(losses(logits, parameters, probabilities, targets))*count
        hits += int((logits.argmax(-1) == classes).sum())
        index = torch.arange(count, device=device)
        mae += float((parameters[index, classes]-targets[index, classes]).abs().mean(-1).sum())
        total += count
    if not total: raise ValueError("Empty evaluation split")
    return {"samples": total, "loss": loss_sum/total, "label_agreement": hits/total, "target_parameter_mae": mae/total}


def train(workspace, data, output, *, epochs=20, batch_size=8, accumulation=4,
          learning_rate=1e-4, warmup_epochs=1, device="cuda", resume=None,
          overrides=None, max_batches=None, pretrained=True):
    if min(epochs, batch_size, accumulation) < 1 or not math.isfinite(learning_rate) or learning_rate <= 0 or warmup_epochs < 0:
        raise ValueError("Invalid training settings")
    if max_batches is not None and max_batches < 1: raise ValueError("max_batches must be positive")
    torch.set_num_threads(4)
    device = torch.device(device)
    if device.type == "cuda" and not torch.cuda.is_available(): raise RuntimeError("CUDA unavailable; install CUDA PyTorch or choose --device cpu")
    manifest, label_config, rows, ids, fingerprint = labeled_records(data, overrides)
    seed = manifest["seed"]
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    contract = load_contract(workspace)
    if contract["sha256"] != manifest["contract_sha256"]: raise ValueError("App contract changed; prepare again")
    train_rows = [r for r in rows if r["split"] == "train"]
    validation_rows = [r for r in rows if r["split"] == "validation"]
    if not train_rows or not validation_rows: raise ValueError("Need nonempty train and validation splits")
    output = Path(output)
    if output.exists() and any(output.iterdir()) and not resume:
        raise FileExistsError("Run directory is not empty. Use --resume or a new --run path.")
    output.mkdir(parents=True, exist_ok=True)
    model = StyleStudent(ids, pretrained=pretrained and not resume).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=.01)
    scaler = torch.cuda.amp.GradScaler(enabled=device.type == "cuda")
    start, best = 0, float("inf")
    generator = torch.Generator().manual_seed(seed)
    settings = {"fingerprint": fingerprint, "style_ids": ids, "batch_size": batch_size,
                "accumulation": accumulation, "learning_rate": learning_rate, "warmup_epochs": warmup_epochs,
                "max_batches": max_batches, "pretrained": pretrained,
                "torch": str(torch.__version__), "device": str(device), "seed": seed,
                "target_epochs": epochs, "python": platform.python_version(),
                "dependencies": {name: version(name) for name in ("torchvision", "numpy", "Pillow", "transformers")},
                "parameter_count": sum(p.numel() for p in model.parameters())}
    if resume:
        if Path(resume).resolve().parent != output.resolve():
            raise ValueError("Resume into the original --run directory to preserve its best checkpoint/history")
        state = torch.load(resume, map_location="cpu", weights_only=True)
        for key in ("fingerprint", "style_ids", "batch_size", "accumulation", "learning_rate", "warmup_epochs", "max_batches", "pretrained"):
            if state["settings"][key] != settings[key]: raise ValueError(f"Resume mismatch: {key}")
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        for values in optimizer.state.values():
            for key, value in values.items():
                if torch.is_tensor(value): values[key] = value.to(device)
        scaler.load_state_dict(state["scaler"])
        start, best = state["epoch"]+1, state["best_validation_loss"]
        torch.set_rng_state(state["rng"])
        generator.set_state(state["loader_rng"])
        if device.type == "cuda" and state.get("cuda_rng"): torch.cuda.set_rng_state_all(state["cuda_rng"])
        if start >= epochs: raise ValueError("--epochs must exceed the already completed epoch count")
    (output/"run-config.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    train_loader = DataLoader(StyleDataset(data, train_rows), batch_size=batch_size, shuffle=True,
                              num_workers=0, generator=generator, pin_memory=device.type == "cuda")
    val_loader = DataLoader(StyleDataset(data, validation_rows), batch_size=batch_size, num_workers=0)
    majority = Counter(r["target_class"] for r in train_rows).most_common(1)[0][0]
    baseline = {"majority_train_style_id": ids[majority],
                "majority_validation_agreement": sum(r["target_class"] == majority for r in validation_rows)/len(validation_rows),
                "standard_validation_agreement": sum(r["target_class"] == ids.index(1) for r in validation_rows)/len(validation_rows),
                "train_style_counts": dict(Counter(ids[r["target_class"]] for r in train_rows)),
                "warning": "Agreement with pseudo-labels is not proof of aesthetic improvement."}
    (output/"baselines.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    if device.type == "cuda": torch.cuda.reset_peak_memory_stats()
    for epoch in range(start, epochs):
        model.configure_backbone(0 if epoch < warmup_epochs else 3)
        model.train(); optimizer.zero_grad(set_to_none=True)
        batch_count = min(len(train_loader), max_batches or len(train_loader))
        running = 0.
        for step, (inputs, probabilities, targets, _) in enumerate(train_loader):
            if step >= batch_count: break
            inputs, probabilities, targets = (value.to(device) for value in (inputs, probabilities, targets))
            window_start = (step//accumulation)*accumulation
            window_size = min(accumulation, batch_count-window_start)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                logits, parameters = model(inputs)
                loss = losses(logits.float(), parameters.float(), probabilities, targets)
            if not torch.isfinite(loss): raise ValueError("Non-finite training loss; checkpoint not advanced")
            scaler.scale(loss/window_size).backward()
            if (step+1) % accumulation == 0 or step+1 == batch_count:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
                scaler.step(optimizer); scaler.update(); optimizer.zero_grad(set_to_none=True)
            running += float(loss.detach())
        metrics = evaluate_loader(model, val_loader, device)
        improved = metrics["loss"] < best
        best = min(best, metrics["loss"])
        report = {"epoch": epoch+1, "train_loss": running/batch_count, "validation": metrics,
                  "peak_cuda_mib": torch.cuda.max_memory_allocated()/1024**2 if device.type == "cuda" else None}
        with (output/"metrics.jsonl").open("a", encoding="utf-8") as stream: stream.write(canonical_json(report)+"\n")
        state = {"model": model.state_dict(), "optimizer": optimizer.state_dict(), "scaler": scaler.state_dict(),
                 "epoch": epoch, "best_validation_loss": best, "settings": settings,
                 "contract_sha256": manifest["contract_sha256"], "rng": torch.get_rng_state(),
                 "loader_rng": generator.get_state(), "cuda_rng": torch.cuda.get_rng_state_all() if device.type == "cuda" else []}
        temporary = output/"last.pt.partial"
        torch.save(state, temporary); temporary.replace(output/"last.pt")
        if improved:
            torch.save(state, output/"best.pt.partial"); (output/"best.pt.partial").replace(output/"best.pt")
        print(json.dumps(report), flush=True)
    return output/"best.pt"


def load_student(checkpoint, device="cpu"):
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model = StyleStudent(state["settings"]["style_ids"], pretrained=False)
    model.load_state_dict(state["model"])
    return model.to(device).eval(), state


def predict(checkpoint, image_path, device="cpu"):
    model, state = load_student(checkpoint, device)
    image, _ = load_rgb(image_path)
    with torch.inference_mode():
        logits, parameters = model(image_tensor(image)[None].to(device))
        probabilities = logits.softmax(-1)[0]
        index = int(probabilities.argmax())
        values = parameters[0,index].cpu().tolist()
    return {"styleId": model.style_ids[index], **dict(zip(("tone", "color", "palette"), values)),
            "confidence": float(probabilities[index]), "confidence_kind": "uncalibrated_label_agreement",
            "contract_sha256": state["contract_sha256"]}


def evaluate(checkpoint, data, split="validation", overrides=None, device="cpu"):
    model, state = load_student(checkpoint, device)
    _, _, rows, _, fingerprint = labeled_records(data, overrides)
    if fingerprint != state["settings"]["fingerprint"]: raise ValueError("Dataset/labels differ from training")
    loader = DataLoader(StyleDataset(data, [r for r in rows if r["split"] == split]), batch_size=8)
    return {"split": split, **evaluate_loader(model, loader, torch.device(device))}
