# Browser photo processing

This consolidates the previous `web/AI-PORTRAIT.md` and `web/DNG.md`. Paths and commands are relative to the repository root. Device experiment history remains in `facts.md`.

### Edited native Styles exports

Some iPhone 16/17 exports after changing a captured Style carry a six-key
MakerNote selection and an ISO HDR `tmap`, without a standalone Styles plist,
linear thumbnail or delta map. The supplied edited copies still expose Styles
when imported directly into Photos; absence of those standalone resources does
not establish that Photos cannot edit the file.

The attempted Texture-only route preserved all original payloads, properties
and references, but the user reports that its imported output still loses Styles.
It is therefore excluded from the website's default flow. These incomplete native
exports are returned byte-exact, retaining the selected preset and original HDR
declarations. Opaque markers, unsupported contracts and existing Portrait routes
retain their previous handling.

The worker must not register an additional HDR `auxC`/`auxl` role on an incomplete
native Styles export. That 67-byte mutation is the only change in the reported
IMG_1730/1731 files that fall back to Filters, while their inputs retain Styles
on reimport. Complete native Styles files keep their existing additive Texture
route and exact HDR resources.

Structural preservation does not establish Photos editing capability. Diagnostic
tools generate the rejected Texture-only control and an A/B/C set: A upgrades
only the marker plus Texture, B adds a reconstructed Styles graph with the original
six-key marker, C uses B's graph and an eight-key marker. Device testing found B/C
have Styles and Texture with acceptable initial colour, but lack displayed HDR.
D adds only the HDR auxiliary role to B; HDR is weaker and disappears inside Edit.
E adds the source ISO headroom to B, and F adds it to C. E/F retain HDR inside Edit
and after saving, but are **not** production repairs: extreme Style adjustments
render differently from the native source.

The same-capture IMG_1735 (native) and IMG_1751 (F) both carry Standard, Tone -1,
Colour +1 and Palette 1. Their saved primary pixels differ, and the user confirms
the native render is more accurate. E/F's calibration, generated thumbnail and
neutral delta map are estimates; retaining a preset label and unedited pixels
does not reproduce Apple's native editing response. Automatic reconstruction
remains disabled while this colour regression is unresolved.

G/H/I are private diagnostic controls using the original editing resources from
`stylio-1`, whose capture UUID matches native-1: G replaces only Styles metadata,
H additionally replaces the linear thumbnail, and I additionally replaces delta
samples. The script refuses a mismatched capture. All other E payloads, properties
and relationships remain exact. This is a way to isolate missing resources,
not a generic fix using unrelated native colour calibration.

The user reports G still has incorrect colour, while H/I look the same and are
very close to Native with a slight remaining brightness/colour difference.
IMG_1729 is the native reference and IMG_1755 is edited I, both Standard with
Tone -1 and Colour +1. Standard has no Palette control in Photos; the stored
marker key `3=1` must not be presented as a user-adjustable Palette in that mode.
On 1024x768 area samples of the SDR primaries, with identical Display-P3 profiles,
mean absolute RGB8 code difference versus native is 20.65 for F and 2.58 for I;
the cabinet region improves from 34.67 to 1.16. This is not a perceptual HDR score.
I still differs in the ceiling and shadows. Its exported HDR headroom matches
the native ISO headroom to float precision, so that scalar alone does not explain
the remaining baked SDR difference.

G-to-H isolates replacing the generated thumbnail with the same capture's
native thumbnail, on top of native Styles metadata. It establishes that thumbnail
as a contributor in this experiment, without proving it is the only contributor
or that native metadata can be omitted. H-to-I gives no reported visible
improvement from delta replacement. Edited-only native-1/native-2 inputs contain
none of these original editing resources; H/I currently require a separate
same-capture original. This requirement and the residual colour difference keep
the diagnostic route out of automatic processing.

The native Bright+Texture control (`stylio-1`) was subsequently edited to the
same Standard extreme and the user reports a 100% native match. This rules out
Texture-only addition as the cause on this capture/settings, focusing the remaining
work on reconstruction. J/K compare the native eight-key selection encoding and
one opaque capture tag; L retains the native image base with the edited selection.
L may still display captured Bright before Edit and is not a production repair.
M/N replace the displayed primary with the edited Standard samples, retaining
native editing resources; the user reports correct edit colours but a reduced
warm/red cast before Edit. O repacks M, P deliberately removes HDR as a control,
and Q pairs the Standard display with its own edited HDR. The user reports all
three still have the cast before Edit; entering Edit restores Standard. R/S
isolate an opaque capture tag and identifier reuse, with no picture/HDR/editing
payload changes; both still show the cast. Changing a parameter slightly in Q
and saving makes Photos' regenerated view correct, a device-confirmed workaround.
T/U isolate neutral delta samples and explicit primary SPS colour declarations.
T/U await device validation; none is an automatic production route.
Device testing subsequently reports that T/U both retain the cast. The user then
changed Texture slightly in Q, tapped Done and exported the corrected asset's
**Current** version as `IMG_1768.HEIC`. The viewer colour is correct, but this
2,075,077-byte export is flattened: it has 80 items instead of Q's 159 and removes
the Styles plist, Texture record, linear thumbnail, StyleDelta graph and all twelve
Texture mattes. Its primary and HDR grid descriptors remain byte-identical while
their tile samples are newly rendered. The eight-key selection marker is reduced
to the six-key edited-export form. The exported file therefore has no explicit
Styles/Texture graph. Earlier six-key native exports can still expose Styles after
reimport, so control availability for a fresh `IMG_1768` import is not inferred
from structure alone.

This confirms that tapping Done made Photos encode a new current rendition and
strongly supports the role of Photos' original/current version plus adjustment
state in the successful viewer result. A browser download cannot create that
PhotoKit state. The supported workflow is to process the unmodified original in
Stylio first, import it into Photos, then choose the Style and tap Done. Edited
native exports that lack the original Styles graph stay byte-exact; the UI explains
this order instead of claiming that Texture was added.

X copies the exact same-capture native Standard primary, HDR and tmap into the
reconstructed graph. Its preview matches native Standard, but Photos Edit shifts
slightly blue. Y additionally regenerates the linear thumbnail from Standard, and
Z also neutralizes StyleDelta; device testing reports the same Edit shift for both.
The remaining defect is therefore not isolated to those two resources.

AA/AB test a dual-rendition layout using the same-capture original: the exact Bright
primary remains `pitm` and the Styles editor base, while the preferred HDR `tmap`
derives from hidden exact Standard primary/HDR items for normal viewing. AA retains
editing-resource targets on both renditions; AB limits those targets to the Bright
primary. This is a device diagnostic and cannot be generalized to an edited-only
upload that no longer contains its original native Styles resources.

AA/AB improve the result according to device feedback but still differ from the
native Standard reference. AC/AD reverse the layout: exact Standard stays primary
for display, an exact same-capture Bright grid is added as a hidden editor base,
and editing resources target that hidden grid. AD retains the displayed Standard
pair as secondary graph targets. These remain same-capture diagnostics.

On device, AC enters Edit without the colour shift but loses both Styles and
Texture controls. AD retains both controls but shifts colour. AE-AH keep AC's
exact Standard display and hidden Bright editor base while progressively restoring
only metadata descriptors, then linear-thumbnail/StyleDelta discovery links to
Standard primary and tmap. They isolate the minimum graph relationship needed for
controls from the relationship that makes Photos choose the wrong editor base.

