# Remaining silhouette erosion: adaptive support (local v252)

## User feedback and scope

The user physically tests v251: acceptable improvement, but remaining cap/rim
erosion at wide apertures. Continue the approved common depth optimization;
do not tune per file/object, change blur strength, or alter HDR/Styles/Texture
for native or non-native routes. No push is requested.

Only `scene-depth-optimizer.js` and the service-worker cache identity change
in production during this iteration. Existing Apple-anchored fusion/focus,
camera depth, source pixels, optical projection, blur response and all export
branches remain untouched. Previous unrelated working-tree edits are retained.

## Red-capable loops

New public regressions first reproduce two missing cases: a high-contrast
reflective silhouette fragment, and a depth-contaminated transition wider than
the frame-proportional band. An additional test protects a small inset layer
near an outer silhouette from being merged merely for lacking a wide interior.
Existing slope, multi-layer, hole, thin-structure, transpose, budget and 1,000
seeded-scene tests remain active, including exact reliable-interior checks.

Real-source private loop (coordinates only in ignored annotations):

```
rtk proxy node tests/private-fixtures/v251/remaining-rim.mjs --baseline
# v251: Standard cap disagreement 22 -> 22; fails.
rtk proxy node tests/private-fixtures/v251/remaining-rim.mjs
# v252: Standard 22 -> 5; Pro 17 -> 3; passes.
```

These are relative disparity-code differences against a nearby visible cap
surface, not physical depth errors or native Photos rendering scores. Raw
depth, RGB, general matte and EdgeSAM observations in fresh v251/v252 browser
replays are byte-identical: the reconstruction change, not a new inference or
re-uploaded processed source, accounts for these differences.

## General algorithm changes

1. Measure one-sided normal depth curvature along the graph distance field.
   Estimate a quantization/noise floor from deep-interior observations. Use the
   extent of curvature above that floor to select support scale within a bounded
   search. Affine planes have no curvature regardless of slope; no subject name,
   model tier, filename, focus value or reference-native data enters the choice.
2. A candidate cut cannot establish an independent surface merely by isolating
   a narrow reflective fragment. Reconsider cuts only where one side has no
   supported interior, touches the actual foreground silhouette, and retains
   strong general foreground membership. Keep cuts between supported surfaces
   and retain enclosed inset layers. This is still ambiguous evidence, not a
   guarantee of correct object identity in every thin/reflective case.
3. Pin samples outside the base band whose local affine prediction already
   agrees within quantization/noise tolerance. A wider support search must not
   perturb otherwise sound planes by one code just because the fit differs.
4. Use accelerated projected gradient with diagonal preconditioning for the
   same box-constrained quadratic. Step 1/2 is bounded by the normalized graph
   Hessian; stop on the projected fixed-point residual, not momentum/update
   velocity. Iteration cap 256, tolerance 0.01 code, fail closed on invalid solve.
5. Retain a small-support fallback when adaptive support cannot converge, lacks
   interior, or exceeds the 32 MiB typed-scratch estimate. This does not bound
   total browser heap. No new model, crop, worker or GPU stage is introduced.

Avoid per-pixel temporary tuple allocations in cut reconsideration, curvature
sampling and graph construction. This reduces transient JS allocation pressure;
desktop tests do not certify Safari peak memory or parallel stability.

## Fresh actual exports and preservation

Only original camera `v248/unmodified/IMG_2310.HEIC` produces download files.
No Stylio output is overwritten or reused as a camera original. The same
algorithm selects support radius 20 for Standard and 38 for Pro from their
observations; those values are reported results, not configured tier constants.

Both outputs retain all 93 original non-depth HEVC payloads, HDR/Styles/delta
grids, linear thumbnail, colour profiles, EXIF optics and orientation. Intrinsic
matrix and pixel-size registration match the original. The actual lossless
depth decode matches an independent current-solver replay. Every confident
background sample is exact; inspected can/table/bag/wall interiors are unchanged.
Disparity ranges remain Standard [0, 0.5096970233], Pro [0, 0.8559063222].

Pro's automatic focus point moves within the same supported can layer after
reconstruction; no reference focus or fixed image coordinate is introduced.
Actual native IMG_2311 retains camera depth payload, descriptor and optical/
rendering metadata through the Texture worker. Apple-anchored suitcase
raw/matte/final arrays are byte-identical to accepted v250 compatibility replay.

Seven sequential desktop browser replays with the mobile input-size budget:
camera Standard/Pro, desk Standard/Pro, plants Standard/Pro and suitcase Pro.
Desk/plant processed files are diagnostic only; unsupported plant mattes fail
closed. This does not establish improved rendering on all these images.

313 focused regressions: 305 pass, eight missing-fixture skips, zero failures.
The 1,000 synthetic erosion cases retain 990 supported corrections and reduce
aggregate absolute boundary error 3,684,157 -> 96,496 codes. This stress score
is not a real-image benchmark; it is slightly higher than v251's synthetic score
and must not be presented as universal accuracy improvement. PWA/diff checks pass.

## Handoff

Two-file GET/HEAD-only LAN whitelist: http://192.168.1.3:8789/ . Downloads are
byte-verified; unlisted resources return 404 and POST returns 405. Expires
01:56:21 Bangkok time on 2026-10-22. v251 files remain unchanged for comparison.
Local source/service-worker identity is v252 and offline assets pass validation.
The previous HTTPS test tunnel was unavailable during the final fetch check;
do not claim a remotely served v252 app. Use the LAN candidate files above.
No commit/push or private images in web/git.

Physical Photos f/4, f/2.8, f/1.4, f/16/Off, viewer icon, re-editability and HDR
remain user acceptance checks. Some left-cap points retain model depth, and
monocular geometry/ownership ambiguity remains. Do not claim zero erosion or
native equivalence from these depth checks.
