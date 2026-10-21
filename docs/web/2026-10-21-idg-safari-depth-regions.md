# IDG device failure and regional Standard/Pro comparison

## IDG: Photos-specific profile rejection reproduced; device validation pending

The reported message is the generic `err.hdrjpeg`. The user confirms the same
photo succeeds on the laptop but fails on iPhone. Do not call the earlier JPEG
browser-decoder fallback a confirmed fix for this remaining symptom.

Fresh desktop browser tests succeed for:

- IDG_20251020_121945_809.jpg through import and Portrait Standard: 3024x4032,
  scalar HDR capacity 3.83289 stops, editable depth exported.
- That input with both browser JPEG decoders forced to fail and WebCodecs
  disabled: software-only HDR import passes, same dimensions and capacity.
- IDG_20260208_212707_316.jpg with WebCodecs disabled: HDR import passes,
  3016x4024, capacity 3.906139 stops.

These are Windows browser tests, not native Safari or iOS memory-budget tests.
They rule out unconditional rejection of these files, but do not identify which
device-specific API/resource fails. There is no iPhone crash log or specific
underlying exception yet. A resource-limit fix would be speculative here.

The diagnostic change retains `hdrStage` and the original exception, and shows
it beneath the unchanged user-safe HDR warning. Phases include encoder load,
synthetic assets, base decode, linear thumbnail, main/gain tiles, assembly and
editable HDR rebase. Long codec logs retain both their opening and final error.
No partial output or SDR fallback is published. Regression tests reproduce the
previously hidden phase/reason, then pass after the change. This is a diagnostic
improvement, **not a confirmed IDG import repair**.

### Phone error narrowed to metadata

The next device screenshot exposes `HDR JPEG [metadata]: Unsupported HDR JPEG
colour profiles`. This specific attempt fails before encoder/Portrait work, so
the earlier codec/resource hypotheses are not evidence for this failure. The
user selected the image from Photos, not Files. All three local copies still
pass the pure metadata parser (two distinct JPEG byte streams: the original
Adobe/v2 ICC and the Photos-style channel-metadata/v4 ICC version).

Local cache v246 now includes the actual base/alternate ICC description strings
in this rejection and retains their lengths as `error.hdrProfiles`. A regression
test first fails because these labels were hidden, then passes. The tunnel's
JPEG parser is verified byte-equivalent to local code; this does not establish
which cached module is running in an existing iPhone tab. The exact Photos-input
bytes or the new label diagnostics are required before choosing between an ICC
description variant, missing/incompatible alternate profile, or an old client.
No profile validation has been relaxed, and the diagnostic changes remain local
under the user's no-push instruction.

### Exact Photos profile pair: local repair v247

The 19:35 device screenshot exposes `base="Display P3"` and
`alternate="Rec. ITU-R BT.2100 PQ"`. A description-only JPEG/MPF metadata
fixture reproduces this exact rejection through the production parser on
Windows. This is a replay of the observed profile pair, not the exact JPEG
bytes supplied by the phone. The old P3 branch only allowed an alternate
description starting `Display P3;`, incorrectly requiring a P3-named rendition.

v247 recognizes the specific observed BT.2100 PQ alternate with a P3 base.
It does not change base primaries, gain samples, XMP, capacity or offsets;
the original alternate ICC is attached byte-for-byte to the HDR tmap rather
than replaced with P3. Unknown alternates, an unsupported base, a missing
alternate ICC, and malformed HDR remain errors rather than SDR fallbacks.

The regression is red before the change and green afterwards. Assembly and
Portrait tests cover both P3/PQ and BT.2100/PQ alternate ICC transport. The
actual raster assembly -> scalar rebase -> Portrait -> Texture graph tests
also retain the alternate ICC byte-for-byte. Description-only profiles test
metadata transport, not colourimetric correctness or Safari's HDR rendering.
130 focused import/HDR/native/Portrait/application tests and PWA checks pass.

Direct HTTPS tunnel requests return v247 and a JPEG parser identical to local
source. No push was made. The user must still retry the Photos-provided file
on iPhone and inspect the resulting colour/HDR; desktop fixture success alone
does not establish that the full iPhone path or rendering is correct.

