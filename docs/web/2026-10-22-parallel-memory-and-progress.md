# Mobile parallel resource budget and honest AI progress (v253 / v254 shell)

Accepted depth/HDR/orientation work was committed first as `5c608eb`.
This change does not retune v252 geometry, blur response, optical metadata,
HDR conversion, Styles, Texture or native/non-native routing.

## Findings and reproduction

`node --test tests/web/portrait-controller.mjs tests/web/portrait-model-progress.mjs`
initially failed eight assertions: Portrait began at 90%; no acquisition boundary
prevented input/model allocation while waiting; IS-Net and EdgeSAM reported every
saved-cache read as `download` without identifying the actual model role.

The downloader also accumulated the entire network chunk list before allocating
a second full model-sized destination. The new memory test went red for both
identity and compressed responses, then passed after manifest-sized preallocation.

These are reproducible scheduling/memory-pressure defects, not a reproduced iOS
process-kill trace. Chromium emulation cannot prove that Safari will not reload.

## Resource ownership

- Keep the existing two independent runtime lanes and result ownership.
- The application shares one FIFO acquisition function with its iframe. It is
  not copied or recreated by the second realm.
- iPhone, desktop-mode iPad and Safari use one memory-intensive slot. Other
  browsers may use two. Parallel remains opt-in, including on iOS.
- Both jobs may be active, but conversion and Portrait acquire separate turns.
  Conversion releases its workers/encoders and idle analysis models before
  handing off to Portrait. Another job can advance between these phases.
- Waiting happens before reading input/model buffers, and before starting the
  Portrait deadline. Cancelling a waiter removes it without consuming a slot.
- Idle model cleanup belongs to each lane's own realm. An iframe must never
  call the parent's cleanup to release its own singleton resources.
- Model transfers/cache reads are inside that same budget, not merely inference.
  Known manifest sizes allow one streaming destination, including compressed
  HTTP responses. Existing size/hash verification remains in place.
- This does not promise two simultaneous GPU inference sessions or a speedup on
  memory-limited devices. JavaScript/decoder/runtime overhead still exists.

## Progress and names

With Portrait requested, conversion occupies 0–35% instead of 0–90%.
The remaining work is divided between depth, foreground segmentation, mask
refinement, geometry optimization, export (92%) and preview (98%). Lite has its
own depth-only allocation. Progress is monotonic through fallback and the two
segmentation-refiner assets. It is stage-weighted, not an elapsed-time estimate;
single inference calls do not invent intermediate completion percentages.

UI names describe roles, not model brands: Depth Estimation Model, Subject
Segmentation Model, Segmentation Refinement Model, Image Restoration Model,
Style Recommendation Model. Copy distinguishes network download, saved-cache
read and initialization. Inference describes the actual task rather than
exposing the word "inference" or CPU/GPU implementation details.

## Validation

- Regression suite: 579 tests, 562 pass, 17 existing private-fixture skips, no
  failures after assembling the existing pinned Styles weight parts locally.
- PWA/offline asset validation and whitespace checks pass.
- Existing mobile-shell browser smoke: 59 checks pass.
- Real app smoke with two original IMG_2310 copies, Standard Portrait, fresh
  browser storage and actual models: two Portrait outputs, one isolated iframe,
  six AI workers in sequence (peak one), no page errors. Each of the four
  Portrait model files is fetched once; the second lane uses persistent cache.
- That smoke is Chromium with an iPhone user agent, not physical iOS Safari.
  The helper asserts actual `_Portrait.HEIC` outputs, so normal-output fallback
  cannot count as a successful Portrait run.
- Re-run with `node tools/smoke-parallel-processing.mjs INPUT.HEIC` and an
  existing Playwright install (`STYLIO_PLAYWRIGHT_MODULE` if needed).

## Device preview

The user approved an HTTPS test tunnel. The initial v253 preview was advanced
to shell revision v254 after resolving role placeholders in failure diagnostics;
model cache names/URLs did not change. `tools/serve-test-app.mjs` serves only
the public `web/` tree, with no uploads, photo inputs, private fixtures or
directory listing. Security/isolation headers and private-path 404s were checked
through the tunnel. The current two-hour preview expires at 02:37 local Bangkok
time on 2026-10-22. A new origin starts with its own empty model cache.

The user subsequently reported the device preview stable. This is device
feedback, not exhaustive Safari/phone/model-tier certification. Pro,
cancellation/retry, GPU-off and other devices remain useful follow-up coverage.

## Final accepted UI and pre-push review

The reserved two-line v255 card layout was rejected after device testing.
v256 restores results.css exactly to its pre-change content: short statuses
occupy one natural line; long text wraps without a reserved empty line or clamp.
Parallel resource budgeting, generic names and stage-weighted progress remain.

On the user's request to review, commit and push, the final review found no
blocking correctness/security issue in the changed paths. Repeated checks:

- 580 regression tests: 563 pass, 17 private-fixture skips, zero failures.
- 59 existing mobile-shell checks and 20 natural-layout combinations pass.
- Real two-HEIC Standard Portrait smoke passes again, including cold-cache
  model transfers, cross-realm resource exclusivity and two Portrait outputs.
- Release 1.1.0 source synchronization, PWA asset consistency and diff checks pass.
- The original task-card CSS is byte-equivalent after newline normalization.
- Private fixtures, generated reports/screenshots and assembled local model
  weights are excluded from the commit. No depth/blur/HDR/Styles/Texture
  algorithm changes were added during this review.

The user authorized committing/pushing this reviewed state to origin/master.
