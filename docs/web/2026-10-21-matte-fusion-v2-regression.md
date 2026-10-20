# Matte Fusion v2 regression investigation

Branch: `feature/ai-portrait-matte-depth-fusion`; production baseline: `1243727`.
Status: v6 key candidate accepted by the user as approximately 99% Native;
this is not acceptance of arbitrary scenes. The Pro-only crop experiment was
subsequently rejected and removed; Pro now shares Standard's matte pipeline.

Read with the 2026-10-20 matte-depth fusion design and implementation plan.
Private originals and intermediate arrays stay outside tracked files.

## Reproduced failures

The actual Standard/WebGPU browser pipeline was replayed on the key original.
The v2 skin anchor retained only the largest confident skin component. An
occluded finger was Apple PEM 255 / skin 254 / IS-Net 255, yet final matte 0.
The metal ring was already confident foreground (254), but output depth 203
remained ten steps from the focus plane 213. Increasing skin edge protection
alone could not address either failure.

Two additional fusion problems appeared while checking the proposed repair:

- IS-Net additions became confident foreground before EdgeSAM ran, making
  false positives immutable under the boundary refiner's contract.
- A PEM foreground class is not necessarily one photographic focus group.
  This original also labels part of a distant bottle as foreground. Blindly
  snapping the entire PEM region to focus introduced a new background error.

These observations do not establish an Apple Photos compositing bug. The
exported disparity itself contained the errors before Photos rendered it.

## Portrait-only corrections

- Prefer the dominant full PEM subject over a dominant skin-only component.
  Use skin as an anchor fallback, and retain all skin components for protection.
- Keep generated expansions provisional until EdgeSAM can confirm/reject them.
  Preserve Apple's original soft confidence floor when models disagree.
- Retain a separate EdgeSAM confidence field internally; original confident
  matte labels remain immutable.
- For disputed non-skin pixels, estimate a robust depth interval from the
  current image's confident skin: 1st–99th percentiles, padded by 22% of its
  interquartile spread. Leave out-of-interval geometry unchanged unless SAM
  corroborates the foreground. This selects focus membership; it neither
  modifies source PEM nor substitutes a generated HEIC matte.
- Bound intra-component disparity relief smoothly with tanh to +/-3 encoded
  disparity steps. A proportional multiplier alone did not bound the error
  inside a single connected hand/ring component. Three steps is an algorithmic
  quantization tolerance, not calibration copied from a reference photograph.

The interval and foreground depths are measured per image. Policy thresholds
are still constants. This is conservative evidence fusion, not metric depth
recovery or a guarantee of object ownership in arbitrary scenes. Without
valid skin or an accepted SAM result, the disagreement guard is not applied.

## Validation

- Portrait/model/geometry/lifecycle/module-path group: 125 passed, no failures.
- Styles/Texture/HDR/legacy group: 110 passed, 8 optional fixtures skipped,
  no failures.
- Key candidate replay: finger matte 255, ring matte 247; both depth 211,
  within three steps of focus plane 214. Annotated background bottle/cylinder
  points keep their original inferred depth. These ROI annotations are only
  diagnostic assertions, never production inference inputs.
- Browser exports were exercised for key, alcohol bottle and power bank.
  These are desktop checks, not substitutes for the required iPhone acceptance.
- Key export preserves all 122 original non-EXIF item payloads and properties,
  source references, alternative groups and Style MakerNote 0x54. This includes
  primary samples, gain-map samples, source semantic mattes and colour profiles.
  Existing Portrait EXIF insertion remains the accepted exporter behavior.
- New deterministic tests reproduce split-skin finger loss, connected-ring
  depth offset, premature generated confidence, and foreground/focus conflation.

Candidate filename: `Stylio_Key_MatteFusion_v3.HEIC`.
Only the key candidate is exposed on the temporary LAN page. Aperture is f/1.4.
Device verification is still required for finger/ring edges, background blur,
Portrait controls and HDR/Styles/Texture before any production promotion.

## v4 follow-up: residual ring erosion

Device feedback accepted v3's hand/key separation but reported mild erosion
on the upper metal ring. Replaying that arc reproduced alternating output
depths 211 and 154–159 despite foreground confidence 246–247. The depth interval
guard was rejecting short, locally coherent parts of the ring.

The correction runs after the existing focus/core fusion:

- inspect rejected regions fully enclosed by the original matte support;
- restore only a narrow inward rim of confident foreground, supported by an
  already accepted pixel in the selected focus region;
- require local inferred-depth agreement, with tolerance derived from the
  current skin-depth distribution;
- bound traversal to 1–2 working pixels and retain the rejected interior;
- keep core focus statistics and all already accepted output pixels unchanged.

The cached key replay changes exactly 200 working depth pixels. Its six
annotated ring-arc points now all output 211; the measured distant bottle,
cylinder and deep ring-hole points retain their previous depth. Cached bottle
replay changes zero pixels; power-bank replay changes 158 rejected rim pixels.
These are deterministic depth checks, not device acceptance for the other cases.

The actual browser-exported `Stylio_Key_MatteFusion_v4.HEIC` differs from v3
only in its encoded depth item. Every other item payload, including new Portrait
sidecars, is identical. All inference mattes are identical, and source item
payload/property/reference/alternative-group preservation passes again.

