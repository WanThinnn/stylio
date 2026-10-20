# AI model assets and distribution

Model binaries and license notices stay under `web/vendor/`. This guide consolidates the former model README/MODELS documents. Commands are run from the repository root; model asset paths below are relative to their corresponding `web/vendor/ai-*` folder.

### Depth model assets

The UI names are Lite, Standard and Pro. Files are fetched by
`tools/download-ai-portrait.mjs`; uploaded photos are never sent to these sources.

| UI | Source | Revision | Format |
| --- | --- | --- | --- |
| Lite | onnx-community/depth-anything-v2-small | 4472b7362082ad9968fee890ca0f1e5aca36b93d | q4 |
| Standard | onnx-community/depth-anything-v2-small | 4472b7362082ad9968fee890ca0f1e5aca36b93d | fp32 |
| Pro | onnx-community/depth-anything-v3-small | 0b6a7f3bf5595f9950b91389e0da3a0de130324c | fp32 with external weights |

V2: https://github.com/DepthAnything/Depth-Anything-V2
V3: https://github.com/ByteDance-Seed/Depth-Anything-3
ONNX conversions: https://huggingface.co/onnx-community

V2 Small and V3 Small use Apache 2.0. Full licenses are retained in
MODEL-LICENSE.txt and PRO-MODEL-LICENSE.txt. Artifact URLs, sizes and SHA-256
checksums are recorded in assets.json. Model version alone does not guarantee
better hair or Portrait Lighting in Apple's renderer.

### Portrait foreground and boundary models

Standard and Pro share the same IS-Net global 1024 input, matte-guided EdgeSAM-3x
pass, matte-depth fusion and autofocus. Only their Depth Anything model differs.
The Pro-only local crop experiment was removed after iPhone testing. Lite skips
IS-Net and uses Apple PEM/skin guidance when present; without guidance it keeps
generated depth without running unconstrained subject discovery.

IS-Net uses `Ko033/isnet-general-use-onnx`, revision
`5a3f3a4ad0d6fe586bc5b293ded13f5212390c24`, Apache-2.0. Its FP16 ONNX weights
are 88,141,111 bytes, SHA-256
`0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c`.
`foreground-assets.json` pins its source, input/output names, normalization and
hash; `tools/download-foreground-matte.mjs` verifies the downloaded bytes.
EdgeSAM's encoder/decoder remain pinned in `assets.json`; their S-Lab 1.0 notice
and the owner's personal, non-commercial use scope remain unchanged.

Models run sequentially in terminated workers; model bytes, not live sessions,
are cached. Optional foreground/refinement failure retains existing guidance or
depth, while parent cancellation propagates. Source mattes remain untouched;
the generated matte is used internally and is not injected into the HEIC.


### Local AI Detail models

These models were downloaded into the **user's own local workspace** (not
uploaded to ChatGPT) with:

```sh
node tools/download-ai-detail.mjs
python tools/verify-ai-detail-models.py
```

The download tool streams pinned upstream model revisions to `.partial`
files, verifies each SHA-256, then moves the files into place. Repeat
runs validate the existing files instead of downloading them again.
`assets.json` holds hashes and model metadata consumed by ONNX Runtime Web.

| UI tier | Original 1x ONNX family | Local asset | Source |
| --- | --- | --- | --- |
| Lite | SuperScale SPAN | lite.onnx | notaneimu/onnx-image-models |
| Standard | RT-Focuser 2025 (25% blend in runtime) | standard.onnx | ReaganWu/RT-Focuser |
| Pro | Fatality DeBlur | pro.onnx | notaneimu/onnx-image-models |

**Actual local validation:** all three inputs and outputs are RGB float32
NCHW tensors with scale 1×; tested against onnxruntime CPU with a real
synthetic RGB image. This does **not** validate Safari/iPhone WebGPU execution,
image appearance on real photographs, or Apple Photos editability after AI.

**License warning:** RT-Focuser Standard is MIT-licensed and pinned to its
upstream commit. OpenModelDB lists the original SuperScale SPAN and Fatality
DeBlur weights as **CC BY-NC-SA 4.0**; the Hugging Face ONNX conversions do not
override those original terms. Review attribution, share-alike and
non-commercial restrictions before public/commercial distribution. See
[model evaluation](../superpowers/plans/AI-DETAIL-MODEL-EVALUATION.md).
Therefore the large downloaded ONNX files are ignored by Git and CI/CD
must not automatically package them for public Pages releases.

Detail supports raster inputs and the guarded native HDR HEIC path in
`web/src/detail/detail-native-heic.js`. Unsupported HEIC layouts keep the source
with an explanation. Model I/O verification alone does not establish Photos
editability or device rendering compatibility.

Use a local HTTP server serving `web/` so model files resolve from
`vendor/ai-detail/`. Opening `index.html` with `file://` bypasses the
normal service worker / cross-origin isolation requirements.


### Suggested Styles AI assets

Suggested Styles uses zero-shot image/text embeddings. It does not train on a
photo dataset and does not ship a text encoder or tokenizer to the browser.
Only image-only ONNX graphs and build-time style prototype vectors are shipped.

### Runtime tiers

| Level | Encoder | License | Views | Embedding |
| --- | --- | --- | ---: | ---: |
| Lite | TinyCLIP ViT-8M/16 | MIT | 3 | 512 |
| Standard | TinyCLIP ViT-39M/16 | MIT | 9 | 512 |
| Pro | SigLIP2 Base patch16 224 | Apache-2.0 | 17 | 768 |

No MobileCLIP or other Apple model weight is included. `assets.json` pins the
exact upstream revision, byte length, SHA-256, preprocessing contract, and the
INT8 WASM / FP16 WebGPU asset for every tier. License texts are stored in
`licenses/`.

The runtime downloads only the chosen tier/provider. Large ONNX files are kept
in the SHA-verified model cache and are not duplicated by the service worker.

### Zero-shot style prototypes

`tools/style-prototype-prompts.json` contains reviewable English positive and
negative prompts for the 14 supported colour Styles. B&W IDs 13 and 15 are
intentionally absent, so they cannot be recommended.

`style-prototypes-{lite,standard,pro}.json` contains normalized prompt means in
the exact embedding space of its matching image encoder. At runtime every crop
is compared directly with these vectors. The global view has extra weight;
support across crops, top-two margin, and dispersion determine confidence.
Genuine cross-view disagreement fails closed to Standard. Image statistics only
refine tone, colour, and Palette, whose injected value remains conservatively
capped.

### Rebuilding and verification

Install the Python build dependencies documented at the top of
`tools/build-ai-style-models.py`, then run:

```text
python -u tools/build-ai-style-models.py
```

The builder:

1. resolves and pins each upstream repository revision;
2. extracts `pixel_values -> image_embeds` and the build-only text tower;
3. exports INT8 and FP16 image-only graphs;
4. executes each graph through ONNX Runtime;
5. projects the reviewed prompts into per-tier prototype files;
6. writes the schema-2 manifest and license files.

An interrupted build can resume: completed model variants and matching
prototypes are hashed and reused. `node tools/verify-ai-style-model.mjs` performs
an independent manifest, hash, I/O, and inference check when
`onnxruntime-node` is installed.

### Reference-bank diagnostics

`reference-bank.json` is retained only for private-corpus audits and research
comparisons. It is not consulted by the recommendation runtime and never gates
Suggested Styles availability. Original pixels, filenames, EXIF, timestamps,
GPS, face metadata, and free-form source metadata must never enter that file.