AE-AH all behave like AC on device: correct Edit colour, but no Styles or Texture.
AI-AL next add the Exif marker relation, ending with every editing resource linked
to Standard primary while withholding Standard tmap. This isolates whether Exif is
required for discovery and whether the alternate target, rather than primary alone,
causes AD's colour shift.

AI behaves like AC. AJ/AK hide traditional Filter but still expose no Styles or
Texture, indicating a recognized yet incomplete native editing graph. AL exposes
both controls and shifts like AD even without a Standard tmap target. AM-AP divide
the remaining sky and Texture matte associations to find the graph-completeness
gate.

AM/AN/AO remain incomplete on device. AP restores both controls and the colour
shift, showing that all twelve Texture matte associations are the observed graph
completeness boundary. AQ-AS therefore keep the complete Bright editor graph and
Bright tmap untouched, then add an independent exact Standard HDR/tmap as the
preferred viewing alternative. This differs from AA/AB, which replaced the Bright
tmap and left the editor with a mixed rendition.

AQ/AR are the closest device results, with only a very small Edit colour difference;
AS is worse. AT-AW now separate Standard and Bright into distinct alternate groups,
vary group order and primary ownership without changing either rendition's pixels
or calibration.

AT/AU/AV behave like AQ/AR. AW matches colour best but loses controls, confirming
that a fully independent Standard primary behaves as a baked rendition rather than
the Bright-backed Styles editor. AX-AZ keep AQ intact and vary only the original
Bright, Photos-saved six-key Standard, and eight-key Standard edit-state markers.

AX correctly selects Bright and therefore does not satisfy the selected-Standard
flow. AY/AZ retain Standard but show the same small Edit difference. Changing a
control and saving gives the closest colour on device, with HDR visually below 10%
darker. BA-BD encode tiny +/-0.01 Tone/Colour selections to test the adjusted-render
path without changing image or HDR payloads. Device testing reports that all four
still have the same slight Edit colour error, so a non-zero selection marker alone
does not create Photos' adjusted/current rendition state.

BE-BH therefore stop changing Style numbers and instead test rendition ownership.
AQ already contains an exact original Bright editor graph plus an exact Standard
preferred rendition, but only one Exif/0x54 state. The new variants keep every
image, HDR, Styles calibration and Texture payload exact while carrying two Exif
items from the same capture: exact original Bright metadata for the editor base and
exact Photos-saved Standard metadata for the displayed current rendition. BE binds
each Exif to its primary grid, BF binds each to its primary+tmap pair, BG binds the
Standard Exif only to the Standard tmap, and BH additionally makes the Standard grid
`pitm`. These are diagnostics for whether a single-file HEIF can approximate the
PhotoKit original/current split; they are not production repairs. Device testing rejects
all four BE-BH for the actual product contract: entering Edit resolves the captured
Bright state. An original-capture rendition must therefore never be used as the output's
editor base when the uploaded HEIC already represents a later user-selected Style.

The next BI-BL diagnostics start only from the edited native export. They preserve its
rendered primary, HDR resources and six-key selected-Style marker exactly and add the
complete Texture metadata/matte set without reconstructing Styles or borrowing any
original Bright payload. BI attaches all Texture resources only to the edited primary;
BJ attaches them only to the ISO tmap; BK keeps Texture metadata primary-only but mattes
on primary+tmap; BL keeps Texture metadata on primary+tmap but mattes primary-only. This
isolates whether the current writer breaks Photos' implicit edited Styles state by
binding new Texture resources to the tmap. The edited upload is the sole source of truth. Device testing reports that BI-BL all
lose displayed HDR and lose the Styles control in Edit. Because primary-vs-tmap target
ownership does not change that outcome, the complete grafted Texture contract itself is
now the isolated trigger on this edited-export shape.

BM-BP therefore decompose the contract. BM adds only `texture_styles` metadata; BN adds
only the twelve 2026 mattes/XMP; BO adds only the native iPhone 18 MakerNote `0x65`
Texture capture record; BP combines `0x65` with metadata-only BM. No variant rebuilds
Styles or changes the edited primary, source HDR items or selected 0x54 Style marker.
BO/BP are intentionally future-contract diagnostics on iPhone 16 and must not enter the
production route without device proof. On device, BO keeps HDR but loses the Styles
control; BM, BN and BP lose both HDR and Styles. This separates HDR failure from Styles
failure: `0x65` alone does not break HDR, while the metadata/matte paths do, but implicit
edited Styles disappear even after the Exif-only BO mutation.

BQ-BT therefore remove Texture semantics entirely. BQ is an exact edited-source control;
BR appends only an inert top-level `free` box; BS adds one inert metadata item so `meta`
grows and existing extents move; BT relocates the exact same Exif payload through the
normal rebuild path without changing any Exif byte. If BR/BS/BT lose Styles, the edited
export is relying on a stricter file/container integrity contract than the current
Texture work assumed. If they retain Styles, `0x65` itself is the Styles-invalidating
semantic change. On device, BQ/BR/BT all keep HDR but lose Styles, while BS loses both.
Crucially, BQ is byte-for-byte identical to the edited source, so its Styles loss cannot
come from file mutation. This elevates import provenance / Photos asset context above
container semantics as the leading explanation for the portable-reimport discrepancy.
The next control reuses the exact same source bytes under multiple names and compares
direct-open/save with forced-download/import; no HEIC bytes are changed. BU-BX then
confirm the same result for every exact-byte route: HDR survives, but a fresh import has
no Styles control whether the file is downloaded normally, opened directly in Safari,
renamed to a camera-style filename, or transported in a ZIP. The edited HEIC is therefore
a flattened current rendition rather than a portable standalone Styles editor asset.

The file-only path must synthesize a complete Apple-recognized editing graph while using
the edited rendition as the only image/editor base. Research now concentrates on the
`linearThumb`, because same-capture H/I previously removed most reconstruction colour
error by replacing that resource, while native StyleDelta samples produced no additional
visible improvement. After correcting HEIF rotation, eight iPhone 16 native captures
show a fairly stable primary-to-linear affine relationship; the corpus-median coefficients
are approximately R `0.3648*x+0.2705`, G `0.3703*x+0.2775`, B `0.3706*x+0.2689`.
Native linear thumbnails are 1024x768, 10-bit 4:2:0, full-range HEVC with unspecified
primaries/transfer/matrix. Candidate outputs may use this research to synthesize a new
linear thumbnail from the edited input, but must never copy the original capture's
linear thumbnail or make the captured Style the editor base.

`tools/native-style-edited-linear-thumb-variants.mjs` implements the bounded phone test
on the previously proven E reconstruction/HDR-headroom base. BY uses the corpus-median
per-channel affine, BZ a neutral `0.37*x+0.27`, and CA the 1729 same-capture fit as a
research upper bound. Only the reconstructed linear-thumbnail sample/codec changes; all
edited primary/HDR payloads, selected Style marker, Styles/Texture graph and HDR headroom
stay fixed. The new thumbnails match native transport as 1024x768 Main10 4:2:0 full-range
HEVC with explicit VUI `2/2/2`. CA is diagnostic only because its coefficients were fit
with same-capture ground truth; BY/BZ are the generic candidates. On-device, all three
preserve the edited colour and restore Styles while retaining HDR; CA is the closest match
and becomes the research baseline for this capture. HDR remains slightly weaker than the
native edited source, so production is not switched yet.

