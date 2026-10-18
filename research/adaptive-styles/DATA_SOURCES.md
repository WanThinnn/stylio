# Adaptive Styles — image and dataset sources

Checked: 2026-10-16. This catalog records remote source discovery and does not imply
that an archive was downloaded or verified. See the separate [local data audit](DATA_AUDIT.md)
for the user's subsequent Apple and Unsplash imports. Download links on a landing
page do not guarantee that every archive is accessible without authentication.

The machine-readable shortlist is [configs/source-catalog.csv](configs/source-catalog.csv).
It is a discovery catalog, not evidence that a collection has already been imported.
After import, record actual provenance in local `data/metadata/sources.csv` and
explicit pair/group mappings in `pairs.csv`.

## Start with these

1. **FiveK 480p** for the first paired-data experiment; use the original FiveK page
   as the authoritative dataset/provenance reference.
2. **Apple Newsroom collections below** as a small, curated aesthetic reference set.
3. **A selected subset of Unsplash Lite** to broaden scenes and lighting. An initial
   2,000–3,000 selected photos is a practical project target, not a dataset requirement.
4. **PPR10K** when testing portrait and skin-color behavior; its prepared package is
   large, so it need not block the first experiment.
5. **ICAA17K / PARA** only if training or evaluating an aesthetic ranker/teacher.

These are inputs to our data preparation and labeling work. None supplies Stylio's
Style ID plus Tone/Color/Palette targets directly.

## Paired editing datasets

