# AI Portrait matte-depth fusion — design

Date: 2026-10-20
Branch: `master` (design only; implementation must preserve current Styles / Texture / HDR behavior)

## Goal

Replace the current rule-heavy AI Portrait subject correction with a **multi-signal, AI-first Portrait pipeline** that behaves closer to Apple's single-camera Portrait stack while preserving Stylio's existing editable HEIC export.

The target behavior is:

- keep hands, held objects, hair-like thin structures, keys, cables and narrow object edges in the intended focus group;
- retain scene-relative depth for foreground/background bokeh;
- avoid pulling tables, walls, bottles or unrelated background objects into focus;
- keep the output editable in Apple Photos;
- preserve current Photographic Styles, Texture/Grain and HDR/gain-map behavior byte-for-byte wherever the existing pipeline already guarantees preservation.

The first validation corpus is the current `depth-effect` triplets:
- alcohol bottle + fingers,
- power bank + hand,
- keys + hand,
with native Portrait and unmodified originals as references.

## Why the current approach is insufficient

The current `1243727` baseline improved subject coherence by combining Depth Anything with EdgeSAM, but production inference still asks EdgeSAM to discover the subject from a sparse point grid and then applies deterministic depth rules to the chosen masks.

The failure modes are structural:

1. **Monocular depth can assign the wrong inter-object offset.** In the key case, the hand is near depth ~220 while the key can be inferred near ~111. At f/1.4 this is enough for Photos to blur the key even when it belongs to the same intended focus group.
2. **One semantic mask is not one photographic focus group.** A hand, a key, a key fob and a power bank are separate semantic objects but often one focus group.
3. **Prompt-grid selection is brittle.** A point can land on a background object or table and produce a high-confidence but irrelevant SAM mask.
4. **Hard binary mask thresholds lose thin structures.** Key teeth, fingers, cables and small metallic edges are easy to clip.
5. **Rules cannot reliably infer semantic ownership.** Heuristics such as "object near a border-entering hand" can repair one image and pull unrelated support surfaces into another.

The new design moves subject ownership to learned mattes and uses depth primarily for geometry.

## Architectural principle

The Portrait pipeline becomes:

```text
RGB / HEIC
  |
  +--> Existing Apple Portrait Effects Matte (if present)
  |
  +--> IS-Net general foreground matte (Standard / Pro fallback or supplement)
  |
  +--> EdgeSAM local boundary refinement
  |
  +--> Depth Anything V2 / V3 relative depth
               |
               v
      Matte-conditioned depth fusion
               |
               v
        Existing HEIC Portrait export
```

The **matte decides foreground membership**. The **depth map decides relative geometry** inside and outside that foreground.

EdgeSAM is no longer the primary subject detector. It becomes a local refinement tool driven by foreground/background seeds derived from a matte.

## Signal priority

### 1. Existing Apple Portrait Effects Matte

If the source HEIC contains exactly one valid
`urn:com:apple:photo:2018:aux:portraiteffectsmatte`, Stylio must use it as the highest-priority foreground guidance.

This is already available in many modern non-Portrait iPhone captures. The test source `IMG_2179_org.HEIC` contains:
- Portrait Effects Matte 2016×1512,
- semantic skin matte,
- semantic sky matte.

The current `readPersonGuidance()` path only uses the Portrait Effects Matte to protect a narrow boundary. The new pipeline must consume the matte as a full confidence field.

Requirements:
- preserve the original matte payload and metadata unchanged;
- never replace it with a generated matte in v1;
- map it to the working Portrait inference geometry without changing its source bytes;
- treat it as a soft confidence map, not only a binary person mask.

### 2. IS-Net general foreground matte

For sources without a useful Apple Portrait Effects Matte, and for Standard/Pro when Apple matte coverage is weak or incomplete, run a pinned **IS-Net general-use foreground segmentation model** locally.

Purpose:
- foreground/background separation for general objects, not only people;
- provide one coherent matte for hand + held object when they form the dominant foreground subject;
- preserve thin outlines better than pure depth thresholding.

Runtime target:
- ONNX Runtime Web;
- WebGPU preferred;
- WASM fallback only if memory permits;
- FP16 WebGPU asset;
- integrity-pinned SHA-256;
- lazy downloaded only when AI Portrait requires it.