A direct contract audit shows CA's XMP headroom (`5.265183813`) matches the same-capture
native full graph (`5.265185`) to negligible precision, and CA retains the edited source's
exact ISO tmap alternate/headroom. The remaining difference is routing: the reconstructed
editor adds the legacy HDR `auxC`, `auxl` and XMP declarations, whereas the flattened
edited source displays its correct-intensity HDR from the ISO tmap without those legacy
roles. Native full-graph tmap gamma/min values vary materially by scene, so Stylio must not
hardcode an original-capture tmap curve. Follow-up diagnostics therefore vary only the HDR
routing declarations around the accepted CA baseline. `tools/native-style-hdr-routing-variants.mjs`
creates CB-CE while keeping every CA item payload byte-exact: CB removes `auxC`, CC removes
`auxl`, CD removes both and leaves only HDR XMP, and CE removes only the HDR XMP relation.
CA remains the full `auxC + auxl + XMP` control. On-device, CB renders black, CC/CD lose
HDR, and CE (`auxC + auxl`, no HDR XMP) is the only routing variant that retains HDR +
Styles. CE still shows the same slightly weaker HDR as CA, so the XMP/routing branch is
closed: `auxC + auxl` are required, while HDR XMP is unnecessary and does not explain the
remaining intensity delta.

Direct comparison of the user's original `IMG_1729 (2).HEIC` and CE `IMG_1864.HEIC`
confirms their ISO tmap values are identical. The stronger remaining suspect is generated
Styles calibration: CE reports a `LinearImage` range far below the same-capture native
full graph because the current retargeting still applies the historical fixed
`LINEAR_IMAGE_SCALE=0.166`. Follow-up diagnostics isolate `LinearImage`, `i/h`, schema and
full plist calibration groups while leaving all image/HDR/Texture/selection payloads
unchanged.

The calibration matrix now separates the high-range fields more finely. CK changes only
`LinearImage.whitePoint`, CL only `LinearImage.highKey`, CM both, CF the whole LinearImage
block, CG only root `i + h`, CH LinearImage plus `i + h`, CI the wider calibration core,
and CJ the whole same-capture native Styles plist. These are research-only controls: they
use original-capture calibration only to locate the causal plist fields; no original image,
gain-map, linear-thumbnail or editor-state payload enters the output. Source-only HDR
reconstruction confirms that 1729 really has strong alternate highlight range (scene p99.9
about 5.25), but native whitePoint does not follow headroom or one fixed HDR percentile
across the corpus, so no global formula is promoted before the phone matrix resolves the
actual controlling fields.

Edited-export reconstruction must preserve the source 0x54 selection byte-for-byte,
including non-zero Style controls. `IMG_1735.HEIC` is the regression fixture for Standard
with Tone `-1`, Colour `+1`, Palette `1`; its generic BZ + CE candidate retains the marker
exactly and remains AI-Portrait eligible because it has no native depth. A production bug
in `styles/port.js` was also fixed: native Portrait reconstruction no longer automatically
replaces a valid source selection with a Bright compromise or neutral Standard marker.
The Bright compromise is diagnostic-only; a valid source 0x54 is immutable.

For native Portrait inputs, depth, aperture/focus and Portrait Lighting/rendering sidecars
are source-owned. Direct reconstruction of `IMG_1119.HEIC` preserves the depth payload and
renderer XMP byte-for-byte, including ƒ/2.8 and Portrait Lighting EffectStrength 0.5, while
also preserving Style ID 16 with Tone -0.5 / Colour +0.5. Its eligibility remains
`existing-depth`, so AI depth cannot replace it. Conversely a no-depth reconstructed source
remains `portraitEligibility === null`, so the normal AI Portrait feature is still
available. These are release-blocking invariants for the compatibility path.

Phone testing of CK-CJ closes the Styles-plist calibration branch: every variant, including
full same-capture native Styles plist CJ, remains darker in HDR than the original flattened
edited source. Local reconstruction confirms the source and CE still contain the same
scene HDR signal under the ISO tmap formula, so the dimming is caused by Photos choosing a
different interpretation once the editable graph is reconstructed. Further phone testing
must use at most one evidence-backed candidate per round. The next isolated candidate changes
only the tmap `useBaseColorSpace` flag from the flattened value `false` to the full-graph
value `true`; gain-map pixels and every numeric tmap/Styles/Texture/selection field remain
unchanged. CN did not improve HDR on-device and HDR disappeared on entering Edit, so that
single-flag branch is closed.

The remaining HDR problem is now understood as a representation mismatch. A native full
editable iPhone 16 gain map uses 15 monochrome 640x896 full-range HEVC tiles, an `nclx
2/2/2` gain-grid colour declaration, no per-tile ICC, and an adaptive PQ tmap ICC. The
flattened current export uses 30 monochrome 512x512 tiles carrying Apple's `Linear Gray`
ICC profile, while its tmap uses simple P3/PQ `nclx`. The two raw maps correlate at about
0.9933, and after decoding each with its own ISO tmap curve their log-gain fields agree to
about 0.019 EV MAE. Re-encoding the flattened log-gain field with the native curve predicts
the native raw map to about 0.0082 sample-domain MAE. Therefore the HDR signal survived;
Photos simply re-encoded the `(gain map + tmap)` pair for the flattened rendition.

Future edited-export compatibility must convert that pair as a unit rather than only add
legacy HDR routing. Decode source samples to log-gain, derive an editor-compatible target
curve/profile from the uploaded source, re-encode the gain map, and emit the corresponding
editor colour/profile contract while preserving the same scene-referred HDR field. Native
editor tmap ICC profiles contain adaptive Apple `HAGC`/`hdgm` tags and vary by image, so a
donor profile or hardcoded curve is forbidden. No further phone candidate should be sent
until the source-only converter satisfies local HDR/log-gain, Style, Texture and Portrait
invariants.

That local gate is now satisfied by a standards-backed source-only profile path. Native
HAGC parsing/serialization round-trips byte-exact across the iPhone 16 corpus, and native
`HAGC.baselineHdrHeadroom` consistently equals the ISO tmap `max` after 1e-4 quantization.
`raster/hagc.js` therefore derives the baseline from the uploaded file and implements the
ST 2094-50 Reference White Tone Mapping fallback without native donor bytes.

`raster/pq-hagc-icc.js` generates a fresh ICC v4.4 Display-P3/PQ profile following the same
public construction used by current Skia HDR ICC authoring: 65-entry PQ input TRC, 11^3
maxRGB-aware A2B CLUT, Display-P3 to XYZ D50 matrix, identity B2A, CICP 12/16/0/1 and the
source-derived HAGC payload. The generated profile is accepted independently by
LittleCMS/Pillow, including construction of a working RGB-to-sRGB transform.

The bounded CE experiment replaces only the tmap `colr` nclx property with this generated
PQ+HAGC profile. Tmap metadata, gain-map HEVC payloads, all image/resource payloads, graph
references and the source 0x54 marker remain byte-exact; worker classification stays
`known-compatible`, FFmpeg decodes the container cleanly, and HDR/HAGC unit tests pass.
The same property-only transformation preserves Standard Tone -1 / Colour +1 on the
non-Portrait fixture and keeps it AI-Portrait eligible. On the native Portrait fixture it
retains Style 16 Tone -0.5 / Colour +0.5, the exact depth/renderer hashes, f/2.8 and
Portrait Lighting strength 0.5. Production remains disabled until one device-level
Photos/ColorSync acceptance check confirms HDR brightness and Edit persistence. That device
check rejected the generic PQ+HAGC candidate: HDR remained weaker and entering Edit removed
HDR from the preview. The generated ICC path therefore stays research-only.

