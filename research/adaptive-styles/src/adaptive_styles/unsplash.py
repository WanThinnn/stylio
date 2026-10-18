"""Download a bounded, reproducible subset from the official Unsplash Lite TSV."""

import argparse
import csv
import hashlib
import json
import random
import re
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from PIL import Image

from adaptive_styles.dataset import find_workspace


def image_url(original, size):
    """Request a JPEG fitting inside a square, preserving the whole composition."""
    url = urlsplit(original)
    if url.scheme != "https" or url.netloc != "images.unsplash.com":
        raise ValueError("Expected an HTTPS images.unsplash.com dataset URL")
    # Dataset URLs are originals; don't inherit crop or color adjustments.
    query = urlencode({"w": size, "h": size, "fit": "max", "fm": "jpg", "q": 90})
    return urlunsplit((url.scheme, url.netloc, url.path, query, ""))


def select_photos(source, count=2000, seed=42, iphone_only=False):
    if count < 1:
        raise ValueError("count must be positive")
    with Path(source).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        required = {"photo_id", "photo_image_url", "exif_camera_model"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Not an Unsplash photos.tsv file: required columns are missing")
        records = {}
        for row in reader:
            if iphone_only and "iphone" not in row["exif_camera_model"].lower():
                continue
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", row["photo_id"]):
                raise ValueError("Invalid photo ID in metadata")
            try:
                image_url(row["photo_image_url"], 1024)
            except ValueError:
                continue  # Some Lite records contain malformed historical URLs.
            records.setdefault(row["photo_id"], row)
    rows = sorted(records.values(), key=lambda row: row["photo_id"])
    random.Random(seed).shuffle(rows)
    return rows[:count]


def validate_jpeg(path, size):
    with Image.open(path) as image:
        if image.format != "JPEG":
            raise ValueError("Response is not a JPEG")
        image.verify()
    with Image.open(path) as image:
        image.load()
        if max(image.size) > size:
            raise ValueError("Image exceeds the requested size")
        return image.size


def download_photos(rows, destination, manifest, *, size=1024,
                    max_bytes=2 * 1024**3, max_image_bytes=8 * 1024**2,
                    delay=0.25, opener=urlopen, progress=print):
    """Resume complete files; limits include existing files in the destination.

    A failed/incomplete transfer never becomes a .jpg. Quota is a stored-byte cap,
    not a guarantee about network traffic or filesystem overhead.
    """
    if size < 64 or size > 4096 or max_bytes < 1 or max_image_bytes < 1 or delay < 0:
        raise ValueError("Invalid size, quota or delay")
    destination, manifest = Path(destination), Path(manifest)
    destination.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    used = sum(path.stat().st_size for path in destination.rglob("*") if path.is_file())
    result = {"planned": len(rows), "downloaded": 0, "already_present": 0,
              "failed": 0, "bytes_on_disk": used, "stop_reason": None}
    logged = set()
    if manifest.exists():
        with manifest.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                    logged.add((record.get("photo_id"), record.get("sha256"), record.get("requested_url")))
                except json.JSONDecodeError:
                    continue  # A partial journal line does not prevent resuming files.
    for index, row in enumerate(rows, 1):
        target = destination / f"{row['photo_id']}.jpg"
        url = image_url(row["photo_image_url"], size)
        temporary = None
        try:
            cached = target.exists()
            if cached:
                dimensions = validate_jpeg(target, size)
            else:
                allowance = min(max_image_bytes, max_bytes - used)
                if allowance <= 0:
                    result["stop_reason"] = "storage_budget"
                    break
                request = Request(url, headers={"User-Agent": "StylioResearch/0.1", "Accept": "image/jpeg"})
                with opener(request, timeout=30) as response:
                    length = response.headers.get("Content-Length")
                    if length and int(length) > max_image_bytes:
                        raise ValueError("Image exceeds the per-image byte limit")
                    if length and int(length) > max_bytes - used:
                        result["stop_reason"] = "storage_budget"
                        break
                    with tempfile.NamedTemporaryFile(dir=destination, suffix=".part", delete=False) as stream:
                        temporary = Path(stream.name)
                        received = 0
                        while True:
                            block = response.read(min(64 * 1024, allowance - received + 1))
                            if not block:
                                break
                            received += len(block)
                            if received > allowance:
                                if max_bytes - used <= max_image_bytes:
                                    result["stop_reason"] = "storage_budget"
                                raise ValueError("Download exceeds the remaining byte allowance")
                            stream.write(block)
                dimensions = validate_jpeg(temporary, size)
                temporary.replace(target)
                temporary = None
                used += target.stat().st_size
                if delay:
                    time.sleep(delay)
            sha256 = hashlib.sha256(target.read_bytes()).hexdigest()
            key = (row["photo_id"], sha256, url)
            if key not in logged:
                record = {key: row.get(key, "") for key in (
                    "photo_id", "photo_url", "photo_image_url", "photographer_username",
                    "photographer_first_name", "photographer_last_name", "exif_camera_make",
                    "exif_camera_model", "photo_description", "photo_featured")}
                record.update(requested_url=url, path=target.as_posix(), sha256=sha256,
                              bytes=target.stat().st_size, width=dimensions[0], height=dimensions[1])
                # A leading newline also separates a previously interrupted JSON record.
                with manifest.open("a", encoding="utf-8") as stream:
                    stream.write("\n" + json.dumps(record, ensure_ascii=False) + "\n")
                logged.add(key)
            result["already_present" if cached else "downloaded"] += 1
            progress(f"[{index}/{len(rows)}] {'cached' if cached else 'downloaded'} {row['photo_id']}")
        except (HTTPError, URLError, OSError, ValueError) as error:
            result["failed"] += 1
            progress(f"[{index}/{len(rows)}] failed {row['photo_id']}: {error}")
            if isinstance(error, HTTPError) and error.code in (401, 403, 429):
                result["stop_reason"] = f"http_{error.code}"
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            result["bytes_on_disk"] = used
        if result["stop_reason"]:
            break
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, help="Path to photos.tsv or photos.tsv000")
    parser.add_argument("--count", type=int, default=2000)
    parser.add_argument("--size", type=int, default=1024, help="Longest side in pixels")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-gib", type=float, default=2)
    parser.add_argument("--iphone-only", action="store_true")
    parser.add_argument("--download", action="store_true", help="Without this flag, only show the plan")
    args = parser.parse_args()
    if not 64 <= args.size <= 4096 or not 0 < args.max_gib <= 50:
        parser.error("size must be 64..4096 and max-gib must be >0 and <=50")
    root = find_workspace()
    source = args.metadata or root / "data/unsplash-research-dataset-lite-latest/photos.tsv000"
    rows = select_photos(source, args.count, args.seed, args.iphone_only)
    collection = f"unsplash-lite-{args.size}-q90"
    destination = root / "data/raw/references" / collection
    manifest = root / "data/metadata" / f"{collection}.jsonl"
    print(f"Selected {len(rows)} / requested {args.count}; longest side {args.size}px; cap {args.max_gib} GiB.", flush=True)
    print(f"Images: {destination}\nProvenance: {manifest}", flush=True)
    if not args.download:
        print("Plan only. Add --download to fetch images.")
        return
    result = download_photos(rows, destination, manifest, size=args.size,
                             max_bytes=int(args.max_gib * 1024**3),
                             progress=lambda message: print(message, flush=True))
    print(json.dumps(result, indent=2))
    if result["failed"] or result["stop_reason"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