The selected release asset and exact revision must be verified before implementation is considered complete. The model license must permit Stylio's intended distribution.

### 3. EdgeSAM refinement

Keep EdgeSAM-3x, but change its role.

EdgeSAM receives:
- positive points sampled from high-confidence matte interior;
- negative points sampled from confident background outside the matte;
- optional local prompts around uncertain matte boundaries.

It must not scan a global point grid looking for a subject.

Expected output:
- one or more refined semantic masks constrained by the matte;
- boundary repair for fingers, key teeth, cables and small held objects;
- no promotion of unrelated support planes based solely on similar depth.

## Matte representation

Introduce a normalized internal matte:

```js
{
  confidence: Uint8Array, // 0..255
  width,
  height,
  source: 'apple-pem' | 'isnet' | 'fused',
  report: {
    coverage,
    confidenceMean,
    borderTouching,
    model,
    provider
  }
}
```

Do not quantize to binary until the final fusion step.

Confidence regions:
- 224..255: confident foreground;
- 32..223: uncertainty band;
- 0..31: confident background.

Exact thresholds may be tuned from tests but must remain centralized in one module.

## Matte fusion

When both Apple PEM and IS-Net exist:

1. Apple PEM remains the primary signal.
2. IS-Net may expand missing general-object foreground near the confident Apple foreground.
3. IS-Net must not erase confident Apple foreground.
4. IS-Net additions must be spatially connected or locally adjacent to the accepted foreground subject.
5. A large scene-spanning IS-Net component must not be promoted merely because depth is similar.

Suggested policy:

```text
finalForeground =
    confidentApple
  + connectedHighConfidenceIsNet
  + EdgeSAM boundary refinement
```

The exact implementation may use confidence-weighted union rather than a literal binary union.

## Depth fusion

Depth Anything remains the scene-geometry model.

Current tiers remain:
- Lite: Depth Anything V2 Small Q4;
- Standard: Depth Anything V2 Small FP32;
- Pro: Depth Anything V3 Small FP32.

Depth fusion must operate after the base depth map has been generated and RGB-guided edge refinement has completed.

### Foreground focus band

For each connected foreground component in the accepted matte:

- measure the robust median depth of confident interior pixels;
- identify components that belong to the dominant foreground focus group;
- normalize **inter-component offset** inside that group toward one photographic focus plane;
- retain bounded **intra-component relief** so a hand, key and object do not become a perfectly flat card.

This directly addresses the observed case where:
- hand ~220,
- key ~111,
while both are intended to remain sharp.

The goal is not metric-depth recovery. It is a stable photographic focus representation for Apple's renderer.

### Background depth

Outside the foreground matte:
- preserve Depth Anything relative depth;
- preserve background layering and gradual bokeh;
- do not globally threshold depth into foreground/background;
- do not dilate foreground into support planes.

### Uncertainty band

At matte boundaries:
- use RGB edge strength,
- EdgeSAM refined mask confidence,
- local foreground depth,
- local background depth,
to choose the final transition.

Do not use one global binary threshold.

## Autofocus

Initial Portrait focus must come from the final matte/focus group, not hard-coded image center and not the highest-scoring arbitrary SAM prompt.

Preferred focus point:
1. largest confident interior region of the dominant foreground;
2. choose a point far enough from the matte boundary;
3. convert display coordinates to stored HEIF coordinates using the existing orientation helpers.

User tapping to refocus remains supported and continues to write the existing focus XMP contract.

## Model tiers

The shared Lite / Standard / Pro control remains authoritative.

| Tier | Foreground guidance | Depth | Edge refinement |
|---|---|---|---|
| Lite | Apple PEM/skin if present; otherwise depth only | DA V2 Q4 | Matte-guided EdgeSAM only when guidance exists |
| Standard | Apple PEM + IS-Net when needed | DA V2 FP32 | EdgeSAM local |
| Pro | Same foreground path as Standard | DA V3 Small FP32 | Same EdgeSAM pass and fusion as Standard |