The next source-only finding is more direct. The reconstructed linear thumbnail had been
created only from the SDR primary, so its ordinary midtones were close to native while its
sparse HDR/specular tail was missing. On the same 1729 capture, native linearThumb luma p99.9
is about 0.978 and max about 0.999, whereas CE/CA reaches only about 0.649 / 0.660. Those
missing pixels align with the uploaded gain map: for source gain >= 0.55 the native-minus-CA
residual rises almost linearly, while lower-gain regions stay close.

The bounded CP diagnostic keeps the accepted CE graph, tmap, gain map, Styles, Texture,
selection marker and every other item payload exact and changes only the 1024x768
linearThumb. It adds a gain-dependent residual to ~1.68% of its pixels. Locally this restores
luma p99.9 to ~0.976 and p99.99 to ~0.980; decoded pixel RMSE against the same-capture native
linearThumb drops from ~0.0209 to ~0.0143. CP is a causality test only: its residual slope and
intercept were fit using same-capture native ground truth and are forbidden as production
constants.

Production now uses a separate source-only HDR-aware linearThumb model trained on eight
independent iPhone 16 native captures, with 1729 held out. It combines the uploaded current
primary with scene HDR reconstructed from the same file's ISO gain map/tmap and bounded
HDR-excess features. On the 1729 holdout, the old primary-only reconstruction leaves p99.9
near 0.62; the generic hybrid reaches about 0.999 while keeping the median at 0.4727 versus
native 0.4739. Whole-thumbnail MAE is about 0.0125 and RMSE about 0.0177. The source native
maximum itself reaches ~1.0, so no same-capture hard cap is used.

`codecs/linear-thumbnail.js` recognizes only the strict single-channel ISO graph whose tmap
inputs are current primary + gain grid. It samples both HEVC grids directly at thumbnail
resolution through `raster/heic-grid-sample.js`, reconstructs the alternate scene, applies
`raster/hdr-linear-thumbnail.js`, then encodes native-shaped Main10 full-range VUI 2/2/2.
A supported HDR graph must never fall back to an SDR-only linear thumbnail.

A critical call-site rule accompanies this: generation is keyed by `d.linearThumb === null`,
not by ordinary `d.thumbnail`. Native Portrait flattened exports can already carry an SDR
thumbnail while lacking the Styles linear resource; treating that SDR preview as a linear
thumbnail weakens editable HDR. `graftPatch()` therefore prefers a real source linearThumb,
and the app generates the HDR-aware resource whenever linearThumb is absent. Strict ISO HDR
reconstruction is fail-closed at both `port.patch()` and `graftPatch()` if neither a source
linearThumb nor a generated HDR-aware linearThumb is available. This applies to Portrait
reconstruction while preserving the source depth, aperture, Portrait Lighting and 0x54
Style/Tone/Colour/Palette state. The invariant is global in the Styles graft layer: an
ordinary SDR thumbnail is never accepted as `linearThumb`, even outside the strict ISO HDR
case. Direct legacy-compatibility callers that do not supply a generated source linear
resource use the baseline target profile's real `donor_linear_thumb_item`; they never fall
back to the source SDR preview. App compatibility callers still prefer the source-derived
HDR-aware linear thumbnail.

The processing router must also keep edited Current exports out of the native Texture-only
fast path. `nativeStyleExportTextureCandidate()` recognizes the proven iPhone 16/17 six-key
shape; `useTextureOnlyNativeStylePath()` returns false for that candidate and for native
Portrait rebuilds, while complete native Styles graphs still remain Texture-only. This fixes
a prior control-flow bug where classification succeeded but `textureOnly===true` caught the
file before `patchInWorker()`, preventing the HDR-aware linear reconstruction from running at
all. Current route + HDR/resource regressions pass 20/20.

The worker must additionally request source-derived editor headroom for the recognized
Current-export route and native Portrait rebuilds. Gating that request on the old
`bright-palette70` / `portrait-standard` report labels omitted the HDR sidecar after source
selection became immutable. The supplied IMG_1921 reproduces the omission: source primary,
gain map and tmap remain exact, but HDR disappears in Photos Edit and returns after saving.
The worker now emits the established headroom declaration without changing the selected
Style, thumbnail reconstruction or HDR samples. One CQ repair of IMG_1921 adds only that
declaration. Device feedback confirms HDR persistence; the residual slightly weaker HDR
remains unresolved. Do not treat metadata presence or an unchanged tmap as visual parity.

Device feedback now confirms CQ retains HDR in Edit, with a slight brightness deficit still
visible against native Standard. CR is a diagnostic-only isolation of inherited identity
Linear Gray ICC associations on the gain grid/tiles. It keeps all item payloads and references,
including CQ's working HDR headroom declaration, exact. Removing those data-channel profiles
must not be confused with removing the primary image colour profile or boosting HDR gain.
The user reports CR looks identical to CQ, so this ICC-removal hypothesis has no observed
benefit and is not promoted. Production remains on accepted CQ routing.

A scene-before-downsampling experiment also stays outside production. Its mathematical
regression is real on a synthetic sparse highlight, but the actual supplied photo improves
raw linear-thumbnail MAE only from 0.01260688 to 0.01258813 (about 0.15% relative). The brightest
native-reference region is already slightly overestimated. Neither that experiment nor a
uniform HDR boost is a demonstrated fix for the reported brightness deficit. The research
snapshot, tests and unserved CS artifact are isolated under ignored
`artifact/build/hdr-1921/prefilter-research/`; the accepted browser sampler is unchanged.
The post-Photos Current export is now supplied as IMG_1925. It retains essentially identical
headroom and gain samples but contains only an Apple auxiliary HDR representation. This
reopens a specific numerical-reader ambiguity, not the rejected ICC branch: version 131072
alone does not prove ISO log-gain semantics in every reader. Reports compare both log and
Apple Rec.709 interpretations; neither is a measurement of the physical Photos display.

CT is a diagnostic-only response. It preserves CQ's complete source ISO HDR and accepted
Styles/Texture resources, and gives the Apple auxiliary reader a separate source-derived
Rec.709 map with a version-65536 declaration. Its source headroom is unchanged. Under that
documented Apple equation, integrated absolute scene-luminance error drops to about 0.192%
on the supplied photo. All encoded auxiliary pixels are independently decoded and checked.
Photos colour, HDR intensity/persistence and controls still require device validation.
The two-plane graph is intentionally outside the single-plane production route; do not
adopt it merely because worker read classifies it known-compatible. See `facts.md` 10.136.

CT device feedback remains slightly dark. CU isolates a specific alternate auxiliary
transfer from Skia's Apple reader (`sample^1.961`), while CT uses piecewise Rec.709. This
does not establish Photos' internal transfer. Under that power-reader hypothesis CT's
computed integrated luminance is about 1.09% low; CU's inverse transfer brings its numerical
signal close to the source without changing headroom. An independent audit proves CU
differs from CT only in 30 auxiliary HEVC tile payloads; all properties and other resources
are exact. CU remains diagnostic pending physical confirmation, and the browser stays on
CQ/v227. See `facts.md` 10.137.

