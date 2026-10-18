"""Generate teacher preferences over the actual app-renderable candidate edits."""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from adaptive_styles.prepare import letterbox
from adaptive_styles.styles import candidates, canonical_json, load_contract, render


def read_jsonl(path, repair_tail=False):
    records = []
    if Path(path).exists():
        text = Path(path).read_text(encoding="utf-8")
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if not line.strip(): continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                if not repair_tail or index != len(lines)-1 or text.endswith("\n"):
                    raise
                # Only discard an incomplete final write from our own label journal.
                Path(path).write_text("\n".join(lines[:index])+"\n", encoding="utf-8")
                print("Recovered an interrupted final label record; it will be recomputed.", flush=True)
    return records


def label(workspace, data, *, device="cuda", batch_size=8, limit=None):
    from adaptive_styles.teacher import AestheticTeacher, TEACHER_ID
    root, data = Path(workspace), Path(data)
    manifest_path = data/"manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    contract = load_contract(root)
    if manifest["contract_sha256"] != contract["sha256"]:
        raise ValueError("App renderer changed since preparation. Prepare a new dataset.")
    options = candidates(contract)
    config = {"teacher": TEACHER_ID, "contract_sha256": contract["sha256"],
              "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              "candidates": options, "content_penalty": .3, "clipping_penalty": .5,
              "minimum_gain": .03, "temperature": .15}
    config_path = data/"labels-config.json"
    if config_path.exists() and json.loads(config_path.read_text()) != config:
        raise ValueError("Label configuration changed. Use a new prepared data directory.")
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    labels_path = data/"labels.jsonl"
    completed = {r["image_id"] for r in read_jsonl(labels_path, repair_tail=True)}
    remaining = [r for r in manifest["records"] if r["image_id"] not in completed]
    if limit: remaining = remaining[:limit]
    if not remaining:
        print("All selected images already labeled.", flush=True)
        return
    teacher = AestheticTeacher(root/"outputs/cache/teacher", device)
    for index, row in enumerate(remaining, 1):
        with Image.open(data/row["path"]) as source: original = np.asarray(source.convert("RGB"))
        rendered = [render(original, option, contract) for option in options]
        previews = [letterbox(Image.fromarray(value)) for value in rendered]
        aesthetics = teacher.score(previews, batch_size)
        content = np.asarray([np.mean(((value.astype(float)-original)/255)**2) for value in rendered])
        source_clip = np.mean((original == 0) | (original == 255))
        clipping = np.asarray([max(0, np.mean((value == 0) | (value == 255))-source_clip) for value in rendered])
        scores = aesthetics-.3*content-.5*clipping
        winner = int(np.argmax(scores))
        conservative = float(scores[winner]-scores[0]) < config["minimum_gain"]
        if conservative: winner = 0
        per_style = []
        for style in contract["styles"]:
            indices = [i for i, option in enumerate(options) if option["styleId"] == style["styleId"]]
            best = max(indices, key=lambda i: scores[i])
            per_style.append(best)
        logits = np.array([scores[i] for i in per_style])
        probabilities = np.exp((logits-logits.max())/config["temperature"])
        probabilities /= probabilities.sum()
        if conservative:
            probabilities[:] = 0
            probabilities[0] = 1  # Unchanged Standard is the conservative target.
            per_style[0] = 0
        record = {"image_id": row["image_id"], "group_id": row["group_id"], "split": row["split"],
                  "selected_candidate_id": winner, "label_source": "laion_teacher_pseudo_label",
                  "style_probabilities": probabilities.tolist(),
                  "style_parameters": [[options[i][key] for key in ("tone", "color", "palette")] for i in per_style],
                  "aesthetic_scores": aesthetics.tolist(), "scores": scores.tolist(),
                  "conservative_unchanged": conservative}
        with labels_path.open("a", encoding="utf-8") as stream:
            stream.write(canonical_json(record)+"\n")
        print(f"Labeled {index}/{len(remaining)}: style {options[winner]['styleId']}; gain {scores[winner]-scores[0]:.4f}", flush=True)