2026-10-21 final user decision: Standard and Pro share the device-accepted v6
global IS-Net 1024 + EdgeSAM-3x, matte fusion, edge protection and autofocus.
The experimental Pro-only crop stage was rejected after physical iPhone
testing and removed. Pro differs only in the existing Depth Anything V3 Small
model; Standard retains V2 Small. No extra local inference budget is used.

IS-Net must not be downloaded if:
- AI Portrait is disabled; or
- Lite has an accepted Apple PEM and does not require fallback.

## Memory and session lifecycle

A18 Pro is the main high-performance target, but Safari memory behavior remains a hard constraint.

Rules:
- never keep Depth Anything, IS-Net and EdgeSAM sessions resident simultaneously;
- run models sequentially;
- release GPU tensors and sessions before creating the next model session;
- reuse the already-decoded working RGB buffer where possible;
- cap working matte/depth geometry to the existing ~1024-pixel longest-edge Portrait working resolution;
- cache model bytes, not live inference sessions across photos unless memory testing proves safe;
- WASM remains a fallback, not the preferred high-quality path on A18 Pro.

## HEIC export contract

### v1: no generated Apple matte injection

The first implementation must **not create new Apple Portrait Effects Matte or semantic matte auxiliary items**.

Reason:
- Photos' behavior toward generated PEM payloads has not yet been device-validated;
- the existing source may already carry native matte resources;
- adding new auxiliary graph roles would increase compatibility risk.

The AI matte is an internal inference signal used to generate a better depth auxiliary.

Existing source matte payloads are preserved through the existing source-resource copy path.

A later phase may experimentally encode a generated matte into Apple's auxiliary contract only after same-file iPhone A/B testing proves that Photos consumes it correctly.

### Existing Portrait output

Continue generating/replacing only the existing AI depth resource and Portrait metadata using the current Portrait assembler.

No change to:
- primary image pixels,
- Style delta resources,
- Texture resources,
- source EXIF preservation rules except existing Portrait metadata insertion,
- HDR gain-map samples,
- HDR alternative groups,
- linear thumbnail,
- color profiles.

## Strict isolation from Styles / Texture / HDR

This is a hard acceptance requirement.

Implementation must not modify these modules unless a test-only import is required:

- `web/src/styles/graft.js`
- the Photographic Styles selection / MakerNote logic
- Texture/Film graft construction
- HDR gain-map transformation logic
- legacy HDR promotion behavior
- native Styles / Texture graph copy semantics

New AI Portrait code belongs only under `web/src/portrait/` plus model manifests/download tools and Portrait-focused tests.

If an implementation appears to require changing Styles, Texture or HDR code, stop and redesign the Portrait boundary instead.

## Existing source semantic resources

When a source already contains:
- Portrait Effects Matte,
- semantic skin matte,
- semantic sky matte,
- Texture-related 2026 semantic mattes,

the exporter continues to copy the source-owned resources exactly as the current accepted pipeline does.

No donor semantic matte may be substituted for the target photo.

Any template resource not owned by the source must continue to be removed under the current reference-template cleanup rules.

## Modules

Recommended new/changed Portrait-only modules:

- `person-depth-guidance.js`
  - evolve from narrow boundary protection to Apple PEM decoding / confidence normalization.

- `foreground-matte-model.js`
  - model manifest contract and preprocessing metadata for IS-Net.

- `foreground-matte-inference.js`
  - worker lifecycle, WebGPU/WASM fallback, integrity checking.

- `foreground-matte-worker.js`
  - IS-Net session, normalization, soft matte output.

- `subject-inference-worker.js`
  - EdgeSAM local refinement from matte-derived positive/negative prompts;
  - remove global 5×5 discovery as production logic.

- `subject-depth-guidance.js`
  - replace held-object heuristics with matte-conditioned focus-group depth fusion.

- `ai-portrait.js`
  - orchestrate: source matte -> depth -> generated matte -> EdgeSAM -> fusion.

Existing `ai-portrait-export.js` should only receive the improved depth/focus result. Its HEIC graph logic should remain unchanged except for any already-approved autofocus initialization that is proven necessary.

## Current uncommitted exploratory work

The working tree currently contains experimental v1-v6 subject-selection changes made while diagnosing the three failing photos.

These changes are **not the architectural baseline**.