Release decision: the user accepts the slight reconstructed-HDR brightness difference and
requests publication of the stable CQ/v227 route. CU did not provide a clear improvement,
so the dual-plane/alternate-gamma trials stay outside production. Complete native originals
continue through the existing Texture-only path. Both supplied original Bright/HDR controls
are byte-identical to their previous Stylio outputs, and a portable four-Style regression
guards route selection, original resources and idempotence in browser CI and Pages checks.
The expanded release validation passes 280 tests with 17 optional-fixture skips. See
`facts.md` 10.138. The research commands below describe optional local tooling; no candidate
generator or private photo is required by the browser release.

The targeted native/Portrait/HDR run passes 69 tests with 4 optional-fixture skips. PWA cache
v227 includes the new HDR/grid modules and the research HDR modules present under web/src;
precaching does not activate the rejected ICC/tmap conversion branches.

```
node tools/native-export-texture-candidates.mjs <output-directory> <source.heic> [...]
node tools/native-style-rebuild-variants.mjs <output-directory> <source.heic> [...]
node tools/native-style-hdr-variants.mjs <ABC-directory> <output-directory>
node tools/native-style-calibration-variants.mjs <output-directory> <E.heic> <same-capture-native.heic>
node tools/native-style-base-variants.mjs <output-directory> <I.heic> <original-native.heic>
node tools/native-style-preview-variants.mjs <output-directory> <L.heic> <edited-native.heic>
node tools/native-style-preview-hdr-variants.mjs <output-directory> <M.heic> <edited-native.heic>
node tools/native-style-preview-metadata-variants.mjs <output-directory> <Q.heic>
node tools/native-style-preview-render-variants.mjs <output-directory> <Q.heic>
node tools/native-style-dual-rendition-variants.mjs <output-directory> <L.heic> <native-standard-current.heic>
node tools/native-style-hidden-editor-variants.mjs <output-directory> <X.heic> <original-bright.heic>
node tools/native-style-split-tmap-variants.mjs <output-directory> <L.heic> <native-standard-current.heic>
node tools/native-style-selection-marker-variants.mjs <output-directory> <AQ.heic> <original-bright.heic> <native-standard-current.heic>
node tools/native-style-dual-exif-variants.mjs <output-directory> <AQ.heic> <original-bright.heic> <native-standard-current.heic>
node tools/native-style-edited-linear-thumb-variants.mjs <output-directory> <E.heic> <edited-source.heic>
node tools/native-style-hdr-routing-variants.mjs <output-directory> <CA.heic>
node tools/native-style-plist-calibration-variants.mjs <output-directory> <CE.heic> <same-capture-native-full.heic>
node tools/native-portrait-contract-audit.mjs <source.heic> [...]
node tools/repair-rebuilt-native-hdr.mjs <native-current.heic> <rebuilt.heic> <output.heic>
node tools/native-style-gain-data-color-candidate.mjs <CQ.heic> <CR.heic>
node tools/native-style-apple-fallback-candidate.mjs <Current.heic> <CQ.heic> <output.heic> [--measure] [--apple-power-1961]
```

The CT diagnostic requires the matching source-hash decode cache from the private
`artifact/build/hdr-1921/compare-after-photos.mjs` harness. It refuses mismatched source
payloads, writes with `wx`, uses no original-Bright resources, and is not a browser feature.

### Editable AI Portrait

The switch is off by default. With it off, processing uses the normal
Styles/Texture pipeline. With it on, depth inference and Portrait export are part
of one visible processing flow. One save/download pair exports Styles, Texture
and AI Portrait together. The browser preview supports tap-to-focus and blur;
changes reuse the same encoded depth, never rerun AI or re-encode the primary.
Preview updates reuse GPU textures and shaders. HEIC assembly runs in a separate
worker after a short input debounce; saving waits for the latest settings.
Assembly is serialized and intermediate slider positions are skipped. Hidden
pages suspend preview GPU resources and wait before starting the next photo.
Decode caches and conversion encoders are released after each processed photo.
The focus marker supports keyboard arrows and a reset action. Removing a result
releases its assembler, preview resources and download URLs.
Inference, preview and tap-to-focus share a canonical stored/display transform
that honors the primary's ordered `irot`/`imir` properties. The exported depth
retains that same property order; rotation and mirroring do not commute.
The intermediate normal result stays hidden while opt-in AI processing runs.
Cancellation or failure publishes that result once as a fallback.

Portrait is initially off. Import the HEIC into Photos, enable Portrait, then
adjust aperture and Portrait Lighting. The preview approximates bokeh; it is not
a pixel-identical preview of Apple's renderer. Focus is stored as a normalized
Focus region and the aperture as SimulatedAperture. Opaque REND focus behavior
and refocusing across arbitrary scenes still need physical-device validation.

The web aperture control uses discrete stops from f/1.4 to f/16, followed by Off,
with exact labels including f/2.0 and f/8.0. Off shows the unblurred preview and
keeps a valid f/16 in editable depth metadata; reset returns to f/4.5. The saved
Portrait remains off initially for every stop.

For tested older Portrait/on exports missing rendering metadata, the Styles
worker restores the accepted V2 A capture graph using the camera's original
compressed depth, without model inference or re-encoding. Device tests confirmed
aperture and lighting adjustments for the iPhone 13/16 samples. Complete capture
graphs and the working next-generation Portrait-off route stay unchanged. This
compatibility repair uses reference rendering/calibration estimates, so these
results do not guarantee physical depth accuracy or support for all cameras.
An original Style selection stored in MakerNote 0x54 survives adding a missing
Styles graph, including Bright and the original Tone/Colour values.

The model control has three steps: Lite (V2 Small q4, 27.4 MB), Standard
(V2 Small fp32, 99.1 MB, default), and Pro (V3 Small fp32, 105.3 MB including
external weights). These sizes describe model downloads, not peak memory or
total runtime downloads. Only the selected model is downloaded when needed;
changing the control applies to the next operation. Each artifact is pinned by
revision, size and SHA-256. Both V2 and V3 Small conversions are Apache 2.0.
V3 uses ImageNet normalization with a five-dimensional single-view input and
positive depth output, converted to inverse depth before common refinement.
Two-photo desktop comparisons at the same 630 input budget verified GPU and
CPU execution, but did not establish better individual hair strands for V3.
Pro is an optional experiment, not a guarantee of better portrait boundaries;
the shared person segmentation remains a separate constraint. Physical Safari
memory, Photos rendering and thermal behaviour still need device validation.
Lite reduces download size; it is not necessarily faster or cooler than Standard.

Inference runs locally through ONNX Runtime WebGPU by default.
The circular settings control beside the Depth switch lets users turn GPU acceleration off to use
single-thread WASM CPU inference. This applies to the next operation, uses the
same model and refinement, and does not change the GPU preview. CPU is slower
on the measured desktop and is not a guarantee of lower device temperature.
There is no automatic switch to CPU after a GPU error. Native depth
is preserved without inference. The completed Styles payload is kept byte-exact
when adding AI, for both native captures and Styles generated by this app. This
includes scene/skin statistics and keeps one-step export consistent with downloading
the normal Styles result and adding AI after re-upload. Unavailable WebGPU, cancellation or failure leaves
the normal result available. Switching off restores it. Inference has a two-minute
deadline for GPU phases and four minutes for CPU phases; streaming downloads have a separate 30-second stall
timeout and progress display. The complete optional AI operation has a ten-minute
ceiling. Full-resolution decode surfaces are released before model allocation.

