# Adaptive Styles research — v1.1.0

Python and Jupyter workspace for training the next Stylio style recommender.
Status: runnable research baseline with candidate scoring, review, training,
checkpoint resume, evaluation and ONNX export. The released app is not changed.

**Start training:** see [TRAINING.md](TRAINING.md), or run from this directory:

```powershell
python train.py run --max-images 1000 --epochs 20 --batch-size 8
```

This uses the current Python environment with CUDA PyTorch and the training
dependencies. The current machine's CUDA environment has been verified. The first
run downloads teacher and pretrained student weights. The automatic labels are
teacher preferences, not human ground truth. A small verification run proves the
pipeline executes; it does not establish production aesthetic quality.

See [Data sources](DATA_SOURCES.md) for the verified dataset shortlist, nine Apple
Newsroom collections, download instructions and import priorities. The discovery
catalog is also available as [CSV](configs/source-catalog.csv).

The [local data audit](DATA_AUDIT.md) records the imported Apple photos and Unsplash
metadata currently on disk, including import-layout notes and remaining preparation.

## Quick start

From this directory, with Python 3.12 and [uv](https://docs.astral.sh/uv/):

```powershell
uv sync
uv run jupyter lab
```

Open `notebooks/00_dataset_inventory.ipynb`, then `03_train_baseline.ipynb`.
The notebooks also work in VS Code with this project's `.venv` selected as kernel.
For an existing Python environment: `python -m pip install -e .`.
The default dependency set is for notebooks/data tools. Training additionally needs
the `train` optional dependencies and CUDA-enabled PyTorch; see [installation](TRAINING.md).

## Download Unsplash images from the Lite metadata

The downloaded Lite archive contains metadata, not the image files themselves.
The [official field documentation](https://github.com/unsplash/datasets/blob/master/DOCS.md)
identifies `photo_image_url` as the image URL. Our downloader reads only `photos.tsv000`;
it does not need the large conversions or collections tables or an API key.

From this directory:

```powershell
# Inspect the plan without accessing the network:
uv run python download_unsplash.py --count 2000

# Download at most 2,000 JPEGs, longest side 1,024 px, capped at 2 GiB:
uv run python download_unsplash.py --count 2000 --download
```

If your selected Python already has Pillow, `python download_unsplash.py ...` also
works without installing the research package. Alternatively open
`notebooks/02_download_unsplash.ipynb` and set `DOWNLOAD = True`.

Images go to `data/raw/references/unsplash-lite-1024-q90/`; local source URLs,
attribution and hashes go to `data/metadata/unsplash-lite-1024-q90.jsonl`.
The URL requests a bounded JPEG with `fit=max`, not a square crop or color filter.
Downloads are working copies; they do not replace full-resolution source originals.

- Rerun the same command to resume. Completed JPEGs are validated and skipped.
- Use `--count 20 --download` for a small first batch, or `--iphone-only` to filter
  camera metadata. Default selection is deterministic random sampling (seed 42),
  not an automatic guarantee of scene balance or aesthetic quality.
- Change `--size 512` or `--max-gib 1` to reduce size/budget. Changing size creates
  another image folder; all folder budgets still contribute to total disk usage.
- The cap includes existing files in the destination, but excludes filesystem
  overhead and the small metadata journal. Run one downloader at a time.
- A failed response is not saved as a JPEG. Interrupted transfers are cleaned up
  when Python can unwind; a forcibly killed process can leave ignored `.part` files.
- A 401/403/429 stops the run. Other failures are printed; rerunning retries missing
  files. No missing photos are replaced with fabricated samples.
- Malformed historical image URLs are excluded from selection. The current local
  Lite metadata has three such records outside the expected image host.

Offline downloader checks: `python -m unittest discover -s tests -p test_unsplash.py`.

## Add data later

```text
data/
  raw/
    inputs/<collection>/...       # Everyday input photos
    references/<collection>/...   # Beautiful photos, including Apple-selected samples
    paired/<collection>/...       # Before/after data, e.g. FiveK
  metadata/
    sources.csv                  # Collection provenance, filled in manually
    pairs.csv                    # Explicit before/after mapping, filled in manually
  processed/                     # Generated inventory and prepared data
outputs/                         # Runs, plots, metrics, checkpoints
exports/                         # Future browser inference exports
```

Keep originals unchanged, including EXIF and ICC profiles. Extraction, decoding,
color conversion, resizing and labels belong in later preparation stages.
HEIC/DNG/RAW files are inventoried but need an explicit decoder before preview/training.
Folder paths are relative to this workspace, not to `notebooks/`.

The CSV templates have headers only. Add one source row per collection, with its
root-relative path, URL/owner and usage terms. Add paired rows only when both images
really show the same scene before and after editing. `group_id` identifies a scene
or burst, including all crops, variants and retoucher outputs from that scene.
Do not infer pairs from directory ordering or filenames alone.

Run the inventory from this directory:

```powershell
uv run python -m adaptive_styles.dataset
```

This hashes local files and records exact duplicates without changing the originals.
The inventory is generated, not a label set. It includes all exact duplicates so
they can be inspected before deduplication. It does not detect resized duplicates.
Existing output is protected unless `--overwrite` is supplied. With no data, it
reports an empty dataset and writes nothing.

## Experiment direction

The student is one compact MobileNetV3-Small model predicting Style preferences and
bounded, Style-conditional Tone/Color/Palette parameters. A frozen CLIP ViT-B/32 +
LAION aesthetic V1 teacher ranks edits made by the app's current SDR preview renderer.
Teacher scoring is used only in data preparation. Softmax confidence is uncalibrated
label agreement and must not be treated as a probability of aesthetic quality.
See `configs/baseline.json` and [TRAINING.md](TRAINING.md) for the implemented baseline.

- Paired datasets teach editing relationships; they do not automatically provide
  Stylio Style IDs or Tone/Color/Palette targets.
- Reference photos teach aesthetic preferences; they are not paired targets or
  proof of an unedited camera color pipeline.
- Labels must come from rendered candidates, ratings or explicit annotations.
  Existing English prompt prototypes are a baseline, not human ground truth.
- Split by scene/burst before crops and augmentation. Keep exact and near duplicates
  together. Leave the test set untouched during tuning.
- Compare against the current app on real iPhone inputs and Apple Photos renders;
  browser preview colors alone are insufficient to validate the result.

`configs/baseline.json` points to the app's existing prompt catalog and parameter
contract. Its recorded bounds must be reviewed if that contract changes.
No current runtime models are replaced by this workspace.

Raw images, local source/pair records and trained artifacts stay out of Git.
Notebook cell outputs are embedded in the notebook file: clear them before sharing.
Dataset/model terms
remain separate from this repository's source license.

## Next steps after the dataset arrives

1. Record sources and review scene/burst groups and color-space assumptions.
2. Prepare frozen working copies and generate teacher labels with `train.py`.
3. Review candidate sheets and supply overrides for mistakes or personal preferences.
4. Train and compare held-out results with Standard and current app behavior.
5. Validate native Photos rendering and benchmark browser inference before integration.
