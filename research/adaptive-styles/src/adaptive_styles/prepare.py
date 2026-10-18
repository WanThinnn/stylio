"""Make working copies and freeze scene groups before candidate generation."""

import csv
import hashlib
import io
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageOps

from adaptive_styles.styles import load_contract


def load_rgb(path):
    with Image.open(path) as image:
        image.load()
        profile = image.info.get("icc_profile")
        image = ImageOps.exif_transpose(image)
        if profile:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                            ImageCms.createProfile("sRGB"), outputMode="RGB")
        return image.convert("RGB").copy(), bool(profile)


def letterbox(image, size=224):
    return ImageOps.pad(image, (size, size), method=Image.Resampling.BICUBIC, color=(128, 128, 128))


def prepare(workspace, destination, *, limit=None, seed=42, source_roots=None):
    root, destination = Path(workspace).resolve(), Path(destination).resolve()
    if (destination / "manifest.json").exists():
        raise FileExistsError("Prepared dataset is frozen. Reuse it, or choose a new --data directory.")
    contract = load_contract(root)
    paths = set()
    folders = source_roots or (root/"data/Apple", root/"data/raw/inputs", root/"data/raw/references")
    for folder in map(Path, folders):
        if folder.exists():
            paths.update(p for p in folder.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"))
    paths = sorted(p for p in paths if p.is_file() and not any(x.is_symlink() for x in (p, *p.parents)))
    random.Random(seed).shuffle(paths)
    records, excluded, seen = [], [], set()
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "images").mkdir(exist_ok=True)
    for path in paths:
        if limit and len(records) >= limit:
            break
        try:
            if "Vivien-Liu-Malin-Fezehai-Mika-Ninagawa" in path.name:
                raise ValueError("known multi-photo collage")
            image, has_icc = load_rgb(path)
            aspect = image.width/image.height
            if min(image.size) < 224:
                raise ValueError("shortest side below 224px")
            small = np.asarray(image.resize((64, 64)), dtype=np.float32)
            chroma = (np.abs(small[...,0]-small[...,1]).mean()+np.abs(small[...,1]-small[...,2]).mean())/2
            if chroma < 1:
                raise ValueError("monochrome/very-low-chroma review candidate")
            pixel_hash = hashlib.sha256(str(image.size).encode()+image.tobytes()).hexdigest()
            if pixel_hash in seen:
                raise ValueError("exact decoded-pixel duplicate")
            seen.add(pixel_hash)
            file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            gray = np.asarray(image.convert("L").resize((9, 8)))
            bits = (gray[:, :-1] > gray[:, 1:]).ravel()
            dhash = sum(int(bit) << i for i, bit in enumerate(bits))
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            relative = f"images/{file_hash}.png"
            image.save(destination/relative)  # Lossless working copy; originals stay unchanged.
            records.append({"image_id": file_hash, "source": path.relative_to(root).as_posix(),
                            "source_sha256": file_hash, "path": relative, "dhash": dhash,
                            "aspect": aspect, "had_icc": has_icc,
                            "pixel_sha256": pixel_hash})
        except (OSError, ValueError) as error:
            excluded.append({"source": path.relative_to(root).as_posix(), "reason": str(error)})
    if len(records) < 10:
        raise ValueError(f"Need at least 10 usable photos for separate train/validation/test groups; found {len(records)}")
    parents = list(range(len(records)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    def union(i, j):
        parents[find(j)] = find(i)
    # Conservative near-duplicate grouping, not a claim to identify every burst.
    for i, a in enumerate(records):
        for j in range(i):
            b = records[j]
            if bin(a["dhash"] ^ b["dhash"]).count("1") <= 4 and abs(a["aspect"]/b["aspect"]-1) < .05:
                union(i, j)
    # Optional manual scene/burst groups override the automatic screen.
    group_file = root/"data/metadata/groups.csv"
    if group_file.exists():
        by_path = {row["source"]: i for i, row in enumerate(records)}
        groups = defaultdict(list)
        with group_file.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if row["path"] in by_path and row["group_id"]:
                    groups[row["group_id"]].append(by_path[row["path"]])
        for group in groups.values():
            for index in group[1:]: union(group[0], index)
    components = defaultdict(list)
    for i, row in enumerate(records): components[find(i)].append(row)
    groups = sorted(components.values(), key=lambda group: min(r["image_id"] for r in group))
    random.Random(seed).shuffle(groups)
    if len(groups) < 10:
        raise ValueError("Need at least 10 independent groups after duplicate grouping")
    nval = max(1, int(len(groups)*.1))
    ntest = max(1, int(len(groups)*.1))
    for i, group in enumerate(groups):
        split = "validation" if i < nval else "test" if i < nval+ntest else "train"
        group_id = min(r["image_id"] for r in group)
        for row in group:
            row.update(group_id=group_id, split=split)
    manifest = {"schema": 1, "seed": seed, "contract_sha256": contract["sha256"],
                "records": records, "excluded": excluded,
                "split_counts": dict(Counter(r["split"] for r in records)),
                "group_count": len(groups), "missing_icc_assumption": "assume sRGB; review before production"}
    (destination/"manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Prepared {len(records)} photos in {len(groups)} groups: {manifest['split_counts']}", flush=True)
    return manifest
