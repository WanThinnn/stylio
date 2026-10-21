# Confidence-weighted scene-depth reconstruction (local v251)

## Intent and containment

The user rejects per-photo/per-object edge patches and approves replacing the
existing generated scene-depth repair with a common RGB/matte/depth optimizer.
HDR, Styles, Texture, native and non-native contracts must remain intact. No
new Photos-based blur calibration or push is authorized.

Changes are contained to `preserveGeometry` in `fusePortraitDepth`, via
`scene-depth-optimizer.js`. This path is used when AI depth has no accepted
Apple PEM/skin ownership anchor. The established Apple-anchored fusion and
focus path is unchanged. Existing camera depth is not sent through this solver.
Lite/missing guidance fail closed. Standard and Pro use identical solver code
and parameters, retaining their different depth-model observations.

Projection, scene-v3 depth-to-blur response, bokeh, export, HDR, Styles and
Texture production modules are not changed by this implementation. Previously
uncommitted HDR/orientation work remains in the working tree; it is not reverted.

## Reproduction and findings

User device renders expose silhouette erosion at f/4 through f/1.4. Capture
the exact RGB, raw depth, accepted matte and EdgeSAM guidance at the fusion seam
using opt-in loopback-only smoke instrumentation. Baseline actual IMG_2310
changes zero Standard pixels and one Pro pixel: limiting repair to uncertain
matte misses depth errors inside confident foreground membership.

Four procedural eroded silhouettes (ellipse, rectangle, ring, triangle) fail
before implementation. They have known sloped surfaces, not a constant shared
focus plane. A second red test catches an early prototype amplifying erosion
by extrapolating a curved/quantized shoulder. The final constrained solver
passes these cases without special handling of their shapes.

Private exact-source replay:

```
rtk proxy node tests/private-fixtures/v251/boundary-replay.mjs --baseline
# Standard: local surface difference 23 -> 23; assertion fails.
rtk proxy node tests/private-fixtures/v251/boundary-replay.mjs
# Standard: 23 -> 1; Pro: 13 -> 0; passes.
```

The inspected rim coordinates are private test annotations, never production
inputs or thresholds. This measures agreement with a local visible surface,
not a ground-truth metric depth map or an automated Apple Photos rendering.

## Common optimization

Use a fixed quadratic objective over a supported boundary band:

`sum(c_i * (z_i - d_i)^2) + sum(w_ij * ((z_i-z_j) - g_ij)^2)`.

- Freeze graph cuts using corroborated appearance/depth discontinuities.
  Small-scale appearance prevents printed pixel texture alone establishing a
  cut. Semantic membership does not assert equal focus distance.
- Propagate reliable same-side interior support without crossing graph cuts.
  A region without supported interior remains unchanged, including thin pieces.
- Fit local affine surfaces to reliable samples. Transport slopes with robust
  shrinkage where an extrapolation disagrees with observed boundary geometry.
  This retains distinct layers and inclined surfaces rather than flattening
  every foreground component to autofocus depth.
- RGB affinities and agreement between semantic scores weight graph edges.
  Scores are uncalibrated guidance, not physical depth probabilities. The
  affinity floor permits printed/reflective surfaces to vary in colour.
- Derive occlusion ordering from same-side interior versus opposite surface,
  not the word "foreground". Box constraints prevent moving an eroded sample
  further towards that opposing surface. Projected red/black coordinate descent
  solves this constrained system with immutable weights and observations.
- Keep confident background (including holes) and reliable interior outside
  the active band exact. No mask dilation, filename, object category, manual
  region, reference native aperture or per-tier coefficient is used.

This is an original bounded pixel-graph surface solver, not the published
Fast Bilateral Solver implementation and not a newly trained neural model.
The general confidence-weighted optimization family is informed by
https://arxiv.org/html/1511.03296v2 . Numerical constants are one shared
configuration; they still require broader evaluation, not per-photo tuning.

## Resource and fallback contract

No additional model, crop inference, worker or GPU allocation. Reject graph
construction whose estimated typed scratch exceeds 32 MiB; this is not a total
browser heap limit. The accepted candidates use about 18-19 MB of typed scratch,
plus JS objects and existing buffers. Iteration cap 256; maximum update must be
at most 0.01 depth code or retain original depth. Missing/ambiguous/unsupported
guidance retains the current depth. This does not certify Safari memory use.

## Verification

`tests/web/subject-depth-guidance.mjs` includes 1,000 seeded, varied scenes with
different locations, rotations, shapes, slopes, colours and near/far orders.
990 have supported corrections; the other ten safely retain observations.
Aggregate known-surface boundary absolute error: 3,684,157 -> 93,153 codes.
These synthetic cases intentionally model edge erosion; this is NOT a real-
photo accuracy benchmark, unseen-data score, or native parity claim.

Additional tests cover resolved planes, no RGB-texture geometry fabrication,
multiple touching foreground layers, holes, thin appendages, transpose
consistency, immutability and mobile scratch-budget fallback.

Fresh sequential mobile-size-budget desktop browser replays: IMG_2310 Standard
and Pro, desk Standard and Pro, plants Standard and Pro, suitcase Pro. Plant
selection rejects unsupported foreground guidance, preserving depth; this is
not a claim of plant-quality improvement. Desk/plant files already contain
previous processing and are diagnostic only, never called original captures.

Actual unmodified camera IMG_2310 is the sole source of downloadable HEICs.
Final Standard modifies 11,586 supported boundary pixels; Pro 7,472. Focus,
can/table/bag/wall interior samples and exported disparity ranges remain the
same as accepted v250. The final HEVC depth decodes exactly to an independent
solver replay. Every confident-background sample stays exact.

Both exports retain all 93 original non-depth image payloads, HDR/Styles/delta
grids, linear thumbnail, colour properties, original EXIF optics, orientation
and expected encoded intrinsics. The actual native camera Portrait IMG_2311
retains depth payload, aux descriptor and optical/rendering sidecars through
the existing Texture worker. Suitcase Apple-anchored raw/matte/final arrays
are byte-identical to accepted v250 compatibility replay.

310 focused regressions: 302 pass, eight missing-private-fixture skips, no
failures. PWA and whitespace checks pass. No production photos are added to
tracked assets. The existing HTTPS test tunnel serves byte-identical v251
service worker, guidance and new solver modules; a running page must refresh
to load new code.

## Handoff and limits

Two-file, GET/HEAD-only LAN whitelist: http://192.168.1.3:8788/ . Files are
byte-verified; unlisted paths 404, POST 405. Server expires at 23:28:59 Bangkok
time on 2026-10-21. Private originals are not modified. No push or commit.

Physical Photos validation at f/4, f/2.8, f/1.4, f/16 and Off is still required,
including icon, re-editability, HDR and boundary quality. Interior model errors,
missed mask regions, ambiguous reflective/thin silhouettes and single-depth
representation limits remain possible. Do not declare all scenes fixed or
camera-native equivalent from desktop or synthetic evidence.
