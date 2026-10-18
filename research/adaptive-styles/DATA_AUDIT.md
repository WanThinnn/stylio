# Local dataset audit — 2026-10-16

Original files were inspected in place. No images were moved, deleted, resized or
downloaded. Detailed local reports and a numbered contact sheet are in
`outputs/audits/2026-10-16/` (ignored by Git).

## Apple

Location: `data/Apple/`

- 81 JPEG files, 184,599,907 bytes (176.05 MiB).
- All 81 passed JPEG verification and full pixel decoding with Pillow.
- No exact file duplicates or identical decoded-image duplicates were found.
- A simple perceptual-hash screen found no close full-image duplicate candidates;
  this is not proof that crops or embedded parts of a collage are unique.
- Dimensions range from a shortest side of 1,102 px to a longest side of 4,032 px.
- 53 files embed an sRGB IEC61966-2.1 ICC profile; 28 have no embedded ICC profile.
  Do not infer the color space of those 28 solely from their JPEG extension.
- 12 files were flagged as monochrome or nearly monochrome by a low-chroma screen.
  These need review rather than automatic removal: a dim color photo can also
  trigger that test.
- Visual review of the contact sheet identified one three-photo exhibition collage:
  `Apple-I-Remember-You-photography-in-Paris-Vivien-Liu-Malin-Fezehai-Mika-Ninagawa.jpg`.
  Exclude this composite from a single-photo reference pool. Keep its original file.

The remaining color photographs are useful aesthetic reference candidates after
review. They have no before/after mappings or complete Style/parameter labels.
Words such as Bright, Ethereal or Vibrant in a filename are source hints, not
verified per-image training targets.

## Unsplash Lite

Location: `data/unsplash-research-dataset-lite-latest/`

- 8 files, 905,860,154 bytes (863.90 MiB); all are metadata/documentation.
- **No actual photo files are present in this folder.**
- `photos.tsv000` contains 25,000 records with 25,000 unique photo IDs.
- Every record has a `photo_image_url`; URL reachability has not been checked.
- 24,805 records have `photo_featured=t`; editorial selection is not a human
  quality score or a preference label for a particular input photo.
- 617 records have an iPhone-like camera model string. This is a useful metadata
  filter, not proof of unedited iPhone camera output. Most of those records describe
  older iPhones, so a mobile input test set should also contain recent real inputs.
- `collections.tsv000` and `conversions.tsv000` account for about 797 MiB together.
  These tables are unnecessary for the first color-recommendation baseline.
  They were left untouched; there is no need to load them into RAM during training.
- The first experiment can use `photos.tsv000`, selected keyword/color fields and
  a bounded selection of downloaded images. Do not fetch all 25,000 automatically.

## Import and storage notes

The original scaffold scans `data/raw/{inputs,references,paired}/`. The user's
`data/Apple/` folder currently sits outside those roots, so it needs explicit import
registration or a deliberate folder reorganization before that notebook can index
it. This audit did not silently move the user's files.

The workspace ignore rules now protect **all files under `data/`**, including
manually named import folders and Unsplash TSVs. Only `.gitkeep` markers and the
metadata CSV templates are exceptions. Reports under `outputs/` also stay local.

For the first experiment, select approximately 2,000 diverse Unsplash references
at a bounded working size, review the Apple images, and add a separate real input
set. This is a collection target, not a completed download or a sufficiency claim.
Candidate edits and preference/parameter labels are still needed before training.

## Pexels candidate

Pexels has useful photography, but it is not currently a downloaded training source
in this workspace. Its official [API terms explanation](https://help.pexels.com/hc/en-us/articles/900005880463-What-are-the-Terms-and-Conditions)
explicitly says that API collection at scale for ML training, fine-tuning or
evaluation requires permission. The general free-photo license is not a blanket
authorization for that collection workflow. Use the existing Unsplash dataset
route first; mark Pexels as a permission-dependent candidate rather than scheduling
a bulk scraper.

## Subsequent downloader verification

After the read-only audit, the new downloader successfully fetched three sample
JPEGs into `data/raw/references/unsplash-lite-1024-q90/`, totaling 436,606 bytes.
All three passed decoding/size checks. Source URLs and attribution were recorded
in `data/metadata/unsplash-lite-1024-q90.jsonl`. The original import folders remain
unchanged. The remaining Unsplash images have not been downloaded.

The downloader's URL validation also identified three malformed historical records
in `photos.tsv000`; these are excluded from selection. A nonempty URL field alone
does not establish that it is a valid or reachable image URL.

## Training pipeline integration

The new `train.py prepare` stage explicitly reads `data/Apple/` as well as
`data/raw/inputs/` and `data/raw/references/`. No manual move is needed for training.
The original inventory notebook remains a separate raw-folder inventory utility.
See `TRAINING.md` for candidate scoring, review, training and export commands.
