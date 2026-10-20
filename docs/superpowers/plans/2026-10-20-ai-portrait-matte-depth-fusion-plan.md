
# AI Portrait matte-depth fusion — implementation plan

Date: 2026-10-20
Design: ../specs/2026-10-20-ai-portrait-matte-depth-fusion-design.md
Target branch: master
Baseline commit: 1243727

Final scope update, 2026-10-21: Standard and Pro share the accepted v6 matte
pipeline and differ only in Depth Anything. Pro-only crops were rejected on
iPhone and removed. Lite skips IS-Net; without valid Apple guidance it returns
depth alone. The original no-matte EdgeSAM fallback is deferred rather than
reintroducing prompt-grid discovery. Optional model watchdogs retain accepted
guidance/depth; parent cancellation still aborts. See the regression record for
the actual validated behavior and remaining limits. Work is committed on master.

## 1. Scope and safety boundary

This plan implements the accepted AI Portrait architecture:

Apple PEM -> IS-Net foreground matte -> EdgeSAM local refinement -> Depth Anything -> matte-conditioned depth fusion -> existing HEIC Portrait export.

The implementation must remain isolated to Portrait/model-loading code and Portrait-focused tests. The following areas are frozen unless a test-only import is required:

- web/src/styles/graft.js
- Photographic Styles metadata/MakerNote logic
- Texture/Film graft logic
- HDR gain-map processing
- legacy HDR promotion
- native Styles/Texture graph-copy semantics

The current uncommitted v1-v6 Portrait experiments are diagnostic only and are not the baseline. The first implementation task is to remove heuristic-only changes and restore the production Portrait path to 1243727 behavior before adding the new architecture.

## 2. Execution order

Implementation is staged in this order:

1. freeze and verify baseline;
2. clean exploratory Portrait changes;
3. add soft-matte primitives;
4. promote Apple Portrait Effects Matte to full guidance;
5. add IS-Net model packaging/runtime;
6. convert EdgeSAM to matte-guided local refinement;
7. implement matte-conditioned depth fusion;
8. add matte-derived autofocus;
9. integrate orchestration in ai-portrait.js;
10. run structural regression gates for Portrait, Styles, Texture and HDR;
11. run the three private real-image regressions;
12. generate one device candidate at a time for physical iPhone validation;
13. update facts.md and Portrait docs only after device behavior is accepted.

No candidate is promoted merely because desktop/WebGPU output looks plausible.

## 3. Phase 0 — freeze evidence and clean the working tree

### 3.1 Review the current diff against HEAD 1243727

Review:

- web/src/portrait/ai-portrait.js
- web/src/portrait/ai-portrait-export.js
- web/src/portrait/ai-portrait-preview.js
- web/src/portrait/subject-mask.js
- web/src/portrait/subject-inference-worker.js
- web/src/portrait/subject-depth-guidance.js
- tests/web/subject-depth-guidance.mjs

Expected removals:

- global 5x5 subject-discovery grid;
- border-hand directional heuristics;
- nearby-held-object recovery rules;
- scene-support-plane scoring heuristics;
- proposal-specific diagnostic fields not required by the new API.

Potentially retain after separate verification:

- Portrait smoke harness;
- depth dump diagnostic tool;
- final matte-derived initial-focus plumbing if rewritten against the new matte API.

### 3.2 Freeze protected pipelines

Record hashes/diffs for representative protected modules before implementation.

Acceptance condition: production Styles, Texture and HDR modules have no implementation diff when this work is finished.

### 3.3 Run baseline tests

Run existing Portrait/HDR tests before new code so failures are classified as pre-existing versus introduced.

Record:

- pass/fail count;
- any known private-fixture failure from the old subject-depth baseline;
- structural audits of the three current HEIC samples.

## 4. Phase 1 — soft foreground matte core

Add:

web/src/portrait/foreground-matte.js

Responsibilities:

- normalize any matte into Uint8Array 0..255;
- compute confidence statistics;
- find connected confident-foreground components;
- produce confident foreground / uncertainty / background bands;
- compute a robust interior focus point;
- fuse Apple PEM and generated matte without erasing Apple-confirmed foreground;
- reject scene-spanning generated components from additive foreground expansion.

Public API concept:

- analyzeForegroundMatte(confidence,width,height)
- fuseForegroundMattes(appleMatte,generatedMatte,width,height)
- foregroundFocusPoint(matte,width,height)

Do not quantize to binary until the final depth-fusion step.

Add tests in:

tests/web/foreground-matte.mjs

Required cases:

- confidence normalization;
- connected-component extraction;
- Apple foreground precedence;
- generated matte can add connected held object;
- generated matte cannot erase Apple foreground;
- large support plane is rejected;
- focus point is inside high-confidence interior;
- input buffers are never mutated.

## 5. Phase 2 — Apple Portrait Effects Matte as first-class guidance

Refactor:

web/src/portrait/person-depth-guidance.js

Add a full soft-matte API:

readApplePortraitMatte(data,width,height)

Result shape:

- confidence
- width
- height
- source: apple-pem
- report