Before production implementation:
- review every current Portrait diff against `HEAD 1243727`;
- retain only changes that remain valid under this design;
- remove heuristic-only logic such as global prompt grids, border-hand directional assumptions and held-object proximity rules;
- do not accidentally commit diagnostic helpers or test output files that are not part of the final implementation.

The stable Styles / Texture / HDR code must remain at its accepted baseline.

## Failure behavior

If Apple PEM decoding fails:
- continue with IS-Net if the tier allows it.

If IS-Net download, integrity validation or inference fails:
- continue with Apple PEM if valid;
- otherwise retain Depth Anything without inventing foreground guidance; EdgeSAM
  runs only when an accepted matte can constrain its prompts;
- report the quality fallback but do not fail the photo conversion.

If EdgeSAM refinement fails:
- use the accepted matte directly.

If all foreground guidance fails:
- retain the current generated depth path without destructive flattening;
- do not invent foreground by large morphological dilation.

Cancellation must terminate workers and release sessions.

## Tests

### Unit tests

Add deterministic tests for:

1. Apple PEM decode and orientation mapping.
2. Soft matte confidence normalization.
3. Apple PEM precedence over generated matte.
4. IS-Net expansion cannot erase confident Apple foreground.
5. Large scene-spanning IS-Net components are rejected from foreground expansion.
6. Matte-derived EdgeSAM positive/negative point generation.
7. Thin connected foreground refinement preserves key/finger-like structures.
8. Foreground focus group removes large inter-object depth offsets while retaining bounded intra-object relief.
9. Background depth remains byte-identical outside the defined fusion band.
10. Autofocus point lies inside confident foreground after orientation transform.
11. Worker/session cleanup on success, abort, WebGPU failure and WASM fallback.
12. No IS-Net download when AI Portrait is disabled.
13. Lite avoids IS-Net when valid Apple PEM is sufficient.

### Real-image regression corpus

Use the three current private cases:

- bottle + fingers;
- power bank + hand;
- keys + hand.

For each:
- compare original source;
- native Portrait f/1.4;
- current accepted baseline;
- new generated Portrait f/1.4.

Required visual checks:
- finger edges are not blurred away;
- held object remains sharp with the hand;
- key teeth/rings are retained;
- no support plane or unrelated background object is pulled into focus;
- background still has depth-dependent bokeh.

Private photos remain outside git.

### Contract regression tests

Before any device candidate is shared, run existing Portrait, Styles, Texture and HDR structural tests.

At minimum:
- AI Portrait export tests;
- HDR Portrait audit;
- Styles graft tests;
- Texture contract tests;
- legacy compatibility tests relevant to the edited export path.

Additionally compare representative accepted fixtures before/after and assert:
- primary payload identity where expected;
- HDR gain-map payload identity where expected;
- Style delta payload identity;
- Texture resources and references unchanged;
- linear thumbnail unchanged;
- only Portrait depth/focus resources differ for the new AI Portrait candidate.

## Device validation

Desktop/WebGPU tests are necessary but not sufficient.

For each private case:
1. process on the production browser path;
2. import the generated HEIC into iPhone Photos;
3. verify Portrait UI appears;
4. set f/1.4;
5. compare the same edge regions against native;
6. adjust aperture, save, reopen and re-edit;
7. confirm HDR remains HDR;
8. confirm Styles remain editable where applicable;
9. confirm Texture remains present/editable where applicable.

Only one candidate at a time should be exposed over the temporary LAN test page.

## Success criteria

The new pipeline is accepted when:

- all three current failing examples preserve the intended hand + held-object focus group with no obvious edge deletion at f/1.4;
- no new foreground false positives are visible in those cases;
- device behavior is materially closer to native than `1243727`;
- all existing Styles / Texture / HDR regression tests pass;
- no production code outside the Portrait/model-download boundary is changed without a separately reviewed reason;
- the generated HEIC remains editable in Apple Photos.

## Non-goals for v1

- recreating Apple's private neural networks;
- metric depth recovery;
- replacing Depth Anything with Depth Pro;
- generated Apple PEM/semantic-matte HEIC injection;
- changing Styles recommendation logic;
- changing Texture/Film behavior;
- changing HDR/gain-map rendering;
- server/cloud inference;
- training a custom model.