The capture-template exporter follows accepted V11/V12/V18/V20 device experiments.
It preserves this photo's compressed primary/HDR/thumbnail/delta payloads and
Texture/face masks. It never bakes blur into the primary or converts HDR to SDR.
Grid item slots are extended to fit the input, including 24 MP native captures
with 45 primary, 48 delta and 15 HDR tiles; tile payloads and properties stay exact.
The reference calibration and REND are compatibility estimates, not physical
camera measurements. The template contains metadata only: no photo bitstreams,
GPS, source dates, capture time or UUIDs. Numeric capture parameters are still
reference estimates; the template's Styles coefficients are not substituted into
the completed photo. Colour strength remains a separate unresolved issue.

The local `tools/build-portrait-template.mjs` build tool extracts sanitized
metadata from a developer-supplied reference; no private photo is deployed.
`tests/web/ai-portrait-export.mjs` checks geometry, payload preservation,
Texture/Styles/depth, native Styles retention and public-template privacy.
Graph checks do not prove Photos controls across every device or photo.

Run `node tools/download-ai-portrait.mjs` to download/verify pinned assets.
Standard's initial download is approximately 120 MB; other selections differ.
Model/runtime binaries are ignored
by Git and fetched/verified by Pages CI. They are not installed with the PWA shell.
Depth Anything V2 Small is Apache-2.0 and ONNX Runtime is MIT; both licenses ship
with the assets. Model input starts at maximum edge 1036 (multiples of 14),
with 770 and 518 resource-failure fallbacks outside Safari/iOS. Safari/iOS start
at 630, with a GPU fallback to 518 on caught inference or resource errors. This moderate budget
avoids probing 1036/770, but still needs validation on physical Safari devices:
a WebKit process reload cannot run a JavaScript fallback.
Explicit CPU inference starts at 630 with a 518 resource-failure fallback.
Primary-image guidance and saved depth remain at up to 1024 for both providers.
This is a browser memory precaution, not a guessed iPhone/GPU model;
ray tracing does not determine WebGPU
memory limits. Relative depth stays float until RGB-guided resampling to maximum
edge 1024 and final 8-bit quantization. Colour guidance sharpens existing depth
boundaries; it cannot recover geometry absent from the model prediction.
When a valid person matte is available, a conservative boundary pass protects
confident subject pixels using nearby interior depth. Changes are capped at 32
8-bit levels; background and uncertain hair pixels are untouched. This reuses
the photo's matte or the one already generated for Soft Skin, without a second
segmentation inference. The same corrected depth feeds preview and export.
Generated Portrait mattes receive a dedicated `PortraitEffectsMatteVersion`
descriptor (65537) and pixel-data type, rather than Texture's FSINC descriptor.
Generated person opacity uses a smooth 32–224 confidence remap: low-confidence
background becomes zero, confident interiors become opaque, and uncertain edges
remain gradual. Portrait/person/one-person instance mattes share the same encode;
skin confidence is unchanged and no additional inference runs. Device tests on
the reported Stage Light sample confirmed a black background with this remap.
Native mattes are preserved. Apple Photos lighting and bokeh still require device
validation; metadata and lossless codec checks do not prove visual parity.
Complete model downloads are SHA-256 verified and cached by content hash;
runtime caching uses its pinned dependency identity rather than the UI release.
No image is sent to a server. Safari/device memory and latency vary.

Generated AI disparity uses the device-accepted F response: a square-root curve
and relative range [0, 0.75]. Preview, auxiliary depth descriptor and XMP use
the same response, including subsequent focus/aperture edits. This compresses
near-side defocus relative to distant background in the tested scene; it is an
empirical adjustment, not metric camera calibration or a hair-detail fix. Native
depth is never remapped.

Clear cache sits beside Clear history. It removes this app's downloaded model
and processor cache entries and releases idle converter resources. It preserves
photos, settings, offline UI and sibling GitHub Pages project entries. It is
disabled while processing or updating Portrait settings. Browser HTTP caches
are outside this button's control; tools download again when required.
Download and successful share actions gain a checkmark and an Again label for
that output File. A cancelled share is unchanged. New focus/aperture output
starts unmarked; these indicators record UI actions, not proof of a Photos save.

Model sources: https://huggingface.co/onnx-community/depth-anything-v2-small
and https://huggingface.co/onnx-community/depth-anything-v3-small.

Completed conversion encoders are released before depth inference to avoid
overlapping their WASM heaps with the GPU model. Runtime failures retain their
step and message, including numeric throws; final failures show a short diagnostic
inside the result's Details. Cancellation, timeout, download/integrity and
unsupported WebGPU failures do not trigger an inference retry.

Edited HEIC exports may omit the ordinary thumbnail. Portrait assembly accepts
that layout when the Styles graph and linear thumbnail are present, removes the
unused reference thumbnail and keeps the photo's own primary and Styles data.

Compatibility is based on file contents, not the EXIF Software/iOS label.
Native Styles schemas 13, 14, 16 and flag-bearing 131087/131088 are understood by the
current exporter. Known iPhone 16/17 contracts continue through the established
native-preservation route unchanged. For iPhone 16/17 only, an unknown Apple
contract is intercepted before Texture, Soft Skin or Portrait mutation. A second
Compatibility Firewall preflight then validates graph boundaries, resource limits,
extents, properties, references and protected primary/HDR/depth/matte roles before
any compatibility profile, decoder or thumbnail work is allowed.
The read worker performs discovery, classification and eligible-source preflight
using one parsed graph. The page consumes that decision without parsing the
contract again or sending a second full photo copy for preflight. The exporter
still independently validates its input before mutation. `idat` extents must fit
inside the actual `idat` payload; a clamped/empty typed-array slice is not bounds
evidence. Unknown reference types touching protected photographic resources also
force preservation, even when neither endpoint has an Apple tag URI.
When the change is demonstrably confined to the editing layer and the underlying
HEIF/photo/HDR/depth contract remains proven, Stylio can create a separate Legacy
Compatibility copy: it removes the unverified editing layer and rebuilds the same
known Styles/Texture graph used by the mature non-native porting path. The conversion
plan and two-way mutation budget reject undeclared source changes as well as
undeclared new output resources. If the future change reaches the container, codec,
a protected essential/non-essential property, a new photographic auxiliary, or an
unknown dependency crosses into HDR/depth/photo resources, the file is preserve-only
instead of being guessed at. A recognizable HEIC that the current parser cannot
understand is likewise returned byte-for-byte as a preserved copy. Extra keys inside
supported current Styles payloads remain byte-exact.
The documented `k` and `l` flags are recognized as current Styles keys and do not
trigger a rebuild. Both compatibility exports and preserve-only results publish a
downloadable file and complete their progress without invoking optional Portrait.
For a compatibility or preserve-only result, **Details → Apple compatibility** shows
the user-facing contract outcome: newer Apple source format, known compatibility
target (when rebuilt), whether photo/HDR/depth data were preserved, and any editing
metadata that was intentionally not carried forward. Exact internal contract IDs stay
in developer diagnostics rather than the normal result UI.
This is not a promise that every future Photos renderer or future contract is already
qualified. New source contracts still require original fixtures and physical
import/edit/save/reopen testing; rewriting an iOS version string is never treated as
a real conversion.


### Active processing handoff — 2026-10-15, iOS 18 telephoto Texture

Branch: `feature/ui-ux-redesign`. UI work is complete for this task; do not redesign
or alter HDR/depth rendering while investigating this report. The working tree was
clean at the start. These processing changes are uncommitted/unpushed; SW cache is v191.