Requirements:

- validate URI, HEVC type, pixi, dimensions, aspect ratio and orientation;
- decode at source matte resolution;
- resample to working Portrait geometry;
- preserve continuous matte values;
- do not alter the original HEIC auxiliary payload;
- fail closed to null.

Keep protectPersonDepth only while baseline tests still require it before final fusion is active; remove or demote it once new fusion fully replaces that role.

## 6. Phase 3 — IS-Net model verification and packaging

Add build/dev tooling:

tools/download-foreground-matte.mjs

Add runtime metadata under web/vendor/ai-portrait without coupling it to EdgeSAM/Depth downloads.

Before production code references the model:

- pin the exact IS-Net general-use ONNX revision;
- verify license and redistribution terms;
- verify exact byte count and SHA-256;
- inspect ONNX input/output names, shape and dtype;
- test ONNX Runtime Web/WebGPU compatibility;
- benchmark one local inference;
- reject the asset if unsupported operators or memory behavior make Safari deployment unrealistic.

The model must be lazy-downloaded only when AI Portrait requires it.

## 7. Phase 4 — IS-Net runtime

Add:

- web/src/portrait/foreground-matte-inference.js
- web/src/portrait/foreground-matte-worker.js

Worker responsibilities:

1. integrity-checked lazy model loading using the current downloadModelBytes pattern;
2. exact model preprocessing;
3. WebGPU inference first;
4. controlled WASM fallback;
5. output normalization to a working-resolution Uint8Array confidence matte;
6. release all tensors/session before returning;
7. cancellation and timeout support;
8. no persistent live session after each photo in v1.

API concept:

inferForegroundMatte(rgb,width,height,{provider,signal,onProgress})

Tests:

- no download until called;
- integrity mismatch fails closed;
- abort terminates worker;
- WebGPU failure falls back to WASM when allowed;
- tensor dimensions validated;
- NaN/invalid output rejected;
- session cleanup path covered.

## 8. Phase 5 — matte-guided EdgeSAM refinement

Rewrite production behavior in:

- web/src/portrait/subject-mask.js
- web/src/portrait/subject-inference-worker.js
- web/src/portrait/subject-inference.js

Remove global subject discovery.

Generate prompts from matte confidence.

Positive prompts:

- sample high-confidence foreground interior;
- favor points far from boundaries;
- include separate connected foreground components when relevant.

Negative prompts:

- sample confident background surrounding the accepted subject;
- include background between nearby foreground components where the matte says background.

Decoder invocation:

- use multiple point coordinates/labels when supported by the current EdgeSAM decoder;
- otherwise use a bounded local sequence around uncertain boundaries.

Candidate acceptance:

- constrain by overlap with the source matte;
- reject masks dominated by confident matte background;
- allow expansion only into uncertain matte regions;
- never promote a mask solely because its Depth Anything value is near foreground depth.

Output:

- refined confidence matte
- report

Tests:

- point-generation determinism;
- positive points lie in foreground;
- negative points lie in background;
- high-score background object is rejected when matte overlap is low;
- thin key/finger fixture remains connected;
- scene support plane is rejected.

## 9. Phase 6 — matte-conditioned depth fusion

Replace heuristic-heavy subject-depth logic with:

fusePortraitDepth(gray,matte,width,height)

Algorithm:

1. identify confident foreground components;
2. choose the dominant focus group from matte connectivity/confidence, not depth score;
3. measure robust median depth for each accepted component;
4. derive one photographic focus plane from the dominant group;
5. remove large inter-component depth offsets within that group;
6. preserve bounded intra-component relief by compressing deviations rather than flattening all pixels;
7. blend corrections through the uncertainty band using matte confidence;
8. preserve background depth byte-for-byte outside the correction band.

Hard invariants:

- no global depth threshold defines foreground;
- no directional hand/object rule;
- no expansion into confident background;
- background bytes outside the matte fusion band remain unchanged.

Tests:

- hand 220 / key 111 converge into one focus band;
- intra-hand relief remains non-zero;
- background remains byte-identical;
- uncertain boundary changes are bounded;
- disjoint background object remains unchanged;
- no source-buffer mutation.

## 10. Phase 7 — autofocus from final matte

Implement autofocus from the final accepted matte:

- choose the dominant confident foreground component;
- maximize distance from boundary;
- choose a stable interior point;
- transform display coordinate to stored HEIF coordinate with existing orientation helpers.

Integrate into ai-portrait.js and preview initialization.

Do not change user tap-to-refocus behavior.

Tests:

- point always lies inside confident foreground;
- orientation 0/90/180/270;
- mirror cases;
- no-matte fallback remains center.

## 11. Phase 8 — orchestration in ai-portrait.js

Target flow:

1. decode working RGB once;
2. decode Apple PEM if available;
3. run Depth Anything;
4. release Depth session/worker;
5. decide if IS-Net is needed:
   - Lite + good Apple PEM: skip;
   - Standard/Pro: run if PEM is absent or coverage confidence is insufficient;
