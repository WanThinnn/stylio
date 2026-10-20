#!/usr/bin/env python3
"""Dump the HEVC Portrait depth auxiliary of one HEIC to an 8-bit PNG."""
from __future__ import annotations
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import photographic_style_port as p  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: dump-portrait-depth.py INPUT.HEIC OUTPUT.png", file=sys.stderr)
        return 2
    src, dst = map(Path, argv)
    data = src.read_bytes()
    d = p.discover_heic(data)
    ids = [i for i in d["infos"] if p.aux_uri_for_item(d["props"], i) == p.DEPTH_URI]
    if len(ids) != 1:
        raise SystemExit(f"expected exactly one depth auxiliary, found {len(ids)}")
    iid = ids[0]
    width, height = p.dimensions_for_item(d["props"], iid)
    hvcc = p.property_box_bytes(data, d["props"], iid, "hvcC")
    if hvcc is None:
        raise SystemExit("depth auxiliary has no hvcC")
    bitstream = p._hvcc_to_annexb(hvcc) + p._sample_to_annexb(p.extract_item(data, d["iloc"], iid))
    with tempfile.NamedTemporaryFile(suffix=".265", delete=False) as tmp:
        tmp.write(bitstream)
        raw = Path(tmp.name)
    try:
        subprocess.run([
            "ffmpeg", "-y", "-threads", "1", "-loglevel", "error",
            "-i", str(raw), "-frames:v", "1", "-vf", "format=gray",
            str(dst)
        ], check=True)
    finally:
        raw.unlink(missing_ok=True)
    print(f"{src.name}: depth {width}x{height} -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
