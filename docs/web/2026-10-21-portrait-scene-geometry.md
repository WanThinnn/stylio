# Portrait foreground membership versus focus distance (v250)

## Scope

The user supplied `Downloads/v248`: camera Portrait IMG_2311, ordinary camera
IMG_2310, Standard IMG_2312 and Pro IMG_2313, plus their unmodified resources.
They request ownership/focus separation, optical metadata verification and
edge/occlusion improvements. They explicitly decline new Photos-based blur
calibration. Preserve today's native/non-native workflows and do not push.

The outer Photos-rendered images confirm the symptom: Standard blurs the table
while retaining the rear bag. Unmodified primary/depth resources identify the
stage responsible. Native IMG_2311 and IMG_2310 are separate captures, not an
aligned ground-truth depth pair. No pixelwise native fitting is performed.

## Reproduced cause

IMG_2310 has no Apple PEM/skin ownership anchor. IS-Net/EdgeSAM put both the can
and rear bag in foreground. The old fusion then treats them as one focus plane;
the largest thick interior also chooses autofocus on the bag.

Standard desktop replay, using the phone inference-size budget:

| Region | Raw depth code | Old fused depth code |
| --- | ---: | ---: |
| Can | 225 | 154 |
| Table adjacent to can | 214 | 214 |
| Rear bag | 152 | 151 |

The large can/table discontinuity is manufactured by grouping, not by the
optical metadata. The original user Standard export has the same failure
pattern, although replay codes vary slightly with the processing environment.
These are relative 8-bit disparity codes, not metres.

Fast synthetic tests reproduce blanket flattening and largest-rear-interior
autofocus before the fix. A separate three-layer regression reproduces the
insufficiency of a single two-class histogram split. A rim regression fails
until local colour/SAM corroboration is implemented.

## Changes

Only internally generated AI guidance changes:

- Without an accepted Apple ownership anchor, keep scene geometry instead of
  flattening all semantic foreground. Confident foreground and background
  samples remain byte-identical, including holes and support planes.
- Autofocus considers substantial discrete near-depth populations inside the
  accepted matte. Hierarchical histogram splits require separation, a genuine
  valley, global population support and spatial coherence. Smooth ramps,
  isolated specks and scattered near noise cannot establish a layer. Fallback
  remains the established foreground-interior selector; no fixed image point.
- In a narrow uncertain rim, independent RGB and strong EdgeSAM agreement may
  reweight depth between local foreground/background supports. No confident
  interior/background edits, recursive expansion, global focus plane or hole
  filling are introduced. On IMG_2310, Standard needs no additional rim change;
  Pro changes one uncertain pixel. The grouping repair, not aggressive boundary
  rewriting, is the material improvement on this scene.
- With an accepted Apple PEM/skin anchor, retain the device-tested fusion and
  focus path. The original soft masks remain unchanged.

No filename, region coordinate, model-tier-specific threshold, extra model,
crop inference or GPU concurrency is added. Population/confidence gates are
general algorithm constants, not per-photo blur multipliers. The selector is
a conservative autofocus policy, not an oracle for the user's intended object;
tap-to-refocus remains available.

## Optical and preservation checks

Production `portrait-geometry`, `portrait-blur-response`, scene-response,
bokeh and HDR-calibration algorithms are unchanged. New export regression
checks that focus/aperture edits cannot change intrinsics, distortion, depth
samples/range, source images or HDR/Styles resources.

Actual IMG_2310 exports retain all 93 non-depth HEVC payloads, Styles, linear
thumbnail, delta grid, HDR grid, colour profiles and source EXIF optics. The
stored reference grid remains 4032x3024, orientation 270; the virtual intrinsic
matrix and pixel size match this source's existing EXIF-derived projection.
EXIF describes 15.66 mm focal length / 120 mm equivalent. This is an estimate,
not a newly measured camera calibration or proof of physical depth accuracy.

The actual IMG_2311 camera Portrait passes through the current native Texture
worker with its camera depth payload, descriptor and depth-sidecar optical/
rendering metadata unchanged. Existing camera depth is never replaced.

Fresh suitcase Pro replay (iPhone 13 source with Apple anchor) has raw, matte
and final arrays byte-identical to the accepted v248 upright replay. The older
`Downloads/depth-error/error-unmodified` directory is no longer present, so no
fresh original iPhone 7 replay is claimed; processed copies are not substituted
for those originals. Existing legacy/non-native export regression tests pass.

## Real browser candidates

Both candidates are created directly from unmodified IMG_2310, initial f/1.4,
using the real browser inference and HEIC export path. No re-uploaded Stylio
image, repeated Styles processing, source mutation or native-calibration copy.

| Tier | Can | Adjacent table | Rear bag | Initial focus (display) |
| --- | ---: | ---: | ---: | --- |
| Standard | 225 | 214 | 152 | (0.557, 0.439) |
| Pro | 206 | 204 | 176 | (0.557, 0.456) |

All confident subject/background samples match the raw depth after actual
lossless HEVC encode/readback. The old erroneous can/table offset is gone and
the bag retains its distinct depth. The existing scene-v3 algorithm naturally
recomputes its response from the corrected map/focus; no blur constants change.

Private audit: `tests/private-fixtures/v249/audit.mjs` (final version argument
defaults to `v250`). Output files are `IMG2310-{standard,pro}-v250.HEIC` in
ignored private fixtures. Local two-file download server is
`http://192.168.1.3:8787/`, expires 22:50:23 on 2026-10-21. Full downloads are
verified byte-identical, unlisted paths return 404. No private image enters web
assets or git. Live app modules are verified as v250 through the existing
HTTPS test tunnel; no push is made.

## Verification and limits

300 focused tests: 292 pass, 8 missing-private-fixture skips, zero failures.
PWA and diff checks pass. These cover Portrait, existing native/legacy routes,
HDR/IDG import, Styles, Texture, orientation, cancellation and resource lifecycle.

The user's physical iPhone comparison remains required for table/can bokeh,
f/1.4 -> f/16 -> Off, viewer icon, re-editability and HDR. Desktop code/payload
checks cannot establish native-equivalent rendering across all scenes. No such
claim is made, and the model can still make local geometric errors.