6. release IS-Net session;
7. fuse Apple + IS-Net matte;
8. run matte-guided EdgeSAM refinement;
9. release EdgeSAM session;
10. fuse depth with final matte;
11. derive autofocus;
12. return improved depth/report to the existing exporter.

Result may add:

- foregroundReport
- suggestedFocus

The exporter remains unaware of model internals.

## 12. Phase 9 — exporter isolation

ai-portrait-export.js must not gain IS-Net/EdgeSAM logic.

Allowed:

- initialize existing focus XMP from validated suggestedFocus.

Not allowed in v1:

- generating a new Apple PEM item;
- injecting new semantic matte URIs;
- changing source matte payloads;
- modifying HDR/resource graph rules;
- changing Styles/Texture copy behavior.

Run a targeted graph/payload comparison proving only Portrait depth/focus resources differ where expected.

## 13. Phase 10 — real-image regression harness

Keep diagnostic tools only if generic and privacy-safe:

- tools/smoke-ai-portrait-heic.mjs
- tools/dump-portrait-depth.py

Do not commit:

- personal HEIC fixtures;
- generated PNG previews;
- LAN tokens;
- output candidates.

For each private case:

Bottle:
- finger remains sharp;
- bottle edge preserved;
- no background object promoted.

Power bank:
- hand + power bank share focus;
- fingers preserved;
- table/background remains layered.

Keys:
- thumb/fingers preserved;
- key teeth, rings and key fob stay sharp;
- yellow/red/blue background objects remain blurred;
- countertop is not promoted.

## 14. Phase 11 — protected regression gate

Before sharing any device candidate, run current relevant tests.

Portrait:

- tests/web/ai-portrait.mjs
- tests/web/ai-portrait-export.mjs
- tests/web/ai-portrait-source.mjs
- tests/web/subject-depth-guidance.mjs
- available private Portrait regression tests

HDR:

- tests/web/hdr-scalar-export.mjs
- tests/web/jpeg-hdr.mjs
- existing HDR Portrait audits
- verify gain-map payload identity where expected

Styles:

- current Styles graft/contract tests
- verify Style delta payload identity

Texture:

- current Texture/Film contract tests
- verify Texture resource payload/reference identity

Legacy:

- compatibility tests touching Portrait export boundaries

Any new failure in protected pipelines blocks device testing.

## 15. Phase 12 — physical-device validation

Only after desktop regression gates pass:

1. build one candidate for the hardest case: keys;
2. expose only that candidate through the temporary LAN page;
3. import into iPhone Photos;
4. verify f/1.4;
5. inspect fingers, key teeth/rings/fob;
6. verify unrelated background stays blurred;
7. change aperture;
8. save;
9. reopen and re-edit;
10. confirm HDR still behaves correctly.

If keys pass:
- test bottle;
- then power bank.

Do not expose multiple experimental files simultaneously.

## 16. Phase 13 — documentation and cleanup

After all three device cases pass:

- update facts.md with the accepted architecture and measured behavior;
- update docs/models/ai-assets.md with the pinned IS-Net asset/revision/hash/license;
- document memory/performance on A18 Pro;
- remove obsolete EdgeSAM global-search heuristics;
- remove temporary proposal audit fields;
- remove diagnostic code not needed for reproducible regression;
- verify no private files are in the working tree;
- commit implementation and docs.

## 17. Commit strategy

Keep commits bisectable:

1. test: freeze AI Portrait matte-depth baseline
2. refactor: normalize portrait foreground matte guidance
3. feat: add verified IS-Net foreground matte runtime
4. refactor: constrain EdgeSAM with foreground matte prompts
5. feat: fuse portrait matte with generated depth
6. feat: derive AI Portrait autofocus from foreground matte
7. test: add real-image portrait regression diagnostics
8. docs: record accepted matte-depth portrait pipeline

Do not combine unrelated Styles/Texture/HDR changes into these commits.

## 18. Stop conditions

Stop and report instead of forcing a workaround if:

- IS-Net ONNX requires unsupported WebGPU operators;
- A18 Pro Safari memory cannot run the model sequentially within practical limits;
- Apple PEM orientation/contract cannot be mapped reliably;
- making Portrait work requires modifying Styles/Texture/HDR graph semantics;
- generated depth still needs broad heuristic dilation to match the test cases;
- structural regression shows source HDR, Styles or Texture payloads changing unexpectedly.

In those cases, evaluate the next-best model/runtime architecture instead of weakening protected pipelines.

## 19. Definition of done

Implementation is complete only when:

- production subject discovery is matte-driven, not grid/rule-driven;
- Apple PEM is used as first-class soft guidance when present;
- IS-Net fallback/supplement is verified and integrity-pinned;
- EdgeSAM is locally constrained by matte-derived prompts;
- matte-conditioned depth fusion keeps all three hand + held-object cases in focus at f/1.4;
- background depth remains layered;
- Apple Photos Portrait remains editable;
- Styles remain editable and unchanged;
- Texture remains unchanged;
- HDR remains HDR and gain-map behavior is unchanged;
- all protected regression gates pass;
- private test artifacts are not committed.