A fresh real desktop browser run of the existing 2,612,099-byte copied JPEG
passes import plus Portrait Standard at f/16 in 39.949 seconds, producing a
14,518,403-byte 3024x4032 HEIC with 3.83289 stops of HDR capacity. This local
input uses the previously accepted P3/PQ ICC, not the phone's newly observed
BT.2100/PQ ICC. Output remains private at
`tests/private-fixtures/IDG-v247-smoke.HEIC`. A two-hour, single-file LAN server
at port 8785 provides this optional desktop result; it is not a substitute for
retrying import from Photos on iPhone.

## Depth: compare encoded source depth, not baked Photos pixels

Each pair's unmodified files has identical stored primary-image samples and
matching non-depth auxiliary resources. They already contain AI Portrait depth;
they are unmodified exported files, not captures from a depth sensor. The outer
folder also includes Photos-rendered/reoriented versions for some pairs.

| Pair | Observation from saved depth |
| --- | --- |
| 2277 Pro / 2278 Standard | Suitcase differs from stored focus by -11 / +2 depth codes; face by -2 / -3. |
| 2280 Pro / 2279 Standard | Foliage maps differ locally; neither is a scalar rescaling of the other. The supplied preference for Pro is consistent with a different local depth ordering. |
| 2287 Pro / 2288 Standard | Wipes differ from focus by +64 / -1 codes. Standard is closer to focus there, but its sampled wall is +41 codes (nearer than focus), while Pro's wall is -1. |

Codes are relative, differently scaled model outputs, **not metres**. Their
numeric differences alone are not a cross-model physical blur measurement. The
encoded range, focus, optical projection and near/far side also affect rendering.

Actual model replays record both pre-fusion and final disparity, plus the final
subject mask. The desktop runtime uses the iPhone input-size budget for the
mobile-budget trials; that does not turn it into Safari. Replayed predictions
are close enough to locate the failing layer, not byte-identical to phone runs.

- Suitcase mask median is 0 in both replays, while face/backpack is 255. The
  suitcase is therefore not flattened into the person/backpack focus group.
  Its depth samples remain unchanged through fusion. Pro's relative placement
  is already different before the focus-group step.
- Wipes mask median is 4: outside the confidently protected subject. Pro replay
  median 241 remains 241 through fusion; Standard 169 remains 169. The local
  disagreement exists before fusion, rather than being manufactured by blur
  range normalization.
- Fusion intentionally changes the supported bag/stand/person depth. It can
  amplify visible disagreement when an adjacent unsupported object is left on
  its model-predicted plane. Model and grouping therefore both matter.

There is no ground-truth depth in these files. It is not justified to declare
the whole Standard map physically correct because one object looks better, or
the whole Pro map correct because it is a newer model. The production tiers
still use the same grouping/refinement algorithm. No automatic tier swap,
dual-model inference, filename correction or whole-table flattening is added.

The upstream implementations describe [V2 relative depth](https://github.com/DepthAnything/Depth-Anything-V2)
and [DA3 monocular depth](https://github.com/ByteDance-Seed/Depth-Anything-3).
Their dataset-level comparisons do not establish which output is correct for a
specific suitcase, tissue box, transparent edge or blank wall in these captures.

## Reproduction

```
rtk proxy node --test tests/web/hdr-import-diagnostics.mjs
rtk node tools/smoke-ai-detail-hdr-jpeg.mjs INPUT.jpg --no-detail --software-only --decode-fallback
rtk node tools/visualize-portrait-depth.mjs PRIVATE_OUTPUT_DIRECTORY INPUT.HEIC
rtk node tools/smoke-ai-portrait-heic.mjs INPUT.HEIC --model=pro --mobile-budget --audit-stages=tests/private-fixtures/PREFIX
```

Stage recording is opt-in loopback instrumentation in the diagnostic tool;
production source does not retain extra depth arrays. All images, masks and
raw audit samples remain private. One supplied iPhone 13 export has a thumbnail
reference to its tmap that the local libheif rejects; a private replay copy drops
only that non-image thumbnail target, retaining every photographic/matte sample.
That decoder limitation is separate from the JPEG HDR import failure.