Validation: 126 Portrait/model/geometry/lifecycle/module-path tests passed;
110 Styles/Texture/HDR/legacy tests passed, 8 optional fixtures skipped.
The synthetic rim regression also guards against unbounded inward growth,
restoring genuinely distant hole edges, open-background expansion and modifying
a disconnected foreground component outside the selected focus group.

v4 still requires Photos validation at the same aperture and focus point.

## v5 follow-up: soften the uncertain skin transition

Device feedback accepted v4's ring restoration and subject separation, then
requested a less rigid foreground silhouette. A deterministic skin-rim replay
showed a protected plateau ending abruptly: depth 212, 201, 199, 196, 80.

The skin-protection floor now tapers linearly through its existing narrow
uncertainty band. Confident skin and the nearest uncertain pixel retain their
protection; farther uncertain pixels approach their original scene depth. The
same replay becomes 212, 201, 161, 120, 80. This is a depth-transition proxy,
not proof of the subjective rendering result in Photos.

Actual Standard/WebGPU export changes 2,131 uncertain skin pixels relative
to v4. All confident foreground/background pixels and all 200 pixels restored
by the v4 ring correction remain identical. Every inference matte is identical.
Only the encoded depth item differs between the v4/v5 HEIC files; the primary,
HDR, Styles, Texture and Portrait sidecar payloads are unchanged.

Cached corpus replay also checks bottle and power-bank transitions. Validation:
127 Portrait/model/geometry/lifecycle/module-path tests and 110 protected-pipeline
tests passed; 8 optional fixtures skipped. The retained edge test checks the
inner protected edge separately from the deliberately feathered outer rim.
Candidate: `Stylio_Key_MatteFusion_v5.HEIC`; device softness/erosion verification
remains pending against accepted v4.

## v6 follow-up: circled background texture at the finger edge

The user's circled close-up registered to the original with 51 affine inliers.
The protruding texture belongs to the background bottle. At four annotated
points PEM confidence was 231–247, skin only 31–51, SAM 0, and inferred depth
116–119; v5 nevertheless output focus depth 211.

The focus guard treated any skin value above the background threshold as
sufficient to override a depth/SAM disagreement. Those falsely protected
pixels could also seed the enclosed-rim repair, pulling adjacent rejected
background back into focus. Increasing feathering alone did not address this.

When SAM rejects a pixel and depth is outside the robust skin interval, weak
skin evidence now caps its focus blend to its soft coverage. Confident skin
and SAM-corroborated foreground remain protected. The disputed pixels also
cannot seed the local rim repair. Core focus statistics, all source matte
payloads and the foreground confidence field remain unchanged.

The four measured background points now output 116, 128, 125 and 123. The six
ring-arc checks still output 211; annotated actual fingers remain focused.
The actual v6 browser export differs from v5 only in the encoded depth item:
3,868 working pixels change, all outside confident skin/SAM foreground and
outside matte-confirmed background. All inference mattes are identical.
Cached bottle/power-bank replays preserve confident skin/SAM and the route
without a skin matte exactly.

Validation: 128 Portrait/model/geometry/lifecycle/module-path tests passed;
110 Styles/Texture/HDR/legacy tests passed, 8 optional fixtures skipped.
The new regression exercises weak skin rescue, incorrect rim seeding, immutable
matte input, and protection of both confident skin and SAM-confirmed objects.
Candidate: `Stylio_Key_MatteFusion_v6.HEIC`. The user subsequently confirmed the
circled region and overall result as approximately 99% Native. Standard tier
pipeline preserves this file byte-for-byte on replay.

## Final tier decision

The subsequent Pro-only IS-Net/EdgeSAM crop experiment passed structural tests
but failed physical iPhone rendering: the leather key fob blurred and a patch
inside the metal ring remained sharp. Resource-preservation tests do not
establish visual correctness. At the user's request the optional crop stage,
its planner, tests and candidate documentation were removed.

Standard and Pro now share the accepted v6 foreground matte, EdgeSAM pass,
fusion, edge protection and autofocus. Only Depth Anything differs: V2 Small
for Standard, V3 Small for Pro. A different depth prediction may still render
differently; the shared matte path does not guarantee identical depth output.

## Pre-commit review and cleanup

Final work is on master, based on 1243727. Both review axes identified optional
worker watchdogs being rethrown as conversion failures. Those timeouts now
retain accepted guidance/depth and report quality fallback; genuine parent
cancellation still rejects. Orchestration tests drive the actual worker
watchdog and check both cases, as well as shared Standard/Pro stage selection.

The original no-matte EdgeSAM fallback is deferred: Lite skips IS-Net and,
without Apple PEM/skin, returns depth alone. Standard/Pro likewise retain depth
if no valid guidance survives. This is documented explicitly instead of
reintroducing unconstrained prompt-grid discovery.

An unused full-resolution foreground map and unused foreground tier option were
removed. The generic HEIC smoke tool no longer uses a global read shim, closes
keep-alive connections before exiting, and verifies its temporary profile path
before recursive removal. Model attribution and asset documentation are updated.

Final verification: 134 Portrait/model/orchestration tests and 151 protected
pipeline/application/release tests pass; 8 optional private fixtures skip. PWA,
i18n and diff whitespace checks pass. A fresh real Chromium/WebGPU Standard
export is byte-for-byte identical to accepted v6 (2,371,695 bytes). Source audit
again preserves all 122 non-EXIF item payloads/properties, 17 source references,
alternative groups and Style MakerNote 0x54. No private photo or model binary
is included in the commit.
