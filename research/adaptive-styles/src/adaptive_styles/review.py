"""Produce local candidate contact sheets plus editable review overrides."""

import csv
import html
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from adaptive_styles.label import read_jsonl
from adaptive_styles.styles import candidates, load_contract, render


def review(workspace, data, output, limit=50):
    data, output = Path(data), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    contract = load_contract(workspace)
    manifest = json.loads((data/"manifest.json").read_text(encoding="utf-8"))
    if manifest["contract_sha256"] != contract["sha256"]: raise ValueError("App contract changed")
    sources = {row["image_id"]: row for row in manifest["records"]}
    options = candidates(contract)
    labels = read_jsonl(data/"labels.jsonl")[:limit]
    entries, figures = [], []
    names = {s["styleId"]: s["name"] for s in contract["styles"]}
    for label in labels:
        source = sources[label["image_id"]]
        with Image.open(data/source["path"]) as image: original = np.asarray(image.convert("RGB"))
        indices = list(dict.fromkeys([0, label["selected_candidate_id"], *np.argsort(label["scores"])[::-1][:6].tolist()]))
        sheet = Image.new("RGB", (4*240, ((len(indices)+3)//4)*210), "#efeff4")
        draw = ImageDraw.Draw(sheet)
        for position, index in enumerate(indices):
            option = options[index]
            preview = ImageOps.contain(Image.fromarray(render(original, option, contract)), (232, 170))
            x, y = (position%4)*240, (position//4)*210
            sheet.paste(preview, (x+(240-preview.width)//2, y+(174-preview.height)//2))
            text = f"id {index}: {names[option['styleId']]} | {label['scores'][index]:.3f}"
            draw.text((x+4,y+176), text, fill="black")
            draw.text((x+4,y+190), f"T {option['tone']:.2f} C {option['color']:.2f} P {option['palette']:.2f}", fill="black")
        filename = label["image_id"]+".jpg"
        sheet.save(output/filename, quality=88)
        figures.append(f"<section><h2>{html.escape(source['source'])}</h2><p>{label['image_id']} | {source['split']} | teacher choice: {label['selected_candidate_id']}</p><img src='{filename}' alt='Candidate edits'></section>")
        entries.append({"image_id": label["image_id"], "candidate_id": "", "accept": "1", "notes": ""})
    csv_path = output/"overrides.csv"
    if not csv_path.exists():
        with csv_path.open("x", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=["image_id", "candidate_id", "accept", "notes"])
            writer.writeheader(); writer.writerows(entries)
    page = "<!doctype html><meta charset='utf-8'><title>Style label review</title><style>body{font:16px system-ui;margin:24px;background:#f2f2f7}img{max-width:100%}section{margin:32px 0}h2{font-size:18px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}</style><h1>Review teacher labels</h1><p>Edit overrides.csv: candidate_id chooses an edit; accept=0 excludes an image; a blank choice keeps the teacher label. Existing overrides are never overwritten. Scores are model preferences, not human ratings.</p>"+"".join(figures)
    (output/"index.html").write_text(page, encoding="utf-8")
    print(f"Review {len(entries)} photos: {output/'index.html'}; overrides: {csv_path}", flush=True)
    return output/"index.html"
