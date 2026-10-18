"""Read-only raw-image inventory. No downloads, decoding or inferred labels."""

import argparse
import csv
import hashlib
from pathlib import Path

ROLES = ("inputs", "references", "paired")
IMAGE_SUFFIXES = frozenset({
    ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif",
    ".dng", ".arw", ".cr2", ".cr3", ".nef", ".raf", ".rw2", ".orf",
})
FIELDS = ("image_id", "role", "collection_id", "path", "suffix", "bytes", "sha256")


def find_workspace(start=None):
    """Locate this workspace from either its root or a notebook directory."""
    path = Path(start or Path.cwd()).resolve()
    for candidate in (path, *path.parents):
        if (candidate / "configs/baseline.json").is_file() and (
            candidate / "src/adaptive_styles"
        ).is_dir():
            return candidate
    raise FileNotFoundError("Run from research/adaptive-styles or one of its subdirectories.")


def inventory(workspace):
    """Inventory local images with deterministic ordering and content hashes.

    image_id identifies the path; sha256 identifies exact content duplicates.
    Collection is the first directory inside a role, or 'unassigned' for loose files.
    Symlinks are excluded so raw-data links cannot read outside the workspace.
    """
    root = Path(workspace).resolve()
    rows = []
    for role in ROLES:
        folder = root / "data/raw" / role
        if not folder.exists():
            continue
        for path in sorted(folder.rglob("*")):
            relative = path.relative_to(root)
            if any((root / parent).is_symlink() for parent in (relative, *relative.parents)):
                continue
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            within_role = path.relative_to(folder)
            posix_path = relative.as_posix()
            rows.append({
                "image_id": hashlib.sha256(posix_path.encode("utf-8")).hexdigest(),
                "role": role,
                "collection_id": within_role.parts[0] if len(within_role.parts) > 1 else "unassigned",
                "path": posix_path,
                "suffix": path.suffix.lower(),
                "bytes": path.stat().st_size,
                "sha256": digest.hexdigest(),
            })
    return rows


def write_inventory(rows, output, *, overwrite=False):
    """Write generated data explicitly, protecting existing output by default."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w" if overwrite else "x", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    root = find_workspace()
    rows = inventory(root)
    if not rows:
        print("No images yet. Add datasets under data/raw/{inputs,references,paired}/<collection>/.")
        return
    output = root / "data/processed/inventory.csv"
    write_inventory(rows, output, overwrite=args.overwrite)
    unique = len({row["sha256"] for row in rows})
    print(f"Indexed {len(rows)} files, {unique} unique hashes: {output}")


if __name__ == "__main__":
    main()