| Source | What is available | How to obtain it | Suggested folder |
| --- | --- | --- | --- |
| [MIT–Adobe FiveK](https://data.csail.mit.edu/graphics/fivek/) | 5,000 RAW scenes, each adjusted by five retouchers in Lightroom. Original archive is about 50 GB and contains DNG files, a Lightroom catalog and scene metadata; the page also offers individual 16-bit ProPhoto RGB TIFF renditions. | Use the archive/parts or individual files linked on the official page. The archive is not a ready-made sRGB before/after training tensor set. | `data/raw/paired/fivek-original/` |
| [FiveK 480p from Image-Adaptive-3DLUT's authors](https://github.com/HuiZeng/Image-Adaptive-3DLUT#downloads) | A prepared FiveK derivative: 480p inputs in 8-bit sRGB / 16-bit XYZ and targets in 8-bit sRGB. | The repository's **Downloads → Datasets** section links Google Drive, OneDrive and Baidu. Archive byte downloads were not tested here. | `data/raw/paired/fivek-480p/` |
| [PPR10K](https://github.com/csjliang/PPR10K) | 11,161 portrait originals in 1,681 groups, three retoucher versions, human-region masks and XMP adjustments. Repository lists about 406 GB overall and 91 GB for the prepared 360p image directory. | Use the [author-linked Google Drive folder](https://drive.google.com/drive/folders/1kB2OSAGy8uc0xUXaMKoPB0HMSc-rkrLW). For a first portrait experiment, select the prepared images and relevant masks rather than all RAW assets. | `data/raw/paired/ppr10k/` |

FiveK original and FiveK 480p contain overlapping scenes: **they are not two
independent datasets**. Keep every retoucher version, resolution and augmentation
of a scene in the same split. PPR10K's prepared package includes augmented inputs;
its file count must not be treated as independent-scene count.

FiveK publishes research licenses ([Adobe/MIT](https://data.csail.mit.edu/graphics/fivek/legal/LicenseAdobeMIT.txt),
[Adobe](https://data.csail.mit.edu/graphics/fivek/legal/LicenseAdobe.txt)). PPR10K's
dataset agreement is non-commercial research only, separate from its code license.

## Apple Newsroom — nine verified collection pages

All nine pages below expose **Download all media** near the end of the article.
Use that control or the individual photo download when present. Archive contents,
dimensions and byte sizes still need inspection after download.

| Collection | Useful material | Suggested collection ID |
| --- | --- | --- |
| [Shot on iPhone Challenge winners — 2019](https://www.apple.com/newsroom/2019/02/apple-highlights-best-photos-shot-on-iphone-around-the-world/) | Ten selected photographs: everyday scenes, architecture, people, animals and landscapes. Includes monochrome work. | `apple-shot-on-iphone-2019` |
| [Night mode Challenge winners — 2020](https://www.apple.com/newsroom/2020/03/apple-reveals-the-best-night-mode-photos-shot-on-iphone/) | Six selected photographs from the iPhone 11 family; useful night lighting and warm/cool contrasts. | `apple-night-mode-2020` |
| [Shot on iPhone 12 — 2021](https://www.apple.com/newsroom/2021/01/shot-on-iphone-12-portraits-cityscapes-the-night-sky-and-more/) | Portraits, city scenes, night skies and other examples with photographer/device captions. | `apple-shot-on-iphone-12` |
| [Macro Challenge winners — 2022](https://www.apple.com/newsroom/2022/04/apple-unveils-the-best-photos-from-the-shot-on-iphone-macro-challenge/) | Ten selected macro photographs from iPhone 13 Pro/Pro Max; nature, textures and color detail. | `apple-macro-2022` |
| [“I Remember You” exhibition — 2023](https://www.apple.com/newsroom/2023/11/new-iphone-photography-exhibition-debuts-in-paris-on-november-10/) | Work by five photographers on iPhone 15 Pro Max; portraits, urban scenes, flowers and monochrome work. | `apple-paris-exhibition-2023` |
| [iPhone 14 Pro launch — 2022](https://www.apple.com/newsroom/2022/09/apple-debuts-iphone-14-pro-and-iphone-14-pro-max/) | Camera sample photographs mixed with product and feature imagery. | `apple-iphone-14-pro` |
| [iPhone 15 Pro launch — 2023](https://www.apple.com/newsroom/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/) | Camera samples including portraits, low-light scenes and outdoor subjects. Product imagery is mixed into the same page. | `apple-iphone-15-pro` |
| [iPhone 16 Pro launch — 2024](https://www.apple.com/newsroom/2024/09/apple-debuts-iphone-16-pro-and-iphone-16-pro-max/) | Camera/Photographic Styles examples; retain caption context when selecting photos. | `apple-iphone-16-pro` |
| [iPhone 17 Pro launch — 2025, English regional page](https://www.apple.com/gw/newsroom/2025/09/apple-unveils-iphone-17-pro-and-iphone-17-pro-max-the-most-powerful-and-advanced-pro-models-ever/) | Portrait, flower, pomegranate, overhead and night camera samples; a caption explicitly identifies a Bright-style portrait. The regional URL was used because the US page failed to fetch during this check. | `apple-iphone-17-pro` |

Store selected files under `data/raw/references/<collection-id>/`. Preserve the
original article URL, asset URL, caption, photographer credit and device when known.

Selection rules for this project:

- Keep actual camera-sample photographs; exclude product renders, UI screenshots,
  collages with phone frames, logos and video thumbnails.
- Separate monochrome work from the current color-style reference pool. It may
  remain useful for later contrast/ranking experiments.
- Deduplicate localized pages, gallery repeats, crops and resized variants.
- Treat these as Apple-selected references. A sample does not establish an unedited
  camera pipeline, RAW access, paired supervision or exact Apple editing parameters.
  The [2019 challenge rules](https://images.apple.com/newsroom/pdfs/iPhoneChallengeRules_012419.pdf)
  explicitly allow edited submissions.
- A captioned Style name can be retained as source metadata; it is not automatically
  a preferred target Style for another image.

Apple's media download controls establish availability, not an open training license.
Record applicable media/photographer terms; this catalog makes no permission claim
for distributing the photos or a resulting public model.

## Larger unpaired reference pool

**[Unsplash Lite Dataset](https://github.com/unsplash/datasets#lite-dataset)** provides
records for approximately 25,000 photos. Download the Lite archive linked in the
official repository. The archive supplies TSV metadata; use `photos.tsv`'s
`photo_image_url` to retrieve the actual image files separately. Its archive size
must not be interpreted as the total size of all full-resolution photos.

The [field documentation](https://github.com/unsplash/datasets/blob/master/DOCS.md)
includes author information, dimensions, `photo_featured`, and camera make/model.
Camera metadata can help select iPhone photographs, but missing fields and prior
editing mean it cannot establish an untouched native-camera look. Popularity or
editorial selection is a selection aid, not a calibrated aesthetic rating.

Suggested location: `data/raw/references/unsplash-lite/`. Start with a balanced
selection of people, food, interiors, streets, landscapes and night scenes, rather
than only highly saturated travel photographs.

Use the dedicated [Unsplash Dataset Terms](https://github.com/unsplash/datasets/blob/master/TERMS.md).
Lite explicitly permits internal ML training subject to its terms; redistribution
of the supplied data is restricted. Full has different, non-commercial conditions.
This is not a recommendation to scrape the general website or assume its ordinary
photo license covers every ML use.

## Optional datasets for an aesthetic ranker

| Source | Why it matters here | Access and limits |
| --- | --- | --- |
| [ICAA17K — official ICCV 2023 project](https://github.com/woshidandan/Image-Color-Aesthetics-and-Quality-Assessment) | Color-aesthetics labels are closer to our color-ranking problem than generic subject classification. Useful for a teacher/ranker experiment. | Authors link [dataset and labels on Google Drive](https://drive.google.com/file/d/18PDtXiQNqHe8NUFK9jpuAjBp2MxRjRGM/view). Dataset contents and training permissions need inspection; this check does not establish a permissive dataset license. |
| [PARA — official CVPR 2022 project](https://yuzheyang.github.io/blog/Dataset/PARA.html) | 31,220 images annotated by 438 subjects, with image attributes and individual preference information. Useful for learning that aesthetic judgments vary. | Follow **Download Instruction → Download PARA** on the author page. Academic use only; the final download/access flow has not been completed here. |

If imported, keep these in separate collections under `data/raw/references/` and
retain their scores/annotations in metadata. They include a range of quality levels:
**do not mark the entire dataset as positive “beautiful photo” examples**.

## What is still needed from our own inputs

Add real iPhone input photos across devices, skin tones, backlight, indoor mixed
lighting, night scenes, food and landscapes under `data/raw/inputs/iphone-local/`.
Freeze scene-disjoint validation/test groups before generating candidate edits.
The source catalog is enough to begin collection; it does not remove the need for
candidate renders and preference/parameter labels before supervised training.

## Additional candidate: Pexels

[Pexels](https://www.pexels.com/vi-vn/) is a potential photography source, but it is
not part of the default download plan. Its [official API terms explanation](https://help.pexels.com/hc/en-us/articles/900005880463-What-are-the-Terms-and-Conditions)
requires permission for API collection at scale for ML/AI training, fine-tuning or
evaluation. Keep this candidate separate from the established Unsplash Dataset
workflow until the intended collection has permission.

Access update (2026-10-16): Pexels is also [pausing issuance of new API keys](https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key).
The current workspace has no Pexels key, so collection through the official API
cannot start yet. The linked announcement does not provide a reopening date.