- Report: iPhone 16 Pro telephoto, Portrait initially Off and Standard capture;
  web processing → Share → Save to Photos → black Glow/Soft Skin and Photos fails
  to save the edit. Private inputs/screenshots are in
  `C:/Users/WanThinnn/Downloads/16-pro-iOS-18-error-black/`.
- `IMG_3435_orgirnal.HEIC` and `IMG_1529_processed.HEIC` have identical native
  Styles bytes: schema 13, no key `3` (tone curve). The output added Texture while
  retaining that missing field. All 96 original HEVC payload hashes occur in the output.
- `texture-compatibility.js` now permits a missing-curve-only schema 13 extension
  through `preserveStyles:true`. `texture.js` uses it both when adding Texture and
  repairing an already processed file. No schema/coefficient/scene-statistic/Exif
  replacement; existing curves and native-preserving policy for other schemas stay unchanged.
- Tests first failed on the actual original and the portable worker fixture, then
  passed after the change. The real processed-file repair retains every original
  container byte except its Styles extent offset/length and an appended Styles payload.
  It preserves all other 131 item payloads, properties and references, and is idempotent.
- The native-preserving helper also leaves unreadable/opaque Styles untouched,
  rather than introducing a new rejection while checking for schema 13. A separate
  regression failed before that guard was added, then passed.
- Private generator/audit: `tests/private-fixtures/Texture_iOS18_3435/curve-trial.mjs`.
  It writes with `wx` (will not overwrite), performs no decode/encode/inference,
  and generates `IMG_1529_TextureCurveTrial.HEIC` (isolated repair) and
  `IMG_3435_TextureCurveTrial.HEIC` (fresh original through the Texture worker).
  These files and personal images are ignored, not deployed.
- **Pending, not a confirmed visual fix:** import the isolated repair into Photos as
  a new asset; try Glow and Soft Skin, Done, then reopen. Compare with the fresh
  original conversion if needed. Confirm both render and successful save. If it still
  fails, this missing-curve hypothesis is insufficient; do not stack unrelated metadata
  changes. Windows tests cannot execute Apple's renderer. See `facts.md` §10.74.

Latest lightweight results: 61 passed / 8 optional private-fixture skips / 0 failed
across the six Node suites below; PWA and git whitespace checks also pass.
Commands were run separately, not in parallel:

```powershell
rtk proxy node tests/web/texture-compatibility.mjs
rtk proxy node tests/web/ai-portrait-export.mjs
rtk proxy node tests/web/style-preservation.mjs
rtk proxy node tests/web/soft-skin.mjs
rtk proxy node tests/web/heic-worker.mjs
rtk proxy node tests/web/module-paths.mjs
rtk proxy node tests/web/check-pwa.mjs
```

### DNG import

The DNG path adapts the existing LibRaw worker in `ref/Elio-backup`. It decodes
RAW samples with camera white balance and colour calibration into 8-bit sRGB,
then uses the unchanged raster-to-HEIC Styles converter. A temporary lossless
PNG carries compact capture Exif; its orientation is reset because LibRaw already
applies the source rotation. The output is HEIC, not a RAW DNG. RAW edit latitude,
HDR and the camera's proprietary rendering are not retained or promised.

Decoder assets are libraw-wasm 1.6.0, loaded on demand from jsDelivr and checked
against pinned SHA-256 hashes. Photos are sent only to a local worker, never to
the CDN. Cross-origin isolation is required. The worker is terminated after each
decode to release its WASM heap before the HEIC encoder starts.

The memory bound is 12 million output pixels. Larger tiled RGB LinearRaw DNGs
can be decoded tile by tile; other oversized RAW layouts fail before decoding.
JPEG XL compressed DNG is explicitly unsupported by this decoder. Supported
camera variants still require tests with actual DNG files.

Browser validation: `IMG_0368.DNG` (DNG 1.6, lossless JPEG RGB tiles, 4032×3024)
completed through tile decode, HEIC Styles export and GPU depth inference.
The HEIC output is 4000×3000 and retains its source capture date, timezone and
subseconds. `IMG_0665.PNG` also completed Styles export and GPU depth inference.
These tests do not validate Apple Photos Styles/Portrait controls or all cameras.

PNG input remains supported through the raster converter. HEIC output has no
transparent alpha plane; this is a still-photo conversion, not a lossless PNG
container round trip.

### Third-party HDR JPEGs (Indigo / Adobe gain maps)

The dedicated HDR JPEG importer preserves the base ICC and the source gain
map's scalar or RGB bounds, gamma, offsets and headroom in an ISO tmap graph.
The HEIC advertises tmap and prefers the HDR rendition over its SDR fallback.
An existing alternate ICC is retained; Adobe inputs without one declare PQ in
the source primaries. The generated template's Apple legacy gain-map role is
removed, and Texture / Portrait stages must not restore it. The native-camera
HDR reconstruction route remains separate.

The supplied Indigo capture passes real browser decode/encode and exact
primary/gain payload comparison with the earlier output. Device confirmation
of HDR in both the Photos viewer and editor remains required; graph presence
alone does not establish visible HDR or support for every camera app.

Device update: the user rejected both initial Indigo A/B outputs because HDR
is still absent. This remains an open bug. The generated HDR alternative was
also found to be marked hidden; new tmap items are now visible while codec
tiles/auxiliaries remain hidden. Portrait B already had a visible tmap, so that
flag alone cannot explain both failures. Standalone HDR versus Styles controls
and a one-byte visibility-only control were created for physical-device comparison.

Latest device correction: E (HDR `tmap` selected as primary, Styles retained)
shows HDR in the Photos viewer but loses HDR after Photos Edit → Save; F (only
the tmap hidden flag cleared) does not show HDR. E therefore isolates a separate
Photos editor compatibility problem. The experimental `importedIso` path in
`registerTmapHdr` can add a legacy Apple gain auxiliary association and optional
HDR headroom XMP to an HDR-primary Adobe import, retaining every existing image
item's bytes. `tools/repair-imported-hdr-editor.mjs` enables controlled A/B
validation without activating this route in production. The repair remains
unconfirmed on an iPhone; do not treat a passing container regression as proof
that Edit → Save preserves HDR. Do not alter E's decoded pixels or colour space.

Device result for that repair: I/J briefly flash HDR for roughly 0.3 s, then Photos
settles to SDR; Edit and post-save remain SDR. Therefore an RGB ISO gain plane
must not simply be relabelled as Apple's legacy HDR auxiliary. The current bounded
diagnostic keeps the RGB ISO tmap intact and adds a separate scalar Apple fallback
computed from the source per-channel HDR equation. K links that fallback to the
tmap primary; L links it to both SDR base and tmap. These dual-plane files are
rejected on-device and must not be promoted.

The production fix is based on the previously device-confirmed CQ editor topology,
not on K/L. CQ keeps the SDR image grid as `pitm`, keeps HDR as a non-primary
`tmap` alternative, and links the Apple HDR auxiliary only to the SDR primary.
For third-party RGB ISO/Adobe HDR the app now preserves the original RGB gain
plane as the second `tmap` input and generates a separate monochrome Apple gain
plane for Photos Edit. The Apple plane receives `auxC` HDR, `auxl -> SDR primary`
and source-derived `HDRGainMapHeadroom`; it is never added to the tmap's `dimg`
recipe. Styles/Exif/thumbnail/linear resources continue to describe SDR + tmap.

`Indigo_M_CQTopology_AppPipeline.HEIC` is produced by the real `importRaster()`
plus FFmpeg.wasm path with AI Detail disabled. Its audited graph is SDR
`primary=1`, ISO `tmap 98 -> [1,50]`, separate Apple HDR grid `100`, and
`auxl 100 -> [1]`. Targeted RGB/scalar/Texture/Portrait regressions pass 24/24.
Physical validation confirms M preserves HDR and Styles/Texture through Photos,
including Edit/Save. Its remaining issue is colour fidelity: the Apple fallback is
one-channel scalar while the Indigo source gain map is RGB, so Photos preserves the
base chromaticity instead of the source HDR per-channel chromaticity. A bounded
source analysis measures scalar HDR RGB MAE around 0.02746 linear and mean saturation
at about 97.65% of the source HDR value, with larger regional errors.

Candidate N keeps the exact proven M/CQ graph and changes only the Apple auxiliary
from mono to RGB per-channel Apple-equation gain. The original SDR primary, ISO RGB
`tmap`, Styles, Exif, linear thumbnail and all other item payloads remain unchanged.
Full-resolution equation error drops to about 0.000718 mean absolute scene error.
Device testing confirms the RGB auxiliary fixes the visible colour loss. O then fixes
the 0x20000 auxiliary sample representation, but HDR brightness still remains about
10% below the source, so the residual viewer difference is not the editor auxiliary.

Historical IDG fixtures expose the viewer regression. The retained
Adobe/no-alternate-ICC `IDG_20261009_HDR_Fixed.HEIC` declares its tmap derived
rendition as full-range Display-P3 extended-linear `nclx(12,8,0)`. Section 10.139
changed this path to PQ `nclx(12,16,0)`. Candidate P restores only that transfer,
and physical testing confirms viewer HDR brightness and colour return to the desired
source-like appearance. P still changes appearance in Photos Edit: colour washes out
and bright lamp highlights clip, so viewer and editor are not yet one coherent HDR state.

Candidate Q attempted the editor correction in the real HDR JPEG importer, but it changed
multiple variables together: HDR-aware linear thumbnail, mono Apple fallback declaration
65536, and the already-proven P viewer tmap. Physical testing rejects Q because HDR is lost
entirely. Those Q-specific runtime changes are rolled back; do not use Q as a production
baseline.

Candidate R therefore isolates one variable only. It is built from device-proven P and
replaces only linear-thumbnail item 65 with the HDR-aware Main10 resource. Every other item
payload, graph reference and non-linear property is verified byte-exact to P, including the
P3 extended-linear tmap, RGB ISO gain, RGB Apple auxiliary/version 131072, headroom and
Styles/Texture resources. Device testing confirms R keeps the correct P viewer but does not
change the Edit defect: colour is still slightly washed out and lamp highlights clip harder.
LinearThumb is therefore not the primary remaining cause.

The next isolated layer is the Apple editor auxiliary. CQ's accepted auxiliary is mono 8-bit,
uses a generic Linear Gray ICC on the grid/tiles, has no tile pixi, and carries full-range
2/2/2 HEVC VUI. P/R instead expose a three-channel RGB Apple auxiliary with colour-image
metadata. Candidate S keeps P's entire viewer/tmap/Styles/linearThumb graph exact and changes
only the Apple auxiliary to a source-derived mono normalized-log 0x20000 representation with
CQ-shaped Linear Gray/mono codec properties. Version 131072 and source headroom remain exact.
Device validation of S shows View, Preview and Edit are now consistent, but HDR-only colour
remains slightly desaturated versus the original JPEG, especially green foliage. Low Power
Mode disables HDR and makes the Stylio HEIC and original JPEG colour match 100%, proving the
remaining error is in HDR gain reconstruction rather than SDR pixels/profile/conversion.
A bounded source-equation check confirms mono gain retains only about 63.8% of source HDR
saturation on green-dominant pixels even though green-channel luminance remains about 95.9%.
Do not correct this with a global saturation boost.

Candidate T isolates a topology solution: keep S's pitm and native-shaped mono Apple editor
gain untouched, add one duplicate SDR grid that reuses the exact same primary payload/properties
and 48 tiles, and make the RGB ISO tmap derive from that duplicate instead of the editor pitm.
No image pixel is re-encoded. Device validation shows T remains visually the same as S: HDR green
is still slightly desaturated while SDR Low Power Mode matches the source. Splitting the tmap base
alone is therefore insufficient.

Candidate U changes only alternate-group membership from `[tmap, editor primary]` to `[tmap,
display-base duplicate]`. All item payloads, properties and iref relationships stay exact to T.
The editor `pitm` and mono Apple auxiliary are now completely outside the viewing alternate group.
Device validation shows U is unchanged from S/T, confirming Photos prefers the Apple HDR auxiliary
independently of this alternate-group topology. Stop further topology-only experiments that keep a
separate mono Apple gain.

The next bounded candidate returns to the retained 20261009 structural IDG contract.
`IDG_20261009_HDR_Fixed.HEIC` uses the same RGB ISO gain grid as both the tmap input and Apple HDR
auxiliary, with auxl targets `[primary,tmap]` and the original Adobe hdrgm RDF sidecar on that gain.
Candidate V restores those roles on current source bytes; W additionally removes only the `tmap`
compatible brand to match that retained file's ftyp. Later review corrects an important assumption:
the 20261009 Adobe/no-alternate-ICC conversion was never documented as physically accepted on an
iPhone; its original record left the device appearance check pending. Only the older 20251020
conversion has explicit historical device acceptance, so 20261009 is a structural reference only.

A clean export from the current HEAD contract was then tested on the iPhone and lost HDR entirely,
despite preserving the source gain plane byte-for-byte at the checked 512x512 YUV tile. Therefore
HEAD and the shared-role 20261009 shape are not valid production fallbacks for this source.

Candidate X is the temporary accepted compatibility point. It starts from P, whose P3
extended-linear `tmap` gives the correct viewer rendition, and leaves every P payload, graph
reference and hvcC byte exact. Only the separate RGB Apple HDR auxiliary's container colour
declaration changes from `nclx(12,13,6)` to full-range `nclx(2,2,6)`, matching the HEVC SPS that
already signalled 2/2/6. Physical validation reports a small residual visual offset, but the result
is acceptable for the current release.

Production implements the same semantics directly. Three-channel Adobe/Indigo inputs keep their
source RGB ISO gain as the second `tmap` input with no Apple aux role, while a separate per-channel
normalized-log 0x20000 Apple auxiliary targets only the SDR primary. It carries version 131072,
the exact source headroom, and full-range 2/2/6 data signalling. The tmap remains extended-linear
in source primaries, the HEIF advertises the `tmap` compatible brand, and generated tmap items are
visible while auxiliary/metadata items remain hidden. No HDR stripping or arbitrary brightness /
saturation compensation is used.

The real browser pipeline smoke for the current Indigo fixture passes with primary 1, ISO gain 50,
tmap 98, Apple grid 112 with 12 tiles, source headroom 10.312498469, and Styles item 97. Contract
audit confirms `tmap 98 -> [1,50]`, tmap `nclx(12,8,0,true)`, ISO gain
`nclx(12,13,6,true)`, Apple `auxl 112 -> [1]`, XMP version 131072, and matching container/SPS
`nclx(2,2,6,true)` on all Apple tiles. Focused HDR regression tests pass 26/26.
