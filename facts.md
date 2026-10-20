# Photographic Style Port: facts

How `photographic_style_port.py` changes the metadata of a normal HEIC so that Apple Photos
offers the Photographic Styles palette (风格 / 调色板), Portrait editing and, on iOS 27,
Texture/Grain (质感 / 颗粒). It covers everything tried from the early V-series experiments to
v1.0.0: what worked, what failed, and what is still open. Usage, testing and the version history
are in the [README](README.md).

**Status labels**

| Status | Meaning |
|---|---|
| ✅ **Proven** | Tested in Apple Photos on a device: the control appears, has a visible effect, and survives save → reopen → re-edit |
| ☑️ **Solid** | Verified at file level (libheif opens it; payloads byte- or pixel-identical; structure matches native files) or by calibration against native files, but not phone-tested on its own |
| 🔍 **Investigate** | A hypothesis, known gap, donor-derived value or unknown meaning; needs more work before it is final |

---

## 1. Overview

Photos decides which editing controls to offer from **what the file contains**, not from the
camera model. Each control appears when the file carries the data that control reads. The
renderer already runs on older iPhones; what an older photo lacks is the data. The port adds
it, and the decoded photo stays pixel-identical to the original. ☑️

### Design principle
Anything software can calculate or approximate is not considered a hardware-specific feature,
so writing it into a photo is not considered adding a hardware-only capability. The end goal
is a port that writes only five kinds of data:

1. **Format declarations**: item types, URIs, schema and pixel-format fields that describe
   what the file contains and how it is laid out.
2. **The photo's own data**: pixels, HDR, Exif, depth, mattes and sidecars, rearranged but not
   altered.
3. **Values calculated from the photo**: scalars such as tone statistics.
4. **Maps calculated from the photo**: images and grids such as light maps and the linear
   thumbnail.
5. **Neutral defaults**: software stand-ins for capture-time results the port cannot reproduce
   (identity, flat, empty). They claim nothing about the scene.

Exif `Make` / `Model` are never changed, so a ported photo still names the camera that took it.

Today the port also takes a structural template and a few values from a **donor**, a
normalized native iPhone 16 file embedded in the script. Donor-derived data is not part of the
end goal and remains an **open issue** (§8).

For where every piece of metadata stands today, see the status sheet in §2.1.

---

## 2. Metadata: status and requirements

### 2.1 Status sheet

Every piece of metadata the port writes, what kind of data it is (§1), and its status.

A row can be ✅ and still have an open point: it works, but something about it is not yet
understood or not yet in its final form.

**Photo data and container**

| Metadata | Port writes | Kind | Status | Open point |
|---|---|---|---|---|
| Primary image tiles + `hvcC`/`colr` | The photo's own, pixel-identical | Photo's own | ✅ | – |
| HDR gain-map tiles + `hvcC` | The photo's own | Photo's own | ☑️ | HDR rendering not tested on its own |
| HDR XMP sidecar (headroom) | The photo's own | Photo's own | ☑️ | – |
| `tmap` geometry (`ispe`/`irot`) | The photo's own, or derived from the primary | Photo's own | ☑️ | – |
| `tmap` payload (gain-map parameters) | The photo's own (since v0.5.1); a photo without one keeps none (v0.6.2) | Photo's own | ✅ | Donor's only on the `--graph donor` fallback |
| Ordinary thumbnail | The photo's own, or encoded from the primary if missing | Photo's own / map | ✅ | – |
| Exif, Make/Model unchanged | The photo's own | Photo's own | ✅ | – |
| Orientation `irot` / `imir` | The photo's own | Photo's own | ✅ | – |
| Item graph (IDs, `iref`, `ipma`, `ipco`, grids) | The photo's own, plus the style items (v0.6.2, §3); donor template only for sizes without a known StyleDeltaMap | Photo's own / format | ✅ | Standard full port does not reconstruct 48 MP / 640-pixel delta tiles; native add-texture keeps existing ones (§3) |
| `mdat` and `iloc` offsets | Rebuilt | Format | ✅ | – |

**Style palette**

| Metadata | Port writes | Kind | Status | Open point |
|---|---|---|---|---|
| MakerNote `0x54` | Fixed 8-key record, neutral pad | Format | ✅ | Members `1`/`2` vary with capture (likely the Tone/Color pad, §8); `4`, `6` vary too; the rest unknown |
| Styles item (`metadata:styles`) | New item | Format | ✅ | – |
| Styles `0` (schema), `e`/`f`, `g`, key `3` header | Fixed values | Format | ✅ | – |
| Styles `1` coefficients | Identity | Neutral approximation | ✅ | Identity intensifies Styles on native IMG_0754 in device isolation (§10.11); native values not reconstructed |
| Styles `3` tone curve | Identity | Neutral | ✅ | Native values not reproduced (affects the look, §9) |
| Styles `c`/`d` light maps, flat (default) | Constants | Neutral | ✅ | – |
| Styles `c`/`d` light maps, `--light-maps target` | Calculated from the photo | Map | ✅ | Stored orientation, no flip (fixed in v0.6.2, §4.1) |
| Styles `6` tone statistics | Calculated from the photo | Value | ☑️ | – |
| Styles `6` `highKey` | **Donor's** | Donor | 🔍 | Derivation unknown (§8) |
| Styles `i` (HDR range, `Gain`) | **Donor's** | Donor | 🔍 | Neither follows headroom or generation alone (§8) |
| Styles `h` | **Donor's** | Donor | 🔍 | Equals `Gain / 4` in all 30 native files; calculable once `Gain` is resolved (§8) |
| Styles `2` | **Donor's** (`True`) | Donor | ☑️ | `True` in all 30 native files: a format declaration (§8) |
| Styles `4`, `5`, `j` | **Donor's** | Donor | 🔍 | All three vary between native files; unknown (§8) |
| Styles `k` / `l` | Not written | – | ✅ | Not needed; `False` in every native file that has them |
| Delta map | Neutral constant tile | Neutral | ✅ | – |
| Linear thumbnail, `generate` | Encoded from the photo with its own `hvcC` | Map | ✅ | irot 90/270 were stored 180° off up to v0.6.1, causing a glow on some photos; fixed (§4.4) |
| Linear thumbnail, `reuse-thumbnail` | The photo's own thumbnail | Photo's own | ✅ | – |

**People layers and Portrait**

| Metadata | Port writes | Kind | Status | Open point |
|---|---|---|---|---|
| Classic semantic mattes | The photo's own | Photo's own | ✅ | Which mattes are needed individually |
| Matte slots the photo does not fill (with or without people) | Exactly empty 2016×1512 frame (since v0.6.1; before, the donor's near-empty matte) | Neutral | ✅ | – |
| `PersonMasksValidHint` | 1.0 when mattes are carried | Value | ✅ | – |
| `PeopleRatio` / `SkinRatio` | Not written (stay 0) | – | ✅ | Not needed for Soft Skin (§7) |
| Depth map | The photo's own | Photo's own | ✅ | – |
| XMP sidecars (depth, mattes) | The photo's own, remapped | Photo's own | ✅ | – |

**Texture and Grain (iOS 27)**

| Metadata | Port writes | Kind | Status | Open point |
|---|---|---|---|---|
| `texture_styles` item | Native iPhone 18 Pro record | Native record | ✅ | – |
| `HardwareModel` | `iPhone19,2` | Native record | ✅ | Names a device other than the photo's own (§8) |
| `FilmGrainSeed` | CRC-32 of the photo's first primary tile mod 256 (since v0.6.1; before, 92 for every photo) | Value | ✅ | – |
| `TextureStylePeopleDataVersion` | 3 | Native record | ✅ | – |
| `Preset`, `CaptureType`, `CaptureMode`, `PortType` | Native values | Native record | ✅ | Not tested one at a time |
| `TextureStylePostProcessedPeopleData` (photos with people) | One entry per face: boxes and angles from the photo's face regions, a fixed landmark layout, median native colour statistics | Value / neutral | ✅ | Turned faces (beyond ~30°) less accurate (§7) |
| 2026 matte set (×12) | Empty frames; on photos with people, skin v2, face skin and person carry the photo's own skin / Portrait matte | Neutral / photo's own | ✅ | – |
| 2026 matte sidecars (×12) | Native XMP | Format | ☑️ | Not tested without the mattes |
| `semanticpersoninstances` (photos with people) | One per face: the photo's own Portrait matte, keyed XMP sidecar | Photo's own | ✅ | One matte serves every face |
| Soft Skin result | – | – | ✅ | Needs all of the above together (§7) |

### 2.2 What each control needs

Numbers refer to the item reference in §2.3.

| Control | Needs | What happens without it |
|---|---|---|
| **Style palette** | #1 MakerNote `0x54`, #2 styles item, #3 linear thumbnail with a matching `hvcC`, #4 delta map, #5 HDR/`tmap` structure | No `0x54` → no palette. Mismatched linear-thumbnail `hvcC` → palette appears but edits do nothing. |
| **People layers** (people and background styled separately) | #8 the photo's own mattes with sidecars, #9 `PersonMasksValidHint = 1.0` | People and background are styled as one layer |
| **Portrait** | #6 depth map + #7 its XMP sidecar; necessary in tested cases, not sufficient to guarantee aperture/lighting editing for every exported copy (§10) | Portrait is not offered, or is offered but does nothing; menu visibility alone does not prove full editing support |
| **Texture and Grain** (iOS 27) | #10 `texture_styles` + all twelve #11 2026 mattes (with #12 sidecars) | #10 without #11 **removes the whole palette** |
| **Soft Skin** (iOS 27) | #10 with per-face people data + #13 person instances + real skin v2, face skin and person mattes in #11 | Missing any one of them, Soft Skin looks the same as Standard (§7) |

Texture and Grain have only ever appeared as a pair; no separate requirement for either is
known.

Tested and **not** required:

| Candidate | Result ✅ |
|---|---|
| Exif `Make` / `Model`, filename, other Exif fields | Changing them does nothing. Some real iPhone 16 photos have no style data and get no palette. |
| Styles schema 16, keys `k` / `l` (iOS 26.5 / 27 additions) | Schema 14 works on iOS 27, palette and Texture/Grain included |
| 13-key `0x54` (iPhone 18) | The 8-key form works on iOS 27 |
| Item order | Does not matter |
| Native coefficients, tone curve, light maps, delta map content | Identity, flat and neutral values work |
| Matte content | Empty mattes are enough for the palette |

### 2.3 Item reference

| # | Item | Identifier | Lives in | Port writes | Evidence |
|---|---|---|---|---|---|
| 1 | Apple MakerNote tag `0x54` | Exif `0x8769` → MakerNote `0x927C` → tag `0x54` (type 7) | Exif item | 109-byte, 8-key bplist `{0:1, 1:0.0, 2:0.0, 3:1.0, 4:1, 5:1, 6:4, 7:0}`, as in every native photo shot with the pad untouched; Apple's demo shots differ in `1`/`2` (and `4`, `6`), see §8 | ✅ |
| 2 | Styles item | `uri ` item `tag:apple.com,2023:photo:metadata:styles`, `cdsc` → primary + `tmap` | `iinf` + `mdat` | Mix of calculated, neutral and donor fields (§4.1) | ✅ |
| 3 | Linear thumbnail | aux `tag:apple.com,2023:photo:aux:linearthumbnail` | `hvc1` item, own `hvcC`/`ispe`/`pixi`, shared `irot` | Encoded from the photo (Main10, 1024×768), or the photo's own thumbnail reused | ✅ |
| 4 | Style delta map | aux `tag:apple.com,2023:photo:aux:styledeltamap` | `grid` of 512×512 Main10 tiles | One constant neutral tile in every slot | ✅ |
| 5 | HDR gain map + `tmap` | aux `urn:com:apple:photo:2020:aux:hdrgainmap`; `tmap` item | `grid` + derived item | The photo's tiles, `hvcC`, `tmap` geometry, `tmap` payload (v0.5.1) and HDR XMP. | ☑️ |
| 6 | Depth map | aux `urn:mpeg:hevc:2015:auxid:2` | `hvc1` item, own `ispe`/`pixi`/`colr`/`hvcC`, shared `irot` | The photo's own item, `auxC` included | ✅ |
| 7 | Depth sidecar | `mime` `application/rdf+xml`, `cdsc` → depth; `apdi:*` ranges/formats, `depthBlurEffect:*`, `depthData:Accuracy`, `portraitLightingEffect:*` | `iinf` + `mdat` | The photo's own sidecar, remapped to the new depth item | ✅ |
| 8 | Classic semantic mattes | `urn:com:apple:photo:` `2018:aux:portraiteffectsmatte`, `2019:aux:semanticskinmatte` / `semantichairmatte` / `semanticteethmatte`, `2020:aux:semanticglassesmatte` / `semanticskymatte` | `hvc1` items + XMP sidecars | The photo's own mattes; unused slots refilled with an empty matte | ✅; which mattes are individually needed 🔍 |
| 9 | Person-mask hint | styles key `7` → `PersonMasksValidHint` | styles plist | 1.0 when the photo's mattes are carried | ✅ |
| 10 | Texture styles item | `uri ` item named `metadata`, `tag:apple.com,2026:photo:metadata:texture_styles`, `cdsc` → primary + `tmap` | `iinf` + `mdat` (216-byte bplist; ~5 KB per face with people) | The record from a native iPhone 18 Pro capture (§5.1); on photos with people, plus per-face people data (§7) | ✅ |
| 11 | 2026 matte set (×12) | `tag:apple.com,2026:photo:aux:` + `semanticnosematte`, `semanticskinmattev2`, `semanticnonfaceskinmatte`, `semanticlipsmatte`, `semanticteethmattev2`, `semanticpersonmatte`, `semanticglassesmattev2`, `semanticeyebrowsmatte`, `semantictattoomatte`, `semantichandsmatte`, `semanticearsmatte`, `semanticfaceskinmatte` | 12 `hvc1` items: shared `ispe`/`pixi`/`hvcC`, own `auxC`, primary `irot`, `auxl` → primary + `tmap` | Empty 768×576 8-bit frames (156 B each); with people, skin v2 / face skin = the photo's `semanticskinmatte` and person = its `portraiteffectsmatte`, each with that matte's `ispe`/`pixi`/`hvcC` | ✅ |
| 12 | 2026 matte sidecars (×12) | `mime` items, `cdsc` → each matte; `fsincMattes:FSINCMatteVersion 0` | `iinf` + `mdat` | Native 357-byte XMP | ☑️; never tested on its own |
| 13 | Person instances (one per face) | aux `tag:apple.com,2026:photo:aux:semanticpersoninstances` + `mime` sidecar with `fsincMattes:InstanceMaskReferenceKey` | `hvc1` items wired like #11 | The photo's `portraiteffectsmatte`; keys `FSINCInstanceMask9`, then `0`, `1`, … as native files number them | ✅ |

### 2.4 What the port writes, by kind

Sorted by the five kinds in §1. The donor row is the open issue in §8.

| Kind | Contents |
|---|---|
| Format declarations | URIs and item types of #2–#12; styles `0`, `e`/`f`, `g` (`'L00h'`, the half-float pixel format of the light maps) and the key `3` header; XMP version strings; #1 `0x54` (identical across native files, so treated as a format record; member meanings 🔍) |
| The photo's own data | Primary, HDR and thumbnail tiles with their `hvcC`/`colr`; Exif; `irot`/`imir`; `tmap` geometry; HDR XMP; #6–#8 depth, sidecars and mattes; on people photos the skin/person mattes in #11 and #13 |
| Values calculated from the photo | Styles key `6` tone statistics; #9 hint (set from whether the photo has mattes); face boxes and angles in the #10 people data (from the photo's face regions) |
| Fixed values from native Soft Skin photos | Landmark layout and colour statistics in the #10 people data (medians of 14 native faces) |
| Maps calculated from the photo | #3 linear thumbnail; light maps with `--light-maps target`; a synthesized thumbnail when the photo has none |
| Neutral defaults | Identity coefficients and tone curve; flat light maps (default); #4 neutral delta map; #11/#12 empty 2026 mattes; an exactly empty frame in every matte slot the photo does not fill |
| Taken unchanged from a native capture | #10 `texture_styles`, including `HardwareModel` and a fixed `FilmGrainSeed` (both 🔍, §8) |
| **Donor** | Styles `i`, `h`, `4`, `highKey`, `2`, `5`, `j` |

---

## 3. What `patch` does, step by step

1. **Choose a route.** A photo with no style data gets the full port. A photo that already has
   native style data (iPhone 16/17) only gets Texture/Grain added (§5.4). A photo that already
   has `texture_styles` is refused.
2. **Keep the photo's own item graph** (v0.6.2, default). A native iPhone 16+ file differs from
   an iPhone 15 photo only by a linear thumbnail, a StyleDeltaMap grid, the styles item,
   MakerNote `0x54` and the `ftyp` brands `MiHA`/`heix`. Tiles, HDR, `tmap`, Exif, mattes, depth
   and sidecars are already the photo's own, so they stay where they are, byte for byte.
3. **Add the style items** with the property bytes every native file uses (identical in 31
   native files and both donors): linear thumbnail (`ispe`, `pixi` 3×10-bit, `auxC`, `hvcC`,
   primary `irot`; `auxl` → primary + `tmap`); StyleDeltaMap grid (`colr` "Display P3 Linear"
   ICC, `ispe`, `pixi`, `auxC`, primary `irot`; descriptor in `idat`; `dimg` → 512×512 tiles with
   `ispe`/`colr`/`hvcC`); styles `uri` item named `metadata` (`cdsc` → primary + `tmap`). The
   StyleDeltaMap size comes from the native table below; a photo of another size falls back to
   the donor graph.
4. **Insert MakerNote `0x54`** into the photo's Exif (§3.3).
5. **Write the style data:** the styles plist (§4.1), a neutral delta map (§4.2) and a linear
   thumbnail made from the photo (§4.3).
6. **Add the Texture/Grain set** (§5), with Soft Skin data when the photo has people (§7).
7. **Rebuild the file:** new `ftyp` and `meta` in front, every original payload in place
   (offsets shift by the header growth), new payloads in one appended `mdat`, then a
   self-check.

| Primary (stored) | StyleDeltaMap | Tiles |
|---|---|---|
| 4032×3024 (12 MP) | 2880×2160 | 6×5 |
| 5712×4284 (24 MP) | 4096×3072 | 8×6 |
| 3088×2316 (front) | 2240×1680 | 5×4 |
| portrait-stored | the same, swapped | |

8064×6048 (48 MP) natives use 640-pixel delta tiles; reconstructing that layout is not
handled by the standard full-port route. Native `add-texture` preserves an existing
delta map rather than reconstructing it. The browser's estimated experimental geometry
is a separate, unvalidated route, not support for reproducing that native layout.

**Phone A/B** (v0.6.2): 48/12 photos with and without an encoder, a Portrait photo with a face
(Portrait, people layers, Soft Skin), and 24 MP / 12 MP re-saved photos without thumbnail or
`tmap` all work with the photo's own graph. ✅

**Donor graph** (`--graph donor`, the only route up to v0.6.1): pick a template by tile layout
(`48-12` or `45-15`), move the photo's tiles, thumbnail, orientation, `tmap`, mattes, depth and
sidecars into its item slots with their `hvcC`/`colr`, then write one fresh `mdat`.

### 3.1 Payloads travel with their decoder configuration
A compressed payload and its `hvcC` (and `colr`, where it has one) must always move together.
This was learned twice:

- **Primary tiles (v0.1 → v0.1.1).** The photo's tiles combined with the donor's `hvcC` showed
  rectangular block corruption. Moving the photo's own `hvcC` and `colr` along fixed it, and the
  output now decodes identically to the source. ✅
- **Linear thumbnail (V7 → V8).** Apple stores one VCL NAL in the payload and the VPS/SPS/PPS in
  `hvcC`. V7 replaced the payload but kept the donor's `hvcC`: the palette appeared but edits
  did nothing. Even re-encoding the *donor's own* image failed, so the problem was never the
  pixels. V8 encoded each candidate as a one-frame MP4 and moved the sample together with that
  MP4's `hvcC`. All four variants worked. ✅

When some items in a shared property slot get the photo's payloads and others keep donor
payloads, the port appends a second `hvcC` and repoints only the items that changed.

### 3.2 Template details (current mechanism; replacing it is open, §8)
- `extract-donor` turns a native iPhone 16/17 HEIC into a profile ZIP: `manifest.json`,
  `ftyp.bin`, `meta.bin`, `makernote_0x54.bin` and `payloads/<iid>.bin`. The donor's pixels,
  HDR, thumbnail, Exif and linear thumbnail are left out, so no donor image content reaches the
  output. ✅
- The two profiles are embedded in the script (zlib + base85).
- A matching tile count is not enough on its own: grid geometry, tile order, `hvcC`, `colr` and
  property associations must all line up. ☑️
- Do not rename the `smartstyle-port-donor-profile` format marker or the
  `smartstyle_makernote_*` manifest keys. They are stored inside the embedded ZIPs, and renaming
  them breaks loading.

### 3.3 MakerNote `0x54`
- Same style data, `0x54` absent → no palette; `0x54` present → palette works (V9). ✅
- Copying the donor's **whole** Exif also brings back the palette, but it carries unrelated
  donor capture state: one test showed a Portrait option on a photo with no usable subject.
  Only `0x54` is inserted. ✅

How the insertion works (`inject_apple_makernote_tag`):
1. Follow IFD0 → `0x8769` ExifIFD → `0x927C` MakerNote and require the `Apple iOS` header.
2. Rebuild the MakerNote IFD with `0x54` added or replaced, sorted by tag. If an entry is added,
   shift every out-of-line value offset by +12.
3. Append the rebuilt MakerNote at the end of the TIFF and point `0x927C` at it (type 7). The
   old MakerNote stays in place, unused, so no other Exif offset moves.

Photos taken with the old Photographic Styles (`SemanticStyle`, iPhone 15 era) have none of the
new items. Changing a preset ID cannot upgrade them; the new item graph has to be built.
☑️

---

## 4. Style data in detail

### 4.1 The styles plist, field by field

| Key | Shape | Meaning in native files | Port writes | Evidence |
|---|---|---|---|---|
| `0` | int | Schema: 14 (iOS 18.2), 15 (iOS 26.5), 16 (iOS 27) | 14 | ✅ |
| `1` | 51,840 B FP16 = 2×18×24×10×3 | Per-region 2nd-order RGB polynomial `[1,R,G,B,R²,G²,B²,RG,RB,GB]`; differs per scene | Identity | ✅ |
| `3` | 516 B = 4 B header + 256 × u16 | Global tone curve | Identity | ✅ |
| `c`, `d` | 32×32 FP16 (`e` = `f` = 32) | Light maps (tone-mapped / linear) | Flat 0.31152 / 0.20093 by default; calculated with `--light-maps target` | flat ✅; calculated ✅ (V10); current fit ☑️ |
| `6` | dict of stat blocks | `ToneMappedImage` / `LinearImage` percentiles, black/white point, `highKey` | Calculated from the photo (default); `highKey` from donor | ☑️ |
| `7` | dict | `PeopleRatio`, `SkinRatio`, `PersonMasksValidHint` | Hint 1.0 when mattes are carried; ratios never written | ☑️ |
| `g` | int | `1278226536` = `'L00h'`, pixel format of `c`/`d` | Same in every file | ☑️ |
| `i` | dict | HDR range: `OriginalRangeMin/Max`, `Gain` | Donor values | 🔍 (§8) |
| `h` | float | Exactly `i.Gain / 4` (30 of 30 native files) | Donor value | 🔍 (§8) |
| `4` | float | Unknown; 4.0–18.3, repeats exact values | Donor value | 🔍 (§8) |
| `2` | bool | `True` in all 30 native files | Donor value (`True`) | ☑️ format |
| `5`, `j` | int, float | Unknown; `5` is 0 or 2, `j` 1.0–1.33 | Donor values (0, 1.0) | 🔍 (§8) |
| `k`, `l` | bool | Added in iOS 26.5 / 27; always `False` | Absent | ✅ not needed |

Native coefficients, tone curve and light maps all differ from scene to scene (about 93% of
the key `1` bytes differ between two shots), but none of them is needed for the controls to
work.

**Calibration** (v0.3.1, regression on eight native files):
- `ToneMappedImage` holds percentiles of **linear-light** display luma (mean ratio 0.980,
  sd 0.076). v0.3.0 wrote gamma-encoded values, about 2× too high; that has since been fixed.
- `LinearImage` is the same signal × **0.166** (leave-one-out MAE 0.013).
- The light maps are stored in the primary's stored orientation, track linear luma, and clamp
  at 0.040741. The fits are `c = clamp(0.7774·L + 0.0294)` and `d = clamp(0.6542·L − 0.0128)`,
  with leave-one-out MAE 0.022 / 0.037 against 0.146 / 0.115 for the flat values.
- Orientation re-checked in v0.6.2 on 30 native files at `irot` 0, 180 and 270: the native
  `c` map matches the stored-orientation sample as is (r 0.94–0.99). The "180° rule" used up to
  v0.6.1 only cancelled the swapped 90/270 mapping (§4.4) and left 0/180 maps upside down. ☑️

### 4.2 Delta map: neutral, never the donor's
- Native delta maps are 10-bit RGB centred on 512 (about 470–560). Amplified, they show the
  scene they came from. ☑️
- With the donor's delta map, edits followed **the donor's scene regions** on the target.
  Flattening the light maps did not help; a constant neutral tile did (V11). ✅
- Editing still works with a neutral map, so it is a correction layer on top of the style, not
  the style itself: `styled ≈ F(image, style) + D(x, y)`, with `D = 0` in ports.
- Every tile gets the same neutral 512×512 Main10 sample with a matching `hvcC`.

### 4.3 Linear thumbnail
- Native: 1024×768, 10-bit HEVC Main10, sharing the primary's `irot`.
- **`generate`** (default): decode the photo, return it to its **stored** orientation, scale,
  encode Main10 with libx265, then move the sample and its `hvcC` in together. ✅
- **`reuse-thumbnail`** (v0.4.4): reuse the photo's own 8-bit thumbnail, which needs no encoder.
  Its `pixi` is shared with other items, so a new one is appended and only the linear thumbnail
  points to it. The browser reuses a present thumbnail; when absent, it generates a
  Main10 linear thumbnail locally with libheif and FFmpeg.wasm. ✅ for the tested reuse path;
  browser generation remains subject to device verification.
- With neutral coefficients, flat light maps and a neutral delta map, the linear thumbnail is
  the renderer's **only spatially varying input**. A misoriented one is therefore the main
  possible source of blocky or patchy results.

### 4.4 Orientation and `tmap`
- Both templates share **one `irot` = 270°** across the primary, thumbnail, HDR grid, delta grid
  and linear thumbnail. Until v0.3.0 this made every photo with a different orientation display
  rotated. Now the photo's own `irot` (and `imir`, if the template has a slot) replaces it.
  ☑️
- `tmap` states its size in **display** orientation and has its own `irot`. Without updating
  it, Windows Photos (which renders through `tmap`) showed a black band under landscape ports.
  v0.4.1 copies the photo's `tmap` geometry, or derives it from the primary. ☑️
- **90/270 inversion, fixed in v0.6.2** ✅: up to v0.6.1 `raw_orientation_filters` (and
  `web/src/media/decode.js`) swapped irot 90 and 270, so linear thumbnails of those photos were
  stored 180° off. An early A/B showed nothing, but a 24 MP photo at irot 270 with sky above
  trees got a glow in the sky and foliage with both the donor and the photo graph; the
  corrected rotation removed it, and a 12 MP irot-270 photo that had passed still passed. Checked against 30 native files: Apple's own linear
  thumbnails match the corrected stored-orientation sample at every irot (r 0.83–0.97), never
  the 180°-turned one.
- With the photo's own graph (v0.6.2) the photo's `irot`, `imir` and `tmap` are simply kept.

---

## 5. Texture and Grain (iOS 27, v0.5.0)

### 5.1 What iPhone 18 files add
On iOS 27, Photos on an iPhone 15 Pro offers Texture/Grain for iPhone 18 photos, so the
renderer runs on older hardware too. Compared with iPhone 16 files, iPhone 18 files add
`texture_styles` (#10), the 2026 matte set (#11) with sidecars (#12), styles schema 16 with
`k`/`l`, and a 13-key `0x54`. Only #10 and #11 matter.

`texture_styles` is a 216-byte bplist with no pixel data:

| Field | Value | Notes |
|---|---|---|
| `Preset` / `CaptureType` / `CaptureMode` / `PortType` | `Standard` / `LF` / `Still` / `PortTypeBack` | Native values; not tested separately |
| `HardwareModel` | `iPhone19,2` | The iPhone 15 Pro value keeps the controls but makes white areas glow under some styles, so it likely selects render parameters. Names a device other than the photo's own. 🔍 (§8) |
| `TextureStylePeopleDataVersion` | 3 | Absent / 0 / 1 / 2 did not help a build missing #11 |
| `FilmGrainSeed` | 92 | Grain is generated from it at render time. Up to v0.6.0 every port got this same pattern; since v0.6.1 the port writes a per-photo seed (§8) |

### 5.2 On-device tests (iPhone 15 Pro, iOS 27; one 48/12 and one 45/15 photo)

| Build | Palette | Texture/Grain |
|---|---|---|
| iPhone 18 donor profile, unmodified | ✅ | ✅ |
| … with styles v14 and 8-key `0x54` | ✅ | ✅ |
| … with `texture_styles` disabled | ✅ | ❌ |
| … with `HardwareModel` → `iPhone16,1` | ✅ | ✅ but white areas glow |
| … with the 2026 matte URIs made unrecognisable | **❌** | ❌ |
| … with `texture_styles` placed after Exif | ✅ | ✅ |
| **v0.4.4 file + `texture_styles` only** | **❌** | ❌ |
| v0.4.4 file + `TextureStylePeopleDataVersion` absent / 0 / 1 / 2 | ❌ | ❌ |
| **v0.4.4 file + `texture_styles` + 12 empty 2026 mattes (v0.5.0)** | ✅ | ✅ |

`texture_styles` without the 2026 mattes removes the whole palette; item order does not matter.
✅ The test profiles come from `tools/texture_variants.py`.

### 5.3 Why it is added on top of the iPhone 16 templates
iPhone 18 donor profiles work on photos without people but **crash on people/Portrait photos**:
their matte set does not fit the people path. Adding the texture set to the v0.4.4 templates
leaves that path untouched, and `--texture off` reproduces v0.4.4 byte for byte.

How the set is appended (`add_texture_items`):
- Shared `ispe`, `pixi` and `hvcC` once, then one `auxC` per matte.
- Properties associated in native order, `ispe, pixi, auxC, hvcC, irot` (descriptive before
  transformative, as HEIF requires).
- Then the 12 sidecars, then the `texture_styles` item.
- The result matches native iPhone 18 files: property bytes, order, essential flags,
  references, payloads and sidecars. ☑️

### 5.4 Photos that already have style data (`add-texture`)
Porting a native iPhone 16/17 photo would replace its real style data with neutral values, so
only #10–#12 are inserted:
- `meta` grows (about 2.5 KB) and every external offset shifts by exactly that amount; new
  payloads go into one small `mdat` at the end.
- Before writing, every original payload must re-extract byte-identical and every new one must
  read back as written.
- Only Apple's native layout is accepted (iloc v1 4/4/0/0, iref v0, narrow ipma).
- Tested on native photos with and without people, including one with depth. ✅

### 5.5 Photos without a thumbnail
Some copies re-saved by iOS have no thumbnail and no `tmap`. Since v0.5 the port encodes a
thumbnail from the primary (416×312, 8-bit HEVC Main, stored orientation, its own `hvcC`).
✅ This was previously unavailable in the browser. The current web app can generate a missing
thumbnail locally using the optional HEVC encoder (`web/src/codecs/linear-thumbnail.js`), requiring
cross-origin isolation and an encoder download on first use. Native `add-texture` does not
need this encoder.

---

## 6. People layers and Portrait

### 6.1 Layers in a people or Portrait photo
Each layer is a separate auxiliary image and drives a different control:

| Layer | Items | Separates | Drives | Port |
|---|---|---|---|---|
| Person and skin | Classic mattes #8 + sidecars | People, skin and hair from the background | People-aware styling | The photo's own mattes |
| Mask trust | `PersonMasksValidHint` #9 | – | Whether Photos uses the masks at all | 1.0 when mattes are carried |
| Depth | Depth map #6 + sidecar #7 | Subject from background by distance | Portrait (blur, depth effects) | The photo's own item and sidecar |
| iOS 27 people regions | 2026 mattes #11, person instances #13, people data in #10 | Faces, skin and each person | Soft Skin | The photo's own skin/Portrait mattes and face regions; other 2026 mattes empty (§7) |
| Light (not semantic) | Styles `c`/`d` | Bright from dark regions | Local tone adjustment | Flat or calculated |

### 6.2 Rules
1. **Layers come only from the photo itself.** A donor matte with content would apply the
   donor's regions to an unrelated photo, the same leak as the donor delta map. Slots the photo
   cannot fill get an empty matte.
2. **Never invent a layer.** A photo without mattes gets no people layer, and styling it as a
   whole is then correct. `PeopleRatio` / `SkinRatio` are never written; they are not matte
   coverage (on two native people photos, one matched within 10%, the other was 17× off).
3. **Mattes and depth are independent.** A Portrait of an object has depth and no mattes.
4. **A layer without its XMP sidecar does nothing.** The sidecar tells Photos how to read the
   samples. Every sidecar is carried and pointed at the item's new ID.
5. **Layers must line up with the photo:** shared primary `irot`, and `auxl` → primary + `tmap`.
6. **Each payload keeps its own `hvcC`.** Copy `auxC` byte for byte, because Apple stores extra
   `aux_subtype` data after the URI.
7. **The mask-trust flag must agree with the layers.** Real mattes with the hint at -1.0 still
   give whole-frame styling. The hint means "masks computed", not "person present"; native
   photos without people carry 1.0 too.
8. **Portrait must come from the photo's own depth**, never from donor capture state (§3.3).

New items are appended at the end of `ipco`, so no existing property index moves. Each needs one
`infe`, one `iloc` entry, one `ipma` entry and one `auxl`/`cdsc` reference.

### 6.3 History

| Version | Problem | Fix | Status |
|---|---|---|---|
| ≤ v0.3.1 | Edits worked, but **people and background changed as one layer**. Ports carried the donor's empty mattes and its `PersonMasksValidHint = -1.0` ("no usable masks"), and the photo's own mattes were dropped. | – | Observed ✅ |
| v0.3.2 | — | Carry the photo's mattes, refill unused donor slots with empty ones, set the hint to 1.0 (opt-in `--people on`) | People and background now separate ✅ |
| v0.4.0 | — | Automatic; photos without mattes come out byte-identical | ☑️ |
| v0.4.2 | Portrait missing: the depth map was dropped | Add depth as its own item, separate from the mattes; copy `auxC` byte for byte | ✅ |
| v0.4.3 | Portrait still did nothing: only half the XMP sidecars were carried | Carry every sidecar. This also replaced the donor's HDR headroom sidecar with the photo's. | ✅ |

Flat light maps (v0.3.1 note) also make tone adjustment uniform across the frame, but that is a
separate issue: they carry no people information.

---

## 7. Soft Skin (v0.6.0) ✅

Up to v0.5.1, Soft Skin looked the same as Standard on every port and every `add-texture` photo.

**What native photos carry.** Twelve native iOS 27 photos where Soft Skin works (iPhone 18,
14 faces) all have, beyond the v0.5 items:
- `texture_styles` of ~5.5 KB per face instead of 216 bytes: a
  `TextureStylePostProcessedPeopleData` array placed after `CaptureMode`, one entry per face, with
  `faceROI`, `faceSkinROI`, 76 `faceLandmarks`, `faceYaw`/`facePitch`/`faceRoll`, `instanceROI`,
  `instanceMaskReferenceKey` and `imageStats` (`Mattify`, `SkinSmoothingStandalone`,
  `UnderEyeBrightening`). The one face turned 45° has an empty `SkinSmoothingStandalone`.
- one `semanticpersoninstances` matte per face (#13), its XMP naming the key the entry uses;
- real 2026 skin v2, face skin and person mattes.

**Phone A/B** (iOS 27; add-texture photos and ports; one change at a time):

| Build | Soft Skin |
|---|---|
| v0.5 (all 2026 mattes empty, 216-byte `texture_styles`) | Same as Standard |
| Skin v2 / face skin / person mattes from the photo's own only | Same as Standard |
| People data only, or people data + instances | Same as Standard |
| Mattes + people data, no instances | Same as Standard |
| Mattes + instances, no people data | Same as Standard |
| People data + instances + skin mattes, no person matte | Looks different, but no real smoothing |
| People data + instances + skin mattes + person matte | **Works** ✅ |
| … plus `SkinRatio`/`PeopleRatio`, skin statistics in styles `6`, key `k` | Works; adds nothing |

**What the port writes** when the photo has face regions (MWG XMP), a `semanticskinmatte` and a
`portraiteffectsmatte` (Portrait-mode photos; iPhone 16+ photos of people):
- Skin v2 and face skin carry the photo's `semanticskinmatte`, person its
  `portraiteffectsmatte`, each with that matte's own `ispe`/`pixi`/`hvcC`. The other nine stay
  empty.
- One person instance per face, all carrying the Portrait matte.
- One people entry per face region. Measured against the 14 native faces: `faceROI` is the XMP
  region (centre → corner) × 0.968; the XMP `AngleInfoRoll` is the face's rotation in stored
  pixels, which places the landmarks; `faceRoll` = −(roll − irot) and `faceYaw` = yaw, in
  radians. Landmarks are a fixed median layout scaled into the face box; colour statistics are
  native medians; `instanceROI` is the full frame, so nothing is decoded (phone-tested on one-
  and three-face ports and add-texture photos ✅). Leave-one-out on
  frontal faces: centre within 1–6%, landmarks within 3–10% of face width.
- Values are rounded to 1e-6 and written by the same bplist layout in Python and the browser,
  so both builds produce identical bytes.

The upstream Python path leaves photos without face regions or either matte as v0.5.1 wrote
them: nothing is detected or invented. The browser now offers AI supplementation (§10.7).
🔍 Open: turned faces (the template is frontal), measured `instanceROI`,
and whether the colour statistics matter; a measured `instanceROI` was not needed.

---

## 8. Donor-derived data: open issues 🔍

Nothing in the final port should come from the donor (§1). Each item below must become a format
declaration, the photo's own data, a calculated value or map, or a neutral default. A value that
proves identical in every native file of a format or capture generation counts as a format
declaration. Findings come from comparing the two templates with 30 native style files
(iPhone 16, 17 and 18; iOS 18.2, 26.5 and 27, including Apple's own demo shots), with their HDR
headroom, `tmap` parameters, lenses and Exif.

| Donor data | What is known | Likely resolution | Status |
|---|---|---|---|
| **`tmap` payload** (gain-map headroom, gain min/max, gamma, offsets) | Up to v0.5.0 every port paired the donor's parameters with the photo's gain map, so HDR highlights used the wrong curve. **v0.5.1 copies the photo's own.** Re-saved photos without a `tmap` still get the donor's. | **Photo's own data** (done). Since v0.6.2 a photo without a `tmap` keeps none, as it came. | ✅ v0.5.1 / v0.6.2; re-saved photos without `tmap` phone-tested |
| **`h`** | Exactly `i.Gain / 4` in all 30 files | **Calculated**, once `Gain` is resolved | Rule known |
| **`i.OriginalRangeMax` / `Min`** | Rises with HDR headroom but is not a function of it: iPhone 18 Pro Max shots reach ~1.0 at headroom 3.4–3.9, an iPhone 17 shot at 4.84 gives 0.31, one at 3.07 gives 0.02. Min is −0.16…0. | Depends on the scene; not calculable from headroom alone | 🔍 |
| **`i.Gain`** | 14.6 (iOS 18.2); 8.4–9.8 (iOS 26.5) with one 2.29; 7.7–10.6 (iOS 27). Not a per-generation constant. | Unknown | 🔍 |
| **`4`** | 4.0–18.3; repeats exact values (5.646 ×5, 5.692 ×3, 4.031 / 4.877 ×2), so likely quantized; no link to lens, brightness, ISO or headroom | Unknown | 🔍 |
| **`highKey`** (in `6`) | 0.52–0.92 across scenes | Unknown | 🔍 |
| **`2`** | `True` in all 30 files | **Format declaration** | ☑️ |
| **`5`** | 0 or 2; both values occur with the same lens, phone and iOS | Unknown | 🔍 |
| **`j`** | 1.0 up to iOS 18.2; 1.0–1.33 on iOS 26.5/27 | Unknown | 🔍 |
| **MakerNote `0x54`** | Members `1`/`2` are 0 in every photo shot with the pad untouched and −0.84…0.99 in Apple's demo shots: very likely the Tone/Color pad position at capture. `4` (1 or 11) and `6` (4 or 8) vary too. | The port's 0/0 is the neutral pad, a **neutral default**; `4`, `6` unknown | ☑️ `1`/`2`; 🔍 `4`, `6` |
| **Donor matte bytes** (slots the photo does not fill) | Near-empty but not empty: up to 9/255, faint donor sky | **Neutral default**: an exactly empty frame on the slots' shared `hvcC` | ✅ done in v0.6.1 |
| **Item-graph template** (item IDs, `iref`, `ipma`, `ipco`, grid descriptors) | Native files add only five things to an iPhone 15 photo's graph (§3) | **The photo's own graph** plus those items, with native format declarations; the two-layout limit goes with it | ✅ done in v0.6.2 (phone-tested); donor graph kept as a fallback for unknown sizes |
| **`HardwareModel = iPhone19,2`** | The only field naming a device other than the photo's own; the iPhone 15 Pro value causes white glow | Find a setting that renders correctly without it, or document it as an exception | 🔍 |
| **`FilmGrainSeed = 92`** | Same grain pattern on every port; native photos all differ (6–264 across 15 iOS 27 files) | **Calculated** per photo: CRC-32 of the first primary tile mod 256 | ✅ done in v0.6.1 |

Done: the `tmap` copy (v0.5.1), empty matte slots and per-photo `FilmGrainSeed` (v0.6.1).
The item graph followed in v0.6.2. `4`, `5`, `j`, `highKey`, `Gain` and `OriginalRangeMax`
do not follow anything measured so far; more random photos will not settle them, controlled
captures (same scene, one setting changed) might. New tile layouts seen in native files: 45/28,
35/12 and 54/15.

---

## 9. Other open metadata questions

- **Why the look differs from a native photo.** Identity coefficients visibly contribute to
  stronger Styles on native IMG_0754 (§10.11). Identity tone curve did not visibly change
  that comparison. Flat light maps and donor values in §8 remain unresolved hypotheses. 🔍
- **Not yet isolated:** whether each classic matte is needed; whether the 2026 sidecars are
  needed on their own; whether styles keys `6`/`7` can be dropped; what `0x54` members `4`/`6`
  mean; how the two planes of the coefficient lattice are read. 🔍

## 10. Portrait editing gap reported on iPhone 16 Pro (2026-10-08) 🔍

The earlier Portrait results do not establish compatibility for every capture/export state.
Distinguish three observations: the viewing menu offers Portrait; blur can be toggled;
and Edit offers aperture (`ƒ`) and Portrait Lighting. Preserving depth and its sidecar
does not by itself prove the third observation.

Private case: original `IMG_0548.HEIC` and processed `IMG_0692.HEIC`, a front TrueDepth
capture from an iPhone 16 Pro (Exif software 18.5). The user confirms the original still
offers aperture and Portrait Lighting on the same phone. The processed copy loses those
controls. Its depth, calibration, simulated aperture 4.5, rendering parameters and
Portrait Lighting strength remain present. All 64 original external payloads other than
Exif, original references and original property bytes were preserved. MakerNote `0x54`
is the only MakerNote tag whose value changed.

User-reported device results for controlled variants:

| Variant | Result |
|---|---|
| Processed copy with byte-identical original Exif restored | Styles and Texture/Grain work; viewing menu offers Portrait, but Edit has no `ƒ`; colour changes on entering Edit |
| Styles graph without Texture, original Exif restored (A) | Styles absent; `ƒ` and Portrait Lighting still absent; colour normal |
| Original graph plus the Texture set, original Exif preserved (B) | User reports Styles and Texture available, but `ƒ` absent |

Variant B contains no 2023 `metadata:styles` item at file level. Its reported controls
must not be interpreted as proof that the documented 2023 palette requirements changed.
The exact control type and behaviour remain to be reconciled. These variants rule out
restoring Exif alone as a sufficient fix for this case; they do not identify the cause.

With the processed copy's styles plist, linear-thumbnail sample/configuration and marker
as inputs, Python `graft_style_graph` reconstructs `IMG_0692` byte for byte: 1,936,059 bytes,
SHA-256 `ac329e6d8431069bcd8b46b18f87279d746fb8fa822c5b679c67895bd3e430e6`.
Reproduce using `tools/portrait-python-parity.py ORIGINAL EXPORTED`. This verifies the
graph writer only; decoding, thumbnail generation and Styles statistics were reused
from the export rather than independently recomputed.

An independent default Python CLI run on `IMG_0548` also completed, generating its own
linear thumbnail and target scene statistics, with flat light maps and Texture enabled.
The private output `IMG_0548_PythonDefault.HEIC` is 1,693,272 bytes, SHA-256
`3766f8fab865a2aff0f64b9892d347fc7aaddb01e5cef0056797c888e6b5b957`.
All 67 non-Exif source payloads (external and idat), original references and original
property bytes are preserved. The user also tested this independent CLI output: aperture
editing remains unavailable and Styles produce strong colours. Replacing the browser
graph writer with Python therefore does not resolve this case.

The colour change on entering Edit is also unresolved. Sections 4.1, 5.1, 8 and 9
describe renderer inputs that can affect appearance; none is established as the cause
for this specific photo. Do not replace native style curves or invent Portrait metadata
based only on this report.

### 10.1 Native versus edited exports: IMG_0714 / IMG_0714-1

Further private samples supplied on the same date isolate an input-state difference:

| File | 2023 Styles / linear thumbnail / delta map | HDR gain map | Route / result |
|---|---|---|---|
| `IMG_0714.HEIC` | All present | Present | Native `add-texture`; user identifies the chosen style as Vibrant |
| `IMG_0714-1.HEIC` | All absent | Absent | Full port / experimental route; depth and a six-key style marker remain |
| `IMG_0715.HEIC` | Newly generated | Absent | User-reported output of `0714-1`: aperture unavailable, strong colours, style reset |
| `IMG_0716.HEIC` | Present | Present | Preserved native Styles plist, all 15 HDR tiles and depth payload match `0714` |

The 49 primary tile payloads in `0714-1` and `0715` are byte-identical. HDR was already
missing in `0714-1`, before conversion. Its source marker has pad values approximately
(-0.30, 0.33), member `4 = 8`, and member `5 = 0`; the full port replaces it with the
neutral eight-key marker (`1 = 2 = 0`, `4 = 1`, `5 = 1`, `6 = 4`). Member meanings must
not be inferred solely from these numbers. The native `0714` marker instead has
(-0.5, 0.5), `4 = 16`, `5 = 1`, `6 = 4`. These observations demonstrate rebuilding
Styles rather than preserving native edit resources; changing a preset label alone
cannot recover the missing curves, delta map or HDR gain map.

The user subsequently re-imported the standalone files into Photos, independently of
the pre-existing library asset: `0714-1` has neither Styles editing nor Portrait editing;
`0715` offers Styles but still has no Portrait editing. Thus, for this specific pair,
the exported source already lacks standalone editing capability before the tool runs.
The Styles in `0715` are newly constructed rather than preserved native edit resources.
Depth presence alone does not reproduce the original library asset's Portrait editor.

The browser now checks the camera model before automatically porting a file that lacks
native Styles. For camera metadata identifying iPhone 16/17, it explains the limitation and
offers an explicit **Create new Styles (experimental)** action. This detects missing
data, not whether a particular edit caused the loss. The native `add-texture` route and
older-camera porting remain unchanged. It is a safeguard, not a Portrait reconstruction
fix. Use the unmodified resource for adding Texture, then reapply edits in Photos.

A new private native output, `IMG_0714_PreserveNative_TextureGrain.HEIC`, was generated
directly from `0714` using Python `add-texture`. All 118 original external payloads,
including complete Exif and the native Styles plist, were verified byte-identical.
SHA-256: `ebcb1a2de49b047f42b9bb07d9f5e871822b1b1adf9e5015d16b11d2305f4148`.
The browser preservation regression additionally checks all original idat payloads,
property bytes and references on this native fixture. Photos UI remains an on-device check.

### 10.2 Browser preparation and cleanup (2026-10-08)

The missing-native-Styles notice is informational (blue with an information icon),
and only triggered for camera metadata identifying iPhone 16/17. Other cameras,
older iPhones and absent Model metadata retain their normal conversion route.

The first browser visit installs/claims the service worker and automatically navigates
once to apply isolation headers, before enabling photo selection. Verified encoder
assets are prepared in the background without retaining an idle WASM encoder heap.
Preparation and conversion share in-flight downloads. A platform HEVC encoder that
reports support but fails during actual encoding now falls back to software encoding.

HEIC reading, graph rebuilding, statistics and payload checks run in a module worker;
DOM-dependent decoding still runs in the page and supplies sampled RGB through messages.
Worker Texture output and analyzed full-port output were compared byte for byte against
the existing functions. This is an execution-location optimization, not a colour change.

Clearing history is available while the processing queue is idle. It revokes result URLs,
removes rows, clears retained Live Photo sources/outputs/movies, disposes bokeh previews,
and releases HEIC/encoder workers. Originals and already downloaded files are unaffected.
Fresh-profile desktop Chrome checks passed for automatic preparation, first PNG conversion,
notice placement, URL cleanup, and native HEIC processing after clearing history.
This does not substitute for an iPhone Safari/Photos test.

### 10.3 Colour research boundary

Review of §4.1, §8 and §9 still leaves the native coefficients/tone curve and donor-derived
`highKey`, `i.Gain`, `i.OriginalRangeMin/Max`, `4`, `5` and `j` without a validated reconstruction
rule for edited exports. `h = i.Gain / 4` gives no independent estimate of Gain.
Neither changing the Texture preset label nor keeping the old pad marker restores the
missing native style graph. No speculative change to these values was shipped.
Further colour optimization requires controlled captures and Photos save/reopen/re-edit
comparisons; compare those fields while changing one setting at a time and keep the
native add-texture path untouched.

Private colour test on iPhone 7 source `IMG_2132` (2026-10-08): variant A used the
current browser output; B replaced only its linear-thumbnail auxiliary with explicitly
P3-linear Main10 samples, preserving A's Styles plist and Exif. Original image payloads
and properties were checked unchanged. The user reports both render too strongly under
Styles, with B stronger than A. Thus this thumbnail replacement did not improve this
case and was not adopted as a runtime fix. It does not prove thumbnail data is irrelevant
or identify the cause. Follow-up C changes only the two main scene-statistics blocks to
donor values; D changes only c/d maps to donor flat maps. The user reports A/C are
equivalent and B/D are equivalent. These variants did not improve the reported colour;
the user stopped this research. None was adopted in the runtime.

### 10.4 AI opt-in and stable result actions

Enabling AI after conversion previously only changed the switch/hint. The app now
keeps file-backed candidates and schedules eligible results when AI is enabled,
as well as running AI when it was enabled before photo selection. Active/completed
jobs are not started twice. The preparation status and native Styles/depth skip
message are visible in the result row. Clearing history also releases these candidates.

The original Styles save/download pair stays in place while AI finishes, with an
unblurred-result label; it is no longer moved into collapsed details. A sole output
group spans the result width so the pair does not initially occupy half a desktop row.
Real WebGPU inference in fresh-profile desktop Chrome produced bokeh previews when
AI was enabled after PNG conversion and before JPEG conversion. Button x positions
and widths were equal before/after AI completion. iPhone Safari remains untested here.

### 10.5 Reliability and compact results (2026-10-08)

Result headings now show filename above the success dot and outcome, wrapping naturally on
small screens. Details report camera, dimensions, source/output sizes, capture time and
HDR/depth resources, without promising Photos Portrait controls. Metadata failures are
informational and cannot remove download buttons. Worker transfer lists only include
typed image buffers, not the numeric metadata file size. Shared icons have rounded corners.

SW installation/activation tolerate unavailable Cache Storage, and successful network
responses survive cache quota failures. AI inference runs in a terminable WebGPU worker;
the switch and per-result stop button cancel it, with a two-minute deadline. Desktop Chrome
produced previews before/after JPEG/PNG conversion. Worker WebGPU on physical iPhone Safari
still requires validation. libheif releases every returned image handle and its native
decoder context; decode failures are per image. Only identical raster box/HEVC tag helpers
were consolidated; native Texture/Styles algorithms remain unchanged.

CI now checks copy, PWA assets and behavior, including a portable synthetic native Texture
preservation fixture. Tests requiring private device photos remain explicitly optional.

### 10.6 Legacy native Texture tone-curve compatibility fix (2026-10-09)

The user reports Soft Skin/Glow/Film work on IMG_0754 and IMG_0762, but Glow/Film blacken
IMG_0757 (source IMG_4850) and IMG_0766 (source IMG_4137). All four are iPhone 16 Pro front
captures. Exif Software is 26.2 for both working captures and 18.2 for both failing ones.
Working native Styles have `0=131087`, a 516-byte `3` tone curve, and `k=false`; failing
sources have `0=14`, no `3`, and no `k`. Initial comparison identified this correlation.

Both failing sources contain two XMP faces, skin and Portrait mattes; both exports contain
two generated people entries and instances. The skin/person codec configurations match
the working examples. Missing face detection does not explain these two failures on its
own. Before the compatibility fix, web and Python `add_texture_bytes` outputs were byte-identical for each supplied source;
the IMG_4850 output also matches the supplied IMG_0757 byte for byte. IMG_0766 differs from
the current source's regenerated output in Exif/XMP, but original image/Styles/mask payloads
are preserved. Nothing demonstrates that the renderer works merely because bytes match.

`tools/texture-compatibility.py` creates private device diagnostics: A reserializes unchanged
Styles values (control); B omits added people data and uses empty 2026 mattes; C adds only an
identity tone curve; D adds that curve plus the observed newer version and k flag. All
original payloads except the deliberately rewritten Styles, codec/property bytes and refs
are checked unchanged. The user reports C and D offer all Texture effects, while A and B
blacken under Glow and have no Soft Skin effect; C and D have equal colour/brightness.
The browser therefore adopts only C: native version-14 Styles without key `3` receive
the computed 516-byte identity curve. Existing curves are left byte-identical; version,
k flag, coefficients, statistics and other values are retained. Other versions are
outside this tested fix. The parser preserves real-number types during this serialization.

The native writer deliberately replaces only that Styles payload and does not shift its
new offset again when shifting untouched original extents. Its self-check validates all
original payloads except that extension and every new/replaced item. Previously exported
Texture files can be repaired by appending only the extended Styles and updating its
extent; no Texture/matte duplication occurs. Outputs are named `_TextureFixed.HEIC`.
New exports and repairs of both supplied sources passed preservation tests and browser
Worker downloads; parsed Styles match the device-tested C variant. This is a web fix;
the author's Python source remains unchanged as the diagnostic reference.

The separate older-iPhone case is now represented by IMG_0783 (§10.7). Upstream Soft Skin
still requires source faces and both masks; the browser can generate missing data using AI.

### 10.7 AI supplementation and generated Styles baseline (2026-10-09)

IMG_0783's actual Exif reports iPhone 11 Pro Max, 2020-10-25 10:34:22 +07:00, 4032×3024.
The supplied file has a 768×576 depth auxiliary and its disparity/blur sidecar, but no MWG
face regions, skin matte, Portrait effect matte, native Styles or separate HDR gain map.
Portrait depth alone therefore cannot enable the source-only `softSkinPeople` path.

The browser adapts Elio-backup's pinned ONNX BlazeFace/478-point landmarker/SelfieMulticlass
pipeline. It runs automatically, without a user switch, when Texture lacks people entries,
skin/person mattes or instances. Original primary/HDR/depth/Exif resources are kept; native
Styles and masks are not recalibrated. Generated masks can replace empty conversion slots.
Face entries retain 76 Apple-layout landmarks, real-number types and distinct per-face IDs;
instance XMP keys match their entries. Inference resources are released before software
grayscale HEVC encoding; item insertion/self-checks run in the HEIC worker. No face or model
failure keeps the converted file usable. Models total about 34 MB, use pinned SHA-256 and
persistent cache, and no photo is uploaded. ONNX produces approximations of private Apple
data, not reconstructed capture metadata.

Real desktop Chrome inference found two faces in IMG_0783, generated masks/people/instances,
and the website processed/downloaded an enriched HEIC through its normal UI. Portable
tests verify native Styles and every untouched payload/property/reference, idempotence,
no-face behavior, real-number types and matching instance keys. The user's phone test
confirmed Soft Skin is active in both A and B, but reported less smoothing than native
iPhone 16/17 photos. Physical Safari memory behavior still requires phone tests.

Two private IMG_0783 outputs use the same AI data: A keeps prior colour metadata; B uses a
generated identity/neutral baseline with Gain=1, h=0.25, range [0,1] and adjusted high-key.
Original pixels and gain map are unchanged. The user reports A and B are equally too strong.
This experiment did not fix colour. Its default website override and raster h change were
reverted; the neutral helper remains research-only. The saved Web_SoftSkin fixture was
generated before this rollback and equals B, not the current default output. Earlier
rejected linear-thumbnail/light-map variants were not adopted. Native Styles are excluded
from colour experiments. Real browser checks also passed for JPEG supplementation, PNG
with no suitable face, and failed model downloads retaining the Styles download.

Soft Skin strength has not been calibrated against Apple's renderer. The current detector
found both faces. The initial SelfieMulticlass whole-image pass has 256x256 output; §10.8
adds per-face refinement. Low resolution can limit detail on small faces but does not prove
the cause of weaker smoothing. SkinSmoothFaceRoughness initially used face luminance variance,
not a validated Apple roughness estimator, and eye statistics reuse face-wide measurements.
These approximations and mask coverage should be isolated in controlled tests before
attributing the difference to model capacity or increasing effect strength.

### 10.8 Per-face segmentation and isolated rendering experiments (2026-10-09)

The browser now runs one padded square segmentation crop for each detected face, sequentially
and with no user switch. The existing model sees each crop at 256x256 rather than the whole
photograph. Confidence is reprojected into the original image and softly blended only inside
that face's skin contour (eyes, lips and eyebrows excluded). Failed/empty crops preserve the
whole-image fallback. No confidence multiplier is applied. Native skin masks and complete
native Soft Skin data remain protected. Transient crop/detection/statistics canvases are released.

Real Chrome inference on IMG_0783 refined both faces, with mean crop confidence 0.809 and
0.893. This confirms pipeline operation, not equivalent smoothing to Apple. At this stage,
the normal web download was byte-identical to experiment B; §10.9 switches it to D.
All seven experiment outputs retain every
source item payload except the expected MakerNote Exif update; primary/depth are unchanged.
The new local-detail roughness proxy rejects a broad illumination gradient in portable tests.
Its numerical scale is not calibrated to Apple; it became the default after device testing (§10.9).

Private outputs live under ignored `tests/private-fixtures/IMG_0783_Refinement/`:

| Variant | Isolated change |
| --- | --- |
| A_GlobalMasks | Original whole-image skin/face-skin masks; same metadata/person instances as B |
| B_FaceCrops | Per-face skin/face-skin masks; face-wide variance; previous website default |
| C_FaceCrops_NativeMedian | B, only SkinSmoothFaceRoughness replaced with upstream native median 0.0121 |
| D_FaceCrops_LocalDetail | B, only SkinSmoothFaceRoughness replaced with a local-detail residual variance; current website default |
| E_FaceCrops_LinearP3 | B, genuine P3-linear Main10 thumbnail |
| F_FaceCrops_LinearP3_Neutral | E, generated neutral colour metadata |
| G_FaceCrops_LinearPersonStats | B, only Styles person/skin statistics changed to linear-light conventions |

C/D differ from B only in the Texture plist, one roughness scalar per face. G differs from
B only in the Styles plist, using linear samples for ToneMapped person/skin blocks, scaling
LinearImage person/skin samples by 0.166, and linearizing the skin RGB channel percentiles.
Capture gain/high-key, masks, roughness, original pixels and all other item payloads are held
constant. E/F/G remain experiments and are not selected by normal website conversion.

A diagnostic comparison on native IMG_0754/0762 reused whole-image AI masks to estimate
the same regions. Across p10/p25/p50/p75/p98, ToneMapped encoded estimates had MAE
0.224–0.342 versus 0.057–0.112 with linear estimates; unscaled LinearImage estimates had
MAE 0.325–0.385 versus 0.010–0.017 with factor 0.166. This supports a metadata-convention
hypothesis, not a proven colour fix: two samples and approximate masks are insufficient
for full calibration, and it cannot explain pre-AI colour complaints on its own. Apple Photos
comparison was subsequently reported (§10.9), rejecting this hypothesis as a colour fix.

### 10.9 Device-selected Soft Skin default; colour experiments rejected (2026-10-09)

On the same IMG_0783 phone comparison the user found D's skin visibly smoother than A, B,
C, E, F and G. Glow/Film worked. The website now selects exactly D: face-crop masks with
SkinSmoothFaceRoughness calculated from local-detail residual variance. Only that smoothing
scalar changes; face colour, eye statistics, Styles metadata, thumbnails and mask encodings
are retained from B. Existing complete/native Soft Skin data continues to skip AI.

The user separately confirmed ALL variants still have excessively strong Styles colour.
E/F additionally turned skin red at maximum strength. G's closer numerical fit to two native
files did not translate into a visual improvement. E/F/G are therefore rejected for default
conversion. This evidence does not establish the renderer's cause; colour intensity on
reconstructed Styles remains unresolved. No new colour calibration is enabled by adopting D.

The native-equivalence claim remains unproven; D's observed improvement is one tested photo,
not a general calibration of Apple's roughness estimator. The preserved A–G fixtures record
the experiment as originally tested and must not be regenerated with new defaults.

Normal-browser verification after adoption produced an IMG_0783 download byte-identical to
the preserved D fixture (SHA-256 5d6ca75de9b94258451a958f9bb7eb6e92805b4e77b232196c3c44bce4c6c1e3).
The JPEG path also generated local-detail roughness for both faces while retaining the old
eye variance. Portable regression checks: 47 passed, 10 optional-fixture skips, no failures;
i18n, syntax and PWA/offline checks passed. This does not extend the physical phone result
to untested photographs or claim a colour fix.

### 10.10 No-face gating and next colour isolation (2026-10-09)

Apple's [WWDC19 segmentation-matte presentation](https://developer.apple.com/videos/play/wwdc2019/260/)
states that when there are no people in the scene, capture will not provide the Portrait/semantic
segmentation mattes (reported dimensions are zero). This documents capture/API behaviour,
not an official specification of Photos' Soft Skin rendering algorithm. The project's §7
requires per-face people entries and masks together. Upstream Python does not invent missing
people information. Elio-backup's face pipeline still calls the segmenter when no face is found
and native masks are missing; it also eagerly loads both detector and landmark models.

Our browser already returned before segmentation/encoding when it found no valid face. It now
also loads the landmark model only when BlazeFace produces a candidate. With no candidates,
only runtime plus the ~0.4 MB detector are needed; landmark (~4.9 MB) and segmentation (~16.5 MB)
weights/sessions are skipped. Detector false positives can still require landmark validation.
Missing XMP regions/mattes alone are NOT a trustworthy no-person signal on arbitrary uploads.
This is face-based gating: a person without a visible/detected face does not require generated
Soft Skin in the current pipeline. The ONNX runtime/detector are still necessary to inspect
such a file. This does not affect separately enabled AI background blur.

A fresh browser test of a blank PNG verified no landmark/segmenter network requests, successful
Styles download and the no-face detail note. The following IMG_0783 still matched the preserved
D byte for byte; JPEG supplementation retained both faces and the selected D roughness.

After gain/range, thumbnail, scene maps and person-statistics experiments failed to improve
colour, the next unisolated hypothesis is Styles key `1` coefficients and key `3` tone curve.
The author normalizes both to identity when preparing the conversion profile. Native values
are scene-dependent (§4.1/§9), so copying them from an unrelated photo is not a proven fix.

Private `tests/private-fixtures/NativeColour_Isolation/` now contains four IMG_0754 variants:
A is the exact reference file; B changes only coefficients to identity; C changes only tone
curve points to identity while retaining its header; D combines B/C. All other Styles values,
every non-Styles item payload, every source property and reference were checked unchanged.
This compares the same pixels on the same native graph and can isolate whether either
normalization contributes to the observed colour intensity. It is a cause-finding experiment,
not an implemented correction for older-iPhone images. The phone result is recorded in §10.11.

### 10.11 Identity coefficients isolated as a contributor; older-photo transfer test (2026-10-09)

The user reports IMG_0754 B (identity coefficients) and D (identity coefficients + identity
curve) are more intense than A; C (identity curve only) looks like A. Since the same pixels,
graph, other Styles fields, masks and Texture data were held constant, this isolates key `1`
normalization as a visible contributor on this native reference. It does NOT establish that
coefficients alone explain all older-iPhone intensity complaints, nor that tone curves never
matter in other scenes or rendering paths.

IMG_0754/0762 use Styles schema `0x2000f` (131087), whereas reconstructed IMG_0783 uses `14`.
A cross-schema coefficient transfer was rejected by the experimental script's version guard.
Instead, two native iPhone 16 references from this session, IMG_4850 and IMG_4137, both have
schema 14 and 51,840-byte coefficient arrays, matching the target's layout.

Private `tests/private-fixtures/IMG_0783_Coefficients/` contains A (byte-identical to the
device-selected Soft Skin D), B (only key `1` from IMG_4850) and C (only key `1` from IMG_4137).
Every other Styles value, every non-Styles item payload, every source property and reference
was checked unchanged. No cross-scene coefficients are installed by the website. Such a transfer
is a cause-finding experiment: coefficients depend on capture/scene and their plane interpretation
is not validated, so a successful transfer still would not justify a fixed donor array for all
photos. Standard colour/brightness and spatial artifacts must be compared alongside Styles.
The user tested Standard with ALL THREE controls at maximum and reports A/B/C look nearly
identical: skin is strongly red/orange and colour remains too intense. Transferring either
same-schema native coefficient array therefore did not improve this tested condition and
is rejected as a default correction. This does not negate the isolated native IMG_0754
result above or establish that coefficients are ignored by the renderer; their interaction
with the reconstructed graph and other metadata remains unknown. The controls were changed
together, so this report does not isolate an individual control's response. The user also
reports original iPhone 16/17 captures do not exhibit this problem at those settings; the
same-schema native coefficient isolation is reported below. Do not claim native colour
parity, enable donor coefficients, or overwrite the tested fixtures. Soft Skin D
remains the default; there is still no validated colour correction for reconstructed Styles.

The next isolated pair, `tests/private-fixtures/NativeV14_Coefficients/`, uses the known
working IMG_0757_TextureFixed (device-selected C compatibility repair). A is its exact
copy; B changes only key `1` to identity. All other Styles values, non-Styles payloads,
properties, associations, item infos and references pass preservation assertions. This
tests the coefficient effect on native schema 14 at the reported Standard/max settings,
without transferring another scene's coefficients onto IMG_0783. A difference from the
earlier native pair cannot be attributed to schema alone because the scenes also differ.
The user reports B is slightly pinker, fresher in colour and brighter than A with all three
controls at maximum in Standard. This confirms a visible coefficient effect in the native
v14 reference too, but the reported shift is mild, unlike the severe red/orange IMG_0783
result. It is not evidence of a quantitative response curve or proof that coefficients
are irrelevant on reconstructed Styles. Together with the unsuccessful IMG_0783 transfers,
it rejects a coefficient-only transplant as the demonstrated fix. Remaining interactions
with capture-dependent fields, scene statistics and other rendering resources are not
isolated. This pair does not change the website's colour or Soft Skin; no colour fix is
claimed, and no additional donor values are adopted on this evidence.

The user subsequently chose to stop investigating skin colour. Keep this research
deferred; do not generate further colour variants or change the selected Soft Skin D
as part of the separate HDR issue below.

### 10.12 Real Adaptive HDR JPEG dropped by the SDR raster route (2026-10-09)

The supplied `IDG_20251020_121945_809.JPEG` is 2,612,099 bytes, Exif iPhone 16 Pro,
2025-10-20 12:19:45.809 +07:00. MPF identifies a 3024x4032 base JPEG and a
1512x2016 three-channel gain-map JPEG (starts at byte 2,201,336). The base ICC is
Display P3; the auxiliary's ICC describes the alternate Display P3/PQ rendition.
Adaptive HDR XMP has base headroom 0, alternate headroom 3.832890, gamma 1 per
channel, SDR/HDR offsets 0.015625; min gains are [-0.275635,-0.288086,-1.159180],
max gains [3.812500,3.816406,3.810547]. These are measured source fields, not donor
parameters. The reported `IMG_0816.HEIC` is 1,579,869 bytes with a neutral gain grid
and no HDR XMP/tmap. The previous `importRaster` always created a black compatibility
auxiliary, so this is confirmed loss of real JPEG HDR, not inferred from file size.

The browser now separates MPF images, validates their Adaptive HDR metadata and
supported matching colour primaries, decodes raw full-range YUV through FFmpeg
(without browser HDR/ICC rendering), and encodes independent base/gain HEVC tiles
losslessly from decoded 4:2:0 planes. Source ICCs and HDR XMP are retained; original
compressed JPEG streams are transcoded. The ISO tmap has all three source channels
and a preferred HDR alternative group; Style/Exif/thumbnail/auxiliary refs also
describe the alternative. Both JPEG planes use the same Exif orientation transform;
output item transforms and Exif orientation are upright. The existing SDR route,
native HEIC resource preservation and Soft Skin D are kept. Recognized unsupported
or malformed HDR stops before an SDR export, with VI/EN/ZH information. Supported
HDR over the existing 48/12 tile budget also stops rather than resizing the maps.

Normal Chrome UI exported private `IDG_20251020_HDR_Fixed.HEIC`, 8,851,220 bytes,
3024x4032, 12 distinct gain tiles, exact base/alternate ICCs and HDR XMP, the source
capture time and a 142-byte tmap carrying the parsed source values. Decoded HEVC
Y/U/V of the first base and first gain tile matches their JPEG-decoded 4:2:0 input
in all 786,432 tested sample values. This is not full-image RGB byte equivalence.
The larger output follows lossless HEVC encoding of JPEG-decoded planes; size is
not an HDR validity criterion. After being asked to compare HDR against the source
JPEG and check Styles/Texture, the user confirmed this supplied HEIC works ("ok rồi").
This is device acceptance of this one output, not a quantitative HDR equivalence
measurement or validation of other JPEG HDR dialects. Physical Safari conversion
memory/performance still needs validation; this file was generated in desktop Chrome.
The change remains local and has not been deployed.

Portable regression suite: 52 passed, 10 optional fixture skips, no failures; five
new HDR tests cover endian MPF offsets, signed three-channel tmap values, unsupported
HDR rejection, Y/U/V tile placement and original metadata/container relationships.
VI/EN/ZH (115 keys) and PWA/offline checks passed; cache version is v65.
References: [Apple WWDC24 HDR](https://developer.apple.com/videos/play/wwdc2024/10177/),
[libavif tmap writer](https://github.com/AOMediaCodec/libavif/blob/main/src/write.c),
[Ultra HDR metadata conversion](https://github.com/google/libultrahdr/blob/main/lib/src/gainmapmetadata.cpp).

### 10.13 Portrait baseline: two IMG_5129 exports (2026-10-09)

The user supplied two private copies of the same iPhone 16 Pro capture (Exif iOS
26.3, 2026-02-11 01:36:52). The first `IMG_5129.HEIC` is 965,408 bytes, SHA-256
`2eff27e5b92fc598f289e6c2867254087a1fddca3de4a30453d20dcb5cc436ff`. It has a
3024x4032 primary, 576x768 disparity, HDR/tmap, but no native Styles, linear
thumbnail or style delta map. The user independently reimported this unprocessed
file into Photos and reported that aperture editing was unavailable. Do not use
this file as a known-good standalone Portrait baseline or attribute that failure
to the website.

The fuller `IMG_5129 (1).HEIC` is 2,080,206 bytes, SHA-256
`e3f10fe03f5b9065432ebb7801c69ccc8dc2db0d7fa310fe9010cfd80de04382`. It has a
4032x3024 primary, 768x576 disparity, native Styles, linear thumbnail, style
delta map, HDR and tmap. The user describes its Portrait as available but Off,
and subsequently confirmed the native A/B/C preservation batch supports both
aperture and Portrait Lighting after import. Native-depth preservation is the
accepted baseline; the open request is generating editable Portrait for photos
that have no depth.
Both depth sidecars declare relative accuracy, native hdis stored as 8-bit L008,
float range 0.735840 to 1.607422, simulated aperture 4.5, calibration and blur
rendering parameters. Their base64 RenderingParameters text hashes are identical.
Both depth auxC properties carry the same 21-byte subtype data after the URI.
Before the experiment below, `attachAiDepth` omitted that subtype and used minimal
XMP without the measured Apple pixeldatainfo layout. These are format differences,
not proven Portrait eligibility requirements. Native 8-bit
storage and relative accuracy must not be diagnosed as inherently invalid.

`tools/portrait-container-baseline.mjs` generated a frozen private A/B/C batch
from the fuller source under `tests/private-fixtures/Portrait_5129_Full_Baseline`:
A is byte-identical to the source; B reverses external payload order and rewrites
iloc offsets without changing any payload, metadata properties or references;
C uses the existing native add-Texture route. Assertions confirm all 104 source
payloads, including Exif, depth, HDR, Styles and idat, preserved in all three,
with original item infos, properties and associations. C adds no legacy tone
curve on this source. The user's device acceptance above supplements these
preservation assertions; it does not establish synthetic-depth support.

### 10.14 Synthetic depth export: Apple metadata experiment (2026-10-09)

The user explicitly requests optional AI depth after Styles/Texture on depthless
photos, with Portrait On/Off, aperture and Portrait Lighting in Apple Photos.
Existing native-depth preservation is already accepted and is not the target.

`apple-depth-metadata.js` now writes the auxiliary disparity descriptor, including
H.265 depth-representation SEI, and Apple pixeldatainfo quantization metadata.
An independently decoded native descriptor is a golden test: 16 fraction bits,
uniform disparity, min 0.73583984375 and max 1.607421875. The default synthetic map
has relative range 0..1, 8-bit L008 storage, native hdis, relative accuracy and low
quality. DepthDataVersion 65541 follows the supplied native file; its semantics
are not established. No camera matrices, pixel size or capture-specific blur
rendering parameters are fabricated. These fields are not proof of Photos
Portrait eligibility.

`exportAiDepth` encodes the actual Depth-Anything-V2-Small result as lossless
monochrome full-range HEVC and attaches it without baking blur. Native depth is
never replaced by this exporter. All source payloads, including idat, and unknown
trailing top-level boxes are preserved. The auxC property precedes orientation
properties as in the measured native graph. This experimental module is not
connected to production save/download buttons; the existing bokeh feature still
exports baked blur and makes no Photos aperture/lighting promise.

Frozen private V2 batches were generated from real local browser inference:

- `Portrait_AI_JPEG_V2`: A is the accepted depthless HDR JPEG conversion;
  B adds AI disparity and Apple metadata; C uses the identical map and additionally
  specifies initial aperture 4.5 and lighting strength 0.5. All 114 baseline item
  payloads remain byte-identical, including HDR, Styles and Texture resources.
  This is the relevant arbitrary-depthless-photo test, without native calibration.
- `Portrait_AI_5129_V2`: source depth and its XMP are physically removed before
  creating A; B/C add actual AI disparity as above. D uses the same AI map while
  retaining this exact capture's own calibration/blur sidecar and quantization
  range. All 127 baseline item payloads remain byte-identical. D isolates the
  native sidecar's effect and is not a general solution for other photos. Native
  capture Exif flags are preserved in this diagnostic cohort.

Both cohorts contain one identical encoded AI map across their depth variants;
V2 reports record geometry, source/map hashes, removed item IDs and preservation
assertions. They have not yet been tested in Photos. A positive native-cohort D
result alone would not establish support for arbitrary depthless JPEGs. Check
fresh import, actual On/Off effect, aperture blur, lighting effect and persistence
after save/reopen before promoting a variant into the website UI.

The first real-inference/export integration completed but did not decode the
exported depth. Subsequent investigation found the V2 codec error in section
10.15; do not treat these V2 files as valid depth exports or a negative result
for correctly encoded AI depth. Portable regressions at that point: 55 passed,
10 optional fixture skips, no failures; PWA and 115-key VI/EN/ZH checks passed,
cache v66. An old libheif decoder rejected the
previously accepted HDR JPEG conversion's tmap/thumbnail graph; the JPEG batch
uses the original JPEG for AI analysis, as the normal raster conversion flow does.
This does not establish that re-uploading that generated HEIC is decodable by the
old library, or validate physical Safari performance.

Apple documents manual auxiliary depth creation via AVDepthData and ImageIO:
[Creating auxiliary depth data manually](https://developer.apple.com/documentation/avfoundation/creating-auxiliary-depth-data-manually).
That documentation does not guarantee Photos aperture/lighting controls for
arbitrary synthesized maps. The descriptor bit layout was checked against
[libheif v1.17.6 HEVC parsing](https://github.com/strukturag/libheif/blob/v1.17.6/libheif/hevc.cc).

### 10.15 Failed Portrait tests; double-wrapped hvcC fixed (2026-10-09)

The user reports all tested synthetic-depth files still have no aperture control.
Inspection then found a concrete serialization defect: `encodeHevcPixels().hvcc`
already contains the complete hvcC property box. The new exporter and private
variant builder wrapped it again, producing a record starting with another box
header instead of HEVCDecoderConfigurationRecord version 1. The V1/V2 trial
codec property is malformed. Earlier preservation checks passed because they
verified source resources, not the new depth's decodability; prior integration
only completed inference/encoding and must not be called functional validation.

Both call sites now pass the complete box once; `attachAiDepth` rejects double
wrapping, raw records and invalid record versions. The portable container test
checks the actual attached codec property and rejects double wrapping. Frozen V3
batches rebuild the same A/B/C/D comparisons with the exact same model assets,
AI map and payload, fixing only the codec serialization. V1/V2 remain frozen for
forensics and should not be used for further device tests.

Chrome readback from both V3 B HEICs passed: all 442,368 stored gray values per
cohort match the AI map exactly (884,736 total), through FFmpeg's HEVC decoder
without RGB/range conversion. B/C/D share the same codec and payload within each
cohort. A second full run of real AI inference -> corrected `exportAiDepth` ->
HEIC extraction -> decoder also matches all 442,368 pixels. HDR, Styles, Texture
and every baseline item payload pass the original preservation assertions.
These checks demonstrate valid encoded depth and preservation, not Photos
Portrait eligibility. The user's V3 result is recorded in section 10.16 below.
No experimental Portrait controls are exposed
in the production UI, and no native calibration is adopted for unrelated photos.

After this fix, the 9 depth/container regressions and 7 startup/lifecycle checks
passed; PWA and 115-key VI/EN/ZH checks passed, cache v67. No colour investigation
was resumed and no files have been deployed.

### 10.16 V3 device result and isolated metadata trials (2026-10-09)

The user imported the unpacked V3 cohort and reports only
`Portrait_AI_5129_V3/D_AI_SamePhotoRendering.HEIC` has full depth and Styles in
Edit. Native-cohort B/C show a depth icon when viewing but have no depth control
in Edit. None of the JPEG cohort has the requested Portrait functionality.
This is device acceptance of D's editing UI on this exact capture. Actual blur,
lighting effect and save/reopen persistence were not separately reported.

Native-cohort B/C/D have the same AI map, encoded payload, codec, image and graph.
D additionally retains the capture's calibration and RenderingParameters, native
float range and Quality high. Therefore the native sidecar/descriptor group has
an observed eligibility effect; the result does not identify an individual field
or establish support for arbitrary photos. In particular, it is not evidence
that a larger AI model or 32-bit HEVC storage is necessary.

The native RenderingParameters value decodes to 1,352 bytes, beginning with REND,
version 7 and a little-endian size of 1,352. It is not a plist; the entries and
their capture/focus dependencies have not been established. No serialized blob
is adopted as a production donor preset.

`tools/portrait-depth-sidecar-trials.mjs` generates frozen private
`Portrait_Metadata_V4` from the V3 baselines and previously encoded AI assets:

- A: remove only RenderingParameters from working D metadata.
- B: remove only its nine camera-calibration fields, retaining render parameters.
- C: change only quantization/auxC range to 0..1, with the identical gray samples.
- D: change only Quality high to low, with the identical AI result.
- E (JPEG): add only the native render blob to V3 C, without camera calibration.
  This is a private cross-scene diagnostic. A positive result alone would not
  validate its focus or blur settings on unrelated photos or justify a default.
- F (JPEG): change only Quality low to high. This tests metadata eligibility;
  it does not improve or measure the AI map's quality.

The working reference D is reproduced byte-for-byte before trials are generated.
All native/JPEG baseline payloads (127/114 items) and their properties/references
remain exact; each cohort retains its V3-verified codec and depth payload. An
independent Python XML parser verified valid XML and exactly the intended changed
fields in all six trials. Physical V4 results are pending; prioritize A/B/E.
Production Portrait behavior and colour defaults are unchanged.

The user supplied two prose/Swift proposals for review. Apple's public method is
`dictionaryRepresentation(forAuxiliaryDataType:)`, not the proposed
`dictionaryForAuxiliaryDataType()`. The manual-depth guide specifies CFData bytes
and a description containing pixel format, width, height and bytes per row; the
proposal passes a CVPixelBuffer object as Data and omits those dimensions/stride.
The guide/method support HEIF, JPEG and DNG, contradicting the HEIC-only claim.
No verified public API guarantee was found that arbitrary MakerApple keys
ApertureValue/FocusDistance/PortraitBlurEffect enable Photos aperture editing.
The proposed kCGImagePropertyHEICSContinuousProfile constant was not located in
the checked public documentation; it must not be treated as a supported Portrait
switch. The cited WWDC21 10076 is Object Capture, not a specification for this
switch. ImageMagick discussion 3892 remains an unanswered request, not a tested
Portrait writer. The snippets recreate the main UIImage and add depth without
explicitly preserving this tool's Styles/HDR resources, and require native APIs
unavailable directly to Safari. None is adopted as a drop-in website fix.

References: [manual auxiliary depth](https://developer.apple.com/documentation/avfoundation/creating-auxiliary-depth-data-manually),
[dictionary representation](https://developer.apple.com/documentation/avfoundation/avdepthdata/dictionaryrepresentation(forauxiliarydatatype:)),
[Object Capture session](https://developer.apple.com/videos/play/wwdc2021/10076/),
[original ImageMagick discussion](https://github.com/ImageMagick/ImageMagick/discussions/3892).

### 10.17 V4 device outcomes and estimated-calibration trial (2026-10-09)

The user reports all 5129 A/B/C/D show the Portrait icon when viewing, but Edit
differs. A (RenderingParameters removed) has no aperture; Portrait Lighting UI
remains but renders black or has no effect. B (calibration group removed) and D
(Quality low) have neither aperture nor lighting. C (range 0..1) has working
aperture, lighting and Styles. JPEG E/F have Styles only, with no aperture or
lighting. Thus viewing-time classification is not evidence of editing support.

On this exact native graph and AI map, removing the render blob or calibration
group, or declaring Quality low, each breaks editing relative to the working
reference. This does not prove every calibration field is required, or that
these three ingredients are sufficient on arbitrary inputs. The 0..1 range
works on this capture; the donor's native min/max need not be used for that case.
Changing Quality to high is an eligibility experiment, not a measured upgrade
to the map or a substitute for the remaining metadata.

`tools/portrait-calibration-trials.mjs` generates frozen private
`Portrait_Calibration_V5`. All variants retain the verified 0..1 descriptor,
relative accuracy, high Quality label and native render blob from working V4 C.
Only calibration is replaced with a pinhole approximation. It is derived from
the individual photo's EXIF actual focal length, 35mm equivalent focal length,
stored dimensions and, in one probe, its digital zoom. Principal point is
assumed centered, square pixels and no distortion are assumed, and extrinsics
are identity. These are estimated modeling assumptions, not measured lens
calibration. No unrelated camera's matrix/distortion, forced Portrait capture
flags, or new model outputs are introduced.

- A uses 5129's 6.764999866 mm actual focal length / 48 mm equivalent at
  4032x3024; approximate focal pixels 5591.377978, pixel size 0.0012098985 mm.
  It changes only calibration relative to the accepted V4 C.
- B uses the JPEG's 15.659999847 mm actual / 120 mm equivalent at 3024x4032;
  approximate focal pixels 13978.444945, pixel size 0.0011202963 mm.
- C uses the same JPEG with its EXIF DigitalZoomRatio 2 as an additional
  multiplier; approximate focal pixels 27956.889890, pixel size 0.0005601481 mm.
  B/C isolate zoom interpretation. The source's crop/distortion/equivalence
  conventions are not fully recovered from EXIF.

Projection formula is f_px = f_35mm * hypot(width,height) / hypot(36,24), and
pixelSize = actualFocalLength / f_px (with zoom multiplier in the C probe).
CIPA defines equivalence using the image diagonal; Apple likewise describes
nominal 35mm focal length as diagonal field of view. Applying this formula to
the exported image is an approximation: crop, correction and metadata rounding
can differ from camera calibration, so a positive control is required.

An independent Python TIFF reader verified these source EXIF focal values.
The builder preserves every baseline item payload (127 native / 114 JPEG),
properties and references, including original EXIF/HDR/Styles/Texture. AI depth
and codec hashes match the previously decoded V3 assets. A separate Python XML
parser checks unchanged non-calibration metadata, matrix ordering/dimensions,
zero distortion and independently recomputes every projection. ZIP CRC and HEIC
hashes pass. Physical V5 outcomes are pending. The cross-scene render blob still
has unknown focus/tuning dependencies and is not adopted as a website default;
production UI, HDR, Soft Skin and colour behavior remain unchanged.

Sources: [Apple camera calibration](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata),
[Apple nominal focal length](https://developer.apple.com/documentation/avfoundation/avcapturedevice/nominalfocallengthin35mmfilm),
[CIPA diagonal-equivalence definition](https://www.cipa.jp/std/documents/e/DCG-X001-2018_E.pdf).

### 10.18 V5 device outcomes, actual depth readback and brand isolation (2026-10-09)

The user reports V5 A has full editing support; V5 B/C have Styles only.
Estimated pinhole calibration therefore works on this native 5129 graph with
its retained capture metadata and same-scene rendering parameters. It does not
establish a general Portrait exporter for photos originally without depth.
Neither tested digital-zoom interpretation makes the JPEG graph editable.

B/C do contain AI depth. Readback used the actual user-unpacked files under
`tests/private-fixtures/Portrait_Calibration_V5_Test/Portrait_Calibration_V5`.
Both contain hvc1 depth item 125, 576x768, a 61,703-byte payload with SHA256
`66e4c0a7f6a71acf771059ec5f7f7a68b27598d7646d6e3990f80ce440b422ab`,
auxl links to primary item 1 and tmap item 98, and the depth XMP sidecar.
Decoding the depth HEVC from each actual HEIC reproduces all 442,368 AI gray
samples exactly. Their map is neither missing nor blank. PNGs generated from
those decoded samples and `readback.json` are in `Portrait_V5_Verification`.
Photos not showing Portrait controls is not evidence of absent file depth.

The accepted native graph declares compatible brands mif1, MiHB, MiHA, heix,
MiHE, MiPr, heic, miaf and tmap. The generated JPEG graph declares only mif1 and
heic; attachAiDepth currently preserves that ftyp. Both depth codecs use HEVC
profile 4. These observations motivate a format-declaration probe; they do not
prove that heix or MiPr enables Portrait, or that adding a brand establishes
all its conformance requirements. The meaning of MiPr remains unverified.

`tools/portrait-brand-trials.mjs` produces frozen `Portrait_Brands_V6` from V5 B:
A adds only compatible heix; B only MiPr; C both. Major brand and minor version
remain unchanged. No AI rerun, camera calibration, render parameters, capture
flags, EXIF, HDR or Styles change. Each file preserves all 116 item payloads,
every property and reference, and the exact depth payload. Only ftyp and the
required absolute iloc offset shifts differ. Byte comparison after undoing
those offsets verifies the entire original tail; an independent Python check
verifies brand additions and unchanged non-meta top-level boxes. V6 device
results are pending. These private diagnostic files, including the existing
cross-scene render blob, are not production defaults or website output.

### 10.19 V6 device outcome and capture-classification isolation (2026-10-09)

The user reports all three V6 HEIC files still lack Portrait controls. Adding
heix alone, MiPr alone or both is therefore insufficient on this exact JPEG
conversion. This does not prove brands never matter in combination with other
conditions. The tested outputs are already HEIC, not JPEG with a changed suffix;
"JPEG cohort" describes the input's origin, not the output format.

Depth payload/descriptor, sidecar references and property ordering were also
compared between accepted V5 A and failed V5 B. Both use the same writer and
valid single hvcC; their depth geometry/transforms differ with their source
geometry. No missing depth item or sidecar was found. The remaining source
metadata differs: native A has Apple MakerNote 0x14 value 12 and 0x1f value 1;
the generated JPEG cohort lacks both tags. ExifTool's primary Apple.pm describes
0x14 as ImageCaptureType (12 = Scene, 2 = Portrait), and 0x1f as
PhotosAppFeatureFlags, set when a person/pet is detected. These descriptions
do not establish a Photos aperture-enabling switch.

`tools/portrait-capture-trials.mjs` generates frozen private
`Portrait_Capture_V7`. A changes only 0x1f to zero on the accepted native V5 A,
providing a negative-control probe. B adds only 0x1f=1 to failed V5 B; C adds
only 0x14=12; D adds both. It does not force Portrait capture type 2, transplant
camera data, identifiers or complete donor EXIF, or rerun AI. All non-EXIF item
payloads (128 native / 115 JPEG), properties, references and original file bytes
other than the EXIF locator remain exact. All unrelated MakerNote tag values
are checked unchanged. The byte-blob injection helper's count is explicitly
corrected in this private tool to ONE TIFF element for each int32 scalar.
Capture flags are diagnostic declarations, not proven detection or production
defaults. V7 device outcomes are pending.

An independent Python HEIF/TIFF reader verifies both scalar tags have signed
int32 type and count one, their requested values, unchanged root/EXIF fields
outside MakerNote, and unchanged unrelated MakerNote values including 64-bit
entries. ZIP CRC and all archived file hashes also pass.

Reference: [ExifTool Apple MakerNote definitions](https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/Apple.pm).

### 10.20 V7 device outcome and EXIF-write controls (2026-10-09)

The user reports V7 A can toggle Portrait and shows the aperture icon in Edit,
but neither aperture nor lighting has a working effect. V7 B/C/D have no
Portrait controls. Adding capture type 12 and/or feature flag 1 is insufficient
on that JPEG-derived HEIC graph. No production classification flags are added.

V7 A simultaneously changed the flag value and used the EXIF/MakerNote writer,
so the failure cannot yet be attributed solely to the flag. V8 separates these
variables: A rewrites accepted V5 A with flag 1 unchanged, using the same writer
as V7; B sets flag 0 directly in accepted V5 A without rewriting EXIF; C restores
flag 1 directly in failed V7 A, retaining its EXIF serialization. All remain
native-graph controls with the same AI depth; none is a new arbitrary-photo fix.
A/C have identical active EXIF bytes. All 128 non-EXIF items, properties and
references are checked exact; B/C change only the four inline scalar bytes.
V8 device results are pending.

V8 A and C additionally have identical complete-file SHA256
`db48c1d44571e7d31b60f0933809d197f07187a1a63aea1ebbd72f172a2e6adb`.
Thus only A/B are packaged for device testing; C needs no separate import.
The independent Python TIFF reader verifies unchanged non-MakerNote fields,
unchanged other MakerNote values, and correct int32/count-one flag values.

The actual original JPEG IDG_20251020_121945_809.JPEG has 1,106 bytes of EXIF
and no MakerNote 0x927c. Thus there is no original Apple MakerNote to restore
on this JPEG cohort. Its minimal Apple MakerNote is generated for Styles;
absence of original capture metadata is not evidence that valid depth is absent.
The Elio backup's portrait-matte code handles foreground segmentation; its
depth code copies existing source depth/sidecars. No verified implementation
that builds arbitrary editable Apple Photos Portrait metadata was found there.

### 10.21 V8 results, Depth Sampler review and separate Focos/merged inputs (2026-10-09)

The user confirms V8 A has working aperture and lighting. V8 B can toggle
Portrait but cannot adjust aperture or lighting. For the tested native 5129
graph, the EXIF-write path works and directly setting PhotosAppFeatureFlags
to zero disables the editing effects. This establishes the effect of that
field on this graph, not sufficiency of setting it to one on arbitrary photos.
The user's objective remains all-camera ordinary photos with genuinely working
Photos aperture/lighting after adding AI depth, not only native-graph controls.

Reviewed shu223/iOS-Depth-Sampler at commit
`ed5c96f9d753fce86a633f069defd3458e90a8c5`; 24 Swift files and associated
Metal/docs were downloaded read-only into an ignored private reference snapshot.
DepthImagePickableViewController filters existing depthEffectPhotos and loads
their file representation. CGImageSource+Depth reads auxiliary dictionaries
and constructs AVDepthData from existing data. PortraitMatteViewController uses
CIBlendWithMask to display background removal inside its own app. VideoCapture
uses AVCaptureDepthDataOutput and synchronization for camera-supplied depth.
No CGImageDestination writer, Photos asset-creation/export path, synthetic
depth model, or implementation enabling arbitrary Photos aperture editing was
found in the reviewed Swift files. Its bundled JPEG examples have native depth
metadata, DepthDataVersion 65538, high/relative quality and older REND version 2;
they are readers' fixtures, not verified all-camera editable exports. They
must not be represented as Focos references or as proof of working Photos ƒ.

The user then supplied a new directory containing FC_20261009_0001.JPEG
(3,161,062 bytes) and IMG_0897.HEIC (271,185 bytes), and explicitly confirmed
they are TWO DIFFERENT photos. Both show Portrait when viewing but lack Edit
aperture/lighting according to the user; neither is a known-good editing reference.
The JPEG comes from Focos, is 3024x4032, has camera iPhone 16 Pro in EXIF,
Apple capture type 10 and Photos feature flag 1. It embeds disparity metadata
with high/relative quality, version 65541, range 0.492432..4.582031,
calibration reference 3024x4032, aperture 2.8, lighting strength 0.5 and its
own 1,352-byte REND version 7. That blob differs from 5129's; it is not replaced.
Its second JPEG stream starts at byte 3,113,146 and decodes as a 576x768
monochrome image; the first stream is 3024x4032 RGB. The separate auxiliary
image is therefore present, not only an empty depth metadata declaration.

The separate HEIC is 1200x900 with no root camera model, capture type 12 and
feature flag 1. It contains depth hvc1 item 9 at 768x576, auxl to primary 7,
and XMP item 10 describing high/relative depth version 65541, range
0.007843..0.992188, calibration reference 4032x3024, aperture 2.8 and lighting
strength 0.5 with a 1,352-byte REND version 7. The reference dimensions differ
from stored pixels; the same aspect ratio alone is not proof of correct
calibration/focus. Do not copy EXIF, calibration, rendering parameters or depth
between these two unrelated inputs.

`tools/portrait-file-classification.mjs` creates private Focos_Classification_V9:
A changes only the Focos JPEG's existing int32 capture type 10 to 2;
B changes only the separate HEIC's existing value 12 to 2. ExifTool describes
2 as Portrait, but this is an isolated diagnostic declaration, not a production
capture claim or proven solution. No HEIC conversion, model rerun, EXIF rebuild,
or data transplantation occurs. File sizes stay exact; byte comparison verifies
that only the inline four-byte scalar region differs (one actual changed byte
in each). Depth, image pixels, render blobs, feature flags and all other file
bytes stay exact. The user confirms both V9 files are recognized as Portrait
when viewing, but neither has aperture or Portrait Lighting editing controls.
Changing ImageCaptureType to Portrait is therefore insufficient for both of
these inputs. Production UI is unchanged.
An independent Python JPEG/HEIC TIFF parser verifies the count-one signed
int32 tag changes and every other EXIF/MakerNote value; ZIP CRC/hashes pass.

References: [Depth Sampler source](https://github.com/shu223/iOS-Depth-Sampler),
[auxiliary data reader](https://github.com/shu223/iOS-Depth-Sampler/blob/master/iOS-Depth-Sampler/Utils/CGImageSource%2BDepth.swift),
[matte demo](https://github.com/shu223/iOS-Depth-Sampler/blob/master/iOS-Depth-Sampler/Samples/Portrait-Matte/PortraitMatteViewController.swift).

### 10.22 Review of supplied Portrait analysis and REND structure (2026-10-09)

The supplied analysis usefully separates aperture from lighting and proposes
investigating rendering parameters. Its proposed four "root causes" are not
established diagnoses. V4/V5/V8 demonstrate changes on the native 5129 graph;
they do not specify a general Apple Photos import contract for arbitrary photos.
V9 now confirms that a Portrait capture declaration alone is insufficient.
Successful pixel readback also does not prove all HEIF graph/metadata details
are correct or rule out further container issues.

Corrections checked against the current code and reference files:

- Depth auxC uses `urn:mpeg:hevc:2015:auxid:2`, not the Apple disparity URI
  proposed by the analysis. The auxl reference runs from auxiliary depth to
  primary (and applicable tmap), not primary to depth.
- The depth range descriptor uses the H.265 depth_representation SEI encoding,
  not an Apple-specific floating-point format. Payload type 177 and prefix
  SEI NAL unit type 39 are different identifiers.
- RenderingParameters is in `http://ns.apple.com/depthBlurEffect/1.0/`, with
  the observed prefix depthBlurEffect; it is not a depthData namespace field.
- Apple MakerNote 0x0017 is described by ExifTool as LivePhotoVideoIndex, not
  SubjectArea. Standard EXIF SubjectArea is 0x9214. Capture type 12 is labelled
  Scene by ExifTool; a specific iPhone subject-detection meaning is unverified.
- Apple's manual auxiliary-depth article writes auxiliary data using
  CGImageDestinationAddAuxiliaryDataInfo. It documents creating/attaching depth
  and supports JPEG, HEIF and DNG dictionaries; it does not promise that the
  imported result enables Photos aperture/lighting editing. The cited public
  API documentation is not evidence that face landmarks and a portrait matte
  are mandatory/sufficient Photos import conditions. The report's
  CIPortraitLighting link could not be verified as a public API reference.

A read-only Base64/binary comparison of native 5129, the supplied Focos JPEG,
and IMG_0897 finds all three REND version-7 blobs are 1,352 bytes. Each has a
16-byte header followed by 167 eight-byte records, with the same unique
16-bit key / 16-bit type-code sequence and four-byte values (149 type-code 1,
18 type-code 2). This is an observed structural pattern, not decoded semantics:
no key is yet proven to mean focus plane, falloff, aperture or circle of
confusion. Against native 5129, Focos differs in 208 bytes / 64 value records;
IMG_0897 differs in 202 bytes / the same 64 records. Both contain REND despite
lacking working Edit controls, so REND presence alone is insufficient.

The Depth Sampler's two older bundled JPEGs instead contain 320-byte REND
version-2 blobs. The report's universal fixed 1,352-byte assertion is false;
version-7 record parsing must not be applied to version 2.

The next justified research direction is to identify specific rendering keys
and validate image/depth/calibration transforms before synthesizing scene
parameters, while testing aperture separately from lighting. Cross-scene REND
transplantation and adding another segmentation model are not demonstrated
solutions. No production metadata or GUI behavior changes were made for this
review; editable Portrait for arbitrary photos remains unverified.

References: [Apple manual auxiliary depth](https://developer.apple.com/documentation/avfoundation/creating-auxiliary-depth-data-manually),
[ExifTool Apple definitions](https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/Apple.pm),
[ExifTool EXIF definitions](https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/Exif.pm).

### 10.23 Same-photo main-encoder/container isolation V10 (2026-10-09)

The user authorized the staged plan: test re-encoding a known-good native photo
first, then test another scene with its own depth only after the same-photo
control is accepted. `tools/portrait-primary-reencode.mjs` creates the immutable
private `Portrait_Primary_V10` batch from full IMG_5129 (1).HEIC:

- A_Original_5129 is byte-identical to the accepted original, SHA256
  `e3f10fe03f5b9065432ebb7801c69ccc8dc2db0d7fa310fe9010cfd80de04382`.
- B_Lossless_Reencoded_Main re-encodes only the 48 primary 512x512 HEVC tiles,
  preserving the 4032x3024 primary geometry, original grid and orientation.
  It decodes directly to full-range 8-bit 4:2:0 samples, then uses the website's
  FFmpeg.wasm/x265 encoder with lossless mode, primaries 12 (smpte432), transfer
  1 (bt709), matrix 6 (smpte170m), and full range. No RGB/ICC conversion or
  cropping occurs. Only primary tile payloads and their hvcC associations change;
  new codec properties are appended without altering any original property.
  All 56 remaining item payloads, including the same photo's depth, HDR, Styles,
  EXIF and depth rendering sidecar, remain byte-exact.
- C_Container_Control uses the same append-codec/repoint/repack writer as B,
  but appends the original hvcC and keeps all 104 original item payloads exact.
  It isolates this serialization path from the new encoded bitstreams.

All original item IDs/infos, references, descriptive properties and other
associations are asserted unchanged. Original idat and non-mdat top-level
boxes are retained. Each new tile is decoded back and compared byte-for-byte
with its own source Y/U/V samples. A second browser check decodes all 48 tiles
from the FINAL assembled B HEIC and verifies their source-sample SHA256 values:
18,874,368 decoded sample bytes match. An independent Python iloc/idat parser
checks all 104 active payloads in every variant; only B's 48 primary payloads
differ. ZIP CRC, contents and file hashes also pass.

B is 8,942,556 bytes versus A's 2,080,206 and C's 2,080,777 because this probe
uses lossless encoding; it is not a production size/performance target. Reports
and Vietnamese import instructions accompany `Portrait_Primary_V10_Test.zip`.
No source input or earlier test batch is overwritten. No production GUI,
Portrait export behavior, model, or website deployment is changed.

The user confirms all three V10 variants work normally with aperture and
Portrait Lighting. Save/reopen persistence was not separately specified.
On this exact same-photo input, both the re-encoded main and the new codec
association/container path retain editing. This permits the next scene test;
it does not rule out all encoder/container problems for other inputs or
establish an arbitrary-photo solution. V10 intentionally keeps native Styles
and does not add Texture; the user noticed its absence and this is expected.

### 10.24 Depthless JPEG scene substituted into native reference, V11 (2026-10-09)

After V10 acceptance, `tools/portrait-scene-trials.mjs` creates an immutable
private `Portrait_Scene_V11` batch. The input is IMG_7454.JPEG, 214,098 bytes,
896x1195, EXIF orientation 1, no camera model, one JPEG SOI stream and no
Apple depth namespace/auxiliary disparity declaration. It is a clear face
against a largely uniform background. All AI input is RGB from this JPEG;
no native 5129 depth pixels are used for B/C.

The source is fitted without aspect stretching into the reference's displayed
3024x4032 extent (upscaling for this structural diagnostic), then rotated
counterclockwise into stored 4032x3024 coordinates. Both the primary and AI
map inherit the reference's irot=270 transform. Depth-Anything-V2-Small runs
on the same stored scene, producing normalized relative disparity at 768x576.
The actual encoded depth SHA256 is
`cec3f2b37c3f44f046890bd382fe3babdcb8e7afa11f371cd90d13c6f01cb285`.
Decoded scene/depth previews were visually checked for alignment and subject
separation. Main tiles use P3 canvas samples converted to the signalled BT.709
transfer and full-range SMPTE170M YUV, followed by lossless website x265.
The normal thumbnail and P3-linear Main10 thumbnail are regenerated from the
new scene, not left as 5129 previews.

- A_Native_5129_Control is the original, byte-exact accepted native file.
- B_JPEG_AI_NativeRange replaces 48 primary tiles, the depth, normal thumbnail
  and linear thumbnail (51 payloads total). It retains native quantization
  range, depth sidecar and auxC range descriptor.
- C_JPEG_AI_UnitRange uses the exact same scene and depth as B, changing only
  depth FloatMinValue/FloatMaxValue to 0/1 and the corresponding auxC descriptor.
  Native REND, calibration, aperture and lighting settings otherwise stay exact.

This is deliberately NOT a complete per-scene exporter. Native 5129 EXIF,
camera/focus calibration, REND, HDR gain map, semantic mattes and Styles maps
remain as diagnostic controls. They describe another capture and must not be
promoted as correct generated metadata. Appearance/HDR/lighting can therefore
be wrong; no colour/HDR fidelity claim follows from this batch. The reference
still has no added Texture. A successful B/C only demonstrates an intermediate
cross-scene eligibility path; all borrowed data would still need removal or
reconstruction for the actual photo before production use.

Assertions preserve original item IDs/infos, references, properties and
unrelated associations. Final-file main readback verifies all 48 tiles against
18,874,368 generated Y/U/V sample bytes. BOTH final B/C depth items decode
exactly to all 442,368 generated gray pixels. An independent Python iloc/idat
parser checks all 104 payloads; B keeps 53 native payloads exact, C keeps 52,
and B/C differ only in the depth XMP payload plus its declared auxC property.
It also verifies the unit sidecar differs only in the two range fields.
ZIP CRC and archived hashes pass. Reports, previews and Vietnamese instructions
are in `Portrait_Scene_V11_Test.zip`. No production UI/export or deployment
changes were made. The user confirms B/C have functional depth/aperture and
Portrait Lighting. Save/reopen persistence was not separately confirmed.
This establishes an accepted cross-scene diagnostic with the JPEG's own AI
depth, but still does not validate the borrowed capture/colour/HDR resources
or establish a complete arbitrary-photo production exporter. Texture was
intentionally absent. The stronger Styles colour remains a paused investigation
at the user's explicit request.

### 10.25 Portrait and Texture coexistence probe, V12 (2026-10-09)

After V11 B/C device acceptance, `tools/portrait-texture-trials.mjs` creates
the immutable private `Portrait_Texture_V12` batch from accepted V11 C:

- A_V11_Accepted_Control is byte-identical to V11 C.
- B_Portrait_Texture uses production addTexture, adding 12 empty 2026 matte
  slots and Texture metadata. No tone curve is added; it has no human masks.
- C_Portrait_Texture_AI_SoftSkin adds the existing per-face crop/local-detail
  AI pipeline using the SAME JPEG and display/stored orientation as V11.
  One face is found and refined. Texture people data, 2026 masks, semantic skin
  and Portrait Effects Matte are added. Native Styles mode preserves the
  entire Styles plist exactly; no colour/preset/statistics changes are made.

The accepted V11/native 5129 graph has only a legacy semantic SKY matte, no
semantic skin or Portrait Effects Matte. Its working Lighting is therefore
a counterexample to treating those two masks as universally mandatory for
Photos Lighting on this tested graph; it is not a general import specification.

All 104 V11 item payloads remain byte-exact in A/B/C. The writer also verifies
original item infos, references and associated property values. Independent
Python iloc/idat parsing confirms all 104 payloads; final B/C depth readback
matches every one of 442,368 source pixels. ZIP CRC and file hashes pass.
Reports and Vietnamese instructions accompany Portrait_Texture_V12_Test.zip.

The user accepts V12 C and confirms Soft Skin, Glow and Film all work; Soft Skin
is relatively subtle and not sufficiently smooth. Save/reopen persistence was
not separately confirmed. The scene still carries V11's borrowed EXIF/calibration/REND/HDR/Styles
resources; this is a coexistence diagnostic, not a correct per-scene exporter.
Production UI/export and deployment remain unchanged. Colour investigation
remains paused; C's entire original Styles payload is byte-exact.

### 10.26 Soft Skin roughness-only strength probe, V13 (2026-10-09)

The accepted V12 C uses the device-selected face-crop/local-detail pipeline
from section 10.9. Its one generated face has local-detail roughness
0.0001650231649452065. The user reports active but relatively weak smoothing.
This is not evidence of a weak model: mask coverage and Apple's interpretation
of the uncalibrated roughness proxy remain separate possible causes.

`tools/portrait-softness-trials.mjs` produces an immutable Portrait_Softness_V13
batch: A is byte-identical to V12 C, B changes only that face's
SkinSmoothFaceRoughness to one tenth, and C changes it to real-valued zero.
These are isolated diagnostic values, not new production defaults or measured
Apple-equivalent roughness. Previous IMG_0783 D acceptance motivates probing
lower roughness, but does not establish a monotonic strength response or
that zero is valid/effective in Apple's renderer.

The only changed item payload is Texture item 130. Its other plist fields
remain semantically exact with real/integer types retained by the JS writer.
All 134 other payloads and every original item/info/reference/property remain
exact, including skin/person masks, main pixels, Styles, depth and lighting
sidecar. An independent Python iloc/idat parser checks all 135 items and
plistlib confirms only the roughness scalar changes. ZIP CRC/hashes pass.
The user reports V13 C (zero roughness) breaks Glow and Soft Skin, blackening
the person. Reject this diagnostic boundary; do not adopt zero as a default.
V13 B is temporarily usable but smoothing remains weak. The user also reports
entering Edit selects Bright + Soft Skin, and manually selecting Standard
darkens the image/skin. This is a newly reported Edit-state issue, not proof
that B's roughness change caused it; its captured Styles marker is identical
to V12 C and the original 5129 reference. No V13 variant is adopted.
No AI inference is repeated, no model/masks
are changed, no colour work is resumed and no production/deployment changes
are made. This batch retains the diagnostic borrowed resources of V11/V12.

### 10.27 Captured Styles state isolation after V13 rejection, V14 (2026-10-09)

A read-only `tools/portrait-preset-audit.mjs` comparison finds the original
5129, V12 C and V13 B share identical Styles and MakerNote 0x54 data. Their
captured marker has fields 1=0.30386266112327576, 2=0.5, 4=16, whereas added
Texture declares Preset=Standard. There is no explicit Bright/Soft Skin preset
string in the inspected Texture plist. The non-neutral captured pad and
borrowed colour/HDR resources are possible contributors, not established causes
of the user's Edit transition. Field 4's semantic meaning remains unproven.

`tools/portrait-capture-style-trials.mjs` freezes Portrait_CaptureStyle_V14:
A is accepted V12 C, B changes only 0x54 fields 1/2 to real-valued zero, C
additionally changes field 4 to integer 1, matching the upstream default
8-field marker's value. This does not relabel/edit Texture or modify the
Styles algorithm. Every variant retains V12's positive local-detail roughness;
V13's zero/lower-roughness candidates are not used.

All 134 non-EXIF item payloads, item infos, properties and references remain
byte-exact, including Texture/person data, masks, main, depth, REND, Styles
and HDR. Every other MakerNote tag remains exact; unchanged 0x54 fields and
their real-vs-integer values are preserved. Independent Python iloc/idat,
TIFF/MakerNote and plistlib checks confirm these constraints; ZIP CRC/hashes
pass. The user reports B still selects Bright on entering Edit; C selects
Standard and is preferable. Both retain working Soft Skin, Glow, Film,
aperture and Portrait Lighting. Skin remains dark/dull after entering Edit,
whereas the viewing image beforehand is bright with normal skin. Supplied
JPEG examples show the AFTER-Edit appearance; the subsequent single image
is explicitly V14 C. No before-Edit image was supplied for quantitative pairing.
Save/reopen persistence is not separately confirmed. On this cohort, changing
field 4 from 16 to 1 with the same zero pad changes the default selected style;
this does not establish all possible preset ID meanings. The residual darkening
is not solved by the captured-state correction. This is only a captured-state diagnostic
with inherited borrowed resources. Production/deployment are unchanged,
and broad Styles colour/strength investigation remains paused.

### 10.28 Borrowed HDR isolation for the Edit darkening, V15 (2026-10-09)

V11-V14 deliberately carried native 5129 HDR resources although their new main
pixels came from SDR IMG_7454.JPEG. The user confirms viewing-to-Edit darkening
persists at Standard in V14 C. The mismatched gain map/tmap is a separate
candidate for that transition; no causal conclusion is made before device testing.

`tools/portrait-borrowed-hdr-trials.mjs` restricts input by SHA256 to accepted
V14 C and creates an immutable Portrait_BorrowedHDR_V15 batch. A is byte-exact
V14 C. B removes ONLY the borrowed gain-map grid 62, its 12 tiles 50-61,
gain-map XMP 100 and tmap 102. It retains the main grid 49 even though the
removed tmap depends on it. References/property associations to removed items
are pruned; surviving auxiliary resources still reference the main 49.
C additionally sets MakerNote HDRHeadroom 0x21 and HDRGain 0x30 to signed
rational 1/1, with correct TIFF element count 1. B retains the original EXIF
to isolate graph removal from HDR marker values. These neutral values are
diagnostic choices, not proof of complete SDR metadata reconstruction.

B retains all 120 surviving item payloads exact. C changes only EXIF 104:
its other MakerNote values including the accepted 0x54 selection remain exact.
Both preserve main, thumbnails, Styles, Texture/roughness/masks, AI depth and
REND byte-exact. All surviving item infos/property bytes/associations and
the expected pruned references are asserted. Independent Python iloc/idat
and TIFF/MakerNote parsing confirms the removed IDs, payload preservation
and two intended rational changes. ZIP CRC/hash checks pass.

The user reports BOTH V15 B/C remain dark/dull in Edit. Removing the borrowed
HDR graph and neutralizing the two HDR marker values did not solve this
transition on the tested scene. Portrait/Texture functioning and save/reopen
persistence were not separately reconfirmed for V15 in that reply. Removing
this borrowed graph is appropriate to test this SDR scene; no real source
HDR is removed and no production HDR behavior changes. Remaining Styles,
calibration, sky matte and rendering data are still diagnostic references.
No broad colour/strength algorithm work is resumed and no production/deployment
changes are made.

### 10.29 ICC/encoded transfer mismatch isolation, V16 (2026-10-09)

After V15 fails to resolve Edit darkening, a read-only colour-signalling audit
finds V11-V15 main/grid/normal-thumbnail colr properties retain native 5129's
P3 ICC. Its shared rTRC/gTRC/bTRC is parametric type 3 with fixed-point values
matching the sRGB inverse curve: gamma 2.3999939, a 0.9478607, b 0.0521393,
c 0.0773926, d 0.0404510. Encoded HEVC VUI instead declares P3 primaries 12,
BT.709 transfer 1, SMPTE170M matrix 6 and full range. Crucially V11's generation
actually applied srgbToBt709Rgba before YUV encoding. This generated sample
convention therefore does not match its retained ICC curve. Native 5129 has
the same ICC/VUI declarations, but VUI alone cannot establish Apple's actual
pixel convention; do not conclude native files are intrinsically broken.

`tools/portrait-transfer-trials.mjs` freezes Portrait_Transfer_V16 from V15 C:
A is byte-exact. B replaces the main grid, 48 tiles and normal thumbnail colr
association with P3/BT.709/SMPTE170M/full-range nclx matching the generated
samples/VUI. C instead keeps a P3 ICC form and replaces ONLY its shared curve
parameters with inverse BT.709 values (1/0.45, 1/1.099, 0.099/1.099, 1/4.5,
0.081), recomputing the ICC v4 profile ID. Other ICC tags/matrix/white point
and header bytes remain exact. The original profile description is inherited
for this private diagnostic; it is not a new public profile definition.

All 120 item payloads remain byte-exact, including HEVC codec/samples,
Styles, Texture/roughness/masks, depth, EXIF, REND and thumbnails. Only the
50 colr associations change; original ipco properties remain unmodified.
Python independently checks all active payloads, added nclx values, ICC
parameters, unchanged bytes and the profile MD5. LittleCMS independently opens
both profiles and maps an encoded neutral sample (115,115,115) to approximately
(115,115,115) with the inherited ICC versus (128,128,128) with the matched ICC.
This verifies the interpretation difference, not that Photos uses that path.
ZIP CRC/hash checks pass. The user reports BOTH V16 B/C still have dark/dull
skin. The corrected transfer declarations do not resolve the Edit appearance
on this scene and are not adopted. This rejects them as fixes; it does not
identify Photos' actual colour-management path or eliminate other interactions.
Portrait/Texture functioning and save/reopen persistence were not separately
reconfirmed in this reply.

A numerical illustration: an sRGB value 128/255 has linear value 0.2158605;
after BT.709 encoding it is 0.4522843. The old sRGB ICC interprets that as
0.1725033 linear, versus the matching BT.709 interpretation 0.2158605.
This supports a specific transfer-mismatch hypothesis without fitting any
Styles gain, coefficient or skin colour values. Broad colour/strength work
remains paused; production/export/deployment are unchanged. Remaining borrowed
Styles/calibration/REND still prevent a complete per-scene exporter claim.

ICC curve form and profile-ID rules were checked against the
[ICC v4 specification](https://www.color.org/icc1v42.pdf).

### 10.30 Active Styles/Texture removal control, V17 (2026-10-09)

After HDR and colour-signalling probes fail to fix the Edit transition, further
colour/roughness parameter sweeps stop. `tools/portrait-without-styles-trials.mjs`
restricts input by SHA256 to V15 C (the original profile, not rejected V16
corrected-profile variants) and freezes Portrait_WithoutStyles_V17. A is
byte-identical V15 C. B removes Styles plist 103, Texture plist 130, StyleDelta
grid 97 and its 30 tiles 67-96 (33 items). It also removes the active MakerNote
0x54 entry while preserving every other MakerNote payload, including real
64-bit TIFF tag types checked independently in Python. Old unreferenced
0x54 data bytes remain harmless; the MakerNote IFD/data-area offsets do not move.

B retains 87 items: the only changed surviving payload is EXIF 104. Main HEVC
samples/codecs/colour profile, regular and linear thumbnails, human/skin masks,
AI depth and REND remain byte-exact. Texture-only matte resources intentionally
remain to avoid confounding activation-data removal with mask removal. Style
Delta, Styles and Texture metadata are no longer active/declared. References
and associations to removed items are pruned, while original property values
remain exact. Independent Python iloc/idat and full MakerNote parsing verifies
every surviving payload and that only 0x54 disappears. ZIP CRC/hashes pass.

The user confirms V17 B no longer darkens/dulls skin in Edit, and separately
confirms BOTH aperture and Portrait Lighting still have working effects.
Thus active Styles/Texture data is implicated on this exact generated graph,
while the retained AI Portrait itself can render/edit without that darkening.
The result does not separate Styles from Texture or identify a particular field,
and it does not show pixels were baked darker: the main pixels are byte-exact.
B's lack of Styles/Texture is intentional subsystem isolation, not a
user-facing feature removal. Save/reopen persistence was not separately
reported. This is not a complete
per-scene Portrait exporter: borrowed calibration/REND still remain. No further
colour fitting, model change, production feature removal or deployment occurs.

### 10.31 Neutral StyleDeltaMap with active Styles/Texture, V18 (2026-10-09)

V17 B proves that working Portrait without active Styles/Texture avoids this
Edit darkening on the JPEG scene. The original V11-V16 active variants still
borrow the 30-tile StyleDeltaMap from 5129. Section 4.2 already records that
donor delta content makes editing follow donor scene regions. This motivates
removing that specific cross-scene correction, not another arbitrary colour fit.

`tools/portrait-neutral-delta-trials.mjs` restricts input to V15 C and freezes
Portrait_NeutralDelta_V18. A is byte-exact V15 C. B keeps active Styles/Texture
and changes ONLY StyleDelta tile payloads 67-96 plus their hvcC and the colr
association of those tiles/grid 97. The neutral recipe is the existing production
synthetic-hevc formula: 512x512 Main10, limited-range Y=504/U=512/V=512,
Display P3 primaries 12, linear transfer 8, BT.709 matrix 1. It is generated
locally by the website encoder in lossless mode, not copied from a photograph.

All 90 other payloads remain byte-exact, including main pixels/codecs/profile,
Styles plist/coefficients/light maps, Texture/roughness/masks, EXIF, depth,
thumbnails and REND. Item infos/references and unrelated associations remain
exact. Python independently checks all 120 payloads and confirms all 30 final
delta payloads equal the generated asset. Independent native FFmpeg Main10
readback matches all 393,216 input Y/U/V samples. ZIP CRC/hash checks pass.
The existing calibration decoder supports only 8-bit readback; the private
Main10 probe therefore uses independent FFmpeg instead, without production
decoder changes.

The user reports V18 B has all effects working and looks a few percent smoother
than A, but skin still remains dark/dull. Thus neutralizing only the donor
delta map does not solve the Edit darkening, despite retaining functioning
Portrait/Texture. Smoothing magnitude is subjective, not a measured metric.
Native 5129's Styles plist/calibration/REND still remain; B is not a complete
exporter. No broad
colour/strength fitting, Soft Skin changes, production or deployment occurs.

### 10.32 Existing neutral Styles plist fields on accepted Portrait graph, V19 (2026-10-09)

V18 retains functioning effects but still darkens skin. The Styles plist still
describes 5129's capture, so `tools/portrait-neutral-plist-trials.mjs` creates
the immutable Portrait_NeutralPlist_V19 batch from V18 B. A is byte-exact.
B replaces ONLY polynomial coefficients key 1 with the existing generator's
identity array. C additionally uses the existing generatedStyleMetadata neutral
values for keys 3,4,5,6,7,c,d,h,i,j: identity curve points, flat light maps,
neutral statistics and internally consistent SDR Gain=1/h=.25/range=[0,1].
The native curve's first four header bytes, schema value 131087, original key
set and all unlisted keys including k are preserved. No parameters are fitted
to the screenshots and no scene's coefficient array is transplanted.

Generated values originate in schema 14; keeping the native declaration does
not prove their semantic compatibility with schema 131087. This is a diagnostic
baseline, not a version upgrade or native-equivalent calibration. Older-photo
colour tests in sections 10.7-10.11 did not establish improvements from such
neutral values; V19 asks specifically about this depthless JPEG scene's default
viewing-to-Edit transition on its working Portrait graph, not maximum Styles
strength. Stronger or worse colour/texture remains a possible result.

Only Styles item 103 changes in B/C; all 119 other active payloads and every
item info/reference/property/association remain exact. Main pixels/profile,
Texture/Soft Skin/masks, EXIF, AI depth, REND and V18 neutral delta are untouched.
Independent Python iloc/idat and plistlib checks confirm all payloads, unchanged
keys, schema, identity coefficient layout and the intended neutral baselines.
ZIP CRC/hashes pass. Device comparison is pending; no model/roughness changes,
production defaults or deployment are made. Borrowed calibration/REND still
prevent an arbitrary-photo production exporter claim.

### 10.33 Complex original HDR JPEG with the Portrait research graph, V20 (2026-10-09)

The user corrected the new complex-scene input to
`C:/Users/WanThinnn/Downloads/IDG_20251020_121945_809.JPEG`;
IMG_0816.HEIC is an already processed output and must not be reused as original.
Independent EXIF inspection identifies Apple/iPhone 16 Pro, orientation 1,
3024x4032. This JPEG has Adaptive HDR but no Apple MakerNote 0x927c. A camera
model string therefore does not imply native editable Styles/Portrait resources.
The scene contains a seated person behind a cart/sign, a large umbrella and
several object distances, rather than the earlier close-up face.

`tools/portrait-complex-hdr-trials.mjs` freezes Portrait_ComplexHDR_V20:
A is byte-exact IDG_20251020_HDR_Fixed.HEIC, the earlier accepted HDR/Styles/
Texture export without AI depth. B is HDR + AI Portrait with active Styles/
Texture removed. C retains those features. B/C use the native 5129 research
graph but replace all 48 main tiles and 12 HDR gain tiles with raw JPEG YUV
decoded without browser ICC/HDR tone mapping. Both planes rotate CCW to stored
4032x3024 / 2016x1512 and retain the native 270-degree display transform.
The source base ICC, alternative ICC, 3-channel tmap and exact source HDR XMP
replace reference HDR. Gain samples remain numerical data. Missing source
Apple headroom/gain flags are neutralized to 1/1, not copied from 5129.

Depth Anything V2 Small runs on this scene; normalized disparity is encoded
losslessly as 768x576 with unit-range depth metadata. Both thumbnails come
from its base JPEG. The reference sky matte is replaced with an empty mask;
this is not a measured sky segmentation. StyleDelta uses the existing neutral
V18 asset. C keeps native Styles coefficients/REND/capture calibration and the
V14 Standard capture marker. Other EXIF camera/date fields remain reference
data; neither B nor C is a complete arbitrary-photo exporter.

Face detection returns state=none, faces=0 on the complex image. The subsequent
face-skin segmentation/refinement and people Texture metadata are skipped.
This is a concrete missed-face case, not evidence that the scene has no person.
Soft Skin cannot be assessed on this batch; it is not generated for C. No
production model/gating change is made from one image.

`tests/private-fixtures/package-complex-hdr-v20.py` independently parses iloc/
idat/IPMA and true TIFF MakerNotes. It decodes the original JPEG/gain JPEG and
all 60 final C HEVC tiles with native FFmpeg: all 23,592,960 YUV sample bytes
match the source exactly, including padding. All 442,368 final depth pixels
match the inferred map. Every B/C shared payload is exact except the EXIF
Styles marker removal; HDR XMP/tmap/profiles are checked against source and
the accepted baseline. ZIP CRC and content hashes pass. File sizes around
9 MB reflect lossless research encoding. Fresh import, actual aperture/lighting
effects, HDR display and viewing-to-Edit colour on iPhone remain pending.
No website changes, general Styles-strength fitting or deployment occurs.

V20 device feedback: the user confirms C has functioning aperture and Portrait
Lighting, retained HDR, and working Glow/Film. C becomes slightly darker/duller
when entering Edit. The user also confirms B, with active Styles/Texture and
the captured Styles MakerNote marker removed, becomes similarly dark/dull.
Thus active Styles/Texture alone cannot account for this complex HDR scene's
transition. Do not label it normal Apple Styles behaviour or extrapolate the
earlier SDR V17 result to this HDR input. Shared Portrait capture/REND/calibration
and the HDR rendering path remain candidates, not proven causes. The user then
confirms A also becomes dark/dull in Edit, while a fresh Photos import of the
original JPEG keeps its colour/brightness. This establishes a reported display
difference, not a proven pixel-colour corruption or a field-level cause. Later
V21 feedback below distinguishes HDR/SDR display for this Project Indigo input.
The transition is not solely introduced by AI Portrait, since A has none. B's actual
aperture/lighting effects have not yet been reported.
Soft Skin remains untested because face detection was empty. Original batches
are immutable; this feedback does not authorize adopting them as production
defaults or claim full exporter correctness.

### 10.34 Image-only HDR versus SDR Edit isolation, V21 (2026-10-09)

V20 A/B/C darken in Edit; the source JPEG does not. The next probe starts from
the accepted V20 A, not a borrowed Portrait capture graph.
`tools/hdr-edit-isolation-trials.mjs` freezes HDR_Edit_Isolation_V21 with no
encoding, inference, colour coefficient changes or pixel brightness adjustment.
A is byte-exact V20 A. B retains ONLY primary grid/48 tiles, ordinary thumbnail,
EXIF and its original HDR grid/12 tiles/tmap/XMP. It removes active Styles,
Texture, StyleDelta, linear thumbnail, all human/matte resources and metadata,
and the whole synthetic Apple MakerNote 0x927c entry. TIFF data areas remain
stationary; all other IFD entry offsets remain valid. B still has the preferred
HDR alternative group [98,1]. C removes only B's HDR items and now-unnecessary
alternative group, keeping every shared B/C payload exact, including EXIF.
C is an intentional SDR control, not a proposed HDR-preserving fix.

All surviving payloads/properties are checked by the generator. Independent
Python iloc/idat/Exif/group verification checks A's 114 items, B's 66, C's 51,
unchanged primary/thumbnail samples, exact surviving payloads except the
declared MakerNote removal, no dangling alternative group targets, and exact
B/C shared payloads. ZIP CRC/hashes pass. Since no codec data changes, the V20
source YUV verification remains applicable.
The comparison must distinguish C's potentially darker SDR appearance at VIEW
from additional darkening specifically on entering EDIT. Neither result alone
proves a field-level root cause. Production/deployment remain unchanged.

V21 device feedback: the user identifies the source as a Project Indigo capture.
B displays HDR while viewing, then becomes SDR/darker upon entering Edit; the
user attributes this brightness change to HDR no longer being displayed and
considers it normal for this Indigo image. C is stable on entering Edit. The
user prefers B's colour with no Styles applied over C's. This is subjective
device feedback; the exact viewing/Edit state of that colour preference is not
specified. B/C retain identical base pixels, ICC, ordinary thumbnail and EXIF,
so their different appearance implicates HDR rendition/display context rather
than a changed base-image payload. Do not report HDR permanently erased merely
from the Edit preview, assert universal Photos/Indigo behaviour, or compensate
the base pixels by increasing brightness on this evidence.

Use V21 B's no-Styles appearance as the user's preferred visual reference for
this scene. It has no Portrait/Styles and is not a full-feature production fix.
This feedback does not resolve the earlier SDR close-up's Styles-associated
dark/dull skin or validate native-equivalent Styles calibration. No further
colour-fitting or production changes are made from this result.


### 10.35 Opt-in Portrait release (2026-10-09)

The user explicitly accepts promoting the working Portrait/Lighting research
branch and defers colour-strength work. The AI switch alone enables the new
exporter; switch-off restores the normal result. Existing native depth is never
replaced. Normal `port`, Texture and HDR conversion algorithms are unchanged.

`ai-portrait-export.js` rebuilds the accepted capture structure using only the
completed photo's imagery, HDR/XMP/ICC, thumbnails, delta and Texture/face data.
A sanitized metadata-only template supplies numerical capture parameters,
native-compatible Styles coefficients and calibration/REND. No reference photo
payload, EXIF camera/date/GPS, capture time or UUID is published. The user's own
camera/date/GPS is preserved. Reference camera calibration is estimated, never
claimed as measured or physically correct AI depth. Source native Styles are
kept byte-exact. General arbitrary-geometry Photos compatibility remains unverified.

The user also requests a single workflow/download, tap-to-focus before saving,
and Portrait initially off. The new UI replaces the old flattened-bokeh export:
one output contains Styles + Texture + Portrait. Encoded depth is reused when
focus/preview blur changes; only focus/aperture metadata and container offsets
are rebuilt. The preview is approximate; its selected Focus region/aperture does
not establish that opaque REND refocus behavior matches every scene. A short
notice directs users to enable Portrait in Photos after saving. Image pixels are
never darkened/brightened to compensate for Apple's HDR Edit display behavior.
Colour fitting remains paused by instruction.

Release testing caught a malformed 0x54 marker in IMG_0935: the rebuilt payload
was 127 bytes but its TIFF element count still declared 115 bytes. The user
reported Photos crashing on Edit. Correcting the serialized count preserves the
complete binary-plist trailer; a private repaired file retains every non-Exif
payload byte-exact. The exporter now validates its final marker before returning
and compacts duplicate properties (387 to 41 on the reported file). Binary-plist
readers reject malformed trailers before trusting allocation counts. This fixes
the verified metadata defect; the user confirms the repaired file works in Photos.
The browser UI smoke check uses deterministic depth inference with real HEVC
encoding: one output pair, focus change without reinference, switch-off restoring
the normal file, switch-on reuse and history cleanup pass with no page errors.

The user then reports that captured Bright becomes Standard. IMG_0932 carries
0x54 values 1=-0.5, 2=0.5 and 4=16; the neutral capture template uses 0/0/1.
The earlier IMG_0935 repair fixed its count but retained that already-reset
selection. The exporter now always copies the completed input's entire valid
0x54 payload/type, independently of the native Styles coefficient route. This
retains preset and Tone/Colour pad without guessing their private semantics.
Source native Styles coefficients remain byte-exact. Focus/aperture rebuilds
retain the same selection; a corrupt input marker fails rather than silently
falling back to Standard. Freshly generated Styles still start at their own
Standard defaults. This does not change the paused colour-strength algorithm.
The private IMG_0932_Bright_PortraitFixed output reuses IMG_0935's accepted AI
depth and checks the original image/HDR/Styles/pad bytes exactly. The user
confirms this Bright-preserving output works. Browser verification uses the
same original Bright capture and checks selection after focus and toggle changes.

### 10.36 Cold startup, one output, 24 MP Portrait and newer Indigo HDR (2026-10-09)

The user reports an intermediate flat download flashing before the Portrait
result, AI failure on IMG_0945.HEIC, HDR conversion failure on
IDG_20261009_172734_866.jpg, and missing labels on a fresh Safari visit.
Both originals were supplied from iCloud Photos (2); neither was modified.

The normal result is now retained privately until the AI outcome is known.
Success publishes one Portrait output pair; failure/cancellation publishes the
normal fallback once. Existing depth still bypasses inference. Focus changes
reuse encoded depth; switching off restores the normal file. Live Photo pairing
and its still-image sharing notice remain separate from Portrait export.

IMG_0945 is a native Styles capture with primary 5712x4284 (45 tiles), delta
4096x3072 (48 tiles), and HDR 2856x2142 (15 tiles). The Portrait reference had
only 12 HDR slots, causing export to reject the completed AI result. Grids now
allocate additional item slots instead of rejecting valid larger layouts.
Regression and real browser export check every primary/delta/HDR tile payload,
its properties, selected preset marker and native Styles coefficients exactly.

The newer Indigo JPEG uses MPF plus Adobe hdrgm RDF per-channel bounds, base
ICC v2 Display P3 (ASCII desc), no alternate ICC, and headroom 3.863412.
The earlier supported input used Apple ChannelMetadata and an alternate ICC.
The JPEG reader now accepts Adobe scalar/RDF metadata, validates ranges/defaults
and base-SDR rendition, and declares the derived HDR rendition as extended linear
RGB in the base primaries. Source base ICC, gain samples, XMP and channel bounds
are preserved. ISO-only and unrecognized HDR remain explicit failures.
Indigo also repeats EXIF ColorSpace 0xa001 with identical values. Equal duplicate
fields are collapsed in appended active IFDs by comparing type, count and value
bytes; conflicting or unknown-size duplicates fail. Existing TIFF value areas
remain untouched, and next-IFD offsets use the original serialized entry count.

HTML now has complete fallback copy. A small bootstrap renders localization and
the language selector before the converter module graph loads. Service-worker
installation caches only the initial screen; complete offline assets warm after
startup with bounded concurrency. Browser isolation setup gates photo selection,
but libheif initialization no longer runs automatically during initial boot.
Online operation does not require full background offline caching to finish.

Desktop Chrome verification uses the actual two supplied originals and real
JPEG decode/HEVC encoding. Depth inference is a deterministic substitute and
Soft Skin detection is a no-face substitute for this UI/export smoke check;
this does not validate model quality or every Safari device's memory limits.
Both outputs retain their HDR/Styles graph, show one output pair with no visible
intermediate download, and pass focus/toggle/history cleanup checks without page
errors. The new Indigo normal HDR output is retained privately for device review.
A separate fresh-browser check verifies visible Vietnamese labels and language
switching before delayed converter loading, exactly one automatic isolation
reload, and enabled photo selection/AI controls after setup. Physical iPhone
HDR appearance and 24 MP Safari export still need user confirmation. Colour
strength fitting remains paused as requested.

Final local verification: 78 regression cases, 68 passed and 10 skipped because
their optional private fixtures were unavailable; no failures. PWA asset-list
and Vietnamese/English/Chinese copy checks also pass.

### 10.37 Non-native one-step Portrait overwrote completed Styles (2026-10-09)

The user confirms native iPhone 16+ depth/Styles works, but reports dark/dull
skin on older-camera Styles plus Portrait. The user then isolates a successful
workaround: generate Styles, download, re-upload and enable AI. IMG_0975 is the
Styles-only input and IMG_0976 its Photos-exported Portrait result.

Read-only inspection of iCloud Photos (3)/(4) identifies cameras iPhone 7 and
iPhone 13 Pro Max. IMG_0962 and IMG_0975 carry schema-14 generated Styles and
measured skin/person statistics. IMG_0969-1 retains the AI capture graph but
has schema 131087 reference Styles, including zero person/skin statistics,
despite carrying non-empty photo-specific masks and valid people ratios.
IMG_0963, IMG_0969 and IMG_0976 are rendered Photos exports: their active Styles
and delta are absent and the primary tiles have been re-encoded. They cannot
serve as byte-exact pre-export Styles controls or reconstruct lost resources.

The production code classified nativeStyles from the original upload, before
the Styles stage. False replaced the completed Styles with the Portrait
template's plist, retaining only keys 7,9,c,d. True (including re-uploaded
generated Styles) preserved the complete plist. Thus the direct route discarded
this photo's measured skin/scene statistics, coefficients, curve and gain/range
metadata while preserving its face masks. This is a verified code-path defect
consistent with the user's route isolation, not proof that each discarded field
individually causes Photos' skin rendering.

Portrait assembly now keeps the completed Styles payload byte-exact regardless
of its origin. The original-upload classification and template substitution are
removed. A final unconditional preservation check covers generated and captured
Styles. The entire selected preset/pad, primary/HDR/delta/thumbnails and existing
face masks remain preserved; capture calibration/REND and depth construction are
unchanged. This does not fit colour coefficients or resume the paused general
maximum-strength colour research. Regression covers generated/native schemas,
non-zero skin statistics, focus updates and direct/re-upload route parity.
Device confirmation of the combined effect after this change is still pending.

Local verification: 79 regression cases, 69 passed and 10 optional-fixture skips,
with no failures; PWA and three-language copy checks pass. The desktop browser
smoke uses real HEVC encoding with deterministic depth inference and no-face
Soft Skin inference substitutes. On real IMG_0962/IMG_0975 it verifies byte-exact
completed Styles/skin statistics, primary payloads and existing face masks after
Portrait export. Native 24 MP preset/Styles/HDR preservation and direct Indigo
JPEG conversion also pass; the direct raster Portrait Styles payload equals its
normal completed result exactly. No page errors or intermediate download flashes
occur. These checks establish data preservation, not quantitative skin appearance
or iPhone Photos controls; the user must confirm the new one-step output on-device.

### 10.38 Mirrored/rotated AI depth disagreed with Photos (2026-10-09)

The user reports correct-looking web preview but misplaced blur in Photos on
IMG_0978/0979 (older iPhone) and IMG_0982 from iPhone 16 Pro IMG_1096.
Both unblurred Styles input IMG_0977 and original IMG_1096 have ordered primary
properties irot=1 then imir=0, EXIF Orientation=5. Their canonical transform is
angle 90, mirror 1; stored sizes are 3088x2320 and 4032x3024 respectively.
The Photos exports have normalized portrait primary/depth orientation; 0978
and 0979 contain exactly the same compressed depth despite differing main pixels.
Rendered exports do not retain the completed Styles graph or original AI sidecar.

AI formerly read raw rotation/mirror values independently, interpreted mirror
0 as horizontal instead of HEIF's vertical reflection, and inverted rotation
and reflection in a different order. Preview and click-to-focus repeated that
convention, so picture/depth could appear mutually aligned while the exported
auxiliary was transformed by Photos according to the actual HEIF properties.
The mirrored quarter-turn cases are a concrete frame-alignment defect, separate
from relative-depth accuracy, REND semantics or colour strength.

AI now uses raster/heif itemOrientation(), composed in primary ipma order.
Both bitmap and libheif display pixels are mapped into stored coordinates with
the existing displayPointToStored convention. GPU preview and focus selection
use the same axes/order. Export copies rotation/mirror properties in the primary's
actual order rather than forcing rotation first. No model, depth quantization,
colour coefficients, camera calibration, REND or primary pixels are changed.
Prior outputs need regeneration: their misoriented AI depth is not repaired by
switching Portrait off/on. Device confirmation remains pending; matching web
preview geometry does not promise identical blur strength to Apple's renderer.

Verification adds 24 ordered rotation/mirror cases at the affine seam and an
export regression proving identical primary/depth transform order. Desktop Chrome
checks 12 angle/mirror combinations using asymmetric coloured pixel fixtures:
real bitmap decoding and a deterministic libheif display substitute recover
stored pixels exactly, GPU zero-blur preview matches independently arranged
display pixels within 1/255, and tap-to-focus returns the expected stored point.
This verifies frame mapping without asserting model accuracy or actual libheif
decode equivalence. The full suite passes 71 of 81 cases (10 optional-fixture
skips); PWA and language checks pass. Physical Photos blur alignment is pending.

### 10.39 Depth detail and interactive performance (2026-10-09)

The user subsequently confirms the one-step Styles/Portrait and orientation fixes
work smoothly, and authorizes higher depth resolution and UI/performance changes.
This confirmation applies to the earlier exporter and orientation fix; the new
depth refinement below still needs physical Photos quality comparison.

Depth Anything V2 Small now receives real primary-image pixels with maximum edge
1036 and dimensions rounded to its 14-pixel patch size. GPU allocation/device-loss
failures retry at 770, then 518; unsupported WebGPU and invalid model results do
not silently become a CPU estimate. Ray-tracing support is not evidence of WebGPU
allocation capacity. Saved depth/preview maximum edge rises from 768 to 1024.
The inference worker keeps float predictions through joint RGB-guided resampling
and quantizes once to the existing Apple-compatible 8-bit depth auxiliary.
Guidance reduces bleeding at an existing high-contrast depth boundary without
creating new layers from texture on a constant-depth surface. It cannot invent
hair, glass or occluded geometry that the relative-depth model did not recover.

Preview now reuses shaders, texture uploads and its GPU context instead of
compiling and destroying them for every frame. Offscreen/collapsed previews free
GPU resources while retaining a canvas snapshot. Source canvas disposal does not
reset the stored blur scale. Focus has a marker, keyboard arrows and reset.
HEIC assembly moves into its own Worker, which owns the completed source and
encoded depth until the result is removed. Changes debounce for 220 ms; range
release/reset commits immediately. Pending downloads are disabled, older replies
cannot overwrite newer settings, and focus updates skip redundant metadata reads.

Tone matching is automatic for generated Styles, with the existing decoder
fallback; native Styles remain unchanged. The only visible switch is AI Portrait,
with its hint revealed when enabled. Each result has a remove action that releases
its Worker, GPU resources, links and Live Photo pairing data. Clear history remains.
Model downloads report progress, use a separate 30-second stall timeout and verify
SHA-256 before inference. GPU phase timeouts remain two minutes and the full AI
flow is bounded at ten minutes. Model/runtime caches survive UI/SW updates using
content/dependency identities, rather than retaining duplicate model copies.

Desktop Chrome measured reused 768x576 preview updates at 0.6 ms median versus
9.8 ms with new contexts (ten samples each). For the real 1,938,864-byte IMG_1096
container, main-thread assembly took 110.1 ms median; Worker assembly took 91.9 ms
with a maximum 10 ms UI timer gap of 11.1 ms. These are local desktop observations,
not iPhone timing predictions. Real WebGPU inference on the supplied Indigo JPEG
used 770x1036 and produced 768x1024 depth in about 4 seconds, without fallback.
An end-to-end native IMG_1096 browser check uses real decode, model, HEVC and
assembly, retaining all primary/delta/HDR tiles, native Styles and selection
exactly; Soft Skin is a no-face substitute in that UI probe. Real Indigo HDR
conversion uses a deterministic depth substitute in its separate export probe.
Rapid settings/reset, OFF/ON while pending, row removal and URL revocation pass.
Fresh visits and 320/430/900 px light/dark layouts pass without missing labels or
horizontal overflow. Twelve orientation cases and post-disposal preview blur pass.

Local regression: 86 cases, 76 passed, ten unavailable optional-fixture skips,
zero failures. PWA asset-list and Vietnamese/English/Chinese checks pass.
Physical quality of the higher-resolution refined depth remains unverified.
Strong Styles colour fitting remains paused at the user's request.

### 10.40 Future format compatibility is not an iOS version downgrade (2026-10-09)

The user proposes converting future iOS 27.2/28 data to the current 27.0.1 label.
EXIF Software is descriptive identity; changing it alone does not transform HEIF
item relationships, codecs, Styles schemas, calibration or REND contracts.
Blindly changing bytes or schema flags could pair unknown semantics with an older
renderer declaration. The accepted current exporter already rebuilds an understood
Portrait graph from the photo's own resources and a tested metadata reference;
that is a specific adapter, not universal conversion of future Apple formats.

The new compatibility guard checks actual Styles contracts: 13, 14, 16 and the
accepted flag-bearing values 131087 and 131088. Unknown schemas retain their native additive
Texture path and Styles payload, while added Soft Skin and AI Portrait are skipped
with an informational message. A second guard in the pure Portrait builder
prevents callers from bypassing this check. Unknown keys inside supported Styles
remain byte-identical; the guard never forces schema/Software to an older value.
Regression adds a hypothetical schema 999 and opaque resource: transformation is
rejected without mutating the source; the same extra resource in schema 14 survives
Portrait export exactly. This verifies code behavior, not future Apple compatibility.

A newer iOS version can continue to work if its actual contract stays supported.
An unknown contract needs sanitized original fixtures and an explicit adapter,
followed by physical import/edit/Portrait/lighting/Texture/save/reopen checks.
Even a known schema cannot guarantee unchanged interpretation by a future Photos
renderer. MakerNote/calibration replacement remains limited to the current tested
Portrait adapter; this guard is not comprehensive version negotiation or a way to
defeat a future Apple restriction.

### 10.41 Live Photo still eligibility and focus UI (2026-10-09)

The reported IMG_0471 from the user's private ZIP has a Live Photo identifier
and native Styles declaration 131088. The preceding guard omitted this variant,
although the earlier accepted Bright photo IMG_0932 also used it. Live Photo
identity itself was never an AI exclusion. Add this observed contract explicitly,
without masking arbitrary future flags or rewriting the native declaration.
The opt-in AI route exports a still HEIC without requiring a MOV. Existing depth
still takes precedence. Unsupported contract info is shown once, rather than
both as Soft Skin compatibility and AI status text.

Regression verifies the declaration, complete Styles payload, selected preset
and all primary/delta/HDR tiles on the actual private IMG_0471. A Chrome mobile
integration run uses the real WebGPU depth model, real HEVC encoding and assembly
worker on this photo, with only optional Soft Skin face analysis substituted by
a no-face result to isolate the Portrait route. It produces 2,373,500 bytes,
retains the native imagery/HDR/Styles, and passes no-intermediate-output, focus,
reset, toggle restoration and row-disposal checks with no page exceptions.
These checks do not replace physical-device Photos import/edit validation.

The focus marker is now a thin yellow square with midpoint ticks, centred on the
selected focus coordinate; it is not automatic face detection. Browser geometry
and colour checks pass. Processing releases cached decoded samples in `finally`
after each serialized file; inference remains WebGPU with 1036/770/518 resource
budgets and no whole-model CPU fallback, as requested.

The Shortcuts serverless work is currently a proposal and OpenAPI contract in
`docs/`, not an implemented processing endpoint. It defines always-on Styles
and Texture with `portrait=true` opt-in, direct binary POST response, native
preservation and explicit processing failures. A GPU container backend requires
native codec/inference adapters and parity testing; no cloud deployment or paid
resources have been created.

### 10.42 Compact Portrait editor and aperture ruler (2026-10-09)

Replace the preview disclosure heading with a compact Portrait toolbar, a
44-pixel circular reset button at the upper right, and a short focus hint.
Pending metadata updates use an accessible indeterminate spinner instead of
visible updating text; failures remain visible beside the controls. The spinner
pauses offscreen and respects reduced motion. Export still waits for the latest
settings and uses the same single output actions.

The native range remains responsible for touch, keyboard and assistive technology.
A decorative 41-tick ruler shows a yellow selected position and a local wave while
dragging or using adjustment keys. Only tick transforms transition, for 140 ms;
reduced motion removes the transition. There is no continuous animation loop.
The ƒ readout uses exactly the existing exported aperture mapping, with finer
0.1 blur steps and localized decimals. Reset restores centre focus and ƒ 4.5.
This is a relative preview control, not a newly calibrated physical lens model.

Browser checks pass at 320/430/900 widths in light/dark mode for vi/en/zh:
18 layouts, native pointer drag and wave, range/readout/reset agreement, progress
without layout shift, accessible reset and explicit failure feedback. Twelve
rotation/mirror checks retain correct focus mapping. Targeted lifecycle,
language and Portrait export regressions pass 28/28, including native imagery,
HDR and Styles preservation. Real WebGPU and HEVC integration on IMG_0471 also
passes. Chrome automation does not replace a physical Safari interaction check.

The follow-up progress design uses the same 44-pixel circular frame as reset,
with a continuous rounded arc and a faint full-ring track inspired by the user's
Camera reference. Rotation is linear instead of a stepped spoke animation;
offscreen suspension, reduced motion and accessible status text are retained.

### 10.43 Cleanup, folder layout, attribution and Safari input budget (2026-10-09)

The maintained source is grouped into core, styles, codecs, media, ui and portrait,
alongside the existing raster, dng and vision folders. Import/export paths,
module-relative worker/model URLs, bootstrap, the offline shell, diagnostic tools,
artifact builder and tests follow the new layout. A portable module-path check
now gates CI and Pages publishing. Twenty-one superseded standalone Portrait
A/B generators and two unused baked-bokeh/depth-only exporters were removed;
historical experiment references in this document refer to earlier Git commits.
Maintained audit/build tools, regression tests, private originals and reference
checkouts are retained. Disposable root/tools Python bytecode was deleted.

README credits Elio (aka WanThinnn) as fork maintainer and nathanatgit as upstream
author. Root LICENSE retains the original MIT copyright and permission text.
The original notice is distributed and cached as web/LICENSE.txt, with an added
maintainer credit; the artifact builder also includes the original notice in
generated bundles. PWA validation allows the maintainer credit but checks the
remaining license text against the root. Bundled Depth Anything/ORT licenses remain unchanged.
Browser capability descriptions now distinguish current editable Portrait and
JPEG HDR support from the unchanged upstream CLI's capabilities.

The user reports Safari reloading during GPU inference. The former 1036-first
retry sequence cannot recover if WebKit terminates the process before JavaScript
gets an error. Safari and iOS therefore start at 518; other browsers keep the
1036/770/518 sequence. This is a precaution for suspected memory pressure, not a
confirmed crash diagnosis from a device log or a whole-model CPU fallback.
Primary-image colour guidance and saved depth remain at maximum edge 1024.
The input tensor is disposed after inference and on failure.

Local regression passes 79/89 with ten missing optional-fixture skips. A Chrome
integration run with Safari's user-agent profile executes the real WebGPU model
at at most 518, real HEVC encoding and worker assembly on IMG_0471. It produces
2,355,680 bytes and retains all primary/delta/HDR tiles and the selected Styles.
No intermediate download, rapid settings/reset, off/on restoration and row disposal
checks pass with no page exceptions. This checks the new budget and paths, not
the native Safari driver; physical Safari reload behavior still needs user testing.

### 10.44 Moderate Safari GPU detail increase (2026-10-10)

At the user's request, Safari/iOS inference now starts at maximum edge 630,
with a GPU retry at 518 only on caught resource errors. Other browsers retain
1036/770/518. The geometry validator accepts the new multiple-of-14 budget;
primary-image guidance and saved depth still use maximum edge 1024. A process
reload cannot execute this fallback, and native Safari stability remains unverified.

Twenty-five targeted depth/export/import-path regressions pass. The real WebGPU
integration probe on Chrome with Safari's user-agent starts at 630 and exports
2,356,093 bytes on IMG_0471, preserving every primary/delta/HDR tile and the
selected Styles. No intermediate download or page exceptions occur, and rapid
settings/reset, toggle restoration and row disposal checks pass. This verifies
the higher inference budget and export path, not an iPhone's memory tolerance.
PWA validation passes; the shell cache advances to v83 without invalidating models.

### 10.45 Edited HEIC without thumbnail and AI failure diagnostics (2026-10-10)

The user subsequently confirms 630 can run and identifies the failure as
"Adding Portrait" on IMG_1015.HEIC, an older-phone image edited previously.
The exact file has primary 49, Styles 84, delta grid 83 and linear thumbnail 52,
but no ordinary thumbnail. The former exporter rejected that graph before
assembly. The ordinary thumbnail is now optional: if absent, its unused reference
item is removed rather than copying an unrelated image or substituting the
linear thumbnail. Styles, primary tiles, delta tiles and the source preset stay
byte-exact. Missing Styles/delta/linear-thumbnail requirements remain enforced.

The real WebGPU browser probe on Chrome with Safari UA processes this file at
630, encodes depth and exports 2,551,808 bytes with no page exceptions. Its own
primary/delta data and selected Styles are exact; the source has no HDR map.
Rapid settings/reset, off/on restoration, row disposal and one final output pass.
Portable no-thumbnail and optional private-file regressions cover the failure;
31 targeted tests pass. PWA and language checks pass. Photos editing on the user's
device is still the final validation of aperture/lighting for this new layout.

Runtime/WASM failures may be thrown as numbers/strings. Worker error envelopes
now preserve a nonempty message and step instead of becoming an undefined depth
result. Caught inference failures can retry at the next smaller GPU input;
cancellation, timeout, download/integrity failures and unavailable WebGPU are not
retried this way. A browser integration probe injects code 17 at 630, verifies a
real model run at 518, and retains native primary/delta/HDR/preset bytes. This is
separate from the IMG_1015 assembly defect; it is not proof of that defect's cause.
Final AI failures add the step and a bounded diagnostic to Details. Completed
conversion encoder workers and decode samples are released before GPU inference
to reduce simultaneous memory use. Safari's budget remains 630/518; v84 updates
the shell while keeping model caches. Process termination still bypasses fallback.

### 10.46 iPhone edge-to-edge page background (2026-10-10)

The user's Home Screen app screenshot shows a separate light status-bar strip,
with the same problem in dark mode. HTML already has viewport-fit=cover but used
the default Apple status-bar style. It now requests black-translucent, following
Apple's standalone web-app configuration, so the background can extend beneath
the status bar. The page gradient lives on the root canvas rather than only the
body. Light/dark browser theme colors and the manifest's light launch color now
match the CSS base colors. Body content padding adds top/bottom safe areas to
the ordinary spacing and respects side cutouts in landscape. OS status icons
remain visible; this does not force Safari's browser chrome into fullscreen.

A private Chrome layout probe substitutes safe-area environment values because
the installed CDP does not support setSafeAreaInsets. Light and dark layouts at
430 portrait, 932 landscape and 320 compact widths keep the root gradient,
respect all four insets and have no horizontal overflow. Screenshots were
visually inspected. This verifies CSS layout, not native iOS status-bar rendering;
Home Screen relaunch on the user's device remains the final check. PWA validation
passes and the shell cache advances to v85, without changing depth's 630/518 policy.

### 10.47 Live Photo ZIP follows the final web output (2026-10-10)

Pair export formerly captured the initial Styles byte array and stopped updating
after its first ZIP. It now follows the same File as the HEIC download, including
Portrait focus/aperture changes, toggle-off fallback and toggle-on restoration.
A MOV selected later pairs with the current output. Revision guards discard old
asynchronous file reads and errors; disposing a row invalidates pending exports.
The current output clears/revokes the previous ZIP URL along with the still URL,
and a newly generated ZIP respects the output's existing pending-download state.

Testing with the private IMG_0471 HEIC also exposed a missing pairing identifier:
the Portrait MakerNote replacement dropped source tag 0x11. The assembler now
retains that source byte/string tag in its rebuilt table and never imports a Live
Photo identity from the reference template. Portable tests cover final ZIP bytes,
unchanged MOV bytes, late MOV, toggle/focus changes, stale reads, removal, failed
identity checks and Portrait identifier preservation. This does not change movie
frames or add a browser-to-PhotoKit importer; Photos still receives a still image
through the normal web share action.

A private browser probe used IMG_0471, deterministic substitute inference, a
real HEVC encoder/Portrait assembler and a synthetic MOV metadata container.
It verified that late MOV selection and each focus/reset/toggle update package
the exact current HEIC and unchanged MOV bytes, preserving the source pairing
identifier. It also checked removal and URL disposal. This does not validate
motion playback or native Photos import of an AI-edited Live Photo pair.

### 10.48 First-use iOS picker format reminder (2026-10-10)

iPhone/iPad users see a compact reminder below the upload area showing the
native picker path: Select photos → ••• → Options → Format → Current. Explicit
Got it dismissal is stored locally; desktop users do not see this notice. The
longer Help instructions remain available. The early page bootstrap renders
the reminder before converter loading and tolerates blocked local storage.
Vietnamese, English and Chinese copy is included, with an English HTML fallback.
A private browser layout check passed at 320/430 widths in light/dark modes,
including translated copy, dismissal/reload persistence, desktop hiding and
iPad detection with blocked storage. No horizontal overflow was observed.
The web cannot select the native picker format for the user. Shell cache v87
ships this notice and the current-output Live Photo ZIP fix.

### 10.49 Compact picker hint and native Portrait capture follow-up (2026-10-10)

The first-use picker hint now uses an unboxed inline row with its acknowledgement
beside the copy, keeping a 44px touch target. Stop AI gains 6px top spacing. Native
language-select tap highlighting and its inner rectangle are removed; keyboard
focus remains visible around the surrounding pill. A private mobile browser
probe checks light/dark, 320/430 widths, all three languages, pointer versus
keyboard focus, dismissal persistence and the cancellation spacing. Shell v88.

Private capture pairs identified by matching primary payloads: IMG_5204 (iPhone
13 Pro Max) → IMG_1029, IMG_1031 → IMG_1032 and IMG_1031-1 → IMG_1033 (iPhone 16
Pro). Depth payload hashes also match each pair. Both 1031 sources lack native
Styles, delta map, linear thumbnail and HDR before conversion; their depth XMP
contains disparity ranges but no RenderingParameters, SimulatedAperture or
Portrait Lighting parameters. Capture type remains 10/11 through processing,
whereas the independently verified complete 5129 resource has type 12 and MiPr.
These correlations are not established requirements or a validated fix.

The user initially reported originals remained editable after re-import, then
corrected IMG_5204: export to Files and re-import already removes Portrait edits
without the tool. That case therefore cannot be described as the converter
dropping native editing resources. IMG_1031-1's fresh-import state still needs
separate confirmation. Private NativePortrait_On_V1 trials isolate adding MiPr
(A), then capture classification 12 (B), then the tested reference rendering
parameters/aperture/lighting and flag 0x1f=1 (C). All retain exact photographic,
depth, Styles, Texture and source property/reference data. C borrows rendering
parameters for diagnosis; none of these changes is shipped pending actual
Photos editing/effect validation. Original photos remain untouched.

Apple documents downloading Unmodified Originals from iCloud.com separately
from Highest Resolution / Most Compatible: https://support.apple.com/en-sg/111762.
Its archive guide also describes Export Unmodified Original from Photos:
https://support.apple.com/en-us/108306. Current selects a picker format; it is
not a guarantee of an unmodified capture or complete Portrait edit resources.

### 10.50 Native depth on the accepted capture graph, V2 (2026-10-10)

Device feedback for NativePortrait_On_V1: every tested variant offers a Portrait
viewing icon, but Edit still offers Styles only, with no aperture control. Adding
MiPr, classification/enable flags and rendering parameters to the old graph is
therefore insufficient for those tests. No V1 metadata changes were deployed.

The private native-portrait-rebuild-trials.mjs now freezes
NativePortrait_Rebuild_V2 for IMG_1029 (iPhone 13) and IMG_1033 (iPhone 16).
The script detaches only the old depth item and its dedicated sidecar from an
assembly input, then runs the actual production buildAiPortrait with the exact
native compressed depth and codec. This uses the already device-tested capture
graph and complete MakerNote rather than retaining the old capture structure.
It adds no duplicate depth auxiliary and performs no inference or re-encoding.

A_WorkingCapture uses that accepted capture's depth metadata as a diagnostic
control; its range/calibration are reference values, so blur accuracy is not
established. B_NativeDepthMetadata retains the source depth property boxes,
orientation, quantization ranges and available calibration XMP, adding only the
reference rendering parameters, aperture and lighting fields. Both use the
existing exporter's reference MakerNote/renderer data. All primary/HDR/delta
tiles, Styles selection and plist, Texture and remaining input resources are
asserted byte-identical/present. Reference photographic payloads are never used.
The originals remain untouched. Subsequent device feedback confirms A for both
samples has working aperture and lighting adjustments; B still shows the viewing
icon but no aperture in Edit. A's original IMG_1033 selection was Standard because
the earlier Styles stage had already overwritten the original Bright marker.

### 10.51 Fixed web aperture stops and accepted native Portrait repair (2026-10-10)

The web ruler now uses exactly 23 positions: f/1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8,
3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0, 10, 11, 13, 14, 16 and Off.
Labels retain their decimal suffixes and numeric settings export the exact stop.
Reset restores f/4.5. Off draws an unblurred preview; it retains editable depth
and writes f/16 rather than an invalid zero/null aperture. Saved Portrait starts
off at all stops. The existing preview calibration and native range interaction,
wave, debounce/latest-output guards and reduced-motion behavior are retained.

restoreNativePortrait uses the accepted V2 A adapter only for legacy capture type
10 or type 11 with Portrait enabled, with one 8-bit hvc1 depth and its dedicated
sidecar, and missing rendering parameters. It detaches that depth for assembly,
then reuses its exact compressed payload with buildAiPortrait. Complete and
next-generation Portrait-off graphs are unchanged. The Styles worker applies it
when adding a missing Styles graph; it does not run AI or re-encode camera depth.
Reference calibration/REND remain compatibility estimates, not native calibration.

Original IMG_1031-1 has a six-key MakerNote 0x54 selection: Bright (key 4 = 16),
Tone -0.5 and Colour 0.5. IMG_1033 and V2 A/B inherited the earlier generated
Standard marker. patch now carries an existing valid selection into its new
Styles graph without mutating the cached profile. The production native adapter
matches both accepted V2 A files byte-for-byte. Portable regression tests cover
legacy/on restoration, untouched off/unknown graphs, no duplicate repair, exact
depth/primary/Styles retention and six-key Bright preservation. Private checks
exercise the real worker job and originals; private photographs are not published.

### 10.52 ISO-only HDR discovery and native Portrait V4 device result (2026-10-10)

Correction to section 10.49: the IMG_1031 Portrait source exports do contain HDR.
Their ISO tmap references the base image and a 12-tile gain map, without the older
Apple hdrgainmap auxiliary label. The previous discovery code only recognized that
label and incorrectly reported no HDR. Both HEIF readers now recognize an unambiguous
tmap dependency pair; explicit auxiliary labels retain precedence. Ambiguous or
unrelated graphs do not become HDR. Original tiles and tmap parameters are retained.

The current private iCloud Photos (5) copies were paired by exact primary payloads:
IMG_1051 matches IMG_1031-1 and IMG_1052 matches IMG_1031, regardless of the user's
filename description. Both source exports lack the full Styles auxiliary graph;
their original Bright selection is still present. Recreating that graph is distinct
from preserving a complete native Styles calibration.

NativePortrait_Bright_HDR_V4 variants A/B/C complete selected marker fields;
D only registers the existing gain map with the older Apple auxC role and auxl
reference, while E combines A and D. The user reports all variants have working
Styles, aperture and Portrait Lighting; D/E also have HDR. All retain Bright and
all still have stronger colour. D therefore supplies the confirmed HDR compatibility
fix without changing the original selection fields or claiming to correct colour.
The production helper matches D byte for byte on IMG_1052. It is additive,
idempotent, guarded by the supported Styles contract and never replaces another
declared auxiliary role. It runs after Styles patch/Texture repair, before export.

The user recalls that Styles-first download/re-upload followed by AI Portrait
previously avoided stronger colour. The existing AI assembler still preserves
completed Styles and per-person statistics exactly; its one-step/re-upload
regression passes. A private comparison using both current native Portrait source
graphs and deterministic substitute face data also finds identical Styles and
all payload bytes whether native restoration precedes or follows Soft Skin.
Changing stage order is not supported as a colour fix by this evidence. This
comparison is not a physical-device render test or real face inference.

The misleading missing-Styles message no longer states that HDR or aperture
editing cannot be preserved. The web still warns when original Styles editing
data is absent, and asks users to check colours and Portrait editing. All 102
workflow regression cases complete with 92 passes, 10 optional private-fixture
skips and no failures; PWA and three-language consistency checks pass. Shell v90.

### 10.53 Native Portrait enable flag is not an editing-completeness test (2026-10-10)

The user reports a new iPhone 16 Pro capture made in Camera's Portrait mode:
IMG_1079 is the input and IMG_1080 its web output in private iCloud Photos (6).
The output shows Portrait while viewing but has no aperture control in Edit;
Bright is retained and the Style colour remains stronger. Both files have
capture type 11, enable flag 0 and the same 576x768 camera depth. Neither has
standalone depth RenderingParameters or the renderer MakerNote blob. The output
has a reconstructed schema-14 Styles graph, while the input lacks that graph.
Its HDR gain map is recognized by the corrected readers. The user-visible
capture mode cannot be inferred from this exported enable flag alone.

The prior repair skipped type-11/flag-0 exports as already working. The local
adapter now accepts both known enable values for types 10/11 when supported
Styles and a single supported camera depth/sidecar exist. Complete rendering
graphs, unknown classifications/flags/Styles and unsupported depth streams stay
unchanged. Existing-Styles and Texture repair jobs use the same native adapter
as first-use Styles jobs, so re-upload does not skip an incomplete editor graph.

Private NativePortrait_1079_V5/A_1080_NativePortraitRebuilt starts from IMG_1080
and retains exact Bright selection, Styles, Texture/people, primary/delta/HDR
payloads and original camera depth. It uses the previously accepted capture
adapter, without inference or re-encoding. B is IMG_1080 unchanged. The production
worker's repair-Texture route matches A byte for byte. All 103 workflow cases
complete with 93 passes, 10 optional fixture skips and no failures; PWA/i18n
checks pass. This local change is awaiting physical Photos aperture/lighting
validation and is not yet deployed. Colour correction remains separate.

### 10.54 Preserve native captures; reject double-blur reconstruction (2026-10-10)

The user rejects V5 A as a correct repair: HDR and aperture controls are present,
but Off still shows the old blur and aperture changes add another blur layer.
Direct FFmpeg decoding of IMG_1079 shows that blur in the primary image itself.
Its container has only one RGB image, native depth and the HDR map; every byte of
mdat is referenced, with no hidden sharp image. Native enable flags cannot prove
that the source base is sharp. The production worker no longer automatically
calls the reference-capture adapter. That adapter is diagnostic only and returns
null unless a caller explicitly confirms an unblurred base.

User policy: native Portrait already on keeps its image, depth, metadata and
viewing icon without trying to reconstruct aperture controls. Older inputs get
Styles/Texture; iPhone 16+ gets Texture only. Existing working editing resources
are retained, including the reported iPhone 13 Pro Max Portrait-off result.
The newer-iPhone path now also covers exports missing their native Styles graph;
it never recreates colour coefficients or modifies an existing Styles plist.
Legacy tone-curve repair is disabled on this path. Complete native selection,
HDR, depth and photographic payloads are byte-preserved, not normalized to a
camera preset or software version.

Private native-policy audits and browser processing of IMG_1092 verify all
original external payloads, Styles, Exif, primary tiles and HDR are unchanged.
IMG_1094 is already the processed/Photos-exported edited result, not the edited
input before processing; retaining it does not undo colour baked in earlier.
The source IMG_6246 and reported result IMG_1099 retain camera depth and a real
HDR gain map. Missing Styles auxiliary data in a later Photos export must not be
confused with whether the asset in the user's library offers editing controls.

IMG_1472.JPEG and IMG_6565.HEIC (iPhone X) have source HDR headroom metadata but no
HDR gain map. IMG_6565 has one 8-bit Display P3 RGB grid plus Exif. The reported
IMG_1086 still has no gain map; it retains headroom 63809/37837 but has acquired
a neutral HDRGain tag absent in the source. AI assembly now retains absence as
well as valid values of source headroom/HDRGain rather than inventing a newer
gain-map contract. This is a metadata correction, not a verified recovery of
legacy Photos HDR display. No fake gain map is generated. Private V6 browser
variants isolate Styles alone and Styles plus Portrait for physical testing.

Google Photos IMG_0840 is an already blurred RGB image with HDR, without depth
in the exported file. IMG_1087 also has a rendered blur in its RGB base and a
1024-square relative disparity map, but no standalone Styles editing graph in
that supplied export. These are visual references, not a matched comparison of
two unblurred inputs and two editable depth maps. The existing map identifies
the person; shoulder/collar depth transitions still need improvement.

RGB guided refinement is added after inference releases GPU resources. Its
coefficient grid is bounded to 256 pixels per edge, evaluated against full RGB,
limited to transition regions, the local depth envelope and a maximum 24/255
correction. Constant surfaces remain constant despite RGB texture. A synthetic
ramp/known colour boundary test shows lower boundary leakage; refinement of the
supplied 1024 map takes about 184 ms on the desktop, with mean absolute change
0.972/255. These are not Safari timings or proof of Google Photos parity. No
new model, CPU depth fallback or higher Safari inference budget is introduced.

All 106 selected workflow cases complete: 96 passes, 10 optional private-fixture
skips, no failures. PWA and 121-string three-language consistency checks pass.
The real browser route also completes GPU depth inference and HEIC assembly on
IMG_6565 (about 22.1 seconds total on this desktop); original primary compressed
tiles are unchanged. The native IMG_1092 route completes without replacing its
camera depth, with exact source Styles and Exif preserved. Soft Skin was mocked
as no-face in this isolated browser probe. No Safari or Photos rendering claim
is inferred from these desktop results. Shell v91.

### 10.55 Native editing regressions after the preservation policy (shell v92)

The user supplied IMG_1119/1120 and processed IMG_1121/1122 in
D:/Downloads/16pro/iCloud Photos. Both inputs already lack the Styles URI,
linear thumbnail and delta map, despite retaining Bright and pad coordinates.
Adding Texture alone does not restore Styles; the v91 native status incorrectly
implied that it did. The default incomplete-native route now preserves the
input without advertising an incomplete Texture renderer. Experimental Styles
reconstruction is explicit, retains the selected preset/pad, and warns that
missing original colour calibration can still change Photos rendering.
IMG_1119 is returned byte-identically. IMG_1120 receives only an additive HDR
role/reference for its own unambiguous ISO gain map; all payloads are identical.
Registration no longer unnecessarily depends on a Styles plist being present.

The blanket removal of native reconstruction also regressed the previously
accepted iPhone 13 Pro Max case. IMG_6246 decodes to a sharp base and uses the
legacy Photo capture class with camera depth. That contract again receives the
accepted renderer after Styles processing, without AI or re-encoding depth.
Other incomplete captures require explicit confirmation that Portrait was
turned off in Photos and the uploaded image is sharp. A compact notice appears
above output actions; an unknown state is never represented as certainly On.
Complete native renderers and Styles stay on the additive preservation route.

ExifTool's Apple.pm identifies 0x1f as PhotosAppFeatureFlags, not Portrait
On/Off; 0x14 is ImageCaptureType (2 Portrait, 10 Photo, 11 Manual Focus, 12 Scene).
The former is no longer interpreted as an enable state. These private fields
alone cannot establish whether edited RGB contains baked blur. The adapter
supports understood capture layouts with a confirmed sharp base, while default
diagnostic calls still do not rebuild arbitrary captures.
Source: https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/Apple.pm

107 selected tests complete: 97 passes, ten optional-fixture skips, no failures.
PWA validation passes. The browser probe covers both 16 Pro pairs, complete
IMG_1092, already processed IMG_1094, and automatic legacy IMG_6246 restoration.
It verifies exact original compressed primary/HDR/depth data and selected Style
parameters. The reconstructed 13 Pro file contains rendering parameters and
Styles, but the updated result still needs physical Photos effect validation.
Soft Skin is mocked as no-face only in the experimental reconstruction probe.
Private V7 comparison files are not published or committed.

### 10.56 Device feedback: preserved Bright versus restored editor (shell v93)

The user confirms the 13 Pro Portrait-Off path works again. On the supplied
16 Pro samples, saving the unchanged/default result keeps Bright in photo info,
but the imported copy has no Styles/ƒ editor. Explicit Styles reconstruction
allows Styles, and confirmed Portrait Off also allows ƒ/lighting, but the colour
still deepens in Edit. This is not evidence that the preserved preset changed
to Standard, nor evidence that turning Portrait off restores missing Styles data.

The missing-graph reconstruction previously classified these native sources as
non-native for automatic Soft Skin, allowing generated person/skin statistics
to rewrite the new Styles plist. Both the caller and the worker installer now
protect native iPhone 16+ sources independent of whether the source Styles URI
exists. Texture masks/people may still be supplemented; source selection, RGB,
HDR and the pre-supplementation Styles plist remain unchanged. A regression
simulates missing editing resources and a misclassified caller, and verifies
that older generated Styles still receive their measured statistics.

Actual browser/model processing of IMG_1119/IMG_1120 reported no suitable face
for either image. Their guarded outputs are byte-identical to the corresponding
V7 reconstructions. Therefore this guard DOES NOT resolve the observed darkening
on those examples, and these duplicate files should not be presented as a new
colour test. The default incomplete result now visibly explains that saving it
does not restore Styles/ƒ, and that reconstruction can still deepen colour even
after Portrait Off. Native Styles coefficients in complete Bright captures
IMG_0932 and IMG_1092 differ in 49,590 of 51,840 bytes; a universal replacement
cannot be inferred from matching presets. No unrelated native calibration is
copied, selection values are not neutralized, and no colour fix is claimed.


### 10.57 AI Detail HDR rebase experiment (feature/ai-ml-processing, 2026-10-11)

The opt-in AI Detail preprocessing path now has an HDR-aware implementation instead
of sharpening an SDR primary while leaving its gain map stale. For compatible ISO
21496-1 gain maps the browser parses the existing tmap headroom, per-channel
GainMapMin/GainMapMax, Gamma and SDR/HDR offsets. It reconstructs the original HDR
alternate in linear light, transfers the AI restoration's per-channel linear detail
delta to that alternate, then solves and quantizes a replacement gain map against
the restored SDR/primary image. Existing tmap metadata is kept byte-exact. If more
than 2% of gain components would exceed the declared min/max range, the AI path
fails closed and the original image is retained.

JPEG Adaptive HDR now uses this rebase before the existing generated HEIC/Styles
assembly. Native HEIC HDR has a separate browser path that decodes the photo's own
primary and gain-map grids, supports both RGB 4:2:0 gain maps and Apple's common
monochrome HEVC gain maps, runs the selected Lite/Standard/Pro restoration model,
re-encodes the primary/gain grids, regenerates the normal and linear thumbnails,
and repacks only changed external payloads. Primary codec colour/range signalling
is required to be explicit and is preserved; unsupported colour/tmap contracts
fall back to the original HEIC. Monochrome gain maps preserve decoded gray samples
and full/limited range; their primaries/transfer/matrix VUI may be absent after
x265 because those tags do not affect gray numerical gain samples.

Two real-browser Edge/WebGPU + FFmpeg.wasm end-to-end probes passed with the Lite
SPAN model. HDR_Edit_Isolation_V21/A_V20_Control_AllFeatures_NoAIDepth (3024x4032,
RGB P3/sRGB gain map) completed in ~36.4 s: 48 primary + 12 gain tiles and two
thumbnail resources changed, 49 unrelated external payloads remained byte-exact,
21 of 9,144,576 gain components clipped to the existing declared range. The
native Portrait 5129 Styles+Texture fixture (4032x3024 primary, monochrome Apple
gain map) completed in ~45.2 s: the same 62 image resources changed, 63 unrelated
payloads including Styles/Exif/depth remained byte-exact, 663 of 9,144,576 gain
components clipped, and maximum measured quantized linear-HDR solve error was
~0.00362 in the probe. The output remains 48 primary + 12 HDR tiles with the
original tmap values.

A private phone-test artifact is written to
tests/private-fixtures/AI_Detail_HDR_V1/IMG_5129_Lite_AI_HDR.HEIC. It is not
published or committed. Desktop structural tests do NOT establish Apple Photos
rendering/editability. The file still requires physical iPhone import, HDR display,
Styles/Texture, aperture and Portrait Lighting checks, including Save -> reopen ->
re-edit. Current full-resolution AI preprocessing is intentionally bounded to
12.5 megapixels to avoid unsafe mobile memory peaks; larger native HDR photos fail
closed until a streaming/tiled full-image implementation is validated.

The selected browser regression set completes 140 cases: 125 passes, 15 optional
private-fixture skips, no failures. PWA, module-path and three-language checks pass.


### 10.58 AI Detail inference concurrency and progress optimization (2026-10-11)

Performance profiling on the local Windows laptop showed that 256px tile count was
not the only bottleneck. ONNX Runtime WebGPU does not allow concurrent
`InferenceSession.run()` calls from multiple sessions in one JS realm (it throws
"Session already started"), so true concurrent inference requires separate
DedicatedWorker realms, each with its own ORT session. The production detail path
now uses a SharedArrayBuffer-backed global input/output image and assigns disjoint
global tile indices to workers. Tile cores do not overlap, so workers write
separate output regions and no band seam/stitching approximation is introduced.

Measured policy:
- Lite / SPAN: 384px tiles, up to 2 WebGPU workers.
- Standard / RT-Focuser 2025: 512px tiles, 32px overlap, 25% output blend,
  up to 4 WebGPU workers.
- Pro / Fatality DeBlur: 256px tiles, exactly 1 WebGPU worker; two workers were
  slower in the measured workload.
- Desktop auto-scaling: <8 logical CPUs = 1 worker; 8-11 = at most 2 workers;
  >=12 = at most 4 workers, still capped by the per-model value above.
- WASM/CPU remains one inference worker but ORT may use up to 4 WASM threads on
  cross-origin-isolated pages, avoiding nested worker oversubscription.

Historical direct WebGPU measurements for the former RPLKSR-S Standard were
256/384/512 = 2394/5659/9668 ms. After replacing Standard with RT-Focuser 2025,
the same browser measured about 156/217/325 ms at 256/384/512 after warmup,
which makes 512px tiles practical. Lite remained about 78/117/258 ms.

The former RPLKSR-S 768x768 Standard path measured 82.6 s with one worker and
26.1 s with four. The RT-Focuser Standard browser smoke now measures about
12.1 s on the first 4-worker pass and 7.6 s on a second pass with retained
sessions. Four remains the desktop cap; session workers are retained briefly
and released after 90 seconds or explicit cache/history cleanup.
An earlier worker-isolation benchmark also measured Pro at ~21.4 s with one worker
versus ~24.9 s with two, confirming the single-worker Pro policy.

On the real 3024x4032 Adaptive HDR JPEG
`tests/private-fixtures/HDR_Input/IDG_20251020_121945_809.JPEG`, the Lite
end-to-end browser/WebGPU/FFmpeg.wasm path dropped from ~57.3 s before this change
to ~31.4 s after 384px + two-worker inference, about a 45% wall-time reduction.
HDR remained enabled; 48 primary + 12 gain tiles and the original tmap
(headroom 0 -> 3.83289) were preserved structurally. Gain-map rebasing remained
21 clipped components out of 9,144,576 with the same measured maximum solve error.

AI Detail/HDR progress shown in the UI now uses percentages instead of raw
`done/total` counters for inference, primary/raster tile encoding, auxiliary HDR
gain-map encoding, and native HDR decode/encode phases. Service-worker shell cache
is v107.

The selected browser regression set now completes 142 cases: 127 passes,
15 optional private-fixture skips, no failures. PWA, module-path and three-language
checks pass.


### 10.59 Film final-render red-highlight overflow mitigation (2026-10-11; superseded by §10.61)

Upstream issue #8 reports that iOS 27 Photos previews the Film texture normally
but, after tapping Done, the saved/final render can produce severe red highlight
halation. The same behavior was reported from the Swift port, which shares the
same Texture metadata contract, so this is treated as a renderer-metadata
compatibility issue rather than a browser-only pixel bug.

A repository scan of 241 private HEIC fixtures containing
`texture_styles` found two renderer profiles in historical/generated outputs:
182 with `HardwareModel=iPhone19,2` and 59 with `iPhone19,7`. The raster
Texture baseline already declared `iPhone19,7`, but its production add-texture
path immediately overwrote that field back to `iPhone19,2`; the native-style
web path and Python path also wrote `iPhone19,2`.

New outputs now consistently use `iPhone19,7` in `texture_styles`:
- `web/src/styles/texture.js`: baseline blob and per-photo rebuilt header.
- `web/src/raster/texture.js`: the old forced `iPhone19,2` override is removed.
- `photographic_style_port.py`: baseline blob and header are kept in parity.

This is a compatibility mitigation for issue #8, not proof that iOS' final
renderer bug is fully characterized. `iPhone16,1` remains rejected because
earlier phone testing produced a separate white-highlight glow. Existing native
photos are never auto-migrated solely because they contain `iPhone19,2`, since
that value also occurs in genuine native Texture metadata. Existing app-generated
files should be regenerated to receive the new renderer profile.

Regression tests parse both web Texture baselines and an actual raster
add-texture output and require `HardwareModel=iPhone19,7`; the Python plist
test requires the same value. Service-worker shell cache is v110.


### 10.60 Device feedback: iPhone19,7 experiment (2026-10-11; rejected in §10.61)

Device testing of the `iPhone19,7` Texture renderer mitigation reports that
Film's red highlight halation is visibly lighter than before, but the user cannot
yet confirm whether that lighter amount matches a native iPhone 18 Pro capture.
More importantly, Photos preview becomes non-monotonic near maximum strength:
the red halation is still visible around 97 but disappears again by 100. This
means `iPhone19,7` is only a symptom-reducing compatibility mitigation, not a
validated native-equivalent fix.

Existing project evidence already shows native iPhone 16/17 Texture/Styles files
using `iPhone19,2` do not reproduce the reconstructed-photo maximum-strength
red/orange problem. Therefore `HardwareModel` alone cannot explain the bug; it
interacts with reconstructed Styles/render resources or selects a different
renderer response curve.

Production remains temporarily on `iPhone19,7` while a strict same-file A/B/C
probe is tested. `tools/film-halation-variants.mjs` creates three variants from
the reconstructed `IMG_0783_Web_Default_D.HEIC`, changing only the
`texture_styles` HardwareModel payload:
A = `iPhone19,2`, B = `iPhone19,7`, C = field removed. The HEIC rebuild
self-check preserves every other original external payload byte-exact. Outputs
are under `tests/private-fixtures/Film_Halation_V1/`; device comparison should
check Film preview at 90/94/97/98/99/100 and the saved result after Done.


### 10.61 iPhone19,7 rejected; native renderer profile restored; Bright preservation control (2026-10-11)

Device A/B testing reports A (`iPhone19,2`) and B (`iPhone19,7`) have the
same Film halation, while C (no HardwareModel) renders with severe blown/incorrect
colour. The `iPhone19,7` mitigation therefore does not solve upstream issue #8.
It also introduced a new regression on some captures: a source selected as Bright
could reopen as Standard after the tool, whereas this did not occur before the
renderer-profile experiment.

The production Texture renderer profile is restored to the native donor value
`iPhone19,2` in web native-style, web raster and Python paths. The raster baseline
constant is also restored to `iPhone19,2`; no hidden `iPhone19,7` production
override remains. The no-HardwareModel variant is rejected.

`tests/private-fixtures/Film_Halation_V1/IMG_7864.HEIC` is a useful street-light
positive control. It is an iPhone 16 Pro native Styles image (schema 131087).
Current add-Texture output preserves the original Styles payload byte-exact and
the complete Exif/MakerNote payload byte-exact, while adding only Texture/mattes.
A regression test now enforces this and requires the generated Texture item to use
`HardwareModel=iPhone19,2`.

A separate native Bright+Texture fixture
`NativePortrait_Bright_HDR_V4/E_CompleteBright_HDR.HEIC` confirms that Apple
itself stores `texture_styles.Preset=Standard` together with a working Bright
Styles/MakerNote state and `HardwareModel=iPhone19,2`. Therefore the Texture
`Preset` string is not the Photographic Style selector and must not be rewritten
to Bright. The Bright regression was caused by the renderer-profile experiment,
not by direct replacement of the native Styles payload.

For phone comparison, `IMG_7864_Texture_iPhone19,2.HEIC` and the generated
`IMG_7864_AB/` variants provide a same-photo street-light Film test. Film issue
#8 remains unresolved after rejecting the HardwareModel hypothesis; the next
useful evidence is whether this native-Styles positive control shows the same
preview-vs-Done red overflow after Texture is added.


### 10.62 Native iPhone 18 Pro Film path differs from the grafted Texture graph (2026-10-11)

Two user-supplied native iPhone 18 Pro captures were inspected:
`tests/private-fixtures/Film_Halation_V1/IMG_0240.HEIC` and
`IMG_0243.HEIC`. Both expose Texture/Film in Photos on-device, but their HEIC
containers contain no 2023 Styles URI item, no `texture_styles` URI item, no
2026 matte set, no linearthumbnail and no style delta map. This proves native
iPhone 18 Pro Texture/Film can be enabled through a capture-generation path that
is distinct from the older-device graft used by this tool.

Both iPhone 18 Pro Exif MakerNotes contain private tag `0x65` (UNDEFINED,
binary plist, 74 bytes). A scan of the available private HEIC corpus found:
- iPhone 18 Pro: 2/2 files contain `0x65`.
- iPhone 16 Pro: 0/219.
- iPhone 13 Pro Max: 0/8.
- iPhone 11 Pro Max: 0/18.
- iPhone X / iPhone 7: 0/all tested.

The two observed native payloads are:
- IMG_0243 neutral-looking: `{0:0, 1:0, 2:0.0, 3:1}`.
- IMG_0240: `{0:1, 1:54, 2:0.20462970435619354, 3:1}`.

The semantic meaning of tag `0x65` is unknown. It is therefore not injected by
production code yet. A strict same-file diagnostic set was generated at
`tests/private-fixtures/Film_Halation_V1/IMG_7864_65/`:
A = current control with no tag 0x65; B = only the neutral 0x65 payload from
IMG_0243; C = only the 0x65 payload from IMG_0240. Styles, Texture resources and
pixels remain unchanged; only the Exif/MakerNote item is rebuilt. The phone test
should compare Film preview at 90/96/97/100 and the saved result after Done.
If B aligns saved Film strength with preview, neutral 0x65 becomes the leading
candidate for a production compatibility marker on grafted Texture photos.


### 10.63 Film preview-vs-Done mismatch confirmed as a native iOS 27 Photos bug (2026-10-11)

Device testing of the strict MakerNote-0x65 variants on IMG_7864 found A/B/C visually
identical. Injecting either observed iPhone 18 Pro 0x65 payload therefore does not change
the Film preview/final mismatch and 0x65 is rejected as a compatibility fix.

More importantly, the untouched native iPhone 18 Pro capture
`tests/private-fixtures/Film_Halation_V1/IMG_0243.HEIC` reproduces the exact bug on
iOS 27 Photos: while editing, moving the Film slider shows little/no red halation, but
after tapping Done the saved Photos render shows the red Film halation. This file was
captured by an iPhone 18 Pro with Exif Software `27.0`; it has not passed through this
tool. Its container has no 2023 Styles URI item, no grafted `texture_styles`, no 2026
matte set, no linearthumbnail and no style delta map. The same Photos preview-vs-final
mismatch therefore exists on Apple's native capture/render path.

This evidence rules out the tool's HardwareModel choice, FilmGrainSeed and MakerNote
0x65 as root causes for issue #8. A file-side metadata mutation cannot be claimed as a
correct fix while an untouched native Apple file exhibits the same renderer mismatch.
Any attempt to pre-compensate the saved result would deliberately diverge from native
Apple semantics and would make the edit preview less trustworthy.

The web app now detects the native iPhone 18+ capture path conservatively as
`camera generation >= 18` plus Apple MakerNote tag `0x65`. Such files are preserved
without grafting a second Texture contract when no grafted `texture_styles` exists.
A private regression asserts IMG_0243 is detected as native Texture while IMG_7864
(iPhone 16 Pro) is not. Service-worker shell cache is v112.


### 10.64 Legacy 0x54 collision and Soft Skin/Glow black-render regression (2026-10-13)

The reported `C:/Users/WanThinnn/Downloads/IMG_1382.HEIC` is an iPhone 7 capture
(Exif Software 14.2). It has no Photographic Styles auxiliary graph, but its Apple
MakerNote contains a six-key 0x54 bplist with `0=1, 1=0.18, 2=0, 3=1, 4=16, 5=0`.
iPhone 7 predates Photographic Styles, so this older 0x54 payload must not be treated
as a captured Style selector merely because its private blob resembles the later schema.

The port path previously preserved any syntactically valid 0x54 selector before grafting
Styles. On pre-Styles cameras this could carry the unrelated legacy payload into the
generated Styles/Texture renderer. The port now interprets source 0x54 as a Photographic
Style selection only for iPhone generation 13 or newer. iPhone 13–15 still preserve a
real legacy Style selection, Suggested Styles can still replace it, and iPhone 16+
native selections remain protected. Pre-iPhone-13 inputs receive the generated neutral
eight-key Standard selector instead.

The exact IMG_1382 browser workflow was re-run end to end after the fix. Its output has
the neutral eight-key marker `{0:1,1:0,2:0,3:1,4:1,5:1,6:4,7:0}`, schema-14 Styles
with a 516-byte tone curve, one generated Texture people entry, and positive
`SkinSmoothFaceRoughness=0.00010525344350426256`. This also proves the earlier V13
zero-roughness failure is not the primary cause for this particular photo. The serializer
still clamps zero/non-finite generated roughness to the smallest previously device-tested
non-black value as a separate safety guard.

Portable regressions cover the iPhone 7 0x54 collision, iPhone 13–15 preservation,
iPhone 16+ protection and nonzero Texture roughness. The real browser IMG_1382 check,
AI Portrait export tests, Texture compatibility tests and Soft Skin tests all pass.
Service-worker shell cache is v142.

### 10.65 Legacy HDR gain map must join the editable Portrait rendition (2026-10-13)

The reported `C:/Users/WanThinnn/Downloads/IMG_1388.HEIC` is an iPhone 12 mini
front-camera HEIC (Software 15.4.1). It carries a 4032x3024 SDR primary, a
2016x1512 Apple legacy HDR gain-map grid, and a 1024x768 relative disparity
image. The gain-map XMP declares `HDRGainMapHeadroom=3.0177927017211914`;
there is no ISO `tmap`, Styles graph, StyleDeltaMap, or linear thumbnail in
the source.

Device feedback distinguishes the failure by display mode: with HDR display
suppressed (for example Low Power Mode), Portrait blur/bokeh looks uniform;
with HDR display active, bright HDR regions regain visible detail and therefore
look less blurred than the surrounding SDR rendition. The source graph links
both the gain map and disparity only to the SDR primary. In contrast, the
project's working modern native HDR+Portrait references use an ISO `tmap`
derived from `[primary, gainMap]`, and link depth/Styles/mattes to both
`[primary, tmap]`. The same structure was previously device-accepted in the
NativePortrait_Bright_HDR_V4 D/E tests.

The web port now conservatively promotes this older Apple HDR layout before
adding Styles/Texture when all of the following are true: exactly one native
depth item exists, the HDR item has Apple's 2020 gain-map auxiliary role, no
`tmap` already exists, one valid Apple HDRGainMap 1.0 sidecar supplies finite
headroom, and the SDR primary is Display P3. Promotion does not alter or
re-encode the primary, gain-map, depth, or their XMP payloads. It adds a
one-channel ISO `tmap` whose alternate headroom is `log2(sourceHeadroom)`,
using the same P3/PQ tmap properties and simple offset/gamma contract as the
device-accepted V4 D/E graph. The HDR derived rendition is preferred through an
`altr` group, while the original SDR primary remains the fallback.

For IMG_1388 the generated tmap uses alternate headroom 1.593494 (rounding the
source log2 value), consumes `[primary 49, gain-map 64]`, and the native
disparity relationship becomes `[primary 49, tmap 68]`. Newly generated
linear-thumbnail, StyleDeltaMap, Styles metadata, Texture and semantic mattes
also target both renditions. The gain-map auxiliary itself remains linked only
to the primary, matching the modern native graph. Full browser processing keeps
the original primary tiles, gain-map grid/tiles/XMP and depth/XMP byte-exact.

A portable regression verifies the tmap parameters, relationship graph,
idempotence and byte preservation. **Device test on 2026-10-13 failed:** the
original IMG_6321.HEIC, its IMG_1388.HEIC derivative and the generated
IMG_1388_HDRPortraitFix.HEIC still exhibit reduced blur / lost bokeh in HDR
highlight regions with HDR display enabled. Therefore tmap/altr/dual-target
relationships are **not a verified fix** for this legacy capture, and the
prior assumption that Photos would necessarily apply Portrait blur after HDR
reconstruction is not supported by the physical observation. No gain-map pixels
were modified, so the portable tests could not detect this perceptual failure.
Next work must compare actual on-device SDR/HDR Portrait renderings and isolate
whether the gain map itself needs depth-aware processing, whether the editor
selects a different rendition/adjustment path, or whether an Apple-private
rendering contract differs. Any blur-aware gain-map rewrite must account for
aperture re-editability and changing Portrait Lighting; dropping HDR is only a
separate SDR-compatibility fallback, not an HDR-preserving fix. Service-worker
shell cache is v143.

### 10.66 AI Portrait must promote legacy Apple HDR after depth generation (2026-10-13)

A direct comparison of the user's true source IMG_6321.HEIC against the derived
IMG_1388.HEIC exposed two facts that the earlier investigation missed. The original
iPhone 12 mini file has **no depth item at all**. Its HDR gain map is one 2016x1512
hvc1 auxiliary image with HDRGainMapVersion=65536, while IMG_1388 contains the
AI-generated 1024x768 disparity and a later 12-tile gain-map grid. Therefore repairing
IMG_1388 only operates on an already transformed Portrait container; it does not test
the original legacy-HDR -> AI-Portrait path.

Apple HDRGainMap version 65536 does not need an explicit XMP headroom field. For this
capture the source Apple MakerNote contains signed-rational tag 33 (0x21) =
52489/79007 and tag 48 (0x30) = 11443/153779. Applying Apple's documented
piecewise headroom equation selects the maker33 < 1 && maker48 > 0.01 branch and
gives 1.5934843899 stops, or approximately 3.0177732x linear headroom. This is
within ~0.00002 of the later IMG_1388 sidecar value 3.0177927017, independently
confirming the same source HDR range.

Two implementation gaps blocked the original photo. First, the source Display-P3 ICC
profile stores its desc string as ordinary ASCII Display P3; the compatibility probe
previously only recognized nclx primaries=12 or UTF-16 profile names. Second,
promoteLegacyPortraitHdr() previously understood only version 131072 with an
explicit HDRGainMapHeadroom. It now also accepts version 65536 when tags 33/48 are
valid signed rationals and derives headroom from those source values. No HDR pixel or
gain-map sample is synthesized from this metadata.

The ordering bug was equally important. patch() runs before optional AI Portrait, so
IMG_6321 has no depth when its Styles graph is created and HDR promotion correctly
skips at that point. Previously buildAiPortrait() added depth and returned immediately,
meaning the now-eligible legacy HDR was never promoted. buildAiPortrait() now runs the
legacy HDR promotion **after** attaching the editable disparity. Existing files that
already have ISO HDR remain unchanged because the promotion is idempotent and refuses
an existing tmap.

An exact reconstruction was produced from IMG_6321.HEIC while reusing the already
computed depth payload from IMG_1388.HEIC so this test changes the HDR/container path,
not the AI depth model. The output
C:/Users/WanThinnn/Downloads/IMG_6321_HDR_Portrait_Legacy65536Fix.HEIC keeps the
original single-image 2016x1512 gain map as hvc1 byte-for-byte, adds a 4032x3024
tmap with alternate headroom 1.593484, keeps 1024x768 editable depth, and targets
that depth plus Styles/Texture resources at both [primary, tmap]. The gain map is not
retiled or re-encoded.

A portable regression now covers the version-65536 path, MakerNote 33/48 headroom
calculation, ASCII Display-P3 ICC identification, the post-depth promotion ordering,
dual-target depth relationship, and gain-map byte preservation. The relevant suite is
36 pass / 0 fail. This fixes the identified container/pipeline defect; the perceptual
HDR+bokeh result still requires the generated file to be checked in Photos on a physical
iPhone before marking the rendering symptom device-proven. Service-worker shell cache
is v144.

### 10.67 Legacy Apple gain samples must be converted before ISO Portrait promotion (2026-10-13)

Physical-device feedback rejected the metadata-only output from section 10.66. Its HDR
highlight regions still reduced the visible Portrait blur/bokeh, and the promoted graph
could also make the depth result look wrong compared with the last committed build. The
post-depth ordering fix was necessary but not sufficient; preserving the old gain-map
bytes while declaring them to be a simple ISO logarithmic gain map was itself invalid.

Apple's documented legacy equation first decodes each 8-bit gain sample with the Rec.709
inverse transfer and then applies `1 + (headroom - 1) * gain`. ISO 21496-1 instead decodes
a normalized log2 gain using the tmap min/max/gamma fields. The rejected implementation
declared the untouched Apple bytes as `logGain = sample * log2(headroom)`, with 0.005
offsets and the alternate colour space. Those equations are not equivalent, so the tmap
could overstate spatial highlight detail even though the item graph and headroom scalar
looked correct in structural tests.

The AI Portrait route now converts every legacy monochrome gain sample before assembly:

`isoSample = log2(1 + (headroom - 1) * Rec709ToLinear(appleSample)) / log2(headroom)`

The converted plane is encoded losslessly as full-range 8-bit monochrome HEVC. Its ISO
tmap uses `min=0`, `max=log2(headroom)`, `gamma=1`, zero offsets, and applies gain in the
base colour space. Endpoints remain exact; exhaustive 8-bit calibration at the reported
3.01779x headroom has less than 0.006 absolute multiplier error (below 0.2% of peak).
Primary pixels, AI depth, Styles, Texture and all unrelated payloads remain byte-exact;
only the gain-map representation and its matching decoder configuration change.

The legacy promotion is now explicitly gated on that conversion. `patch()` no longer
promotes an existing legacy HDR+depth file, restoring the previous non-mutating behavior
for incomplete/native Portrait inputs and preventing the failed metadata-only experiment
from changing their blur path. AI export performs the conversion once before the reusable
Portrait assembly worker; focus/aperture updates reuse the converted gain map and do not
decode or encode it again. Existing ISO tmap HDR files remain unchanged.

Portable regression now rejects metadata-only promotion of raw Apple samples, validates
the Apple-to-ISO equation over all 256 code values, checks base-colour/zero-offset tmap
metadata, preserves every unrelated item, and covers version 65536 plus MakerNote 33/48.
The focused suite is 37 pass / 0 fail; adjacent Portrait, JPEG HDR, thumbnail and worker
tests are 29 pass / 1 optional private-fixture skip / 0 fail. PWA validation passes.
The perceptual result still requires a fresh physical-iPhone check before this is marked
device-proven. Service-worker shell cache is v145.

### 10.68 Legacy-to-ISO conversion must migrate the HDR sidecar atomically (2026-10-13)

The user's physical-iPhone comparison supplied the post-import `IMG_1401.HEIC` plus HDR
and SDR screenshots `IMG_1402.JPEG` / `IMG_1403.JPEG`. The SDR screenshot retains the
expected background blur and round bokeh, while HDR restores hard detail in the bright
tree/courtyard regions. This confirms that the disparity result itself is usable and that
the visible regression is introduced only by the HDR rendition.

The previous direct output contained the intended `tmap` and targeted depth/Styles at both
the SDR primary and HDR rendition. After Photos/iCloud canonicalized it into `IMG_1401`,
however, the `tmap` item was gone, depth targeted only the SDR primary, and the still-sharp
gain map remained auxiliary to that primary. HDR display could therefore reintroduce
high-frequency highlight detail after the SDR Portrait blur. Photos converted the gain map
to a 12-tile grid and emitted `HDRGainMapVersion=131072` with explicit headroom, showing
that it did not accept the input as one internally consistent editable HDR graph.

The v145 preparation had an additional deterministic contract bug: it converted 0x10000
(`65536`) Apple Rec.709 gain samples to ISO logarithmic samples but preserved the old
0x10000 XMP declaration. A caller boolean was then sufficient to add an ISO `tmap` despite
that contradictory sidecar. On import, Photos could interpret or migrate the already
converted samples again, or reject the derived rendition.

Gain conversion and metadata migration are now atomic. A 0x10000 input is re-encoded once,
its same HDR XMP item is changed to version 0x20000 (`131072`), and its source-derived
headroom is written explicitly. `promoteLegacyPortraitHdr()` additionally requires that
0x20000 declaration; its caller flag can no longer promote raw legacy metadata. A subsequent
pass recognizes the migrated representation and skips decoding/encoding, preventing a
Photos round-trip from being converted twice. The tmap continues to use the algebraically
matching one-channel log2 contract (`min=0`, `max=log2(headroom)`, `gamma=1`, zero offsets,
base colour space).

A reconstructed diagnostic for the exact IMG_6321 image is saved as
`tests/private-fixtures/HDR_Portrait_IMG6321/IMG_6321_HDR_Portrait_ISOContractFix.HEIC`.
It contains the 4032x3024 primary, normalized 2016x1512 gain map, 1024x768 editable depth,
version-131072 sidecar with headroom 3.017773211, and a tmap derived from `[primary,gain]`;
depth and editing resources target `[primary,tmap]`. This file still needs a fresh physical
iPhone import/edit/export check, specifically verifying that Photos retains the tmap rather
than producing the rejected primary-only graph seen in IMG_1401. Service-worker shell cache
is v146.

### 10.69 Native Portrait restoration needs the same HDR preparation (2026-10-13)

The user reports that the previous HDR blur/bokeh fix now works, but restoring Portrait
on some native-depth inputs introduces glaring HDR highlights. Their workflow is native
Portrait ON -> Photos Edit -> Portrait OFF -> upload -> process -> import -> Portrait ON.
The post-import examples are IMG_1412 and IMG_1415. IMG_5202 and IMG_7094 in
`C:/Users/WanThinnn/Downloads/iCloud Photos/iCloud Photos` are the original Portrait-ON
files, not the uploaded sharp bases. The user subsequently supplied the actual Portrait-OFF
uploads under `C:/Users/WanThinnn/Downloads/iCloud Photos (1)/iCloud Photos` with the same
two filenames. Comparison confirms identical gain-map/depth payloads between ON and OFF,
but different primary payloads; generating a test from the ON originals would risk double
blur and would not reproduce the upload workflow.

Both actual uploads are iPhone 13 Pro Max HEICs with 3024x4032 primary grids, 1512x2016
12-tile monochrome Apple gain maps, native 576x768 depth, HDRGainMapVersion=65536,
and no explicit HDRGainMapHeadroom or ISO tmap. Their Apple MakerNote contains tag 33
but no tag 48. IMG_5202 has maker33=28718/31509; IMG_7094 has maker33=39391/27267.
The headroom probe previously required both tags and therefore skipped these inputs.
Skia's Apple HDR decoder explicitly handles this older 33-only layout by defaulting an
absent tag 48 to zero:
https://skia.googlesource.com/skia/+/main/src/codec/SkExif.cpp
Applying that convention to Apple's piecewise equation gives 1.8 stops (~3.4822x) and
3 stops (8x), respectively. Only an absent tag 48 uses the default; a missing tag 33,
wrong tag type, zero denominator or negative signed-rational denominator still rejects
the conversion. No missing MakerNote tag is synthesized into the output.

The second gap was pipeline-specific: native-depth restoration uses restoreNativePortrait(),
not exportAiPortrait(), so the normalization and atomic sidecar migration from 10.67/10.68
never ran before installing the newer Portrait renderer. Native restoration now uses the
same HDR preparation, converts legacy Rec.709 gain samples to the matching logarithmic
representation, migrates the sidecar to version 131072 with explicit source-derived
headroom, and attaches a matching tmap after restoring the camera depth. Depth and editing
resources target both primary and tmap. Existing ISO HDR remains unconverted, completed
Portrait graphs are not rebuilt, and the normalization helper releases its encoder when
it owns the codec. This does not change the existing native-depth calibration or blur
algorithm and does not replace the camera depth with AI depth.

A real local Chrome run processed both actual OFF uploads through the web app. Results
are saved privately in `tests/private-fixtures/HDR_Portrait_Highlights/`:

- IMG_5202_HDR_Portrait_HighlightFix.HEIC (4,997,008 bytes).
- IMG_7094_HDR_Portrait_HighlightFix.HEIC (3,266,619 bytes).
- verify-browser.mjs and verification.json record the reproduction and checks.

For each output, every primary tile and the native depth payload remain byte-exact.
Independent FFmpeg decoding of all 12 output gain tiles exactly matches the normalized
plane. Across 3,145,728 samples per photo, the maximum relative multiplier error versus
the original Apple equation is 0.244833% for IMG_5202 and 0.408426% for IMG_7094. Both
files contain the expected source-derived tmap headroom and dual-target depth relationship.
These checks establish container and gain-equation consistency, not physical Photos
rendering: the remaining blown-highlight symptom still needs a fresh iPhone import and
Portrait/HDR ON/OFF comparison before it can be marked device-proven.

Portable native-restoration regressions cover the two 33-only metadata patterns,
primary/Styles/depth preservation, malformed metadata rejection, idempotence and all 256
gain code values. The focused export suite is 40 pass / 0 fail; the combined relevant
Portrait/HDR/worker/Styles suites are 80 pass / 2 optional skips / 0 fail. PWA and i18n
validation pass. Service-worker shell cache is v148. No UI redesign was implemented.

### 10.70 v148 physical feedback: 7094 sky still blows out; split-reader diagnostics (2026-10-13)

The user tested both 10.69 outputs on iPhone. IMG_5202 is broadly acceptable but its HDR
also increases slightly. IMG_7094_HDR_Portrait_HighlightFix.HEIC blows out the entire HDR
sky. Thus v148 is **not a device-proven general fix**, despite its passing sample-equation
and preservation checks. Do not treat 5202 as evidence that every legacy HDR capture works.
The user supplied the actual Photos-rendered exports:

- `C:/Users/WanThinnn/Downloads/IMG_1431.HEIC`: failed 7094 rendition.
- `C:/Users/WanThinnn/Downloads/IMG_1428.HEIC`: broadly acceptable 5202 rendition.

Both exports omit the input tmap and Styles graph, retain the same 1,352-byte Portrait
REND blob, and carry version-131072 Apple HDR auxiliary maps. 1431 explicitly declares
headroom 8; 1428 declares 3.4822022914886475. Their depth payload hashes match the older
1415/1412 Photos renders. The absence of tmap is therefore not by itself sufficient to
explain failure: it occurs in both the broadly acceptable and failed outputs.

Independent FFmpeg luma decoding compares a fixed sky rectangle (normalized x .53-.87,
y .10-.33). For 7094 its gain median is 183 in the source Apple map, 188 in the direct
v148 logarithmic map, and 188 in 1431 after Photos. The source ON/OFF gain planes are
identical. 1415, the pre-normalization render, has median 183. The analogous sampled
5202 medians are 11 (source), 5 (direct v148) and 6 (1428). These values demonstrate
which numerical planes survive rendering, not the correct visible HDR result. The agent
cannot execute the physical iPhone Photos renderer in this Windows environment.

One prior contract assumption needs qualification: an Apple HDRGainMapVersion=131072
declaration alone does **not establish ISO logarithmic sample semantics for every reader**.
Skia's Apple XMP reader accepts any version and still chooses its Apple gain-map decoding
type (https://skia.googlesource.com/skia/+/main/src/codec/SkXmp.cpp). This is evidence about
that reader, not proof of which internal iOS path causes 1431. A single plane offered as
both Apple auxiliary HDR and ISO tmap input leaves reader-selection ambiguity after
Photos removes tmap. Existing automatic version-131072 handling is not broadened here.

Two immutable **diagnostic-only** 7094 variants are generated by the private
`tests/private-fixtures/HDR_Portrait_Highlights/contract-trials.mjs`:

- `IMG_7094_HDR_Portrait_ISOOnlyTrial.HEIC`: the same normalized gain and tmap, without
  the Apple HDR auxiliary label or Apple XMP sidecar on that numerical plane.
- `IMG_7094_HDR_Portrait_DualContractTrial.HEIC`: the same ISO-only plane/tmap plus a
  separate byte-exact copy of the source Apple gain grid/tiles/XMP linked to the primary.
  ISO reconstruction consumes the normalized plane; an Apple auxiliary reader can consume
  only the untouched Apple plane. Both headroom equations retain the source-derived range;
  no arbitrary brightness clamp, SDR-only conversion or guessed headroom is introduced.

Every surviving baseline item payload is asserted byte-identical in both variants,
including primary, depth, Styles, Texture, normalized gain, tmap and REND sidecar. The
dual-contract variant additionally asserts every imported Apple payload against the source.
The ordinary discoverHeic() hdrGrid selector prefers the Apple auxiliary in that variant,
so simple audits comparing tmap input to d.hdrGrid report no matching tmap even though
the tmap item and its original [primary, normalizedGain] inputs remain present. This is
another reason these diagnostics are not yet adopted into the application pipeline.

A human-in-the-loop harness adapted from the diagnosing-bugs skill is saved privately as
`hitl-7094.sh`. Replaying **only the user's already reported observations** from
`7094-user-observation.txt` returns VERDICT=RED for the v148 file and records IMG_1431 as
the exported artifact. It does not represent a new agent-run iPhone test. Unknown OFF,
revert and bokeh observations remain unknown rather than being inferred. The loop requires
actual HDR retained, no sky clipping with Portrait OFF/ON, and working HDR bokeh to accept
a new output; losing HDR cannot count as success. The two trial variants still need fresh
device observations and post-Done HEIC exports. No new runtime or cache change is made;
production remains at v148 until a rendering-specific comparison supports the next fix.

### 10.71 Native camera disparity range must survive Portrait restoration (2026-10-13)

Physical feedback for the 10.70 variants: ISOOnly still clips the HDR sky, less glaringly
than HighlightFix, but gives stronger blur and nicer bokeh. DualContract clips least but
still does not match the original, with lighter blur/bokeh than ISOOnly. At the same f/1.4,
the original native Portrait is lighter and has less bokeh than these reconstructions.
Neither diagnostic is therefore accepted as a complete physical-device fix.

A separate deterministic bug is confirmed in the native-depth adapter. It retained the
compressed disparity payload but discarded the camera's FloatMinValue/FloatMaxValue and
auxC depth representation descriptor, replacing both with the AI default range 0..1.
The actual Portrait-OFF 7094 range is 0.043335..1.615234; 5202 is 0.110901..0.750488.
Preserving encoded pixels alone does not preserve how those pixels are interpreted.
The 10.69 statement that calibration was unchanged only described that patch's delta;
the pre-existing adapter was already replacing the native range. It must not be read as
evidence that the native calibration was preserved correctly.

restoreNativePortrait now reads the unambiguous 8-bit disparity range from the camera XMP,
retains the exact camera auxC property, and supplies both bounds to the Portrait assembler.
The new sidecar writes the same bounds, and assembly asserts that the native descriptor
and encoded depth remain byte-identical. Missing/invalid/duplicate ranges and unsupported
namespaces/formats are declined instead of silently guessing 0..1. The worker-safe parser
supports namespace aliases and either element or attribute values. Generated AI depth
still defaults to minimum zero and its own supplied maximum; no AI range is changed.

This fixes the range bug, not a proven cause of the remaining HDR clipping. The native
uploads do not provide their own camera matrix/lens fields; the existing reference
calibration and REND blob are still used. No invented replacement calibration, brightness
clamp, SDR fallback or new HDR-contract selection is introduced. DualContract remains
diagnostic-only because its two gain roles still need explicit pipeline support.

Two immutable metadata-only 7094 trials are generated by the private
`tests/private-fixtures/HDR_Portrait_Highlights/native-range-trials.mjs`:

- IMG_7094_HDR_Portrait_ISOOnly_NativeRange.HEIC (3,271,916 bytes).
- IMG_7094_HDR_Portrait_DualContract_NativeRange.HEIC (3,396,608 bytes).

Each differs from its corresponding 10.70 trial only in the native depth auxC and the
two sidecar range values. All image/depth/HDR/Styles/REND payloads, remaining properties,
graph references, HDR headroom and gain contracts are asserted unchanged. Generation
performs no decoding or encoding and never overwrites prior trials. Physical iPhone
comparison at f/1.4 is still required before concluding whether clipping or bokeh improves.

Verification was deliberately kept lightweight following the user's SSD-load report.
Direct single-process execution (not the child-process `node --test` runner) passes all
42 Portrait export regressions in ~2.6 seconds and the two small parser tests in ~14 ms.
PWA and i18n checks pass; cache is v149. No browser run, image transcoding, repeated
background test launches, commit, push or UI redesign was performed in this follow-up.

### 10.72 DualContract feedback and native capture-measurement ownership (2026-10-13)

Physical results for 10.71: ISOOnly_NativeRange still blows out the sky.
DualContract_NativeRange is temporarily acceptable but remains slightly clipped compared
with the original. The user additionally identifies the older DualContractTrial (unit
depth range) as the least clipped variant, with lighter background blur/bokeh. Do not
hide clipping by reverting the corrected native range or treating weaker blur as a fix.

The user supplied `C:/Users/WanThinnn/Downloads/IMG_1437.HEIC`, exported after enabling
Portrait on DualContract_NativeRange. It contains an Apple auxiliary HDR map declared
version 65536 without explicit headroom, not the version-131072 declaration retained by
the failed 1431. Photos removed the tmap and Styles graph again. The native depth range
0.043335..1.615234 and the same 1,352-byte template REND blob survive. The gain payload
hash changes during the Photos export, so the retained version declaration alone is not
proof of byte-exact or sample-exact gain preservation. No new gain-plane decode was run.

Another deterministic adapter bug is verified: makerBlob replaced camera scene
measurements with the Portrait template's observations. For 7094 this changes:

| Measurement | Uploaded camera source | Previous DualContract / IMG_1437 |
| --- | --- | --- |
| AE target / average | 189 / 264 | 184 / 185 |
| Focus distance range | 0.35546875..0.55859375 | 1.04296875..1.078125 |
| Luminance noise amplitude | 0.01041538455 | 0.02036245540 |
| Signal-to-noise ratio | 56.93239207 | 28.23365786 |
| Colour temperature | 5385 | 5237 |
| Focus position | 69 | 74 |
| Lux level | 25926 | 62 |

1437 retains these foreign measurements, not the source's. Names and source ownership
are informed by the primary ExifTool implementation:
https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/Apple.pm
This proves metadata substitution, not that any particular field causes Photos clipping.
Opaque REND semantics are still not known, and those values are not adjusted by guessing.

Native restoration now preserves the source's whitelisted AE/colour/noise/focus
observations via native-capture-metadata.js. Missing measurements remain absent instead
of borrowing them from another photograph. Source count/type are retained; typed TIFF
words are adapted to the destination byte order (each rational's 32-bit numerator and
denominator separately), while undefined/plist payloads stay byte-exact. Renderer/feature
flags, HDR headroom/gain, selected Styles and Live Photo identity remain separate existing
contracts. The generated AI-depth route is unchanged; this ownership fix is restricted to
the native-depth restoration branch. Reference camera matrices and REND remain estimates.

A single immutable diagnostic is saved as
`tests/private-fixtures/HDR_Portrait_Highlights/IMG_7094_HDR_Portrait_DualContract_SourceCapture.HEIC`
(3,406,366 bytes). The private source-capture-trial.mjs changes only the native scene
measurement entries in the DualContract_NativeRange Exif MakerNote. All non-Exif item
payloads, graph references/property associations, REND, depth, HDR planes/contract/headroom,
Styles and primary pixels are asserted unchanged. All other MakerNote entries retain
their exact type/payload, including renderer flags and Styles. It uses the correct native
range, not the older unit-range diagnostic. No image decode/encode, brightness clamp or
HDR removal is performed. This trial still needs an actual iPhone comparison at f/1.4.
DualContract is not yet silently adopted as the production HDR graph.

The new integration regression was run directly as one Node process: RED before the
fix (source AE matrix was replaced with the 512-byte template matrix), then GREEN.
All 43 Portrait export regressions pass in ~2.6 seconds; a small endian/count regression
passes for all four source/destination byte-order combinations. PWA and module-path
checks pass; cache is v150. No browser run, background child-test runner, image
transcoding, commit, push or UI redesign was performed in this follow-up.

### 10.73 SourceCapture rejection and renderer-owned depth-range diagnostic (2026-10-14)

Physical iPhone testing rejects the 10.72 SourceCapture hypothesis. The user reports
`IMG_7094_HDR_Portrait_DualContract_SourceCapture.HEIC` is more clipped than even
`IMG_7094_HDR_Portrait_ISOOnly_NativeRange.HEIC`. Preserving 7094's AE/noise/focus
observations while retaining the foreign REND/calibration therefore worsens this device
result; metadata ownership was a real structural mismatch but is not a safe HDR fix.
The runtime import, MakerNote substitution, report flag, regression and PWA asset added
for that experiment are reverted. Cache returns to v149 and the direct integration suite
returns to 42 passing tests. Section 10.72 remains historical evidence, not the current
implementation or a successful fix.

The ordering across the tested files is now significant: the unit-range
DualContractTrial remains the least clipped but has lighter blur/bokeh, while the
source-native 0.043335..1.615234 range produces stronger blur and more clipping. This is
consistent with, but does not prove, a mismatch between Portrait's processed SDR base
and the separate Apple HDR auxiliary result. It does not justify clamping gain, changing
headroom, weakening depth, or claiming that native source range is compatible with a
renderer borrowed from another capture.

The borrowed REND/calibration originates from the 5129 native reference, whose own depth
descriptor and sidecar declare 0.735840..1.607422. A single metadata-only diagnostic was
therefore generated from DualContract_NativeRange:

`tests/private-fixtures/HDR_Portrait_Highlights/IMG_7094_HDR_Portrait_DualContract_RendererRange.HEIC`
(3,402,536 bytes).

It changes only the depth auxC property and the XMP FloatMin/FloatMax pair to the exact
5129 renderer-owned values. The primary image, both HDR gain representations, depth
payload, Styles resources, REND blob, all graph references, and all other properties and
payloads are asserted byte-identical to DualContract_NativeRange. The private
`renderer-range-trial.mjs` performs no decode, encode, pixel edit, brightness clamp or
overwrite. Audit confirms the 7094 depth hash and Apple gain hash remain unchanged and
the REND hash is still the 5129 renderer. This is a focused device diagnostic, not a
production adoption or a claim of final correctness.

Verification remained deliberately light: one direct single-process Portrait suite
passes 42/42 in about three seconds; the depth-range parser passes 2/2; PWA and module
path checks pass. No browser, FFmpeg/image transcoding, background child runner, commit,
push or UI redesign was used.

## 10.74 — iOS 18 telephoto Styles v13 missing curve: isolated Texture candidate (2026-10-15)

The user reports a telephoto iPhone 16 Pro/iOS 18 capture, Standard selected and
Portrait initially off. After processing and Share → Save to Photos, Glow/Soft Skin
renders almost black and Photos refuses Done with “There was an error saving this
photo. Please try again later.” Private screenshots IMG_1532/IMG_1533 show that
failure, with Vibrant + Glow selected during editing (not evidence that the original
capture used Vibrant). Inputs are IMG_3435_orgirnal.HEIC and IMG_1529_processed.HEIC
in the user's private `16-pro-iOS-18-error-black` directory.

The task starts from a clean feature/ui-ux-redesign branch after the completed UI
work. No UI redesign or HDR/Portrait renderer changes are part of this investigation.

Both files contain the same 56,947-byte native Styles plist, schema 13, without key
`3`. The original 51,840-byte coefficients hash is
`274de533499375919c851ca4ade03ec702830008ed5436bc7f35839ae82f6a95`.
All 96 original HEVC payload hashes occur in the processed file. Texture was added
with HardwareModel iPhone19,2 and no postprocessed people data. This is consistent
with a legacy Texture compatibility gap, not evidence of an encoder blackening RGB.

Section 10.6 documented a device-accepted missing-curve-only repair for schema 14.
Current native preservation bypasses that repair, and its helper only recognized
14. New actual-original and portable worker regressions first fail because the
native-preserving schema 13 path adds Texture without the missing curve. They then
pass with a narrowly scoped change: recognize 13 as well as the historical 14 on
the default route; allow only 13 through preserveStyles:true. Existing curves and
all other native-preserving schemas (including 14) remain untouched. No schema
upgrade, coefficient/statistic substitution, camera-label rewrite, HDR gain change,
depth normalization, people deletion or HardwareModel experiment is introduced.
Both add-Texture and already-Texture repair use the same eligibility check.

Private metadata-only candidates were generated under
`tests/private-fixtures/Texture_iOS18_3435/`:

- `IMG_1529_TextureCurveTrial.HEIC`, 2,269,645 bytes, SHA-256
  `99e7f32bd17cb0166796e2f8e4c6c0ea272103922a7b3bbabbb5f2c6432ccdcb`.
  Only adds the 516-byte identity curve to the processed Styles, serializing with
  preserved plist real types. All existing bytes except two Styles iloc extent
  fields remain identical, followed by the appended replacement Styles mdat.
  All 131 non-Styles item payloads, references and properties stay exact.
- `IMG_3435_TextureCurveTrial.HEIC`, 2,270,123 bytes, SHA-256
  `15f8d36a445b0daa5b33e6650a2250008ed85c680faca4691ef5b92e6724106f`.
  Runs the original through the actual native-preserving Texture worker with the
  new compatibility field and verifies every non-Styles source payload unchanged.

The private curve-trial.mjs refuses output overwrites and performs no decoding,
encoding, model inference, downloads or heavy disk work. Original user files are
read-only; candidates remain ignored and are not included in the web deployment.

**Device validation is pending.** Structural regressions do not execute Apple
Photos and cannot establish that schema 13 has exactly the schema 14 renderer
requirement. Import the repaired processed file as a new asset; select Glow and
Soft Skin, tap Done, then reopen and verify rendering and saved edits. If that
single-variable trial fails, do not call the issue fixed or stack speculative
changes. The fresh original candidate permits a second check of the upload route.
The separate Photos persistence symptom might need further investigation even if
rendering improves. The web compatibility candidate ships in cache v191; no commit
or push has been requested for these changes. Current handoff is in the browser
processing guide, not a new UI plan.

The compatibility probe preserves opaque/unreadable Styles on the native route;
checking for schema 13 must not introduce a new processing rejection. A separate
test first caught that regression and passed after adding the preservation guard.
Lightweight sequential checks: Texture 9 pass / 4 optional skips; Portrait export
42 pass; native preservation 3 pass / 2 optional skips; Soft Skin 5 pass; worker
1 pass / 2 optional skips; module paths 1 pass. Total 61 pass / 8 optional skips /
0 fail, plus passing PWA and git diff whitespace checks. No heavy encoders, models
or concurrent test runners were started. There is a separate working-tree change
to the install-guide SVG in web/index.html; it is unrelated and left untouched by
this processing task.

## 10.75 — Legacy Compatibility Export foundation and iPhone 16/17 future-contract recovery (2026-10-15)

The `feature/legacy-compatibility-export` branch now implements the defensive
architecture proposed after §10.40. The normal pipeline remains authoritative:
known iPhone 16/17 contracts continue through the existing native-preservation
route; iPhone 18+ native Texture/Film detection remains unchanged; iPhone 15 and
older, Android/raster imports and screenshots continue through the established
non-native construction path. Compatibility recovery is entered only when an
iPhone 16/17 file has concrete evidence of an unknown Apple editing contract.

A canonical contract fingerprint now inventories HEIF container versions/layout,
item/reference/property topology, primary/HDR codec roles, Styles schema, Texture
contract, Apple auxiliary/tag URIs and relevant MakerNote evidence. The classifier
detects unknown Styles/Texture payloads, new Apple tag namespaces, editing reference
types, changed 0x54 selection contracts, an unexpected 0x65 native-Texture marker
on 16/17, unknown essential properties and future container/codec layouts before
the native mutators run. Container/core changes that are not proven safe are
preserve-only; they are not forced through the legacy builder.

For an unknown 16/17 contract whose photographic/container roles still satisfy the
known recovery contract, the exporter strips only the Apple editing layer and
reuses the mature non-native `patch()` path to rebuild the known editable
Styles/StyleDelta/linear-thumbnail/2026 Texture graph around the source photo.
Primary tiles, HDR resources, thumbnail, native depth, classic mattes and capture
EXIF remain source-owned. A valid legacy 0x54 selection is retained; an unknown
future 0x54 falls back to the validated profile marker rather than rejecting the
photo. If a future 0x65 Texture marker appears on 16/17, it is removed only in the
compatibility copy before the 2026 Texture graph is installed, avoiding two
competing Texture contracts. No EXIF Software/iOS version string is rewritten.

The compatibility mutation budget is stricter than the ordinary output check. Every
source item not explicitly removed must still exist, non-EXIF source payloads and
their property associations must remain byte-identical, surviving source references
must remain exact, and all Apple MakerNote tags except the explicitly rebuilt 0x54
and explicitly removed 0x65 case must remain type/payload identical. The output is
rediscovered and must classify as the known target contract. Reprocessing that
output is a no-op rather than adding duplicate editing resources.

A future HEIC whose brand is recognizable but whose container cannot yet be parsed
is no longer rejected as a processing failure: the read worker returns the original
bytes with a discovery error and the UI publishes an exact `_Preserved.HEIC`
copy. Likewise, any generic recovery failure falls back atomically to the untouched
source and disables downstream Soft Skin/AI Portrait mutation for that result.
This gives future releases a safe preservation state even when automatic recovery
cannot run.

Developer tooling now includes contract inspection/comparison and target-manifest
generation. Sanitized mode removes filenames/item identifiers and payload hashes,
retaining only contract-relevant structural evidence; target manifests require a
neutral evidence ID, reject private/binary fields and explicitly record that physical
Apple Photos qualification is still pending. The comparer reports semantic item,
reference/property, MakerNote and payload-hash changes plus source primary/HDR/depth
preservation in its non-sanitized research mode. The runtime target report also
records the exact existing profile family selected by `profileFor()`, rather than
pretending one donor graph covers every geometry.

The target registry is explicit and currently marks the known baseline as
`structural-only` with `physicalApplePhotos: false` and normal-user qualification
disabled. The true source-adapter registry is intentionally empty: generic
editing-layer recovery is a bounded fallback, not a claim that a future source
contract has been semantically mapped. Adapter matching fails on ambiguity and the
compatibility layer now uses stable diagnostic categories such as
`unknown-source-contract`, `unsupported-container-layout`,
`adapter-ambiguous`, `mutation-budget-violation` and
`target-classification-failed`.

The result UI now adds a compact **Apple compatibility** section only for compatibility
or preserve-only results. It reports the source as a newer Apple format, whether a
known compatibility target was rebuilt, photo/HDR/depth preservation and intentional
loss of unrecognized editing metadata. Exact contract IDs stay in developer
diagnostics; user-facing copy no longer describes an arbitrary future conversion as
physically “verified”.

Sequential regression after these changes records 287 passing tests, 15 optional
fixture skips and zero failures across Legacy Compatibility, native Styles/Texture,
Portrait/depth/HDR, raster/non-native import, Live Photo, date preservation,
application/lifecycle/app-shell, Suggested Styles, startup/history and related
suites. PWA asset consistency, static-release checks and VI/EN/ZH copy checks pass;
all compatibility modules and the three developer tools pass `node --check`.
Service-worker cache is v199 for the expanded compatibility module graph.

This is strong structural coverage, not evidence that an arbitrary future Apple
contract has already been physically validated. No genuine iOS 27.2/27.3/28
changed-contract fixture exists in this work. The generic rebuild intentionally
handles editing-layer changes while preserving the known photographic contract;
a future change to depth/HDR auxiliary semantics, essential properties, codec or
container layout remains preserve-only until an explicit adapter and physical
Photos import/edit/save/reopen test exist. That boundary is deliberate: the goal
is to keep future 16/17 photos usable without sacrificing the proven native and
non-native pipelines through speculative rewrites.

## 10.76 — Compatibility Firewall v2 hardening (2026-10-15)

The compatibility subsystem was hardened again without changing the established
routing contract. `known-compatible` photos still enter the pre-existing native
pipeline, and `non-native` sources still enter the mature raster/non-native
construction path. Only `unknown-apple-contract` is eligible to reach the new
Compatibility Firewall.

Contract fingerprinting is now version 2. Besides the prior Styles, Texture,
MakerNote, Apple URI and container evidence, the fingerprint records item/reference/
property counts, semantic property and reference topology, construction methods,
editing-family multiplicity, and both essential and non-essential unknown property
types. A canonical sanitized representation produces a deterministic 128-bit
structural signature (`c2-...`). This signature is a lookup identity only; it is
not treated as a cryptographic authenticity mechanism and never replaces fixture
evidence or device validation.

A graph policy now defines protected semantic photo resources independently of
editing item IDs. The protected set includes primary/grid tiles, HDR, native depth,
classic/Apple photographic mattes and auxiliaries, thumbnail and capture Exif.
Editing graph closure is calculated separately. Unknown references crossing from
editing metadata into a protected role fail closed unless the relation is one of the
known target relationships. A future Apple `photo:aux:` tag is deliberately treated
as photographic/preserve-only, not as disposable metadata merely because it uses
the `tag:apple.com` namespace.

`recovery-preflight.js` is the final mutation authority for future candidates. It
runs before compatibility profile loading, image decode or thumbnail generation and
checks source/file complexity limits, HEIF item/extents/construction methods, dangling
references, property associations, unknown properties, duplicate editing families,
editing graph cycles and cross-boundary dependencies. Unknown changes are classified
as discardable editing changes, photographic semantic changes, container changes or
ambiguous dependencies; generic rebuild is authorized only when all reasons belong
to the discardable editing layer and the graph remains inside the proven photo
contract.

Compatibility state is independently versioned (`engine=2`, `fingerprint=2`,
`plan=3`, `report=2`, `target-registry=2`). The target registry now carries
explicit invariants, qualification state and a kill switch, so a historical target
can be disabled after a future Photos regression without modifying native processing.
The real source-adapter registry remains empty. Future adapters must declare exact
contract signatures or an explicitly reviewed predicate, fixture/research evidence,
capabilities, allowed mutations, information loss and physical Apple Photos
qualification; normal-user availability is forbidden until physical qualification
is true, and ambiguous adapter matches are rejected.

The conversion plan is now v3 and lists exact source signature, planned removed
editing IDs, allowed added target families, permitted MakerNote changes, property/
reference mutation boundaries and information loss. Mutation-budget verification is
two-way: it rejects both undeclared changes to surviving source resources and
undeclared resources/references introduced by the rebuilt output. Target postflight
also verifies the target schema/version families, URI/property/reference allowlists,
duplicate resource limits and safe editing/photo boundaries. A final semantic role
diff independently proves that protected photographic resources remain unchanged.

The exporter has an atomic safe wrapper and worker operation. Any parser, preflight,
sanitizer, builder, mutation-budget, semantic-preservation or target-verification
failure returns the exact source bytes and a structured failure report; partially
rebuilt bytes are never exposed as a result. The web processing route additionally
executes preflight before expensive compatibility work. Existing current native
photos never execute this path because classification leaves them on the native
route.

Developer research tooling now includes canonical signatures and optional preflight
in the inspector, a standalone preflight command, semantic/cross-boundary reporting
in the comparer, versioned target-manifest build/validation, strict adapter-manifest
validation and a scaffold command that creates a **disabled** exact-signature adapter
skeleton for a future fixture. Sanitized diagnostic modes remove filenames, payload
hashes and item identifiers.

Firewall-specific tests now record 56 passing tests and zero failures. They cover
real current iPhone 16 routing, iPhone 18 Texture routing, unknown essential and
non-essential properties, duplicate editing families, dangling refs, editing cycles,
unsupported iloc/iref/ipma/codec variants, future Styles/Texture/MakerNote changes (including iPhone 16 `0x65` even when a known Texture graph is present),
future metadata vs photographic auxiliaries, depth cross-boundary dependencies,
resource limits, real iPhone 16 Pro 24 MP/HDR preservation, Live Photo identifier
preservation, recursive protected `dimg` closure, non-MakerNote Exif preservation, plan v3, two-way mutation budgets, semantic preservation, atomic
fallback and worker APIs.

The broader Firewall v2 verification pass records **313 passing tests, 15 optional
private-fixture skips and zero failures** across compatibility, native Styles/Texture,
Portrait/depth/HDR, raster/non-native import, Live Photo, date preservation,
application/lifecycle/app-shell, Suggested Styles, startup/history and module-path
suites. PWA, static-release and VI/EN/ZH copy checks pass. Service-worker cache is
v201 for the expanded compatibility module graph.

The remaining boundary is intentional: no genuine future changed-contract iOS
fixture exists yet, so no source-specific adapter can be truthfully implemented or
physically qualified in advance. The system is prepared to preserve unknown future
files, automatically recover only demonstrably editing-layer-only changes, and make a
real adapter straightforward to add once future A/B fixtures exist.

## 10.77 — Compatibility review corrections and worker reuse (2026-10-15)

Four review findings were reproduced and corrected at file/application level:

- Parseable unknown-contract recovery and preserve-only branches bypassed
  `tryAiPortrait()`, which also published the File and completed progress. They now
  publish once directly, reach 100% and clear the busy state without optional AI.
- Construction-method-1 offsets were checked via the truthiness of an extracted
  typed array. Out-of-range slices can be empty yet truthy. Preflight now checks
  offset/end against the actual `idat` payload, including primary/HDR grid items
  and disposable editing items; invalid sources return unchanged via safe export.
- Unknown references were previously detected only beside Apple tag URI items.
  Detection now includes protected photo/HDR/depth/thumbnail/Exif roles and their
  `dimg` closure. Unknown types touching protected roles block recovery; unrelated
  generic metadata references do not block the native route.
- Styles key `l`, already documented with `k` in §4.1, was missing from the known
  key set. Both flags now retain the existing native route and original metadata.

The read worker now reuses discovery for fingerprint/classification and candidate
preflight. This reduces source HEIC discovery from four calls to one during the
read/classification/preflight sequence for a recovery candidate, removes synchronous
contract parsing/signature work from the page, and avoids a separate source copy
sent back to the worker for preflight. Bounds checks inspect the `idat` box once
instead of reparsing `iloc` and copying each item. Export still independently
validates its own input, sharing that discovery with its preflight.

All web suites importing `node:test`, run sequentially, record **354 passing tests,
15 optional private-fixture skips and zero failures**. New application regressions
exercise successful recovery, preserve-only camera, preflight rejection, profile
failure, builder failure, unparseable HEIC and classification failure; each must
produce exactly one downloadable file, finish progress and preserve exact source
bytes on fallback. Worker tests also verify the read decision and preflight.
Service-worker cache is v203.

This is structural/application evidence. No new physical Apple Photos test or
Safari memory/timing benchmark was performed, and no future-contract adapter was
qualified by these changes.

## 10.78 — PWA startup, queue visibility and real processing preferences (2026-10-15)

The v196 six-second viewport resampling was insufficient for the newly reported
Home Screen cold-launch case: stale `innerHeight` and `clientHeight` can continue
overriding correct CSS geometry for the whole session. The v204 attempt used CSS
`100dvh` and safe areas at rest; the user subsequently confirmed it still failed
on their iPhone. It is superseded by 10.79 below.

The release cache now serves app HTML/modules/styles without waiting for network
revalidation on every launch. An inline loading screen paints while CSS/modules
load, profiles/history no longer block readiness, heavy encoders remain lazy, and
initial offline warming waits for worker activation when there is no controller.

History now registers all imported files before processing. The default single-job
queue can opt into two jobs using an isolated second runtime, with visible waiting
states and all active jobs shown in Activity. Save-action preference, visible-work
Wake Lock and the iOS original-format reminder replace the prior Settings mocks.

Desktop browser validation completed three HEIC exports across both lanes, showed
2 active + 1 waiting file, retained a dock bottom of 834 on a 390×844 viewport with
both JS heights fixed at 756, and successfully booted fully offline after caching
188 resources. Save preference and reminder interactions were exercised; Wake Lock
lifecycle and refusal/late-completion cases have deterministic tests. No phone
thermal, Safari lifecycle or physical Photos qualification is claimed. Full details
and device checks: `docs/ui-ux/2026-10-15-pwa-startup-queue-settings.md`.

Final automated web regression for this update: **370 passing tests, 15 optional
private-fixture skips and zero failures**, plus PWA asset/i18n/static-release checks.

## 10.79 — Theme-correct launch artwork and mobile chrome revision (2026-10-15)

User feedback confirms the v204 dock geometry still required a force-quit on the
physical iPhone. Prior Chromium viewport tests were not device acceptance.
v205 removes `top:100dvh` placement: a fixed, unfiltered `inset:0` host outside
`<main>` aligns a relative glass dock with flex and safe-area padding. The document
keeps normal scrolling. No physical-screen floor, layout-height override, launch
polling or body scroll lock is used. Focused Search alone can request keyboard
clearance, measured from the host bounds; lifecycle resets discard that offset.

Real-browser checks exposed a separate missed-Close-tap bug: input blur cleared
the keyboard offset before click, moving the button away. Pointerdown now retains
Search focus until activation; keyboard activation still works normally.

The launch icon embeds the existing light/dark SVG geometry and uses critical
theme CSS, so it is correct even with the stylesheet unavailable. Saved appearance
overrides system appearance; System follows live changes. Mobile layout follows
the local Ionic/iOS reference with compact header, 16pt margins, leading large
title and one grouped photo picker surface. No framework or effect dependency
was added; source/output photo geometry is unchanged.

Validation: **372 passing web tests, 15 optional private-fixture skips, zero
failures**; PWA/i18n checks pass. The repeatable mobile browser smoke covers 20
scenarios including blocked-CSS launch themes, seven viewport sizes in both
appearances, stale JS height, tab/scroll restoration, Search, production bootstrap,
install-guide focus ownership and AI Settings. Physical iOS cold launch/reopen is
still unqualified. See `docs/ui-ux/2026-10-15-pwa-startup-queue-settings.md`.

## 10.80 — Short/long destination boundary, lens sizing and header clearance (2026-10-15)

Physical feedback rejected v205 as a complete dock fix: Settings positions the
dock correctly, while Process/empty History/collapsed Guide raise it again.
Desktop measurements confirm a distinct root state: the short screens had
scrollHeight equal to clientHeight, while Settings was scrollable. v206 marks
standalone mode in the early head script and uses `min-height:calc(100lvh + 1px)`
for main in that mode, preserving root scrollability across all destinations.
The dock keeps the existing independent host. This removes the content-length
boundary without JS screen floors, scroll locks, reloads or settling timers;
physical WebKit acceptance remains outstanding.

The end-tab lens mismatch was independently reproduced in Chromium. The global
element-only box-sizing reset does not include `::before`; its border enlarged
the percentage translation step, accumulating drift at Settings. Explicit
border-box sizing fixes the actual lens width. At 402px, resting top/right
insets changed from 5/-3 to 5/5 CSS pixels. Mobile header controls also move
16pt down from the status area, with matching content clearance.

Validation: 372 passing web tests, 15 optional private-fixture skips, zero
failures; PWA/i18n checks pass. The mobile smoke now covers 21 scenarios, including
Settings → Process → History → Guide → Settings with short content, preserved
scroll, exact end-lens insets, and all prior startup/Search cases. Browser runs
passed at 1× and 3× device scale; neither is physical iOS qualification.

Follow-up v207 restores the user's preferred inset grey photo-picker surface,
12pt outer padding and former 190pt minimum picker height. Its fill follows the
theme background. The v206 dock/lens/header changes remain in place.

## 10.81 — Device-accepted dock, mobile sheets and dark glass (2026-10-16)

The user confirmed the toolbar now works on their iPhone after v206/v207.
v208 keeps that host/scrollability/offset geometry intact.

AI Settings had a reproducible missing-rim defect: mobile CSS explicitly removed
the bottom border and lower corner radius; the whole dialog scrolled. The new
floating frame retains all corners and its rim, sizes to content within the
available safe viewport, and scrolls only the body. Header/handle downward drag
can dismiss; control presses, cancellation, short/horizontal/upward drags and
teardown are guarded. Feature state and processing contracts are unchanged.

Per the user's correction, switches retain the old 63×44px control. The Model
control CSS is identical to committed v207, including blue capsule, stops, knob
and inline presentation. Its value mapping/model processing is unchanged.

Dark navigation material follows the local Ionic reference: vertical rim rather
than bright side/outer glow, transparent moving lens, 72% black resting fill and
final-200ms release handoff. Light and accessibility modes keep separate rules.
Mobile Guide uses chevrons; History menu actions have 44px targets. Other audited
native-style surfaces remain intact.

Validation: **375 web tests pass, 15 optional skips, zero failures; 50 browser
checks pass**, including 24 sheet size/language/appearance combinations, Model
levels, swipe dismissal, dark rest/hold/release, forced colors, reduced motion,
History, Photo, Guide and confirmation. Physical sheet/optical acceptance remains
outstanding. Details: `docs/ui-ux/2026-10-16-ios-sheets-materials.md`.

## 10.82 — AirPods-style AI corners and stable launch/held lens (2026-10-16)

v209 follows the user's native AirPods-card screenshot with broader mobile AI
Settings corners and progressive continuous curvature. A circular fallback is
provided; switch and Model control styling and resting dock geometry are retained.

The loading ring shrank from 30px to 24px when the universal box-sizing reset
arrived. Critical CSS now explicitly keeps a 30px border-box ring; themed app
artwork remains 76px throughout. The held toolbar lens scaled its positional
translation, explaining why Process was centered while the three later tabs
drifted. Individual `translate` now positions the lens before animated scale.

Validation: 375 passing web tests, 15 optional skips, zero failures; 54 browser
checks pass, including stylesheet-arrival dimensions and actual transformed lens
centers on all four tabs. Existing sheet, control, accessibility and dock checks
remain. Physical iOS optical acceptance is still separate from browser checks.

## 10.83 — More restrained AI Settings corners (2026-10-16)

Device feedback rejects v209's overly broad AirPods-style corners. v210 removes
those overrides and uses a modest 36–44px circular radius for phone widths up to
600px. iPad/desktop retain the existing shared 32px radius. The privacy footer
is removed from AI Settings, including its unused styles. Switches, Model,
internal scrolling, launch dimensions and toolbar fixes remain intact.

Validation: 27 targeted checks, 54 browser scenarios at 3× scale and PWA assets
pass, including light/dark sheet layouts across phone, landscape and iPad widths.

## 10.84 — Lower phone AI Settings with internal safe-area clearance (2026-10-16)

v211 sets phone AI Settings' bottom frame gap to 8px, matching its side gaps.
This lowers it by 14px where the iPhone bottom safe area is 34px. Safe-area
clearance is kept inside the scrolling body instead of lifting the frame.
Phone lower corners use 40–48px while top corners retain 36–44px; iPad/desktop
keep their existing geometry. The browser smoke now emulates the 34px safe area
and checks frame gaps and internal clearance explicitly.

Validation: 55 browser scenarios at 3× scale, 27 targeted checks and PWA assets
pass; the emulated safe-area check measures 8px side/bottom gaps and 26px internal
bottom padding.

## 10.85 — Continuous Camera-reference AI Settings frame (2026-10-16)

v212 replaces phone AI Settings' circular corners with a continuous contour
sampled from the user's Camera screenshot. Its side/bottom gaps measure about
8pt; the corner fit uses ~92pt extent and exponent 3.77. SVG supplies the same
outline and clipping geometry without depending on CSS corner-shape support.
Layout-size changes update the path; drag/open transforms do not change it.
Tablet/desktop return to their original 32px circular frame. Existing controls,
internal safe-area clearance, processing and toolbar behavior remain.

Validation: 378 passing web checks, 15 optional skips, zero failures; 55 browser
scenarios pass at 3×. Curve samples, resize cleanup, clip/outline readiness and
tablet fallback are checked. Physical Safari optical acceptance remains separate.

## 10.86 — Accepted phone curve and centered privacy footer (2026-10-16)

The user confirms v212's phone curvature is correct. v213 retains the frame and
restores the localized privacy note at the bottom of AI Settings, centered.
The last control group remains rounded; Model, switches and internal safe-area
clearance are unchanged.

Validation: all 55 browser scenarios at 3×, PWA assets and i18n checks pass.

## 10.87 — Footer uses existing space without enlarging the sheet (2026-10-16)

v214 corrects v213's extra footer height: the centered note shares the body's
existing bottom padding. Its 4px top gap and 18px line are offset by -22px bottom
margin, leaving the frame the same height as without a one-line note. Wrapped
translations retain natural extra line height. The accepted phone curve and
frame position are unchanged. The browser smoke compares visible/hidden footer
heights and checks placement below Model inside the frame.

Validation: all 56 browser scenarios at 3×, 24 stylesheet checks and PWA assets
pass. Visible and hidden footer produce the same frame height.

## 10.88 — AI Settings without the left close button (2026-10-16)

v215 removes the AI Settings X, centers the title in one column, lowers the title
6px and the grabber 4px without adding layout height. Swipe-down, Escape and
outside dismissal remain. Photo close, the accepted frame and the user's current
footer typography are retained. Optional close-button wiring handles its absence.

Validation: 55 targeted checks, 56 browser scenarios at 3× and PWA assets pass.

## 10.89 — Restore earlier corner styling after device feedback (2026-10-16)

v220 removes the experimental concentric/shared group curves at the user's
request. AI groups, including the Model group's bottom, return to 20px circular
corners; Settings returns to 22px. Other menus/Appearance/picker restore their
earlier shapes. Per-group observers and inner custom clipping are removed.
The accepted outer phone frame remains. Keep the X and footer removed, the
lowered header, compact inner spacing and original Model/switch controls.

Validation: 55 targeted checks, 56 browser scenarios at 3× and PWA assets pass.

## 10.90 — Compact centered AI footer (2026-10-16)

v221 restores the localized privacy sentence at the user's request, centered
at 12px with a 16px line height. The phone footer uses 6px above and 8px below
the text, lifting the Model group about 14px. Preserve the accepted sheet
frame, original inner corners, switches and Model control.

Validation: 55 targeted checks, 56 browser scenarios at 3×, PWA assets and
translation consistency checks pass.

## 10.91 — v1.0.0 release UI polish (2026-10-16)

v222 adds trailing Settings/AI separator insets, moves mobile Guide chevrons
inward, and gives dark tab glass more visible material and directional edge
lighting without changing dock/lens geometry. A bounded active-lens optical
pass has reduced-transparency/forced-color fallbacks. Update Stylio paints
localized animated feedback before checking the worker/caches, retains it
until reload and restores controls if the update fails.

Release notes live under the corrected `release_note/` directory, with English
v1.0.0 notes linked from all three README languages. Security work is deferred
by the user; this release does not claim those audit findings have been fixed.

Validation: 378 automated checks pass, 15 skip, 0 fail; 59 browser scenarios at
3× and PWA/i18n checks pass. Slow update feedback, failure recovery and successful
reload are exercised in the browser with external requests blocked.

## 10.92 — Edited native Styles and additive HDR registration regression (2026-10-18)

The supplied `comparision/HDR-native.HEIC` and `HDR-stylio.HEIC` are a matched
source/output pair. All original item payloads, properties, MakerNotes and
references are exact; Stylio adds 25 Texture/matte/XMP items and 8,957 bytes.
No HDR samples or native Styles calibration are replaced in this pair.

`native-1.HEIC` and `native-2.HEIC` were changed from the camera's original
Bright preset to Standard before export. Their original-Bright Stylio outputs
must not be used as a preservation comparison against these edited copies.
The user confirms both edited Native files still have Styles when reimported
directly into Photos. Both lack the standalone Styles URI, linear thumbnail
and delta map, but retain a six-key native 0x54 selection (`5=0`) and ISO tmap.
Missing standalone resources alone therefore do not establish Photos capability.

The reported `IMG_1730.HEIC` and `IMG_1731.HEIC` differ from these edited inputs
by exactly 67 bytes: HDR `auxC` and `auxl` registration. All original payloads
and MakerNotes remain exact. Replaying the old repair worker and full workflow
reproduced both outputs byte-for-byte, with no error status. The user observes
Filters on these outputs and Styles on their original inputs. This isolates
the regression to that registration combination, not pixel or preset loss.
Separate effects of auxC versus auxl and Photos' internal routing are unknown.

The worker now retains incomplete native Styles HDR declarations. Recognized
iPhone 16/17 six-key exports without depth can take a Texture-only candidate
route, preserving the selected preset and every original item/property/outgoing
reference. The guard accepts supported preset IDs rather than special-casing
Bright or Standard. Other incomplete/opaque native files stay byte-exact;
complete native Styles and existing Portrait routes keep their established paths.
Reupload does not add duplicates or register another HDR role. Automatic Soft
Skin/reconstruction is skipped for this candidate to avoid replacing native data.

Portable regressions use synthetic samples and sanitized EXIF, covering four
presets through the actual download workflow and candidate detection for all
16 supported IDs. Optional tests exercise both reported sources and confirm
the matched complete HDR pair still produces the prior known output. Targeted
validation: 86 pass, 10 optional-fixture skips; PWA/i18n checks pass. Shell v223.
Phone-test Texture-only candidates are generated separately; functioning Photos
Styles, Texture/Grain and saved renders remain pending device feedback. This is
not a claim that a reconstructed native renderer has been proven correct.

## 10.93 — Texture-only candidate rejected on iPhone (2026-10-18)

The user downloaded the native-1/native-2 Texture-only candidates and reports
that Styles is still absent. Keeping HDR declarations exact therefore removes
one known regression but does not establish the requested Styles+Texture flow.
The candidate is removed from automatic processing; incomplete native exports
now return byte-exact. The worker's guard against additional native HDR auxC/auxl
registration remains. Shell v224. Tests now require exact default preservation
rather than interpreting the presence of Texture metadata as feature success.

`tools/native-style-rebuild-variants.mjs` creates three isolated experiments:
A retains no Styles graph and upgrades the preset marker alongside Texture;
B adds the existing reconstruction pipeline's Styles graph and a target-derived
Main10 thumbnail while retaining the original six-key selection; C changes only
B's selection to the eight-key form, retaining preset ID/Tone/Colour/Palette.
Original primary/HDR samples, HDR declarations and capture metadata are checked
for preservation. The estimated calibration may change Photos Edit rendering.
These files are delivered through a temporary LAN-only download page; no private
photo is placed in web/ or published. Later device results are recorded below.

## 10.94 — Reconstructed Styles recover HDR, but extreme colour differs (2026-10-18)

The user confirms B/C expose Styles and Texture, with stable initial colour and
no darkening, but no displayed HDR. D registers B's existing HDR gain map with
auxC/auxl only: HDR is weaker, disappears in Edit and returns after Save. E adds
the source ISO tmap headroom to B; F does the same for C. E/F retain HDR in Edit
and after saving. Primary/HDR samples and all source HDR parameters remain exact;
the headroom sidecar is derived from each photo, not a hardcoded intensity.

The initial E/F report is insufficient for acceptance. The user subsequently
provided `iCloud Photos (2)/iCloud Photos/IMG_1735.HEIC` (native) and IMG_1751.HEIC
(edited F). Both have capture time 2026:10:18 19:10:14, 5712x4284, Standard (ID 1),
Tone -1, Colour +1, Palette 1. The user confirms the same settings. Their saved
primary pixels differ visibly: F is warmer/pinker and has a different tonal
response. These rendered copies no longer contain standalone Styles resources;
their absence must not be interpreted as evidence of the editor UI they exposed.

The current research graph uses profile schema 14, target-estimated statistics
and light maps, a generated RGB thumbnail and neutral delta samples. The original
capture's resources retained in stylio-1 use schema 131088 (0x20010), different
coefficient/curve data, capture gain/range and native spatial resources. The
schema difference is an observation, not proof of which field causes the colour
error. Source pixel preservation before editing does not prove native rendering
after a new Style adjustment. E/F remain excluded from automatic processing;
the default incomplete native route continues to return the source byte-exact.

`tools/native-style-calibration-variants.mjs` requires matching capture UUID,
timestamp/subsecond, camera, exposure, aperture and geometry. It builds G from E
with the same capture's native Styles metadata, H with that plus native linear
thumbnail, I with those plus native delta samples. No cross-schema coefficient
splice is used. Source primary/HDR/EXIF/Texture payloads, their properties and
all graph relationships remain exact. These isolate missing native resources;
they are not a production repair for arbitrary edited-only uploads. Phone colour
results remain pending. Portable tests cover structural/HDR preservation without
claiming that they can simulate the private Photos renderer.

## 10.95 — Same-capture native thumbnail removes most reconstructed colour error (2026-10-18)

Device feedback on G/H/I: G has incorrect colour; H and I look the same and are
close to native, with only a very slight remaining brightness/colour difference.
The supplied `iCloud Photos (3)/iCloud Photos/IMG_1729.HEIC` is the native reference;
IMG_1755.HEIC is edited I. The user confirms both use the Standard control's lower
right extreme. Their markers agree on Standard ID 1, Tone -1 and Colour +1.
Standard has no Palette control in Photos. The previous test-page instruction to
set Palette 100 was wrong for Standard; marker key 3 still records 1 internally,
which is not evidence of a visible Palette slider.

Both rendered files have the same Display-P3 ICC property. Area-sampled 1024x768
SDR RGB8 comparisons against IMG_1729 give mean absolute code differences 20.6513
for edited F (IMG_1751) and 2.5795 for edited I. Cabinet-region differences decrease
from 34.6671 to 1.1553. I's ceiling difference is 3.3712 and shadow difference 5.6663;
shadows have higher G/B values, consistent with a slightly cooler/lifted response.
These are decoded SDR code differences, not calibrated perceptual errors or HDR
quality percentages. The original-native reference matches the earlier capture
and controls. Source files and scripts stay in private/ignored artifact folders.

Native IMG_1729 retains ISO headroom 5.2651838132. Edited I uses an Apple auxiliary
gain-map sidecar declaring version 131072 and headroom 5.2651839256. The latter
matches to float precision. Their HDR container representations differ, and the
remaining SDR pixels already differ before any HDR screen presentation. Neither
matching headroom nor preserved gain-map bytes proves full rendering parity.

The native thumbnail is 10-bit full-range HEVC; the generated E thumbnail is
10-bit limited-range HEVC. Both decoded samples also differ visibly in tonal
response. Those observations do not isolate a range-tag bug: the encoded sample
values differ too, and merely relabelling a stream would not recover a missing
native linear reference. G-to-H changes only the thumbnail sample/properties,
after installing same-capture native Styles metadata, and removes most of the
observed colour error. H-to-I adds native delta samples with no reported visible
benefit. Native metadata's independent contribution is still unisolated.

The uploaded edited-only native-1/native-2 files contain neither that native
thumbnail nor native Styles calibration. H/I rely on the same capture's original
resources retained in stylio-1; this is not a general single-file repair. No
global exposure/colour adjustment is adopted from one reference. Default exact
preservation and the guard against graphless HDR registration remain in place;
the full requested editable Styles + Texture flow is still incomplete.

## 10.96 — Original Bright baseline and next colour isolation (2026-10-18)

The newly supplied `Downloads/IMG_1729.HEIC` is the unedited Bright capture,
distinct from the adjusted same-named file under iCloud Photos (3). It is
2,316,672 bytes, 5712x4284, capture 19:10:14.827, schema 0x20010 and an eight-key
Bright selection (Tone -0.5, Colour +0.5). It retains native Styles, thumbnail and
delta resources. Every original item payload matches the corresponding item in
comparision/stylio-1.HEIC. The actual file-processing harness produces stylio-1
byte-for-byte from this new input (+8,957 bytes of Texture resources), and a new
optional regression verifies all original payloads, properties and references.
All nine targeted native-export tests pass. This establishes a clean original
plus Texture control, not Photos render equality after further adjustments.

A numerical reconstruction probe compared primary RGB to the capture's own
native thumbnail for the indoor, night and HDR-native scenes, with 16-bit
decoding and stored-orientation alignment. Identity/gamma/linear/log variants
with fitted gain and offset reduce thumbnail sample differences but need
different parameters by scene; fitting requires the reference thumbnail that
an edited-only upload lacks. These are diagnostics, not calibrated production
parameters, and no fixed exposure/colour override is enabled. The portrait HDR
reference requires undoing FFmpeg's internal HEIF grid rotation even with
-noautorotate; misaligned results are discarded.

CMRA's Texture plist declares HardwareModel iPhone19,2 and people-data version 3,
the same values as Stylio. The sample grain seeds differ. This comparison does
not isolate whether activation of the Texture renderer causes the small remaining
native-vs-I difference. A requested device control uses the unchanged stylio-1
Bright+Texture output, sets Standard/Tone -1/Colour +1 in Photos, and compares it
with the adjusted Native reference. Its result will distinguish a Texture-only
render difference from one introduced by reconstructing the edited export.
Device results remain pending; current incomplete-input preservation stays exact.

## 10.97 — Native Bright plus Texture matches the native editing control (2026-10-18)

The user tested stylio-1 (the unedited original Bright plus additive Texture),
selected Standard with Tone -1/Colour +1, and reports a 100% match to the native
reference. On this capture and these settings, adding Texture with all native
editing resources retained does not produce the small difference seen in I.
The remaining defect is therefore in the reconstructed edited-export route;
this does not establish a universal Texture rendering result for all photos.

The next bounded same-capture diagnostic set is generated by
`tools/native-style-base-variants.mjs`:

- J retains I's payloads/graph and changes only 0x54 to the original capture's
  eight-key encoding, preserving the edited preset/Tone/Colour/Palette values.
- K adds only original MakerNote tag 0x5e to J. The tag is opaque (four bytes);
  no interpretation of it as a rendering flag or claim that it causes the defect
  is made. All other capture metadata stays on the edited input.
- L starts with the original Bright + Texture graph and base, and writes the
  edited selection in the eight-key form. This tests keeping the native image
  base separately from the initial selection; its initial display may remain
  captured Bright. It is a diagnostic, not a complete selected-Style export.

The generator verifies unchanged preset parameters, all base payloads except
Exif, all properties/references, semantic Exif fields and unrelated MakerNotes.
The read worker classifies J/K/L as known-compatible. No unknown-source mutation,
new colour compensation or automatic reconstruction is enabled. Device rendering
results for these new probes are pending.

## 10.98 — L's full preview retains Bright; separate display-resource probe (2026-10-18)

The user finds L the closest colour result, but its full-size Photos view before
Edit is warm/red like captured Bright; entering Edit makes it normal. The user
explicitly distinguishes the full-size view from the library thumbnail. L kept
the original rendered Bright primary and ordinary thumbnail while changing only
selection metadata. This confirms a visible-render/selection mismatch in that
experiment, not merely a stale small thumbnail. Exact equality of L's adjusted
render with native is not yet asserted.

`tools/native-style-preview-variants.mjs` creates M/N from L and edited native-1:
both copy the edited Standard primary samples with their own matching decoder
properties, and regenerate the ordinary 416x312 display thumbnail. The native
Styles blob, linear thumbnail, delta map, HDR samples/metadata, Texture and all
graph relationships remain byte-exact relative to L. M keeps L's eight-key
selection; N uses the edited source's six-key marker. Selected parameters agree.
All other semantic Exif fields/MakerNotes are preserved. The normal thumbnail's
encoder VUI is explicitly checked against its encoded P3/sRGB/full-range matrix.

The actual read worker classifies both as known-compatible. FFmpeg's decoded
73,410,624-byte SDR RGB view of M is byte-identical to native-1. This establishes
the written Standard display, not the Photos editor response. Original Bright
HDR is retained while the SDR display changes, so HDR/colour coherence still
needs device validation; preserving those bytes alone is not acceptance. M/N
remain private diagnostics using same-capture original resources. The main app
does not select them automatically.

## 10.99 — M/N edit colours hold; isolate the remaining full-preview defect (2026-10-18)

The user reports M and N look identical: the full-size view before Edit still
has a warm/red cast, reduced relative to L. Entering Edit restores the expected
colour, and Standard Tone -1/Colour +1 still looks correct as in L. The marker
encoding alone therefore did not remove this defect. Byte-identical decoded SDR
does not establish Photos presentation equality. The retained Bright HDR and
the container layout remain separate hypotheses, not confirmed causes.

`tools/native-style-preview-hdr-variants.mjs` generates three same-capture probes:

- O repacks M into one mdat, preserving every declared payload, property and
  reference, and removes unused historical picture bytes from appended mdats.
- P removes HDR gain-map resources, tone-map metadata, HDR sidecars and the
  alternate-rendition group from O. It is deliberately SDR-only, a diagnostic
  control rather than an acceptable final export.
- Q retains O's native editing resources and Standard display, replaces HDR
  tiles and their decoder properties with the edited Standard source's exact
  data, and uses that source's ISO tone-map equation plus its own headroom XMP.

All three pass real read-worker discovery and classify as known-compatible.
The generator asserts valid property indices, no dangling references, exact
Standard primary samples and unchanged native Styles/linear-thumbnail/delta
payloads. O's entire declared graph is preserved; Q's non-HDR resources and
references remain exact. These are structural checks, not device render tests.
Device results for O/P/Q remain pending. No automatic reconstruction or colour
compensation has been enabled in the main app.

## 10.100 — O/P/Q do not remove the preview cast (2026-10-18)

The user reports all three still show a cast before Edit and return to correct
Standard colour upon entering Edit; HDR is reported normal for the HDR test.
O's canonical repack does not resolve the symptom. P contains no HDR resources,
so the continued cast cannot be explained solely by mismatched HDR gain data.
Q's matching Standard HDR likewise does not resolve it. Primary ICC profile
bytes are identical between native-1, the original Bright and P; the Standard
tile decoder properties in P already match native-1 exactly. A generic ICC
profile mismatch is therefore unsupported. These results do not identify the
Photos viewing path or rule out effects from retained native editing resources.

Two further single-variable metadata controls use Q as the common baseline:
`tools/native-style-preview-metadata-variants.mjs` writes R without opaque
MakerNote 0x5e, which is present in the original Bright but absent in the edited
native export. Its four-byte content is not interpreted as a rendering flag.
S instead keeps 0x5e and changes only the UUID-shaped MakerNote 0x2b value to test
identifier reuse independently. This is a private diagnostic, not a production
policy to discard capture metadata or replace identifiers.

Both pass actual read-worker discovery/classification as known-compatible.
Assertions verify exact non-Exif payloads, all properties/graph references,
semantic Exif and every unrelated MakerNote. Both retain Q's exact HDR, primary,
native Styles/linear-thumbnail/delta and Texture resources. Device results are
pending. A separate requested control has the user change Tone one step in Q,
save, and inspect whether Photos' regenerated view retains the cast. No new
automatic production mutation has been introduced.

## 10.101 — Saving a real edit refreshes Q's view; R/S remain red (2026-10-18)

The user confirms Q stops showing the cast outside Edit after changing a
parameter slightly and saving. They also point to prior recorded viewing/editing
discrepancies in this document. Related histories include the unresolved Edit
colour transition in section 10 and the separate native Film preview/final bug
in 10.63; those are not evidence that this case has the same underlying cause.
The current save-and-regenerate workaround is now device-confirmed. It is not
an automatic file-export fix and does not prove a Windows/web implementation can
reproduce Photos' render. Avoid repeating a test solely to reconfirm this fact.

R and S both retain the warm/red cast before Edit and correct Standard colour
inside Edit. Neither removing opaque 0x5e nor replacing UUID-shaped 0x2b solves
the symptom on this capture. They remain rejected diagnostic mutations; neither
is adopted as a capture-metadata policy.

`tools/native-style-preview-render-variants.mjs` makes two Q-based controls:
T replaces only native delta-map samples and their decoder configuration with
the existing constant neutral profile asset, checking tile geometry and leaving
the native Styles/linear thumbnail untouched. U changes only primary SPS colour
primaries/transfer from unspecified 2/2 to explicit P3/sRGB 12/13, consistent with
the existing ICC's primaries/transfer. Matrix 6, full range, all other SPS fields,
all primary picture samples and every unrelated property remain exact. Every
primary tile is checked for absence of an overriding in-band SPS. This tests a
declaration/fallback interaction, not arbitrary exposure or colour compensation.

Both retain exact Q HDR, Exif, native Styles metadata, linear thumbnail and
Texture; graph references are unchanged. Real read-worker classification is
known-compatible. All declared preservation assertions pass. These tests cannot
verify Photos' two rendering contexts; T/U device feedback is pending. Main-app
incomplete-input exact preservation and cache v224 are unchanged.

## 10.102 — T/U fail; compare Photos' saved current version next (2026-10-19)

The user reports both T and U retain the warm/red full-size view before Edit.
Entering Edit was already correct on their common Q baseline. Therefore neither
neutralizing the native StyleDelta samples nor making the primary HEVC SPS
primaries/transfer explicit resolves this symptom. These diagnostic mutations
are rejected and remain outside the application path.

The tight remaining device loop is the same Q asset before and after a tiny
Photos adjustment: imported Q is red in the viewer, while changing one parameter
slightly and tapping Done makes the viewer correct. Apple documents that Photos
stores previous and current image versions together with separate adjustment
data for non-destructive edits. This supports, but does not by itself prove, the
current leading explanation: tapping Done creates a Photo Library current
rendition/adjustment state that a standalone imported HEIC does not supply.
The web application cannot create a PhotoKit content-editing output or attach
Photo Library adjustment data through a file download.

Do not infer the exact changed fields from the on-device appearance. The next
required artifact is the **Current** export of the corrected Q asset after the
tiny adjustment, not its unmodified original. Compare it against the original Q
with `tools/compare-photo-contracts.mjs`, then inspect item payloads, properties,
references, Exif/MakerNotes and any sidecars. If the current export is flattened
and lacks Styles resources, that is evidence that the correct viewer state lives
in the Photos asset's adjustment/current-version pair rather than in a reusable
standalone editable HEIC. It would also confirm the existing supported workflow:
add Texture to the unmodified resource, import it, then apply/save the Style in
Photos. No further colour compensation or metadata guessing should precede this
comparison.

## 10.103 — Photos Current export confirms a library-level adjustment state (2026-10-19)

The user changes Texture slightly in Q, taps Done and reports that the full-size
viewer returns to the correct Style colour. The resulting Photos **Current** export,
`IMG_1768.HEIC`, is 2,075,077 bytes versus Q's 2,398,867 bytes. The contract
comparison finds 80 items instead of 159. It removes the Styles plist, Texture
record, linear thumbnail, StyleDelta graph, twelve Texture mattes and all of their
editing relationships. Primary and HDR grid descriptors remain byte-identical,
while primary and HDR tile payloads are newly rendered. HDR remains represented.

The MakerNote selection changes from Q's 127-byte eight-key form to the 98-byte
six-key edited-export form: keys 0–4 retain Standard and its Tone/Colour values,
key 5 becomes zero, and keys 6/7 are absent. This marker difference is descriptive,
not a reusable adjustment sidecar; M/N already established that switching marker
shape does not repair the imported viewer state.

Therefore `IMG_1768.HEIC` is a flattened current rendition with no explicit
Styles/Texture graph. This does not by itself prove that a fresh import lacks the
controls: the earlier six-key native exports also omit that graph but expose Styles
on the tested device. Fresh-import behavior for `IMG_1768` has not been reported.
The result is consistent with Photos retaining Q as the original resource together
with a separately generated current rendition and adjustment state. A standalone
browser download cannot attach that PhotoKit state. Grafting the flattened pixels
back into Q would mix an already-rendered Style/Texture image with the original
editing graph and risks applying the edit twice; it is not an evidence-based
production repair.

The safe product behavior remains exact preservation for edited native exports
that lack their original Styles graph. The UI now gives the usable order: process
the unmodified HEIC in Stylio first, import it into Photos, then choose the desired
Style and tap Done. Shell cache v225 carries this guidance. No colour compensation,
opaque metadata guess or flattened-pixel graft is enabled.

## 10.104 — Native Standard display still shifts in Edit (2026-10-19)

The user clarifies that both the native reference and the test asset were captured
with Bright and then changed to Standard. X uses the exact native Standard primary,
HDR tiles and tmap, so its full-size preview matches the native Standard reference.
When Photos enters Edit, however, X becomes slightly blue relative to that same
native Standard reference even when Standard and all visible controls match.
The user's Current export of X after this Edit path, `IMG_1784.HEIC`, is byte-for-byte
identical to the earlier corrected-Q Current export `IMG_1768.HEIC`. This confirms
that Photos is producing the same editor rendition from both reconstructed files;
the mismatch is in the editor base/calibration path rather than the displayed
Standard primary.

Y regenerates the linear thumbnail from the exact native Standard rendition. Z
does the same and replaces StyleDelta samples with the constant neutral profile.
The user reports that both retain X's behavior: preview is correct, but entering
Edit gives the same slight blue shift. Therefore neither the linear-thumbnail
pixels nor native-versus-neutral StyleDelta samples isolate the remaining error.
They remain rejected diagnostics and are not enabled in production.

## 10.105 — Separate preferred Standard rendition from Bright editor base (2026-10-19)

`tools/native-style-dual-rendition-variants.mjs` tests a two-base HEIC structure.
It starts from L, whose exact original Bright primary and native Styles calibration
give the correct editor response. It then copies the exact native Standard primary,
HDR grid and tile samples into hidden items and makes the existing preferred ISO
`tmap` derive from those Standard items. The HEIF `pitm` remains the original Bright
grid for the Styles editor, while the `altr` group continues to prefer the tmap for
normal HDR viewing. The ordinary thumbnail is also copied from native Standard.

AA leaves native editing resources associated with both the Bright primary and the
preferred tmap, matching Apple's original target topology. AB removes the tmap from
the shared `auxl`/`cdsc` editing targets, leaving the exact Bright primary as their
only editor target. Both retain native Styles metadata, linear thumbnail, StyleDelta,
Texture, HDR, selection marker and capture identity. The worker classifies both as
known-compatible, and every Standard display plus Bright editor payload is asserted
byte-exact against its same-capture source. Device results are pending. These files
require the same-capture original and remain diagnostics rather than a single-file
repair for an edited-only upload.

## 10.106 — AA/AB improve but do not eliminate the Edit difference (2026-10-19)

The user reports the dual-rendition AA/AB result is provisionally better but still
differs from the native Standard reference. This means retaining the exact Bright
`pitm` as the editor base while making Standard the preferred alternate is not a
complete solution. No empirical colour offset is derived from the residual.

`tools/native-style-hidden-editor-variants.mjs` reverses the ownership for the next
bounded test. AC/AD keep X's exact native Standard primary, HDR and tmap unchanged
for display, add the exact same-capture Bright primary and all 45 tiles as a hidden
grid, and route the Styles/Texture `auxl`/`cdsc` graph to that hidden Bright base.
AC removes the displayed Standard pair from those editing targets. AD lists hidden
Bright first and retains Standard primary/tmap as secondary targets for discovery.
Both retain the native calibration resources and pass real-worker parsing as
known-compatible. Device results are pending; the added hidden base requires the
same-capture original and is not a generic edited-export repair.

## 10.107 — AC proves the hidden Bright base fixes colour; discovery targets restore the shift (2026-10-19)

Device feedback separates AC from AD. AC does not shift when entering Edit, which
confirms the exact hidden Bright grid is a correct editor base for this capture,
but Photos exposes neither Styles nor Texture. AD exposes both controls, but its
Edit colour shifts again. Their only intended graph difference is that AD also
targets the displayed Standard primary/tmap from every shared editing resource.
Thus the remaining problem is the minimum discovery relationship Photos requires,
not the Bright calibration or Standard preview pixels.

The generator now adds four target subsets while keeping Standard display bytes
and the hidden Bright grid identical. AE links only the Styles and Texture metadata
descriptors to Standard primary. AF links those descriptors to Standard primary
and tmap. AG links the descriptors plus linear thumbnail and StyleDelta to Standard
primary. AH links that core set to Standard primary and tmap. All other Texture
mattes and editing auxiliaries remain Bright-only. Each output is worker-readable
and known-compatible. Device results will identify whether a metadata-only link
can expose both controls without making Standard the editor base.

## 10.108 — AE-AH behave like AC; test Exif and primary-only graph (2026-10-19)

The user reports AE, AF, AG and AH all behave exactly like AC: entering Edit does
not produce the colour shift, but Styles and Texture are unavailable. Therefore
linking the two metadata descriptors, linear thumbnail and StyleDelta to Standard
primary and/or tmap is insufficient for Photos control discovery. All four kept
Exif associated only with the hidden Bright grid.

AI-AL test the remaining discovery boundary. AI links only Exif to Standard primary.
AJ links Exif plus Styles/Texture descriptors. AK links Exif, descriptors, linear
thumbnail and StyleDelta. AL links every formerly shared editing resource to the
Standard primary but deliberately excludes the Standard tmap. Every variant keeps
the hidden Bright target first. This distinguishes Exif's Style marker relation and
primary association from the alternate-rendition association that may be responsible
for AD's colour shift. Device results are pending.

## 10.109 — Exif changes the fallback mode; complete primary graph restores controls and shift (2026-10-19)

The user reports AI behaves like AC. AJ and AK still expose no Styles/Texture,
but traditional Filter is also absent. This is consistent with Photos recognizing
a native Styles editing mode after Exif plus metadata/core links while rejecting
the still-incomplete graph; it does not prove a specific undocumented validation
rule. AL exposes Styles and Texture and shifts colour like AD. Since AL targets
only Standard primary, the tmap target is not required for the shift.

The difference from AK to AL is now limited to the semantic sky matte and twelve
iOS 2026 Texture mattes. AM adds only sky to AK. AN and AO add the first and second
halves of the Texture matte set. AP adds all twelve Texture mattes while leaving
sky Bright-only. These variants retain exact Standard display and hidden Bright
payloads. Device results will show whether full Texture matte association is the
graph-completeness gate and whether sky participates.

## 10.110 — All Texture matte targets complete the graph, but bind editing to Standard (2026-10-19)

The user reports AM, AN and AO behave like AJ/AK: traditional Filter is hidden,
but Styles/Texture controls are absent. AP behaves like AD: both controls return
and Edit shifts colour. Sky and either half of the Texture matte set are therefore
insufficient; all twelve Texture matte associations form the observed completeness
boundary. Their full primary association also coincides with Photos selecting the
displayed Standard primary as the editing base. Removing any subset is not a fix
because it leaves the graph unusable.

`tools/native-style-split-tmap-variants.mjs` now avoids that invalid split. It starts
from L and preserves byte-exact original Bright primary, Bright HDR, Bright tmap and
every native Styles/Texture association. It adds a separate exact Standard primary,
HDR and tmap from the same-capture native current rendition, then places the Standard
tmap first in the `altr` viewing group. Unlike AA/AB, the native Bright tmap is not
replaced. AQ groups Standard tmap with Bright primary; AR also lists Standard grid;
AS also lists the preserved Bright tmap. The worker accepts all three as known-
compatible. Device validation must establish whether Photos uses Standard for normal
viewing while keeping the untouched Bright rendition for the editor.

## 10.111 — Separate Bright and Standard alternate groups (2026-10-19)

The user reports AQ and AR are identical and are the closest result so far, with
only a very small remaining colour difference in Edit. AS is worse. Adding the
Standard grid to AQ's single alternate group has no effect, while adding the Bright
tmap to that same group changes the result adversely. The remaining error is thus
associated with sharing one alternate group, not missing Standard grid membership.

AT-AW preserve all Bright and Standard payloads from AQ/AR and vary only alternate
group ownership. AT places a separate Standard group first and Bright group second
while keeping Bright as `pitm`; AU reverses the group order. AV puts all four
renditions in one group and makes Standard the primary. AW uses two groups and makes
Standard the primary. These variants test whether Photos can use an independent
Standard current rendition while resolving the complete Styles/Texture graph from
the Bright group. Device results are pending.

## 10.112 — AW matches colour but loses controls; isolate selection state (2026-10-19)

The user reports AT, AU and AV behave like AQ/AR. AW gives the most accurate colour
but loses Styles/Texture controls. AW's independent Standard primary group therefore
works as a baked current rendition, while Photos no longer resolves the Bright graph
as the editor for that primary. Combining the groups restores controls and the small
remaining recomputation difference. Group order alone does not change it.

The remaining byte-level difference relevant to editor initialization is MakerNote
tag 0x54. Original Bright stores an eight-key selection with preset 16, Tone -0.5,
Colour +0.5 and capture flag 1. AQ stores Standard preset 1, zero Tone/Colour and the
same capture flag. The Photos-saved Standard current rendition stores a six-key form
with flag 0. `tools/native-style-selection-marker-variants.mjs` keeps AQ's image,
HDR, Styles, Texture and graph bytes exact while producing AX with the original Bright
marker, AY with Photos' six-key Standard marker, and AZ with the eight-key Standard
marker but edit flag 0. Device results will determine whether the last residual comes
from original/current selection state rather than calibration.

## 10.113 — Marker form does not remove residual; saved current is slightly darker HDR (2026-10-19)

AX enters Edit as original Bright, as its marker requests, and no longer represents
the desired initially selected Standard state. AY and AZ behave identically: Standard
remains selected and Edit retains AQ/AR's small colour difference. Therefore the
six-versus-eight-key marker form and key 5 edit flag do not remove the residual.

The user reports that changing one control slightly and saving produces the closest
Standard colour, but the regenerated HDR appears slightly darker, estimated below
10%. This is consistent with Photos creating a new current rendition rather than a
standalone marker effect. The estimate is visual device feedback, not a measured HDR
headroom difference.

BA-BD keep AQ's exact preview/HDR/editor graph and set a tiny +/-0.01 Tone or Colour
value together with the edited flag. They test whether a non-zero selected parameter
enters Photos' adjusted-render path without requiring a PhotoKit save. No primary,
HDR, calibration, Texture or graph payload changes. These values are diagnostics and
not a production colour offset.

## 10.114 — Tiny marker adjustments fail; split original/current Exif state (2026-10-19)

The user reports BA, BB, BC and BD all retain the same slight colour error when
entering Edit. Positive or negative 0.01 Tone/Colour therefore does not trigger a
file-level equivalent of Photos' saved adjusted/current rendition path. Combined
with AX-AZ, the 0x54 marker branch is exhausted for this residual: selection form,
edit flag and a tiny non-zero control value do not remove it.

AQ is re-evaluated from its ancestry before the next test. Its Bright editor base is
not reconstructed calibration: L starts from the exact original Bright capture and
the normal additive Texture writer, and AQ keeps that Bright primary, HDR/tmap,
Styles metadata, native linear thumbnail, StyleDelta and Texture graph intact while
adding the exact same-capture Standard preferred rendition. This focuses the remaining
hypothesis on ownership/state between original Bright and current Standard rather than
missing Bright calibration.

`tools/native-style-dual-exif-variants.mjs` creates BE-BH. The existing AQ Exif is
restored to the exact original Bright Exif, while a second Exif item carries the exact
Photos-saved Standard current Exif from the same capture. Capture UUID equality is
required. BE associates Bright and Standard Exif with their respective primary grids;
BF associates each Exif with its own primary+tmap pair; BG leaves Standard Exif on the
Standard tmap only; BH uses the full per-rendition associations and also makes the
Standard grid `pitm`. All image, HDR, Styles calibration and Texture payloads inherited
from AQ remain exact. These variants test whether a standalone HEIF can approximate
PhotoKit's original/current split without changing colour coefficients or Style values.
They remain diagnostics and are not enabled in the application path pending device
validation.

## 10.115 — Dual-original ownership is rejected; preserve the edited asset as the only editor base (2026-10-19)

Device testing rejects BE-BH for the requested workflow: all four reopen the photo in
its captured Bright state. Although the files contain a Standard current rendition,
carrying the original Bright editor graph/Exif ownership makes Photos resolve the
original capture as the editable Style state. This violates the product contract and
closes the branch that uses an original-capture rendition as an editor base.

The required contract is explicit: a camera photo may be captured with any default
Undertone Style; the user may then change the Style and/or its controls in Photos; the
edited HEIC uploaded to Stylio is the source of truth; Stylio must add Texture while
preserving that selected Style, its parameters, HDR and edited pixels. The original
capture may be used only as a research reference, never as output state.

`native-1.HEIC` already satisfies the Style half of that contract when imported directly:
it was captured Bright, edited to Standard, and Photos still exposes the edited Style
even though the standalone Styles plist/linear thumbnail/delta graph are absent. The
next diagnostics therefore start only from this edited export and isolate Texture graph
ownership. `tools/native-style-edited-texture-target-variants.mjs` keeps the source
primary, HDR and 0x54 selection marker exact and adds the full Texture metadata plus all
twelve 2026 mattes. BI targets every new Texture resource only to the edited primary;
BJ targets them only to the ISO tmap; BK targets Texture metadata only to primary while
mattes retain primary+tmap; BL keeps Texture metadata on primary+tmap while mattes target
primary only. No original Bright payload or calibration is included. All four are
worker-readable and classified known-compatible; device validation determines whether
implicit edited Styles can coexist with Texture without reconstructing a Styles graph.

## 10.116 — Full Texture graph itself knocks edited exports out of HDR/Styles mode (2026-10-19)

Device testing of BI, BJ, BK and BL reports the same failure in every target-layout
variant: HDR is no longer displayed and Photos Edit no longer exposes Photographic
Styles. Because all four retain the edited primary, HDR payloads and the six-key Style
selection marker byte-exact, and differ only in whether the new Texture metadata/mattes
target primary, tmap or both, the failure is not caused by primary-vs-tmap ownership.
The observed mode switch follows the presence of the complete grafted Texture contract
on an edited export whose original standalone Styles graph is already absent.

The next bounded test decomposes the Texture contract rather than rebuilding Styles.
BM adds only `texture_styles` metadata to the edited primary, with no 2026 mattes. BN
adds only the twelve 2026 mattes plus their XMP sidecars, with no `texture_styles`
metadata. BO adds only the 74-byte native iPhone 18 MakerNote `0x65` Texture capture
record from a neutral native sample and adds no HEIF Texture items. BP combines that
`0x65` record with metadata-only BM, still without mattes. All four preserve the edited
primary, source HDR items and selected 0x54 Style marker. BO/BP intentionally classify
as `unknown-apple-contract` because `0x65` on iPhone 16 is future-contract evidence;
they remain diagnostics only.

## 10.117 — `0x65` preserves HDR but still invalidates implicit edited Styles (2026-10-19)

Device results for BM-BP further separate the failure modes. BO, which adds only the
native iPhone 18 MakerNote `0x65` Texture-generation record, still displays HDR but
Photos Edit no longer exposes Photographic Styles. BM (`texture_styles` metadata only),
BN (twelve 2026 mattes/XMP only), and BP (`0x65` + metadata) lose both displayed HDR
and Styles. None changes the edited primary, source HDR payloads or the selected 0x54
Style marker.

This means `texture_styles` and/or the 2026 matte graph can independently force the
edited iPhone 16 export out of its native HDR route, while `0x65` alone does not. The
Styles loss is broader: even an Exif-only `0x65` change is enough to make Photos stop
honouring the edited export's implicit Styles capability. Before attributing that solely
to `0x65` semantics, the next diagnostic must determine whether any harmless container
or Exif relocation invalidates the same implicit Styles state. BQ-BT therefore compare
an exact source copy, an appended inert top-level `free` box, an inert metadata item that
only grows `meta` and shifts extents, and a byte-identical Exif payload relocated through
the same rebuild path. These tests contain no Texture semantics.

## 10.118 — Exact-byte control also loses Styles after web re-import; provenance is now the leading hypothesis (2026-10-19)

Device results for BQ-BT are decisive. BQ is a byte-for-byte copy of `native-1.HEIC`, yet
after the current web download/import flow it still has HDR but no Photographic Styles
control. BR (only an appended top-level `free` box) and BT (byte-identical Exif payload
relocated through the rebuild path) behave the same: HDR remains, Styles is absent. BS,
which grows `meta` and shifts the existing external extents, loses both HDR and Styles.

Therefore the Styles loss observed in BQ/BR/BT cannot be caused by a byte mutation in
BQ: BQ has none. At least one earlier assumption must be refined. Either the prior
`native-1` validation did not represent a fresh re-import through the same path, or
Photos' Styles availability also depends on asset provenance/import context outside the
HEIC bytes. BS separately confirms that HEIF meta/extent rewrites can invalidate the HDR
path.

The next control must replay the exact edited source bytes under their original filename
and camera-style naming through the same HTTP path, and compare forced-download versus
direct-open/save flows. If every exact-byte delivery still loses Styles, the edited
export itself is not a portable standalone Styles contract and production cannot satisfy
“edited Style + Texture” from that flattened HEIC alone without recreating an
Apple-recognized editor graph from other information.

## 10.119 — Exact-byte transport closes the implicit-Styles branch (2026-10-19)

BU-BX replay the exact `native-1.HEIC` bytes through four import paths: ordinary web
download with the original filename, direct Safari open/save, the same bytes renamed to
`IMG_1729.HEIC`, and a ZIP transport extracted in Files before saving to Photos. The
HEIC payloads are SHA-256 identical where applicable. The user reports the same result
for every route: HDR remains, but Photographic Styles controls are absent after fresh
import.

This closes filename, forced-download, direct-open and archive transport as explanations.
The Photos-edited export is a flattened current rendition, not a portable standalone
editable-Styles asset. Its six-key 0x54 marker describes the current selection but is
not sufficient to recreate Photos' library-level adjustment/editor state. A file-only
Stylio solution therefore has to synthesize an Apple-recognized editing graph around the
edited rendition. The edited HEIC remains the sole source of truth; the captured Bright
original must not become the output/editor base.

The most promising missing resource is the native `linearThumb`. Earlier H/I device
results showed that replacing the reconstructed thumbnail with the same-capture native
linear thumbnail removed most of the colour error, while replacing StyleDelta samples
added no visible benefit. New research decodes native linear thumbnails only as ground
truth and fits them against their own rendered primary. After correcting HEIF `irot`, an
8-photo iPhone 16 corpus is well approximated by a per-channel affine remap with mean
MAE about 0.0157. The corpus median is approximately R `0.3648*x+0.2705`, G
`0.3703*x+0.2775`, B `0.3706*x+0.2689`. The same-capture 1729 research fit is near
`0.396*x+0.251` on all channels. Native linear thumbnails consistently use 1024x768,
10-bit 4:2:0 HEVC, full range, with unspecified colour primaries/transfer/matrix. These
measurements motivate source-only linear-thumbnail synthesis; no native original payload
is copied into candidate outputs.

## 10.120 — Source-only full-range linear-thumbnail candidates BY/BZ/CA (2026-10-19)

A clean E base was regenerated from the edited export using the existing reconstruction
pipeline plus the source ISO tmap headroom path that previously kept Styles, Texture and
HDR active in Edit. `tools/native-style-edited-linear-thumb-variants.mjs` changes only
that base's reconstructed `linearThumb`. The edited primary, source HDR payloads, selected
six-key 0x54 marker, Styles graph, Texture graph and E headroom remain exact.

BY uses the 8-photo corpus-median per-channel affine coefficients. BZ uses a deliberately
neutral scalar `0.37*x+0.27` on all channels. CA uses the same-capture 1729 affine fit as
a research upper-bound; its coefficients were estimated using original-capture ground
truth, so CA is not a generic production candidate even though its output thumbnail is
still generated only from the edited pixels. No original-capture payload is copied by
any variant.

All generated linear thumbnails are 1024x768 Main10 4:2:0 HEVC, full range, with explicit
VUI primaries/transfer/matrix code `2/2/2`, matching the observed native transport.
Worker readback classifies all three `known-compatible`. After HEVC encode/decode, their
MAE against the same-capture native linear thumbnail is BY 0.01468, BZ 0.01385 and CA
0.01236. Device testing determines whether this closer source-only linear reference also
removes the Photos Edit colour shift while retaining Styles + Texture + HDR.

## 10.121 — CA validates edited-only Styles + Texture reconstruction; HDR is the final delta (2026-10-19)

The user tested BY, BZ and CA on-device. All three retain the edited colour accurately,
restore Photographic Styles controls and keep HDR present. CA is the best visual match and
is now the accepted research baseline for this capture. The only remaining visible defect
is that HDR is slightly weaker than the native edited source.

This is the first edited-only reconstruction in this investigation to satisfy the core
contract simultaneously: the uploaded edited rendition remains the image/editor base,
the current selected Style survives, Styles + Texture controls are available, and HDR is
not lost. No original Bright payload is used in the output. Production still remains on
the fail-safe path until the residual HDR-strength delta is solved and the source-only
linear-thumbnail method is generalized/validated beyond this capture.

HDR contract audit rules out the XMP headroom scalar as the cause. CA uses
`HDRGainMapHeadroom=5.265183813`, while the same-capture native full graph records
`5.265185`. The edited flattened source and CA also retain the exact same ISO `tmap`
alternate value (`2.396483898`) and headroom ratio (`5.265183813`). The material routing
difference is that CA adds the legacy Apple gain-map `auxC`, `auxl` and HDR XMP required
by the reconstructed editor path, while the flattened source displays HDR through its ISO
`tmap` without those legacy declarations.

A native iPhone 16 corpus shows that full-graph tmap `min` and `gamma` are scene-dependent,
so hardcoding the original-capture curve is rejected. The next bounded experiment keeps CA
byte-exact except for HDR routing relationships, isolating whether Photos can retain the
ISO-tmap intensity while still exposing HDR inside the reconstructed Styles editor.

## 10.122 — CA HDR routing isolation CB-CE (2026-10-19)

`tools/native-style-hdr-routing-variants.mjs` starts from the accepted CA file and changes
only HDR routing metadata. Every existing item payload remains byte-exact, including the
edited primary, HDR gain-map image, CA linear thumbnail, Styles plist/StyleDelta resources,
Texture resources and Exif selected-Style marker. Worker readback classifies every variant
`known-compatible`.

- CB removes only the HDR gain-map `auxC`, keeping `auxl + HDR XMP`.
- CC removes only the gain-map `auxl`, keeping `auxC + HDR XMP`.
- CD keeps only HDR XMP, removing both `auxC` and `auxl`.
- CE keeps `auxC + auxl` but removes the HDR XMP relation.

CA remains the all-three-declarations control. CB is the leading hypothesis: if Photos can
use the edited source's ISO tmap intensity while the remaining `auxl + XMP` are sufficient
for editor persistence, it should restore native-like HDR without disturbing the already
validated colour/Styles state. No tmap curve or gain-map pixel values are modified.

## 10.123 — CE is the minimum valid HDR routing; residual HDR delta points to Styles calibration (2026-10-19)

Device results for CB-CE close the routing branch. CB (`auxl + XMP`, no `auxC`) renders a
black image. CC (`auxC + XMP`, no `auxl`) and CD (XMP only) lose HDR. CE (`auxC + auxl`,
no HDR XMP) keeps HDR and Photographic Styles, but HDR remains slightly weaker than the
original edited source. Therefore `auxC + auxl` are both required for this reconstructed
editor graph; HDR XMP is not required for HDR presence and is not the cause of the weak
HDR rendering.

The user supplied a direct comparison pair: `IMG_1729 (2).HEIC` is the original flattened
edited source and `IMG_1864.HEIC` is CE. Their ISO tmap payload is identical, including
alternate headroom `2.396483898162842`, min/max, gamma and offsets. The gain-map item
payload is also preserved. The remaining HDR-strength difference is therefore downstream
of the ISO gain-map data itself.

Styles-plist audit exposes a much stronger candidate. CE's generated plist reports
`LinearImage.whitePoint≈0.166`, `i.OriginalRangeMax≈0.08447`, `i.Gain≈14.57` and `h≈3.64`,
while the same-capture native full graph reports `LinearImage.whitePoint≈2.55544`,
`OriginalRangeMax≈1.00781`, `Gain≈10.18` and `h≈2.55`. The current retargeting code still
uses the old global `LINEAR_IMAGE_SCALE=0.166`, derived from an older eight-image corpus.
For this high-headroom capture that calibration severely understates the scene-referred
range even though ToneMappedImage and visible SDR colour are close. The next experiment
isolates these plist calibration groups without changing any photographic payload.

### Required compatibility invariants added by user

The edited HEIC is always the source of truth not only for the selected Style ID but also
for Style parameters. A real flattened fixture, `IMG_1735.HEIC`, carries Standard with
Tone `-1`, Colour `+1`, Palette `1` in its six-key 0x54 marker; future reconstruction must
preserve that marker byte-exact instead of normalizing to a preset default. The same rule
applies to any Style ID and non-zero Tone/Colour/Palette values supported by Photos.

Existing Portrait state must also survive reconstruction. If native depth and Portrait
rendering metadata already exist, Stylio must preserve the native depth resources,
focus/aperture (f-number) and Portrait Lighting/rendering sidecars rather than replacing
them with AI depth or a neutral renderer. If the source has no native depth, the existing
AI Portrait path must remain available after Styles/Texture reconstruction. These are
release-blocking regression requirements for the eventual edited-export compatibility
path.

## 10.124 — Styles-plist HDR calibration isolation CF-CM (2026-10-19)

The residual weak-HDR problem is now isolated independently of all photographic payloads.
`tools/native-style-plist-calibration-variants.mjs` starts from the user's CE file
`IMG_1864.HEIC` and changes only the Styles plist item. The edited primary, gain-map/tmap,
CA linear thumbnail, Texture resources, source 0x54 selection and all graph relationships
remain exact. Same-capture native full-graph `IMG_1729.HEIC` is used only as diagnostic
calibration ground truth, never as image/editor content.

The phone-test variants are deliberately nested: CK copies only native
`LinearImage.whitePoint`; CL only `LinearImage.highKey`; CM both fields; CF the complete
native `LinearImage` block; CG only root `i + h`; CH `LinearImage + i + h`; CI the wider
native calibration core (`0,4,h,i,j,k` plus LinearImage); CJ the complete native Styles
plist. All classify `known-compatible`. This matrix can determine whether weak HDR is
controlled by a single high-range statistic, the range/gain block, or a wider plist
contract before any source-derived implementation is attempted.

Further source-only analysis confirms that the old `LINEAR_IMAGE_SCALE=0.166` is not
uniformly wrong: ordinary percentiles such as p98 remain close to native on the 1729
capture, while the generated whitePoint is catastrophically low (`~0.166` vs native
`~2.555`). Reconstructing the uploaded edited HEIC's alternate HDR signal directly from
its primary + native gain map + ISO tmap yields a real scene-referred p99.9 near `5.25`,
proving that this capture contains substantial highlight range absent from the SDR-only
statistics. However, other native captures with similar nominal HDR headroom have
LinearImage whitePoint only around `0.30–0.35`, so whitePoint cannot safely be derived from
headroom or a fixed HDR percentile alone. Do not replace the fixed scale globally until
the CF-CM device matrix identifies which fields actually control Photos HDR rendering.

## 10.125 — Source Style parameters and native Portrait state are immutable (2026-10-19)

A real production bug was found while adding the new regressions. `web/src/styles/port.js`
previously allowed `nativePortraitRebuild` to replace a valid source MakerNote 0x54 with a
Bright compromise or the neutral profile Standard marker. That could silently reset the
user's Style controls. The automatic mutation has been removed: when a valid native 0x54
exists, reconstruction now keeps its payload and TIFF type exactly. The Bright compromise
is explicit-diagnostic-only via `opts.reconstructedBright===true`; a profile fallback is
reserved for the case where no valid native selection exists.

`IMG_1735.HEIC` provides a non-zero flattened Style fixture: Standard, Tone `-1`, Colour
`+1`, Palette `1`. The generic BZ + CE reconstruction preserves its six-key 0x54
byte-exact, and the reconstructed file remains `portraitEligibility === null` with no
native depth, so AI Portrait is still available normally.

Native Portrait preservation was verified independently with `IMG_1119.HEIC`. Before and
after the Styles/Texture graph reconstruction, the native depth payload hash is identical
(`45d75c8c74660a3c`) and its renderer-XMP hash is identical (`36affcc09a41351c`). The XMP
continues to report simulated aperture ƒ/2.8 and Portrait Lighting EffectStrength `0.5`.
The same reconstruction also preserves Style ID 16, Tone `-0.5`, Colour `+0.5`, Palette
`1`, and remains classified `existing-depth`, so the AI depth path cannot replace native
Portrait data. `1163_Off.HEIC` independently confirms the existing-renderer contract with
ƒ/4.5 and EffectStrength `0.5`. These source-owned depth/rendering payloads are now explicit
release invariants alongside the source 0x54 marker.

## 10.126 — CF-CM/CJ do not recover native HDR brightness; plist calibration branch closed (2026-10-19)

The user reports that every HDR calibration variant in the phone batch remains darker than
the original flattened edited source. This includes CK/CL/CM, full LinearImage CF, root
range/gain CG, combined CH, wider core CI and even full same-capture native Styles plist CJ.
Therefore the residual HDR attenuation is not controlled by the tested Styles-plist
calibration fields. Do not generate further plist-calibration variants for phone testing.

Local scene reconstruction provides an important separation: `IMG_1729 (2).HEIC` (the
flattened edited source) and CE `IMG_1864.HEIC` produce numerically identical HDR signal
from their primary + gain map + ISO tmap under the ISO formula (scene p99.9 about 5.25,
max about 5.29). Yet Photos displays CE darker. The attenuation is therefore an Apple
Photos interpretation/context switch caused by the reconstructed editable graph, not a
loss of gain-map image data or nominal headroom.

The strongest remaining structural distinction is the tmap application mode. The flattened
edited source uses `useBaseColorSpace=false` (flags 0) with offset 0.005, while the native
same-capture full editable graph uses `useBaseColorSpace=true` (flags 0x40) with tiny
0.00001 offsets. Historical experiments have not isolated the base-colour-space flag by
itself. Future device testing must be sparse: at most one evidence-backed candidate per
round, not a matrix. The bounded CN candidate toggled only `useBaseColorSpace` on the accepted CE contract;
every other payload and tmap numeric parameter remained exact. On-device, CN did not
improve HDR brightness and HDR disappeared when entering Edit. Therefore the single tmap
mode flag is not the missing contract and must not be promoted.

## 10.127 — Flattened and editable HDR use different gain-map/tmap encodings of nearly the same log-gain field (2026-10-19)

Local comparison of the same capture finally isolates a structural HDR conversion that
Photos performs when exporting the current edited rendition. The native full editable
`IMG_1729.HEIC` uses a 2856x2142 gain grid made from 15 monochrome 640x896 HEVC tiles.
The gain grid has `nclx 2/2/2` colour metadata, the tiles have no per-tile ICC profile, and
the editor tmap owns a large adaptive PQ ICC profile. The flattened edited
`IMG_1729 (2).HEIC` instead stores the same-size gain grid as 30 monochrome 512x512 tiles;
the grid and every tile carry Apple's 368-byte `Linear Gray` ICC profile, while the tmap
uses a simple P3/PQ `nclx` declaration. CE retains this flattened gain-map representation
and merely adds the legacy `auxC + auxl` editor routing, which makes Photos interpret the
samples under a contract they were not encoded for.

The raw gain maps are strongly related rather than unrelated images. Across 6,117,552
pixels, native-full vs flattened raw samples have correlation `0.9933311`; a direct affine
fit is approximately `native = 0.905866*flattened + 0.101537`. More importantly, decoding
each file's samples through its own ISO tmap curve shows that the underlying logarithmic
gain fields agree to mean absolute error about `0.0189 EV` (RMSE `0.0335 EV`). Re-encoding
the flattened log-gain field with the native full curve predicts the native raw gain map
with sample-domain MAE `0.00815` on [0,1], roughly two 8-bit levels. The same relationship
repeats with `IMG_1768.HEIC`.

This proves that Photos' current export re-encodes an almost identical HDR signal into a
different `(gain-map samples + tmap curve + colour/profile)` pair. Stylio cannot restore
an editable graph by adding `auxC/auxl` to the flattened pair. It has to convert the pair as
a unit: decode the source gain samples to log-gain using the source tmap, choose/derive an
editor-compatible target curve, re-encode the log-gain field into that target curve, and
emit the matching editor gain-map/tmap colour contract. Any conversion must preserve the
scene-referred HDR signal numerically before device testing.

Native editor tmap ICC profiles are adaptive rather than constant. Same-generation iPhone
16 captures contain image/style-specific ICC profiles with private Apple `HAGC` and `hdgm`
tags; the profile hashes and tag lengths vary by capture/style while `cicp` remains P3/PQ.
Therefore copying one donor profile or hardcoding one native tmap curve is not a valid
production solution. The next research work is source-derived editable HDR authoring,
including reconstruction of the adaptive gain-curve/profile contract. No new phone
candidate should be emitted until this conversion passes local log-gain parity and graph
invariants.

## 10.128 — Source-only HAGC parser + generic Display-P3/PQ ICC path passes local CMM and editor-state invariants (2026-10-19)

The source-only HDR work now has a standards-backed path that does not require reproducing
Apple's image-specific private ICC bytes. `web/src/raster/hagc.js` parses and serializes
SMPTE ST 2094-50 Application #5 payloads, including the Apple HAGC ICC wrapper and the
observed Apple one-byte-short internal length convention. The parser round-trips the native
HAGC payload byte-exact on the same-capture 1729 file and on the iPhone 16 Style corpus.
Across nine native iPhone 16 samples, `HAGC.baselineHdrHeadroom` equals `tmap.max` after the
native 1e-4 quantization (only a few 1e-5 floating-point difference). This makes HAGC
baseline headroom derivable directly from the uploaded edited file.

The module also implements ST 2094-50 Reference White Tone Mapping (RWTMO) expansion and
piecewise-cubic gain-curve evaluation. RWTMO is retained as the standards-defined fallback;
it does not pretend to reproduce Apple's custom per-image HAGC control points.

`web/src/raster/editable-hdr-pair.js` now provides the source-only mathematical core for
re-encoding ISO gain maps while preserving log2 gain. Tests verify that a flattened
(min=0, max=2.39648, gamma=1) 8-bit gain field can be re-encoded into the observed native
curve with mean quantization error below 0.004 EV without clipping. This code is not wired
into production yet.

A second important simplification comes from current Skia HDR ICC support. A valid HAGC
profile does not need Apple's private adaptive `hdgm`/13^3 CLUT bytes: Skia can author a new
Display-P3/PQ ICC v4.4 profile from public colour constants and attach the serialized HAGC
payload. `web/src/raster/pq-hagc-icc.js` ports that deterministic construction: 65-entry PQ
input curves, an 11^3 maxRGB-aware A2B CLUT, Display-P3 -> XYZ D50 matrix, identity B2A,
CICP 12/16/0/1 and a caller-supplied HAGC tag. No native/donor ICC payload is copied.

The generated 9,196-byte profile passes both internal structural tests and independent
LittleCMS/Pillow validation: LittleCMS opens it, reads the description, builds an RGB ->
sRGB transform and successfully transforms pixels. FFmpeg also decodes a HEIC whose tmap
`colr` is replaced by this profile without container/codec errors.

The local CE-derived HEIC experiment changes only the tmap `colr` property from P3/PQ nclx
to the generated Display-P3/PQ + RWTMO-HAGC ICC. All item payloads remain byte-exact,
including tmap metadata and every gain-map HEVC tile; the item-reference graph and source
0x54 marker are exact, and the worker still classifies the result `known-compatible`.
Cross-regression also passes on non-zero Style parameters and native Portrait: Standard
Tone -1 / Colour +1 is preserved; the no-depth file remains AI-Portrait eligible; the
Portrait fixture retains Style 16 Tone -0.5 / Colour +0.5, native depth hash
`45d75c8c74660a3c`, renderer hash `36affcc09a41351c`, aperture f/2.8 and Portrait Lighting
strength 0.5. Production remains unchanged pending one device-level ColorSync/Photos
validation of this standards-backed profile path.

## 10.129 — CO rejected on-device; weak HDR is traced to the reconstructed linear thumbnail losing the gain-map highlight tail (2026-10-19)

The user tested the generated-PQ/HAGC candidate CO on-device. `IMG_1917.HEIC` is SHA-256
byte-identical to the staged CO file, so transport/import did not mutate it. CO still renders
weaker HDR than the original flattened edited source and entering Photos Edit removes HDR
from the preview. Therefore a standards-valid generic Display-P3/PQ + RWTMO-HAGC ICC is not
sufficient to make Photos adopt the native editable-HDR contract. That branch remains useful
for standards research only and must not be promoted.

The remaining difference is now localized to the reconstructed `linearThumb`. CA/CE built
that 1024x768 resource from the SDR current primary by affine remap. This reproduces most
midtones but mathematically cannot represent the sparse HDR highlight tail carried by the
source gain map. Same-capture decoded statistics make the loss explicit. Native 1729
linearThumb luma has median `0.47393`, p99.5 `0.64144`, p99.9 `0.97776`, p99.99 `0.98069`
and max `0.99918`; CE/CA has nearly the same median (`0.47237`) but p99.9 only `0.64909`,
p99.99 `0.65136` and max `0.65951`. Thus the earlier low whole-image MAE hid a severe error
in precisely the specular pixels relevant to HDR editor reconstruction.

Reconstructing the uploaded edited source's alternate scene from its own primary + gain map
+ ISO tmap shows the missing signal directly: the same sparse highlights reach about `5.25x`
SDR white. Comparing native linearThumb against the CA primary-only prediction as a function
of the source gain sample gives a sharp high-gain residual. Below gain ~0.6 the residual is
small; gain 0.6-0.7 averages about +0.159 luma, 0.7-0.8 +0.215, 0.8-0.9 +0.255 and 0.9-1.0
+0.327. On the 2,371 same-capture pixels with `g >= 0.55`, a simple diagnostic fit is
`delta = 0.6915016*g - 0.3595679`, zero-crossing near `g=0.51998`, with residual-fit MAE
about `0.00941`. These coefficients are same-capture research evidence, not production
constants.

`tools/native-style-hdr-linear-thumb-candidate.mjs` builds one causal diagnostic CP from the
known-good CE graph. It keeps CE's original flattened tmap/nclx and every non-linearThumb
item payload and graph relationship byte-exact. It changes only the linearThumb samples,
adding `max(0, delta)` from the exact uploaded source gain map to the already accepted CA
midtone reconstruction. Only 13,175 of 786,432 thumbnail pixels (~1.675%) are changed.
After Main10 full-range HEVC encode/decode, CP's luma p99.9 is `0.97593` and p99.99 is
`0.97985`, essentially restoring the native `0.97776/0.98069` tail while preserving the
midtone distribution. Pixel-wise native-vs-thumbnail MAE improves from `0.01236` (CE) to
`0.01159`, RMSE from `0.02088` to `0.01432`, and worst-case error from `0.36425` to
`0.17539`. Worker classification remains `known-compatible`; Styles/Texture and the source
0x54 selection remain unchanged.

CP is therefore the only current phone candidate. Its purpose is to prove causality: whether
the missing HDR tail in `linearThumb` caused Photos' weak editable HDR. Even if CP succeeds,
production must derive a generic source-only linearThumb HDR transform from independent
native captures / the underlying Apple encoding rather than ship the 1729-fitted constants.

## 10.130 — Generic HDR-aware linearThumb reconstruction is implemented; Portrait call-site bug fixed (2026-10-19)

The production direction no longer uses CP's 1729-fitted residual. A generic source-only
model was fitted on eight independent native iPhone 16 captures from the Styles corpus and
validated with 1729 held out completely. The model combines the uploaded current primary
with scene-referred HDR reconstructed from that same file's one-channel ISO gain map/tmap:
`primary + HDR excess at scene thresholds 0.75 / 1.5 / 2.5 + bias`. On held-out 1729 the
primary-only model leaves p99.9 near 0.62, while the generic HDR hybrid restores the encoded
linearThumb tail to about 0.999 versus native 0.978 without materially moving the midtone
(median 0.4727 vs native 0.4739). Decoded hybrid-vs-native whole-thumbnail MAE is about
0.01248 and RMSE 0.01766. The native max itself is approximately 1.0, so no 1729-specific
hard cap is introduced.

The implementation now lives in `web/src/raster/hdr-linear-thumbnail.js`; the fixed
coefficients are corpus-trained, not per-photo. `web/src/codecs/linear-thumbnail.js`
recognizes a strict one-channel ISO `tmap` whose inputs are the current primary + gain grid,
samples both source grids directly at linear-thumbnail resolution, reconstructs scene HDR,
then encodes a native-shaped 10-bit full-range VUI 2/2/2 HEVC linear thumbnail. Supported
HDR graphs are forbidden from silently falling back to an SDR-only linear thumbnail.
`web/src/raster/heic-grid-sample.js` performs tile-local bilinear sampling so the browser
never needs a full-resolution RGB canvas for this reconstruction.

A separate production bug was found in `file-processor.js`: linear-thumbnail generation was
gated on `d.thumbnail === null`. Native Portrait flattened exports such as `IMG_1119.HEIC`
already contain an ordinary SDR thumbnail (`thumbnail=32`) while still having
`linearThumb=null`, so they bypassed the HDR-aware generator and the graft path could reuse
the ordinary thumbnail as the Styles linear resource. Both reconstruction call-sites now
gate on `d.linearThumb === null` instead. `graftPatch()` also prefers a real existing source
linearThumb over an ordinary thumbnail and supports construction-method-1 payloads. Thus
native Portrait inputs now receive the same HDR-aware linear reconstruction while keeping
the source depth/renderer state, and files with a genuine existing linearThumb are not
regenerated.

Targeted pure-JS regression tests initially passed 9/9 for HDR linear-thumbnail math, grid
sampling and native Styles rebuild preservation. No PQ/HAGC ICC replacement is part of the
production fix; CO/CN remain rejected research branches. Production source Style selection
(`0x54`, including non-zero Tone/Colour/Palette), Texture, native depth, aperture and
Portrait Lighting remain independent preservation invariants.

## 10.131 — Current-export routing bug fixed; HDR-aware reconstruction now actually runs in production (2026-10-19)

A second production control-flow bug was found after the HDR-aware linearThumb implementation
was complete. `nativeStyleExportTextureCandidate()` correctly recognized the proven iPhone
16/17 six-key Current-export shape, and `preserveIncomplete` correctly exempted it from
preserve-only. However, the later Texture-only branch still matched `textureOnly===true`
before graph reconstruction, so the candidate could be sent through `addTextureInWorker()`
instead of `patchInWorker()`. In other words, the new hybrid linearThumb could be correct but
never run for the exact 1729 class it was designed to repair.

The Texture-only route is now centralized in `useTextureOnlyNativeStylePath()`. A complete
native Styles graph remains Texture-only; ordinary native-style inputs remain Texture-only;
but a proven edited Current export and any native Portrait rebuild explicitly bypass that
fast path and continue to graph reconstruction. Tests cover presets 1/4/8/16 and the actual
`native-1.HEIC` / `native-2.HEIC` files where available. Opaque or unsupported native markers
still stay on preserve-only, and the same-capture unedited Bright full graph still produces
the previously device-working Texture output unchanged.

HDR linear-resource handling is now defended at three layers. The file processor generates
whenever `d.linearThumb===null`; `port.patch()` gives a specific error if a strict ISO HDR
pair reaches reconstruction without a generated/source linearThumb; and `graftPatch()` also
refuses an ISO HDR pair that would otherwise fall back to an ordinary SDR thumbnail. When a
real source linearThumb does exist, graft prefers it over the ordinary thumbnail, including
construction-method-1 payloads. A new synthetic regression proves both the refusal and the
source-linear preference.

The current focused regression set passes 20/20: Current-export recognition/routing,
complete-native Texture preservation, opaque-marker preserve-only, HDR linear-thumbnail
math, grid sampling, strict HDR linear-resource fail-safe, source-linear preference, and
native graph rebuild preservation. Service-worker cache is bumped to v226 and includes the
new HDR/grid modules so installed PWAs do not mix the new `linear-thumbnail.js` with stale
runtime dependencies.

## 10.132 — Linear-thumbnail invariant finalized; legacy compatibility preserved without SDR fallback (2026-10-19)

The linear-resource invariant is now global inside the Styles graft path: an ordinary SDR
thumbnail is never accepted as a Styles `linearThumb`. `graftPatch()` either receives an
explicit generated linear resource or reuses an actual source `linearThumb`; otherwise it
fails. `port.patch()` enforces the same boundary before graph mutation. This prevents the
original HDR regression from reappearing through another caller.

The stricter invariant initially broke direct legacy-compatibility callers that historically
relied on the source ordinary thumbnail. That path was repaired without weakening native/
Current reconstruction: `legacyCompatibilityExport()` now falls back to the real
`donor_linear_thumb_item` from the known baseline target profile when the caller does not
provide a source-derived generated linear thumbnail. App callers still provide the
HDR-aware source-derived thumbnail. No compatibility path silently substitutes the source
SDR preview anymore.

The focused native/current/compatibility regression set now passes 81/81. This covers the
Current-export router, native Portrait/Styles graph reconstruction invariants, strict
linear-resource handling, complete-native Texture preservation, compatibility firewall,
legacy recovery, mutation-budget checks and HEIC worker API behavior. No full-resolution
FFmpeg corpus run is required for this verification.

## 10.133 — Production headroom gate still used obsolete preset-replacement reports (2026-10-19)

The user supplies `IMG_1729 (3).HEIC` (native Current Standard) and the current website output
`IMG_1921.HEIC`. Device feedback: colours are stable in viewer and Edit, HDR is present in
the viewer, disappears inside Edit, then returns after saving. HDR is slightly weaker than
the native source. This supersedes any assumption that implementing the generic HDR-aware
linear thumbnail already validated HDR persistence on the device.

Direct comparison verifies exact source primary/HDR grid descriptors and all corresponding
HEVC tiles, exact ISO tmap, and exact selected Style marker. Both use alternate headroom
2.396483898162842 stops (ratio 5.265183813219286), gamma 1 and offsets 0.005. The output has
the HDR `auxC` and `auxl` but no Apple HDR headroom sidecar. Its graph contains 156 items.

The worker still enabled `registerTmapHdr({headroom:true})` only when the patch report was
`bright-palette70` or `portrait-standard`. Real source-selection preservation intentionally
stopped producing those labels, and the newly enabled Current-export path produces neither.
Thus the production path omitted the editor declaration even though the established E/F
reconstruction path included it. A worker-level regression reproduces the missing declaration
(0 rather than 1) before the fix. The worker now enables source-derived headroom for recognized
six-key native Current exports and explicit native Portrait rebuilds independently of preset
replacement labels. Existing complete-native Texture and opaque preserve-only paths retain
their prior behavior. No source Style parameter is changed.

`tools/repair-rebuilt-native-hdr.mjs` creates one bounded CQ repair directly from IMG_1921,
requiring its source native Current reference and verifying capture/selection identity plus
all image/HDR payloads. CQ adds exactly one HDR metadata item (433 bytes). Every existing
payload, property and outgoing reference, including the new HDR-aware linear thumbnail and
Styles/Texture graph, is byte-exact against IMG_1921. The headroom ratio is derived from its
own tmap; no gain samples, tmap curve, ICC, coefficients or brightness compensation change.
CQ is worker-readable and known-compatible. Its HTTP download matches the staged file exactly.
Physical Photos validation remains pending. Earlier CA/CE results also show that the presence
of this sidecar alone does not prove native HDR intensity, so the slight darkness is not
declared fixed and no rejected plist/ICC branch is reopened.

Validation also exposed eight pre-existing Portrait tests whose callers omitted the newly
required encoded linear thumbnail, and two of their expectations still required resetting a
real native selection to a compromise/default preset. These fixtures now explicitly supply
an encoded test linear resource and assert the real source Style/Tone/Colour/Palette remains
exact. All 42 Portrait tests pass, including source depth, aperture, HDR and renderer checks.
The complete targeted run passes 69 tests, skips 4 absent optional fixtures, and has no failures.
PWA validation initially found three uncached research runtime modules; those modules are now
listed without enabling their experimental conversion paths. PWA check passes. Cache is v227.

## 10.134 — CQ confirms HDR persists in Edit; isolate gain-map colour-carrier metadata (2026-10-19)

The user confirms CQ keeps HDR when entering Photos Edit. The remaining issue is slightly
lower HDR brightness than the native Current Standard source. CQ is now the device-accepted
HDR-presence baseline; production retains the v227 worker headroom fix. This feedback does
not establish exact native HDR intensity or calibration parity.

A distinct, previously untested carrier difference remains. The flattened source and CQ
associate a 356-byte GRAY ICC with the gain grid and each of its 30 tiles, plus an unspecified
full-range nclx 2/2/2 declaration on the grid. The native full Styles capture uses only that
nclx declaration on its gain grid and no tile colr. The inherited ICC has identity kTRC
(`curv`, one gamma value 1.0) and D50 white point; it is a data-channel profile, not the
Display-P3 primary image profile. Whether Photos interprets it differently after Styles
reconstruction is a hypothesis, not an established cause of the attenuation.

`tools/native-style-gain-data-color-candidate.mjs` creates one CR diagnostic from accepted CQ.
It removes only those 31 identity Gray ICC property associations. All 157 item payloads,
references and unrelated properties remain exact: primary image/profile, gain samples,
ISO tmap equation, editor headroom, linear thumbnail, Styles, Texture, Exif and selected
Style controls are unchanged. Thus the raw ISO gain signal remains mathematically identical;
this is not a brightness multiplier or a rescaled gain map. The remaining grid declaration
matches the native data-only nclx shape. Worker classification is known-compatible and the
HTTP download matches the staged file exactly. CR is not enabled in production until device
testing establishes brightness, colour, Styles/Texture and HDR persistence. No rejected
Styles-plist, tmap-mode or generated-PQ/HAGC branch is reintroduced.

## 10.135 — CR rejected; isolate unproven prefilter research, retain CQ (2026-10-19)

The user reports CR really does not look different from CQ. Removing the identity Gray ICC
associations therefore has no observed HDR-brightness benefit and is not enabled in the
production route. CQ remains the device-confirmed baseline for correct colour, Styles/Texture
and HDR persistence in Edit; exact HDR brightness against native is still unresolved.

One further diagnostic examined the order of HDR scene reconstruction and thumbnail
downsampling. The corpus model reconstructs scene HDR before resizing, while the accepted
browser sampler first averages encoded primary/logarithmic-gain samples. A synthetic sparse
highlight demonstrates that these nonlinear operations differ. A sparse-neighbour version
was implemented temporarily and exercised through the actual browser sampling functions
with a native FFmpeg decoder adapter on the supplied Current export. The source upload alone
supplies every output resource; the unedited Bright original is read only as a metric
reference. This does not execute Apple's Photos renderer.

Measured raw prediction MAE changes from 0.01260687997 to 0.01258813036, only 0.1487% relative;
RMSE changes from 0.01797599586 to 0.01794612195. In the native-reference luma >0.9 region,
the mean signed error is already positive (+0.02449245), and the experiment increases it
slightly (+0.02452874). Thus neither the small aggregate improvement nor a blanket headroom/
gain increase establishes a fix for the user's HDR-intensity symptom. A generated CS file
changes only the reconstructed linear thumbnail and its codec description, retains all
other CQ item payloads/references, and passes container checks. It was NOT served or tested
on the phone and must not be described as visually validated.

The complete prototype and its mathematical tests are isolated in ignored
`artifact/build/hdr-1921/prefilter-research/`, with metrics in
`artifact/build/hdr-1921/IMG_1921_CS_HDR_Prefilter.HEIC.json`. Its temporary browser changes
and tracked-tree tool were removed, retaining the accepted CQ implementation and v227.
Twelve isolated research tests pass; the accepted native/Portrait/HDR regression set still
passes 69 tests, skips 4 optional fixtures, and has no failures.

No Current export of CQ after Photos Edit/Done has been supplied yet. The existing
IMG_1921 predates CQ's headroom repair and any re-render performed by Photos. A same-capture
post-edit Current export of CQ, paired with the existing native Current Standard file, is
the next required artifact for measuring the actual rendered HDR discrepancy. Do not infer
native display parity from item hashes, numerical maximum headroom or synthetic model tests,
and do not replace the accepted baseline with another visually unproven compensation.

## 10.136 — IMG_1925 isolates HDR reader ambiguity; CT supplies a separate Apple fallback (2026-10-19)

The requested post-Edit/Done Current export is supplied as
`C:/Users/WanThinnn/Downloads/IMG_1925.HEIC` (2,073,340 bytes; SHA-256
`2e55bcb1705d081ffbc5fa3c13ac1ad3a0ae6b251543c5a74fe198614fe8dd96`). Photos removes
the ISO tmap and standalone Styles/Texture graph from this rendered export, retains the
same six-key Standard selection, and writes an Apple auxiliary HDR map with version 131072
and headroom 5.265183925628662. The native Current/CQ ISO headroom is 5.265183813219286;
the difference is float rounding, not an observed headroom reduction. This inventory does
not imply that Photos has lost controls on the asset kept in its library.

The gain field remains 2856x2142; Photos retiles 30 512x512 tiles into 15 640x896 tiles.
Independent FFmpeg luma decoding finds 84.04% identical gain codes at the sampled positions,
with mean absolute difference 0.2041 of one 8-bit code. The primary ICC profile is byte-exact
against native. Mean encoded primary-channel difference is 0.00881146; the Texture nudge
and Photos rendering mean this is not an exact no-op pixel comparison. Stored orientation
is checked and is identity for both supplied files.

Version 131072 alone does not prove which gain equation a reader uses, as already noted in
10.70. The comparison therefore evaluates both interpretations explicitly. Treating IMG_1925
as normalized logarithmic gain with zero offsets leaves the brightest region about 0.4%
below source, while much of the image is slightly above source. Applying the documented
Apple Rec.709 multiplier equation instead gives integrated luminance about 9.3% below source.
These are numerical interpretations of the actual exported planes, NOT measurements of
the iPhone display and NOT proof of which internal Photos reader ran. The latter is a
specific hypothesis consistent with the user's slight HDR attenuation. Relevant primary
sources: https://developer.apple.com/documentation/appkit/applying-apple-hdr-effect-to-your-photos
and https://raw.githubusercontent.com/google/skia/main/src/shaders/SkGainmapShader.cpp .

`tools/lib/iso-apple-fallback.mjs` implements a diagnostic conversion from source ISO scene
luminance to an independently encoded Rec.709 Apple auxiliary map. It includes the actual
source ISO offsets, uses the same source-derived headroom, and reports clipping and black
pixels that a zero-offset single-channel multiplier cannot represent. Two mathematical
tests fail for the old relabel-only samples, then pass after conversion. All four new math
tests pass, and the targeted HDR/native set passes 18 tests. This verifies the diagnostic
equation, not the user's device symptom.

`tools/native-style-apple-fallback-candidate.mjs` builds a single CT diagnostic from accepted
CQ and the supplied Current Standard only; the original Bright capture is not read or
imported. CT keeps the source ISO gain grid/tiles and tmap exact for ISO readers. It removes
the Apple auxiliary role from that ISO numerical plane, adds a separate source-derived
Apple map (grid 158 plus 30 losslessly encoded tiles), and retargets HDR sidecar 157 to that
map with version 65536 and the same headroom. All prior payloads except that one HDR XMP
remain exact, including primary, Exif/Style selection, linear thumbnail, Styles, StyleDelta,
Texture, source ISO gain samples and tmap. Their protected property associations also stay
exact. This is not the rejected original-Bright/editor-base branch or a global HDR boost.

On all 6,117,552 source gain pixels, the old relabel-only Apple interpretation has mean
absolute scene-luminance error 0.06348968 and integrated ratio 0.89145149. CT's converted
Apple interpretation has error 0.00112112, integrated ratio 1.00011827, and integrated
absolute error 0.1917% of source luminance. There are 306 over-headroom samples and 306
unrepresentable black samples; exact RGB/offset recovery is not claimed. A separate decode
of all 30 encoded CT tiles matches the converted pixel array exactly. The complete output
is 2,997,240 bytes, SHA-256
`32fc16dc30c35928cf6c3748bbd7ae72f37018b2945b198ee1a9245f57090e8a`, and worker-read
classification is known-compatible. Numerical reports and independent audits are ignored
under `artifact/build/hdr-1921/`.

CT and accepted CQ alone are served on a one-hour allowlisted Wi-Fi page; the downloaded
CT is byte-exact and unlisted files return 404. CT still needs physical confirmation of
HDR brightness, HDR persistence in Edit, correct colour and Styles/Texture controls before
any production adoption. Two gain planes require explicit pipeline support: the ordinary
discovery hdrGrid selector prefers the Apple auxiliary, which deliberately differs from
the ISO tmap input. Do not silently ship this diagnostic through the existing single-plane
worker. Production remains on CQ routing/cache v227, on master, uncommitted.

## 10.137 — CT still slightly dark; CU isolates the Apple gain transfer curve (2026-10-19)

Device feedback for CT is "temporarily okay, still slightly darker than the original."
This is not a claim of exact native parity or a quantified improvement over CQ, and no
separate post-save CT export has been supplied. No new colour/control failure is reported.
Production remains on the accepted CQ route while the residual is investigated.

Three bounded hypotheses are considered: a different auxiliary gain transfer, reduced
declared headroom, and quantization. Headroom is still source-exact, and CT's integrated
bias under its intended Rec.709 equation is slightly positive (+0.0118%), so a uniform
brightness increase is not justified by either of those latter measurements.

There is a specific alternative transfer in primary source code. Skia's Apple gain-map
shader uses `sample^1.961` rather than the exact piecewise Rec.709 inverse:
https://raw.githubusercontent.com/google/skia/main/src/shaders/SkGainmapShader.cpp .
This is evidence about Skia, NOT evidence that Photos uses Skia or that iOS necessarily
uses the same approximation. The diagnostic prediction is that if that power reader is
selected, the CT curve will under-represent scene luminance slightly, and an inverse of
that exact power must recover the source signal without changing source headroom or colour.

The prediction is measured on all 6,117,552 source gain pixels: CT's Rec.709 codes under
the power reader produce integrated ratio 0.98906734 (about 1.09% lower) and integrated
absolute error 1.1294%. An inverse-power-1.961 encoding produces ratio 1.000099999 and
integrated absolute error 0.2035%. Bright-region ratios vary with threshold; this is not
a global gain/brightness factor and is not a measured percentage of iPhone display loss.
Both endpoints retain their gain range, and the 306 clipped / 306 unrepresentable-black
limitations of the single-channel fallback remain reported.

`isoToAppleFallback()` now permits only two explicit diagnostic transfers: the default
`bt709` used for CT, and `power-1.961`. Unknown transfer names fail instead of guessing a
gamma. Two new tests fail before that option is implemented, then pass; the previous four
math tests also pass. This changes no browser runtime or public processing behavior.

The single CU device diagnostic is generated from the same CQ and uploaded Current file
with `--apple-power-1961`. It is 2,955,623 bytes, SHA-256
`5e7d6a1aee3e63bb0ec7fedb33d366b4eef413e932af85a4d6f2eb302d02c246`.
An independent decode matches all 6,117,552 expected power-encoded gain pixels exactly.
Comparison against CT proves only its 30 auxiliary HEVC tile payloads differ: every other
item payload, every item property including hvcC/colour, all graph references, source ISO
gain/tmap, primary pixels/profile, Style selection, Styles/Texture and linear thumbnail
remain exact. Worker-read classification remains known-compatible. Reports and audits are
under ignored `artifact/build/hdr-1921/`.

The focused HDR/native/diagnostic set passes 20 tests. CU and CT alone are available through
the one-hour allowlisted Wi-Fi page; CU's HTTP download is byte-exact and unlisted files
return 404. Device brightness, colour, HDR persistence in Edit and Styles/Texture controls
remain pending for CU. A favourable curve-only result will not by itself establish generic
support for the dual-plane graph; explicit production reader/routing support is still
required before replacing CQ. Master remains uncommitted and browser cache remains v227.

## 10.138 — Accept the residual HDR difference and publish the proven route (2026-10-19)

The user reports CU is still essentially the same, explicitly accepts a small HDR brightness
reduction, and authorizes committing and pushing on master provided the original-photo
pipeline remains safe. No extra HDR compensation is required for this delivery.

The selected release is the existing CQ/v227 browser route: recognized iPhone 16/17 Current
exports reconstruct the missing editor graph using the uploaded selection/pixels and the
source-derived HDR-aware linear thumbnail, then declare source HDR headroom. Full native
originals keep their existing Texture-only route. CT/CU supplied no clear device benefit
that warrants adopting their dual-plane graph; they and the offline candidate generators
remain local research. The release does not enable a guessed brightness factor, native
donor image, replacement preset, PQ/HAGC conversion, or auxiliary-gamma experiment.

Original-photo verification exercises the real file processor/classifier/worker with AI
disabled. The supplied original Bright IMG_1729 output matches the historical stylio-1
control byte-for-byte; HDR-native likewise matches HDR-stylio byte-for-byte. Every source
payload, property and outgoing reference is preserved by those tests. A portable complete
native-graph regression covers presets 1/4/8/16, non-neutral controls, equality with the
existing Texture writer, input immutability and repeated processing without duplicate
Texture/HDR resources. It fails if the processor enters profile/decode/rebuild branches.
The new original/edited-native regression group is required by both browser CI and the
GitHub Pages pre-deployment checks.

The release validation set passes 280 tests, skips 17 absent optional private fixtures and
has zero failures across processing, native Styles/Texture/HDR, Portrait, compatibility
recovery, raster/HDR JPEG import, Soft Skin, Live Photo, metadata, UI wiring and release
asset versioning. PWA consistency and all three UI languages pass. This is not a claim of
exact native HDR rendering; the known slight difference is accepted by the user. Personal
HEICs, decoded caches and LAN download artifacts are excluded from the source commit.

## 10.139 — Third-party Indigo HDR export contract correction (2026-10-19)

The new report supplies IDG_20261019_165921_779.jpg and two Stylio HEICs,
IMG_1906_styles-texture-only and IMG_1905_styles-texture_portrait_light. The
user reports both exports display without HDR. The JPEG reader already recognizes
the source: 3024x4032 Display P3 base, 1512x2016 RGB gain map, Adobe per-channel
signed bounds, gamma 1, offsets 1/64 and alternate headroom 3.366322 stops
(10.31249847 linear). Both old HEICs retain that metadata and the gain image;
this is not an absent-gain-map import failure.

Confirmed structural problems: generated HDR imports inherit an Apple legacy
auxC/auxl role without an Apple rendering declaration, the Styles-only file
does not advertise the tmap compatible brand, and the Portrait assembler can
retain its template's outgoing gain auxl when the source has no such reference.
The no-alternate-ICC Adobe path also declares an extended-linear derived
rendition rather than PQ. These are competing rendering contracts; which one
caused the observed Photos fallback has not been isolated on a physical device.

The local correction keeps imported scalar/RGB ISO gain maps on the source
tmap/Adobe contract, removes the generated placeholder's Apple legacy role,
advertises tmap, declares the no-alternate-ICC rendition as PQ in the source
primaries, and prevents Texture registration / Portrait assembly from restoring
the removed role. Existing alternate ICCs are preserved. This supersedes the
extended-linear no-ICC declaration described in 10.36. Native one-channel
reconstruction and existing Apple HDR contracts retain their previous route.
No channel averaging, arbitrary headroom boost, or gain equation substitution
is introduced. PWA cache is v228.

An initially failing portable regression runs imported scalar and RGB metadata
through actual Texture workers and Portrait assembly, checking the ISO graph,
brand, source metadata, gain payloads and HDR colour declaration. The browser
repro runs the real JPEG decoder and HEVC encoder on the supplied JPEG, with AI
Detail disabled. Its 48 primary and 12 gain tile payloads match IMG_1906 exactly;
all source gain metadata also matches. A second output reuses the same photo's
existing IMG_1905 depth payload through the current Portrait assembler. This
does not retest depth inference. Both outputs retain Styles and the RGB HDR
contract; their physical iPhone viewer/Edit HDR appearance is still pending.

Validation: 282 passed, 17 absent optional private fixtures skipped, zero failed;
PWA, language consistency and whitespace checks pass. Native original Bright
and HDR controls still match the historical Stylio outputs byte-for-byte.
Do not claim universal third-party-camera compatibility or confirmed Photos HDR
appearance from these structural checks. Photos and LAN artifacts remain local.

## 10.140 — Indigo A/B rejected on iPhone; HDR alternative visibility (2026-10-19)

The user explicitly reports BOTH A (Styles/Texture) and B (Portrait/Lighting)
still have no HDR. The contract correction in 10.139 is NOT a device-validated
fix. Its passing graph tests cannot establish Photos HDR. No push/deployment
has been performed for this work.

Comparing raw ItemInfoEntry flags reveals the generated Styles-only tmap has
hidden_image=1. Native IMG_1729 / its Current Standard export have visible tmap
items. The shared addItems writers mark every added item hidden by default,
including a displayable tmap alternative. The local correction makes only tmap
visible by default, retains hidden tiles/auxiliaries, and permits an explicit
hidden override in both core and raster writers. The new call-site regression
was observed failing on the hidden HDR item before this change. PWA is v229.

IMPORTANT: B already has a VISIBLE tmap copied into the Portrait template, so
visibility alone cannot explain the complete reported bug. Do not conclude
that this is the common root cause or that HDR is now fixed.

Private phone controls C/D/E retain all image/gain payloads. C strips generated
Styles/Texture resources and restores the source JPEG Exif; D selects that
same HDR derived item as primary; E selects it as primary with Styles retained.
D/E explicitly clear the hidden flag on their selected primary. These are
diagnostic graphs, not production routes: existing processing discovery assumes
an SDR primary and cannot yet treat tmap as its primary image role.

F is the narrow visibility control: it differs from rejected A in EXACTLY ONE
BYTE, clearing the tmap hidden flag; all image/Styles/HDR payloads, properties,
references, selected style and file size remain exact. A corresponding attempt
on B changes zero bytes, confirming B already has the visible flag, so that
duplicate is not offered as a purported new fix. C/D/E/F phone results are
pending. No RGB gain conversion, monochrome averaging or headroom boost has
been introduced in this follow-up. Validation now passes 283 tests with 17
optional private-fixture skips and zero failures; Native controls remain exact.

## 10.141 — HDR-primary E viewer succeeds; Photos editor repair remains experimental (2026-10-19)

The latest iPhone correction supersedes the pending E/F result in 10.140:
E (tmap selected primary, Styles retained) displays HDR in Photos, but editing
and saving loses HDR. F (one-byte visible-tmap-only control) does not display
HDR. Hence selection of the HDR-derived primary is material to viewer HDR;
there is a separate unsolved editor/save contract problem. Do not conflate them.

The previous Codex worktree already contains an opt-in `importedIso` branch of
`registerTmapHdr`, which registers the gain as an Apple HDR auxiliary linked
to the base and tmap primary, optionally providing HDR headroom XMP. The local
`tools/repair-imported-hdr-editor.mjs` script produces non-production phone
validation files without changing existing item payloads. This run additionally
added regression for adding headroom in a SECOND step after adding the auxiliary
role, checking that subsequent registration is idempotent. The targeted
`node --test tests/web/jpeg-hdr.mjs` passes 16/16. Physical iPhone results of
the two candidate variants have NOT been received; HDR preservation after
Photos Edit → Save is not verified. No production routing change, commit, push,
or bulk corpus/FFmpeg run was performed in this continuation.

## 10.142 — I/J rejected; transient HDR identifies a reader handoff, RGB dual-plane diagnostics K/L (2026-10-19)

Device result: both I (editor auxiliary only) and J (editor auxiliary + headroom)
briefly show HDR for about 0.3 seconds after opening in Photos, then fall back to
SDR. Entering Edit is SDR and saving an edit remains SDR. This rejects relabeling
the Indigo RGB ISO gain plane itself as an Apple legacy HDR auxiliary, with or
without the headroom sidecar. The transient flash is consistent with Photos first
rendering the HDR-primary ISO tmap and then switching to an incompatible editing/
legacy rendition; it is not evidence that the file lacks HDR data.

The new diagnostic direction keeps E's RGB ISO plane and tmap byte-exact and adds
a separate one-channel Apple auxiliary. `isoRgbToAppleFallback()` reconstructs
the HDR alternate per RGB channel using the source per-channel min/max/gamma/
offsets, collapses the result to Display-P3 luminance, and solves Apple's scalar
legacy multiplier without changing source headroom. Its math regression passes.
`tools/indigo-rgb-apple-fallback-candidate.mjs` builds K with the Apple auxiliary
linked only to the HDR-primary tmap and L linked to both the SDR base and tmap.
Both preserve every pre-existing E item payload, including RGB gain item 50,
tmap 98 and Styles resources. K/L are device diagnostics only; production routing
remains unchanged until Photos viewer/Edit behavior is confirmed.

## 10.143 — CQ topology comparison identifies the production graph bug; M is generated by the real app path (2026-10-19)

K/L are rejected on-device: Photos does not retain HDR. The investigation therefore returned to the production importer rather than transport/download behaviour. A fresh CQ reference was regenerated from the supplied native Current Standard `IMG_1729 (3).HEIC` and `IMG_1921.HEIC` with `tools/repair-rebuilt-native-hdr.mjs`. CQ is the previous device-confirmed baseline that keeps HDR in Photos Edit.

CQ keeps an SDR grid as `pitm`; its visible HDR rendition is a non-primary `tmap` alternative, and its Apple HDR gain auxiliary targets only the SDR primary. By contrast, E/K made `tmap` the primary, and the raster importer also had a blanket rule that appended the tmap to every primary-targeting `auxl`, which would turn an Apple gain relation into `[SDR, tmap]`. Both differ from the accepted CQ editor graph.

The RGB third-party path now uses two gain resources because Indigo's RGB ISO/Adobe equation cannot be represented safely by relabelling the same plane as Apple's scalar auxiliary. The original RGB ISO grid remains the exact second input of `tmap`; `rgbIsoToAppleGain()` reconstructs the HDR alternate per source RGB channel, collapses it to luminance, and produces a separate scalar Apple gain map. The app encodes that fallback as 8-bit monochrome HEVC, declares `urn:com:apple:photo:2020:aux:hdrgainmap`, links it by `auxl` to the SDR primary only, and supplies a source-derived `HDRGainMapHeadroom` sidecar. The SDR grid remains `pitm`; Styles, Exif, thumbnail and linear resources continue to describe both SDR and tmap.

Targeted regression now passes 24/24, including RGB/scalar ISO preservation, CQ-shaped dual-plane topology, Texture and Portrait propagation. A real browser/app import of `tests/private-fixtures/indigo-hdr/input.jpg` with AI Detail disabled completed successfully and produced `Indigo_M_CQTopology_AppPipeline.HEIC` (8,850,571 bytes). Its audited graph is `primary=1`, `tmap 98 -> [1,50]`, separate Apple HDR grid `100`, and `auxl 100 -> [1]`. M is generated through the actual `importRaster()` + FFmpeg.wasm path, not an offline graph patch. Physical iPhone result: M keeps HDR and Styles/Texture, including Photos Edit/Save compatibility, but its colour appears roughly 5-10% less saturated than the original Indigo JPEG.

The original file supplied later at `C:\Users\WanThinnn\Downloads\project-indigo-hdr-issue\iCloud Photos\IDG_20261019_165921_779.jpg` is byte-identical to `tests/private-fixtures/indigo-hdr/input.jpg` (SHA-256 `827b4b9de6421eb32db755dd5ab528e4e73eb7a1c6437f30212412a03f85935c`). A bounded 378x504 colour diagnostic over 118,151 HDR pixels confirms the reason M can lose chroma: M's Apple auxiliary is one-channel scalar, so it preserves base chromaticity while the source RGB ISO gain changes R/G/B independently. Mean scalar saturation is 97.65% of source HDR saturation and regional deviations are materially larger. The scalar RGB scene MAE is about 0.02746 linear.

Candidate N keeps M's proven CQ topology and changes only Apple auxiliary item 100 from mono to a per-channel RGB Apple gain representation. The RGB Apple equation reduces full-resolution mean absolute scene error to 0.000718 (about 38x lower than the scalar diagnostic), while all non-Apple-tile item payloads remain exact. N audits as `primary=1`, `tmap 98 -> [1,50]`, Apple RGB grid `100`, `auxl 100 -> [1]`; Styles marker/resources are unchanged. `node --test tests/web/jpeg-hdr.mjs tests/web/iso-apple-fallback.mjs` passes 25/25. Device result: N preserves HDR/Styles and fixes the visible colour loss, but HDR luminance remains roughly 5-10% below the original JPEG.

The remaining luminance error is a representation/version mismatch, not missing HDR energy. N's sidecar declares `HDRGainMapVersion=131072` (`0x20000`), while its RGB auxiliary samples were encoded with the legacy `0x10000` Rec.709 linear-multiplier equation. Existing runtime code already documents that `0x20000` is the normalized logarithmic representation. Decoding N's actual post-HEVC samples according to the version it declares predicts source-luminance ratios of 94.53% for HDR >=0.5, 93.67% for HDR >=1, 92.39% for HDR >=2 and 91.58% for HDR >=4, directly matching the reported 5-10% attenuation. Interpreting the same decoded samples under the legacy equation is about 99.43%, proving the codec itself is not the cause.

Candidate O keeps N's graph, RGB Apple auxiliary, headroom, colour properties, hvcC, Styles, ISO tmap and XMP version unchanged, but encodes the 12 Apple HDR tile payloads as per-channel normalized `log2(multiplier)/log2(headroom)` samples required by `0x20000`. Full-resolution pre-codec scene MAE is 0.000672. After HEVC decode, the declared log representation reconstructs integrated luminance at 99.456% overall and 99.41-99.47% across HDR thresholds 0.25-4.0; the remaining ~0.5-0.6% is codec/YUV420 loss. Focused HDR tests pass 26/26. Physical result: O keeps the corrected colour and HDR/Edit behaviour, but the user still sees roughly 10% less HDR brightness than the original JPEG. This demonstrates that the residual viewer difference is not primarily the new Apple fallback sample equation.

Historical `IDG_*` review identifies a regression introduced by 10.139. The device-accepted `IDG_20251020_HDR_Fixed.HEIC` and retained `IDG_20261009_HDR_Fixed.HEIC` both keep the RGB gain grid as `tmap 98 -> [1,50]`; the newer Adobe/no-alternate-ICC file declares the derived tmap rendition as full-range Display-P3 extended-linear `nclx(12,8,0)`. 10.139 changed this no-alternate-ICC declaration to PQ `nclx(12,16,0)` while also removing the inherited Apple aux role. O still uses that PQ tmap declaration. Since correcting O's separate editor auxiliary did not change device brightness, the tmap colour declaration is now the leading viewer-side regression candidate.

Candidate P changes exactly one property from O: tmap item 98's `colr` transfer is restored from PQ 16 to linear 8, preserving P3 primaries 12, matrix 0 and full range exactly as `IDG_20261009_HDR_Fixed.HEIC`. Every item payload, graph reference, ISO RGB gain, Apple editor fallback, Styles/Texture resource, headroom and codec property remains exact to O. Device result: P restores the Photos viewer to the desired source-like HDR brightness and colour, confirming the PQ declaration from 10.139 was a viewer regression. However, entering Photos Edit becomes visibly less saturated and the lamp/highlight region clips brighter, so the editor rendition is still inconsistent with the corrected viewer.

The Edit mismatch exposes two deterministic runtime regressions that predate P. First, `importHdrJpeg()` was building the Styles linear-thumbnail resource from the SDR `working` image only, despite the earlier 10.130 invariant that supported HDR editor resources must reconstruct the HDR scene rather than lose the highlight tail. Second, `rgbIsoToAppleGain()` emits Apple's legacy Rec.709 scalar-multiplier samples while `buildRasterHeic()` declared that separate auxiliary as version `131072`/`0x20000`, the normalized-log representation. Historical CT used the same scalar conversion with the matching `65536`/`0x10000` declaration.

Candidate Q combined three editor-side changes at once: the P viewer tmap fix, a new HDR-aware Main10 linear thumbnail, and a mono Apple fallback declared as version 65536. Physical iPhone result is a hard rejection: Q loses HDR entirely. Therefore Q is not a valid baseline and none of its editor-side changes may be promoted as a group. The Q-specific runtime changes were rolled back; only P's device-proven extended-linear tmap declaration remains under consideration. No commit or push has been performed.

Candidate R isolates the next experiment correctly. It starts from device-proven P and replaces only linear-thumbnail item 65 with Q's HDR-aware Main10 payload/properties. A dedicated verifier confirms every other item payload is byte-exact to P, all graph references are exact, and every non-linear item property is exact. Consequently R keeps P's `tmap 98 -> [1,50]`, RGB ISO plane, RGB Apple auxiliary item 100, version 131072, source headroom 10.312498469, Styles/Texture graph and all viewer-side contracts unchanged. Only item 65 differs; it remains targeted to `[1,98]` and now carries Main10 full-range 2/2/2 VUI. `Indigo_R_Plus_HDRLinearThumbOnly.HEIC` is 10,680,928 bytes with SHA-256 `39648b0aa5996bdaec4c3b3f106000c658f0a898b7ad3b88f075397eb3dfc3ef`. Device result: R preserves the good P viewer, but entering Edit still makes colour slightly pale and bright lamps more clipped. This rules out linearThumb as the primary remaining cause.

The repeated Edit mismatch is now tied to the Apple editor auxiliary representation itself. CQ's accepted editor gain grid is monochrome 8-bit; its grid and tiles carry the generic 368-byte `Linear Gray` ICC profile, tiles have no `pixi`, and HEVC VUI is full-range 2/2/2. P/R instead expose item 100 as a three-channel RGB 8-bit 4:2:0 image with P3/sRGB-like `nclx(12,13,6)` metadata. Viewer correctness does not validate that auxiliary because the P viewer is driven by the separate ISO RGB tmap. When Photos enters Edit it can switch to the Apple auxiliary, making the RGB-vs-mono contract mismatch a direct explanation for the pale colour/highlight clipping.

Candidate S therefore keeps P byte-exact outside the Apple auxiliary and rewrites only item 100 plus tiles 101-112 into a native-shaped monochrome normalized-log `0x20000` gain map. It reconstructs source HDR luminance from the original Indigo per-channel ISO equation, encodes `log2(multiplier)/log2(headroom)`, retains version 131072 and source headroom 10.312498469, and uses CQ's generic Linear Gray profile plus mono full-range 2/2/2 HEVC shape. Local reconstruction MAE is 0.000744 linear; graph refs and every non-Apple payload/property remain exact to P. `Indigo_S_Plus_NativeMonoEditor.HEIC` is 11,850,591 bytes, SHA-256 `c7613088b4748c94f24d1f4895b5b7e77f6ec678f2b759541707291b23b6a58f`. Physical result: View, Preview and Edit are now mutually consistent, but HDR colour is still slightly less saturated than the original JPEG, most visibly in green foliage. The user then isolates this to HDR only: with Low Power Mode disabling HDR, the Stylio HEIC and original JPEG match 100% in colour. This rules out SDR primary pixels, base ICC and ordinary JPEG/HEVC colour conversion as the cause.

A source-equation diagnostic explains the residual green loss. Across all 3,048,192 gain-map pixels, a scalar/mono reconstruction retains about 95.99% of source HDR saturation. On 154,495 green-dominant HDR pixels, the source mean saturation is 0.42710 while the mono reconstruction is 0.27232, only 63.76% of source saturation; green-channel linear intensity itself remains about 95.85%. This is exactly the expected limitation of replacing Indigo's per-channel RGB gain with one scalar gain: SDR chromaticity is preserved while the source HDR chromaticity change is lost. Do not compensate this with a global saturation boost.

Candidate T tests a two-rendition topology without changing a single existing pixel payload. Starting from S, it adds one extra SDR grid item 139 whose payload, properties and 48 dimg tiles reuse the existing primary bytes exactly. `pitm=1` remains the editor base with the mono Apple auxiliary; `tmap 98` is changed only from `[1,50]` to `[139,50]`, so the RGB ISO HDR viewing rendition no longer shares the same base item as the Apple editor auxiliary. The `altr` group remains `[98,1]`; every original item payload/property and every non-tmap reference stays exact to S. `Indigo_T_SplitDisplayBase.HEIC` is 11,850,759 bytes, SHA-256 `1e3d2006581708f64d92657ba1653e111e2b8332f95bd909624fb93853099cc2`. Device result: T is visually unchanged from S; HDR green remains slightly desaturated while SDR Low Power Mode still matches the source. Splitting the tmap base item alone is therefore insufficient.

Candidate U isolates the remaining alternate-group coupling. It is byte-identical to T in every item payload, item property and iref relationship; only the HEIF `altr` membership changes from `[98,1]` to `[98,139]`. Device result: U is visually unchanged from S/T; HDR green remains slightly desaturated. This confirms Photos prefers the Apple HDR auxiliary independently of this `altr` topology. Stop further topology-only attempts with a separate mono Apple gain.

Historical `IDG_20261009_HDR_Fixed.HEIC` reveals a useful structural contract: there is no separate mono editor gain. The same RGB ISO gain grid 50 is both `tmap 98 -> [1,50]` input and Apple HDR auxiliary with `auxl 50 -> [1,98]`; the raw Adobe hdrgm RDF sidecar 99 targets gain 50. Candidate V restores exactly that semantic role on the current source while keeping every payload byte exact to P: the old separate fallback 100-113 is merely demoted by removing its auxC/auxl/cdsc role, RGB gain 50 receives the Apple HDR auxC, and the source Adobe XMP remains unchanged. Candidate W additionally removes only the `tmap` compatible brand so the ftyp brands also match that retained historical file (`heic/mif1/heic`). Contract audit of W versus `IDG_20261009_HDR_Fixed.HEIC` matches primary=1, tmap=98, RGB/Apple gain=50, auxl `[1,98]`, tmap colr `nclx(12,8,0)`, gain colr `nclx(12,13,6)` and compatible brands. All item payloads, refs and unrelated properties remain exact. `Indigo_W_HistoricalSharedRGBGain_NoTmapBrand.HEIC` is 10,585,713 bytes, SHA-256 `7265430a1768e86a16c073a3b764e079ce8c43203645852a9047d2dc6e63b86e`. Important correction: unlike `IDG_20251020_HDR_Fixed.HEIC`, the retained 20261009 Adobe/no-alternate-ICC conversion has no documented physical-iPhone HDR acceptance; its original record left iPhone appearance pending. Treat it as a structural reference, not a device-proven oracle.

## 10.143 — HEAD baseline rejected; Candidate X accepted as temporary Adobe RGB-gain compatibility path (2026-10-20)

A clean production-path export using the current Git HEAD contract was tested on the physical iPhone as `Indigo_HEAD_Baseline.HEIC` and lost HDR entirely. This rules out “restore HEAD” as a valid fix for the current Project Indigo Adobe/no-alternate-ICC source. Container comparison shows that baseline still matches the retained 20261009 structural graph at the important ISO layer (SDR primary 1, RGB gain 50, `tmap 98 -> [1,50]`, extended-linear P3 tmap, shared auxiliary role). A bounded raw-sample verification also decodes the first 512x512 source gain tile and its HEVC copy: 393,216 Y/U/V samples compare with zero mismatches and max delta 0. The regression is therefore not explained by lost gain pixels or the tmap hidden flag.

The strongest device evidence remains P/S. Candidate P restores source-like HDR brightness and colour in Photos View by keeping the Adobe derived rendition as full-range P3 extended-linear `nclx(12,8,0)`, but its RGB Apple auxiliary is inconsistent in Edit. Candidate S proves that native-shaped Apple gain-data signalling makes View/Preview/Edit coherent, but its mono collapse necessarily loses per-channel HDR chromaticity, especially green saturation. Candidate X keeps P's entire viewing path byte-exact and changes only the separate RGB Apple auxiliary's container colour declaration from P3/sRGB-like `nclx(12,13,6)` to data-like full-range `nclx(2,2,6)`, matching the HEVC SPS that was already `2/2/6`. All item payloads, graph references and hvcC bytes remain exact to P. `Indigo_X_PViewer_RGBDataColr.HEIC` is 10,585,748 bytes, SHA-256 `08a1b573a4922044e79f3a4bfec878eda6f4b30112ac71d27920eee8d972f176`. Physical result: the user accepts X as a temporary fix; it is still slightly visually offset from the original but is close enough to ship for now.

Production now implements the X semantics rather than shipping only the research fixture. For a three-channel Adobe/Indigo gain map, the source RGB ISO plane remains untouched as the second `tmap` input and carries no Apple auxiliary role. A separate RGB Apple auxiliary is derived per channel with the normalized-log `0x20000` equation, signalled as full-range `nclx(2,2,6)`, carries `HDRGainMapVersion=131072` and the exact source headroom, and targets only the SDR primary. The tmap stays extended-linear in source primaries; the file advertises the `tmap` compatible brand; generated tmap items are visible while ordinary auxiliary/metadata items remain hidden. No arbitrary HDR brightness/saturation boost and no HDR stripping are used.

The real browser/app smoke on `tests/private-fixtures/indigo-hdr/input.jpg` passes with no AI Detail: 3024x4032 primary, ISO gain 50, separate Apple HDR grid 112 with 12 tiles, source headroom 3.366322 stops / 10.312498469 linear, Styles item 97, and exact three-channel source tmap metadata. `Indigo_Production_X.HEIC` is 9,410,820 bytes, SHA-256 `051555b6b850cd603f37620e6eb4bbf158f3fcfc401a25db84fc5e15a36a64ce`. Contract audit confirms `tmap 98 -> [1,50]`, tmap `nclx(12,8,0,true)`, ISO gain `nclx(12,13,6,true)`, Apple aux `112 -> [1]`, Apple XMP version 131072/headroom 10.312498469, and container/SPS `nclx(2,2,6,true)` on all 12 Apple tiles. Focused regression tests pass 26/26. The production smoke is contract-equivalent to the device-accepted X path but is a fresh app-generated encode, so the remaining very small HDR colour offset is explicitly accepted as a temporary limitation rather than claimed as pixel-identical to the source.

## 10.144 — Missing Indigo Portrait depth and legacy-branch regression audit (2026-10-20)

The supplied IMG_1995.HEIC is a Styles/Texture output with no depth auxiliary at
all. Source is IDG_20261019_165207_144.JPEG (3024x4032, Adobe RGB HDR, headroom
0.107217 stops). Existing buildAiPortrait succeeds on IMG_1995 when provided a
valid depth sample, so the missing controls are not initially a Photos-only
recognition issue.

A real browser reproduction runs createAiPortrait against IMG_1995 with the
original JPEG as source. Normal Chrome ImageBitmap decoding succeeds. Forcing
only JPEG ImageBitmap rejection reproduces `AI primary photo decode failed`:
aiSourceCanvas passes the original JPEG to libheif instead of using the browser's
HTML image decoder. The optional Portrait controller then publishes the normal
Styles-only fallback. This failure path predates the compatibility branch:
ai-portrait-source.js is unchanged since commit 4d3f742 (2026-10-10), and is
byte-identical at branch base 9e3172e. No iPhone error log was supplied, so this
is a reproduced mechanism consistent with the missing-depth file, not proof
that every possible failure of that file has the same cause.

Local fix: after ImageBitmap rejection, sniff the original file bytes and use
HTMLImageElement.decode for raster sources. Never send failed JPEG/PNG/WebP
decodes into libheif; AVIF may retain its HEIF fallback. Native HEIC retains its
existing decoder path. Object URLs, canvases and native decoder handles are
released on both success and failure. New regression was observed failing
before the fix and passing afterward; it also checks error cleanup and the
unchanged HEIC fallback.

The real Portrait controller + Lite ONNX/WebGPU + FFmpeg + assembly now succeeds
with the same forced ImageBitmap rejection on the supplied source. The private
Indigo_Portrait_HDR_Fixed.HEIC output is 11,183,598 bytes and contains depth
768x1024, a depth descriptor and focus/aperture metadata attached to SDR and HDR.
Independent role-by-role audit confirms exact source primary pixels, both ISO
RGB and Apple RGB gain payloads, HDR metadata/profile/codec properties, Styles,
Texture, linear/ordinary thumbnails and selected style controls. This validates
the file contract, not physical Photos recognition of Lighting/Depth yet.

The user also requests an audit of feature/legacy-compatibility-export. Review
range 9e3172e...fe1cce1 is checked against current 818674e and the local design/
validation specs. JPEG imports return from the raster branch before the HEIC
compatibility classifier; known HEICs retain their existing AI call. First-pass
unknown-contract recovery intentionally freezes output before Soft Skin/AI,
as required by the design. Read-only classification of 411 private HEICs has
no parser/fingerprint failure; 20 unknowns are modified research contracts.
No previously stable original was demonstrated misrouted by this branch.

One independent P2 branch regression is confirmed: edc1ef25 adds a pending save
lock when Portrait is enabled after conversion, but runAiCandidate never ends
that queue lock. Failure, cancellation and success with preview disabled leave
save controls locked. Three real-controller lifecycle tests fail before the
fix and pass after adding the finally reset; an active preview write remains
locked correctly. See docs/web/2026-10-20-legacy-compatibility-regression-review.md
for the separate Standards/Spec reports. No bulk rollback was performed.

Validation: 322 passed, 17 absent optional private fixtures skipped, zero failed;
PWA, language and whitespace checks pass. Both new regression files are required
in browser CI and Pages checks. Cache is v231. Changes remain local on master;
personal photos and LAN artifacts are excluded. No push/deploy in this turn.

## 10.145 — Indigo HDR survives View/Edit but disappears on Photos zoom (2026-10-20)

Device feedback accepts Indigo_Portrait_HDR_Fixed.HEIC for Portrait controls,
Styles/Texture, and HDR in View/Edit. Zoom makes HDR disappear until the image
is closed and reopened, without restarting Photos. The original Indigo JPEG
keeps HDR on the same zoom test. Do not mark zoom compatibility as fixed, and
do not dismiss this as normal behaviour affecting every HDR photo.

Supplied IMG_1998.HEIC is 1,172,790 bytes, SHA256
c68ff55b0b5f6c39a54d1fc6c0188aaa5cc30666ad8a24e4c65dff1ee041aaed.
Its graph has primary 49 (3024x4032, 48 tiles), Apple HDR grid 64
(1512x2016, 12 tiles), version 131072 and headroom 8. It has no tmap,
Styles, Texture or depth auxiliary and appears to be a rendered Photos export,
not the original 11,183,598-byte editable Stylio container. This does not
contradict device acceptance of the editable asset: rendered export resources
and the asset's nondestructive edit resources must not be conflated. The file
still contains HDR; transient display loss does not establish deleted gain data.

Historical comparison 9e3172e...fe1cce1 is byte-identical for raster-import.js,
jpeg-hdr.js, ai-portrait-export.js, ai-portrait-source.js and
hdr-compatibility.js. The shared HEIF reader change only adds TIFF scalar
sizes. The separate RGB Apple gain representation was introduced later by
1285101. This narrows investigation, but does not prove the commit causing
the physical zoom issue. No legacy rollback or speculative production change.

Three ranked diagnostic paths are viewer ISO/Apple rendition handoff, tiled
RGB Apple gain decoding, and a Photos-generated rendition/cache. Windows
cannot run the physical Photos zoom UI; the user's original-vs-export device
comparison supplies the failing feedback loop. tools/indigo-zoom-hdr-candidates.mjs
creates a frozen new output directory, refuses overwrites, and verifies each
candidate with the actual read worker. Private batch:
tests/private-fixtures/indigo-zoom-1998-v2/

- Zoom_A_Photos_Render.HEIC: byte-exact IMG_1998 imported as a fresh asset;
  HDR-only diagnostic, no editable Styles/depth expected in this rendered copy.
- Zoom_B_Primary_HDR.HEIC: remove only the altr preference group from accepted
  Portrait export; all payloads, properties and iref references stay exact.
  SHA256 11f3cfd1687108a2acc64cd3b25561c9e4e3a4c7dc5731295ebc520e4018c1b2.
- Zoom_C_Single_RGB_Gain.HEIC: replace only the Apple gain's tiled layout with
  one lossless 1512x2016 HEVC RGB-data image; keep original ISO HDR, primary,
  Styles, Texture, depth, colour equations and headroom. All original payloads
  stay exact; full-range Y/U/V samples compare exactly before and after the
  new encode and after assembly. SHA256
  0c53b9e9c0da29ed61b751ce4aef2e98aede6bff36da691460cfc1aeb4bcc075.

The gain-sample diagnostic must explicitly preserve full range at FFmpeg input
and output; default raw yuv420p conversion can rescale samples. Sample asserts
compare buffers without formatting millions of values on a mismatch. An early
diagnostic attempt lacked this range declaration and was rejected, never served.
B/C still require physical zoom plus View/Edit/Save/control checks. Actual
worker reads, payload/property/reference assertions and gain round-trip checks
pass; syntax and diff whitespace checks pass. No new production fix is claimed.

## 10.146 — Replace the weak-HDR zoom scene with a confirmed HDR Indigo capture (2026-10-20)

Device feedback: A still has the zoom issue. B/C have no visibly useful HDR in
the old capture; the user explains that scene was not an HDR capture in practice.
Its metadata headroom was only 0.107217 stops (1.077148381 linear). Do not treat
the old B/C as proof that either diagnostic change strips HDR, or use that weak
scene to judge the next zoom fix. The old A re-import still reproduces the issue.

New user input C:/Users/WanThinnn/Downloads/IDG_20261019_201808_176.JPEG is
2,737,932 bytes, SHA256
259381ce6efddeea6c716f53fe9b85fa2c2ab43ac4ccfa751959aaf06e087f2a.
Base is 4032x3024, RGB gain is 2016x1512, Display P3, Adobe three-channel HDR,
alternateHeadroom 3.257388 stops / 9.562501043 linear. A bounded 256x192
source-equation diagnostic confirms actual highlights rather than metadata
alone: estimated peak luminance 6.067x SDR white, peak channel 8.646,
2.952% of sampled luminance above SDR white and 1.225% above 2x.
These are source reconstruction estimates, not measured iPhone display output.

Ran the actual browser importRaster + FFmpeg path with AI Detail disabled,
then the actual Portrait controller + Lite ONNX/WebGPU + assembly on that
same file. Styles_Baseline.HEIC is 11,412,831 bytes; Portrait_Baseline.HEIC
is 11,596,958 bytes, depth 1024x768. Source ISO metadata is exact, Apple
headroom is 9.562501043 and editable Styles remain present. No scene/template
HDR, exposure/saturation boost or new production policy was introduced.

tools/indigo-zoom-hdr-candidates.mjs now accepts '-' instead of a Photos render
to create a fresh exact app baseline D plus E/F on the same scene. Frozen batch
tests/private-fixtures/indigo-zoom-201808/zoom/:

- D Zoom_D_App_Baseline.HEIC (11,596,958 bytes), SHA256
  9ed2a54cb8faaa1d19f4db26f659df5b0d61f91844ad34c4a7652e9823297b8f.
- E Zoom_E_Primary_HDR.HEIC (11,596,922 bytes): only remove altr preference,
  every payload/property/reference exact. SHA256
  5294026231e97b4fb22a7e109807bbebc016ccb6701d9951c12044e71438250a.
- F Zoom_F_Single_RGB_Gain.HEIC (14,129,112 bytes): exact Apple RGB gain
  decoded values in one 2016x1512 lossless HEVC item instead of 12 tiles,
  all existing payloads preserved. SHA256
  23b265090af6fae87079c01bf68fe4383e003ffa04cb658df7ef0dd5b9759893.

Actual worker reads, sample round trips and protected-resource assertions pass.
An independent contract report verifies all three against source JPEG ISO
metadata, depth and HDR sidecar values. Physical View/Zoom/Edit/Save remains
pending; do not claim a zoom fix or attribute the issue to legacy based on the
old weak-HDR scene. A one-hour allowlisted LAN page serves only D/E/F and the
exact new source JPEG for the requested device test. Private photos stay ignored.

## 10.147 — D/E/F reject zoom workarounds; real pre/post-merge JPEG export is byte-identical (2026-10-20)

Device result on the confirmed HDR capture: D/E/F all lose visible HDR when
zooming; closing/reopening the image and entering Edit still show HDR. Removing
altr or storing the Apple gain as one image does not fix this symptom. These
negative results do not prove that all ISO/Apple reader handoffs or all tiling
are excluded: E retains the tmap and F retains the primary/ISO grids. Do not
ship those candidates as fixes or continue claiming zoom has been validated.

The user specifically asks whether old working code was broken by a merge.
Ran an actual historical comparison rather than inferring from file dates:

- git archive of web/src at 9e3172e (before legacy), served in an isolated
  snapshot using tools/smoke-ai-detail-hdr-jpeg.mjs --source-root.
- Same at 76182ae (the actual legacy merge); git diff fe1cce1..76182ae web/src
  is empty, so the merge retained the branch source verbatim.
- Each browser run imports the identical new JPEG with analyze=true,
  AI Detail disabled, and actual FFmpeg.wasm. Runtime vendor/wasm/model assets
  have no git diff between the historical version and current tree.

BeforeLegacy_Styles.HEIC and AtMerge_Styles.HEIC are both 8,853,904 bytes and
compare equal over the entire file. SHA256
04e874343bf94cafa57fdf583dde366529a89dc5d70c0156b22f910e7e31ae07.
This rules out that merge changing this JPEG-to-HEIC export. It is not a
physical Photos zoom acceptance of either historical output, nor a claim
that every UI/queue/native/recovery path is identical.

Role comparison with current Styles_Baseline.HEIC (11,412,831 bytes, SHA256
ef90821b148f041fd1477cb4d1c88e7291c505832868a56c49e7b9100dafbe6f)
shows 48 primary tiles and 12 source ISO gain tiles exact in payload/codec/
colour, source tmap payload/properties exact, Styles payload exact, and linear
thumbnail payload/properties exact. The later 1285101 export changes are the
separate RGB Apple auxiliary and its sidecar/role, HDR visibility and compatible
brand signalling. Do not claim these changes are the proven zoom cause before
the old/current device comparison. Earlier PQ-vs-linear and gain-equation
regressions in 10.143 were real mistakes during HDR repair, not evidence that
the legacy merge itself changed this export.

Two frozen history controls use the same new capture, each Styles+Texture
without Portrait: Zoom_G_Before_Legacy.HEIC is the exact before-merge output;
Zoom_H_Current_Without_Portrait.HEIC is the exact current Styles_Baseline.
tests/private-fixtures/indigo-zoom-201808/history/ and history-comparison.json
record these copies. Device View/Zoom results are pending. They distinguish
an existing limitation on newer Adobe HDR input, a later HDR export regression,
and the additional Portrait stage. No new production change, rollback or
Native pipeline mutation was made for this diagnostic.

## 10.148 — Historical G lacks HDR; current H fails zoom before Portrait; I/J/K isolate representation (2026-10-20)

Physical result on the identical confirmed-HDR source: G (code before legacy
merge) has no visible HDR. H (current Styles+Texture without Portrait) displays
HDR but loses it when zooming. Therefore this newer Adobe/no-alternate-ICC input
was not fully supported by the old code; restoring that code is not a HDR fix
for this photo. Since H has not entered the AI Portrait stage, the zoom defect
already exists in the generated HDR JPEG export before Portrait. Keep the
earlier distinction: the actual pre/post-merge export is byte-identical; the
later HDR fix adds useful compatibility but remains incomplete for zoom.

Ranked next probes: primary-item choice on full-resolution load; Apple's RGB
gain auxiliary versus native single-channel representation; competing ISO and
Apple HDR reader routes. These are hypotheses, not a proven Photos algorithm.
All start from the same H (Styles_Baseline.HEIC), same source capture, and no
Portrait. Private outputs under indigo-zoom-201808/routing/:

- I Zoom_I_HDR_Primary.HEIC, 11,412,831 bytes, SHA256
  29896088629b392f8d0b7fa60aed3f8755c4045a0618187eb08b88501eec4a16:
  change pitm from SDR 1 to HDR tmap 98 only. Exactly ONE byte differs from H;
  every item payload, property and iref remains exact.
- J Zoom_J_Mono_Apple_Gain.HEIC, 13,154,182 bytes, SHA256
  f8a114a0ccf6ea5509ad2e5672d826f427c48a01bdad952da3ecdfc5b750d3b6:
  source-equation luminance gain with normalized-log version 131072, monochrome
  8-bit HEVC, generic Linear Gray profile/2-2-2 signalling matching the retained
  CQ contract. Only the separate Apple gain tiles/properties change; source SDR,
  ISO HDR, Styles, Texture, headroom and refs remain exact. Mean linear luminance
  reconstruction error 0.0004303. RGB HDR colour may differ due to scalar collapse;
  this is a stability diagnostic, not an accepted colour-preserving fix.
- K Zoom_K_ISO_Only_Primary.HEIC, 11,412,802 bytes, SHA256
  f829987a7f705754c7306b49a005d848d28692e8a58524e948271b2d36471d90:
  same tmap primary as I, then disable only the added Apple's auxC/auxl/cdsc
  role. Every payload stays exact, including the still-unused Apple plane;
  ISO HDR inputs/metadata, base pixels and all edit resources remain intact.
  It may lack editable HDR; the device test must check controls/Edit separately.

The legacy discovery helper reports hdrGrid=null on K because its ISO fallback
searches for a tmap derived FROM the declared primary, not a tmap AS primary.
This diagnostic must inspect tmap 98 -> [1,50] directly; do not mislabel K as
having no HDR data from that shortcut. No production parser change is bundled
with the zoom probes. Actual read-worker diagnostics, exact-resource checks,
and routing assertions pass for I/J/K. Physical View/Zoom/Edit results pending;
no new production HDR change or rollback was performed.

## 10.149 — J still loses HDR on zoom; single-frame encoder signalling isolated without pixel changes (2026-10-20)

Device result: only J has visible HDR among I/J/K, and J still loses HDR when
zooming. The one-channel Apple gain does not by itself solve zoom; changing
pitm to tmap also is not an accepted fix. Do not promote I/J/K.

Base-structure audit finds native HEIC examples are ALSO 8-bit 4:2:0, so do not
assume 10-bit primary encoding is required. Their primary codec is Main Still
Picture (profile 3), while H's FFmpeg.wasm primary/ISO/Apple RGB tiles signal
Main (profile 1), level 255. hvcC, VPS and SPS all agree on that declaration;
this is not just a mismatched container record. Native examples use ordinary
bounded levels (e.g. 93). Main video at level 255/8.5 is a standards-conformance
concern; it is not yet proven to cause this physical Photos zoom symptom.

The encoder uses -frames:v 1 but does not pass total-frames=1 to libx265.
x265's official Profile/Level/Tier documentation explains that this total-frame
parameter selects a still-picture variant, and may be missing when called via
another application. References:
https://x265.readthedocs.io/en/master/cli.html#profile-level-tier
https://www.itu.int/rec/T-REC-H.265-202108-S/en (Annex A profile constraints).

Built an isolated 13df341 web/src snapshot and changed ONLY the x265 parameter
string in its raster/ffmpeg-hevc.js by adding total-frames=1. Ran the real
browser importRaster/FFmpeg pipeline on the same new JPEG, no AI Detail and no
Portrait. O Zoom_O_App_Single_Frame.HEIC is 11,412,827 bytes, SHA256
14b1b359d0d0ef3493d983595de3d01e276447bdae5f6476d721d20b4a4fd086.
All 72 RGB primary/ISO/Apple image tiles now signal Main Still Picture.
The actual encoded picture payload of EVERY item is byte-exact to H, as are
all non-hvcC properties and references. Styles/Texture, headroom, tmap metadata,
ICC/colr and even thumbnail/delta picture payloads are exact; the codec
configuration alone changes. No source saturation/brightness compensation.
verify-still.mjs rejects H and accepts O on the codec-signalling probe. This
is NOT an automated test of the iPhone zoom symptom.

Additional frozen reductions under indigo-zoom-201808/decode-paths/:
- M Zoom_M_Main_Still_Picture.HEIC (17,976,131 bytes), SHA256
  6120fb4501eec997249aafb65a50c19e4c783df2fe1c6a6d863f8a21e172c30a:
  change only H's primary tile codec by losslessly re-encoding as Main Still
  Picture, all decoded Y/U/V values exact. HDR/Styles/Texture payloads and refs
  exact. This distinguishes the base decoder from O's all-encoder change.
- L Zoom_L_Mono_Apple_Only.HEIC (13,154,047 bytes), SHA256
  6d29a318b4520e18596fd2a100fae6920b4f6bf132b4f11416810547d9790e50:
  J with tmap item, altr group AND tmap compatible brand removed. All retained
  resources exact; Styles/Texture still present. A single Apple HDR reader
  path now remains, unlike the earlier altr-only reduction E.
- N Zoom_N_Bare_Apple_HDR.HEIC (13,151,147 bytes), SHA256
  8633b7080f7c03b80ae7087f4dcd0b351caad3daced17874ad5c862fa384ec90:
  minimal version of L with only primary, mono Apple gain and sidecar, and
  source JPEG EXIF. No private Styles/Texture/Portrait resources by design;
  base/gain picture bytes remain exact. Isolates the private edit graph.

L/N may alter HDR chromaticity as J does; they are diagnostics, not proposed
colour-preserving exports. Old first L/N builds still advertised the removed
tmap brand; these were replaced before any link was sent, using hash-checked
deletion of only our two generated outputs. M initially failed a profile guard
without total-frames=1 (x265 selected an intra-extension profile), then passed
after adding the actual still-picture parameter; no failed output was served.

Prioritize O on the LAN page; M/L/N are further controls if it fails. Physical
View/Zoom/Edit/Save remains pending. Production encoder and Native pipeline
have NOT been changed; the trial is in an ignored snapshot. Do not claim the
zoom root cause is established or the encoder probe is a device acceptance.

Final read-worker check: O and L are known-compatible, no discovery/compatibility
errors. N has no parse error but is classified unknown-apple-contract with its
restored source EXIF and stripped edit graph; it is only a Photos display
diagnostic, not an accepted Stylio re-import contract.

## 10.150 — O/M/L/N all still fail zoom; isolate the full-resolution base grid (2026-10-20)

Device feedback: O equals M, both still lose HDR on zoom. L/N have paler colour
and also lose HDR on zoom. Adding total-frames=1 / Main Still Picture signalling
is NOT sufficient to fix this symptom. No encoder change was promoted. Even N,
with no Styles/Texture/Portrait, no ISO tmap item and no tmap brand, still fails;
the private edit graph and competing tmap rendition are not necessary conditions.
The mono gain conversions alter HDR chromaticity and are not accepted exports.

The primary in every previous probe still used a grid of many coded tiles.
F changed ONLY the Apple gain to a single coded image, not the base. Next probe
therefore assembles all 4032x3024 base Y/U/V samples from H and encodes one full
lossless Main Still Picture frame. Every decoded Y/U/V value is checked exact;
all original auxiliary payloads (ISO HDR, Apple HDR, Styles, Texture etc.) remain
byte-exact, as do all incoming references and base colour/geometry properties.

Frozen candidates under tests/private-fixtures/indigo-zoom-201808/full-frame/:
- P Zoom_P_One_Cell_Full_Frame.HEIC, 17,884,504 bytes, SHA256
  b070b971591a1cfdb683fdebbb43e575f15a29a65055f6bab78963ccd5ed71a1:
  primary remains grid 1, but its dimg references one full-resolution coded
  image instead of 48 tiles. Actual read worker has no discovery/compatibility
  errors. Every original non-primary payload remains exact.
- Q Zoom_Q_Direct_Full_Frame.HEIC, 24,356,065 bytes, SHA256
  e4a8616c9e13bcf1e5895a899db8883635c59f102cae6eb5bdd01decb94482a0:
  same complete frame, directly declared as primary hvc1 item 1, without a grid
  wrapper. Every incoming reference retains its original target ID. This is
  outside the current app's grid-only import contract; generic HEIF item parsing
  and independent FFprobe identify the 4032x3024 primary correctly. It is a
  device diagnostic, not a supported production export/re-import design.

Both share full-frame YUV SHA256
47f97c607a57e2beee2fb3719e17dc929a7773c2c70b0e2794c79467eb5606f9.
Generator: artifact/build/indigo-zoom-201808/full-frame.mjs. Coded profile 3,
level 255; this experiment changes spatial base assembly, not the bounded-level
hypothesis. Device View/Zoom/Edit/Save still pending; no production web/src edits.

Independent checks: FFprobe recognizes the complete coded frame at the intended
4032x3024 size in both files. The pinned old libheif reader cannot parse H's
complete original graph either (reports a thumbnail target it cannot recognize),
so it is not a pass/fail oracle for these full HDR graphs. With only each primary
graph wrapped for that reader, both P/Q decode to identical actual RGBA output,
SHA256 8ff6e71a38a48460e7a05958f81eb0025479dde041b4f759ab9d57ee0f02e54f,
11,764,966 non-black pixels. check-full-frame.mjs records that scope explicitly;
this does NOT validate Photos' HDR zoom handoff or Q's app re-import support.

## 10.151 — Stop zoom experiments; accept the existing stable production route (2026-10-20)

The user reports P/Q still lose HDR on zoom and additionally give wrong colours
when applying Styles/Texture. Exact base YUV and auxiliary payload equality did
NOT establish correct Photos editing behaviour. P/Q are rejected, not releases.

The user explicitly ends this investigation, accepts temporary HDR loss and
requests committing the most stable version. Select the existing production
route at 13df341: accepted Adobe RGB HDR compatibility from 1285101/818674e,
plus the fixed raster Portrait source decoder and Portrait save-lock lifecycle.
This is the actual H Styles/Texture baseline and D Portrait baseline of the
new scene, not the historical G export that failed to display HDR at all.
The accepted limitation is HDR disappearing after zoom until the photo is
closed/reopened. View/Edit HDR and the established Styles/Texture/Portrait
route remain the target; do not intentionally strip HDR to hide the symptom.

No experimental O/M encoder signalling, mono L/N conversion, or P/Q full-frame
grid changes are promoted. Production web/src, service worker and profiles are
already unchanged from 13df341. Preserve the original Native pipeline. The
investigation tools and historical snapshot option are diagnostics only;
private photos/candidate files stay ignored. No further zoom fix is authorized
unless the user later reopens it. No new runtime asset version is required.

Final stable-route verification: 160 tests passed, 13 absent optional fixtures
skipped, zero failed in the focused native/HDR/Portrait/worker/lifecycle/export
set (173 total). The real original Bright and HDR-native preservation controls
run and pass, rather than being skipped. PWA and three-language checks pass.
Fresh actual-browser import of the strong-HDR JPEG, AI Detail disabled, produces
11,412,831 bytes, SHA256
ef90821b148f041fd1477cb4d1c88e7291c505832868a56c49e7b9100dafbe6f,
byte-identical to H. This verifies the selected app route, not a zoom repair.
No production web/ or workflow files differ from 13df341.

## 10.152 — New HDR colour error after Photos Edit/Save; RGB gain is lost in the supplied render (2026-10-20)

The user reports the accepted export still has wrong colours in HDR, especially
the pharmacy sign, while SDR looks normal. Supplied IMG_2024.HEIC is the image
after a small edit/save; IMG_2025.JPEG is a screenshot. The latter has no embedded
gain map and cannot preserve the display's full HDR luminance. This reopens HDR
COLOUR investigation only; the zoom investigation remains stopped as requested.
Do not describe the accepted baseline as fully colour-correct after Edit/Save.

IMG_2024 is 1,661,065 bytes, SHA256
586d5c02324b50aa6d2a4bff2667a28b985569dc133ed5fe22a2c82a4bafc8b2.
It is a Photos-rendered 4032x3024 primary 49 with 48 tiles, Apple HDR gain grid
64 at 2016x1512 with 12 tiles, headroom 8 and version 131072. It also retains
depth item 66. No ISO tmap or Styles resource is present in this rendered file;
that does not establish that the Photos asset lost its editable controls.
Primary and gain both have identity orientation, ruling out an ignored rotation
in this local comparison. The output gain has RGB pixi, HEVC chroma 4:2:0, a
generic Linear Gray ICC and SPS full-range 2/8/6.

Important raw-plane measurement: despite that three-channel container, every
decoded U and V sample of ALL twelve saved HDR tiles is neutral 128. The gain
therefore contains scalar/gray data only. The actual pre-edit production
Portrait baseline has non-neutral U in 734,523 and V in 720,104 of 786,432 samples
per plane. extractplanes=u/v copies the decoded channels directly, so this is
not an ICC transform, RGB preview or tone-mapping artefact in our analysis.
Generator/report: artifact/build/indigo-color-2024/audit-planes.mjs and ignored
tests/private-fixtures/indigo-color-2024/chroma-planes.json.

This is evidence of loss of the independent chromatic gain in the supplied
Photos render, consistent with the reported HDR-only colour issue. It does not
prove every mono gain map is invalid, or identify the exact private Photos stage
that collapsed it. The exact changed control is not recorded, the saved base is
also re-rendered (mean 7.53/255 component difference from H), and the two files
cannot be treated as a controlled equal-setting pixel comparison. Local source-
equation visualizations use common SDR tone compression and are NOT screenshots
of the actual iPhone HDR output. Global MAE is not an acceptance oracle.

Two new private probes start from the exact production Portrait baseline D,
without changing ANY item payload, graph reference, base profile/pixels,
Styles/Texture/depth or gain headroom/equation:
- Color_1_Linear_Gray.HEIC, 11,597,326 bytes, SHA256
  6480b616cb8aa1ca3a9990a7bdce70c97f52b5380fd7fb2c3e13dbfd9ea68ea0:
  only replace Apple RGB gain grid/tiles' colr with the generic Linear Gray ICC
  Photos itself writes in IMG_2024; all HEVC configurations stay exact.
- Color_2_Linear_Gray_SPS.HEIC, 11,597,446 bytes, SHA256
  521f14d63d16325b17dffc8638e1ae116985098781475cfcda708e3e0797567c:
  Color 1 plus only SPS transfer_characteristics 2 -> 8 on Apple HDR tiles,
  matching the saved Photos data declaration 2/8/6. Original picture NALs and
  every item payload remain exact; all other SPS fields are checked unchanged.

These test the unresolved colour-data declaration hypothesis, not a confirmed
fix. Physical View/Edit/Save colour and the saved result's HDR gain must be
checked. No new production web/src changes, commit, push or rollout; 4dfac1e
remains the previously selected release baseline.

## 10.153 — Colour header probes rejected; original JPEG survives Photos editing (2026-10-20)

The user reports Color 1 and Color 2 are visually the same and do not fix the
HDR colour issue. Neither ICC-only nor ICC plus linear SPS signalling is an
accepted correction. No production change is promoted.

Correct the earlier causal inference: a scalar gain map in a rendered export
does not alone prove a broken RGB edit. Photos may move chromatic adjustments
into its re-rendered base. This was already a concern in 10.152, and requires a
passing post-edit reference rather than classifying any gray gain as a bug.

New device control: the user adjusts Exposure one step on the original
IDG_20261019_201808_176.JPEG, without Stylio, and saves. Its HDR pharmacy-sign
colour remains correct. This rules out a universal Photos HDR-editing failure
on the device/source. It does not yet isolate JPEG vs HEIC container handling
from the private Styles/Texture/Portrait editing path, or establish a particular
gain-map equation/colour profile as the cause. Asked for the saved good original
to compare with IMG_2024. Do not resume the stopped zoom investigation.

## 10.154 — Passing Photos JPEG retains RGB ISO gain; ordered ISO/PQ probes (2026-10-20)

The user supplies IDG_20261019_201808_176 (1).JPEG after increasing Exposure
in Photos, and confirms its HDR colour remains correct. It is 2,800,797 bytes,
SHA256 76a9ddd2d3af5f215997dd9c8cab00b4b52456de685d806073a5be3b910bb14b.
The MPF contains a 4032x3024 Display-P3 base and a 2016x1512 three-component
gain image. The gain JPEG carries ISO 21496-1 binary metadata rather than Adobe
HDR XMP. Its 13,312-byte alternate ICC is Display-P3/PQ (cicp 12/16/0 full),
with A2B0/B2A0 LUTs and no HAGC. This is an actual device-produced passing
reference, not an inferred colour profile selected by appearance.

ISO metadata has base headroom 0, alternate headroom 3 (8 linear), shared
min 0/max 3/gamma 1, offsets approximately .005/.005, useBaseColorSpace false.
ONE metadata parameter set does NOT imply a monochrome gain image: raw decoded
U is non-neutral in 643,243/762,048 samples, V in 609,267/762,048 samples.
This passing Photos JPEG therefore retains chromatic gain, whereas the failing
IMG_2024 Apple HEIC render has neutral chroma in every HDR tile. It strengthens
the ISO-vs-legacy route hypothesis but does not alone isolate container choice
from the private Styles/Texture editing path, or prove the exact collapse stage.
Do not copy this increased-Exposure file's gain parameters onto the original
scene's unchanged gain samples; their equations/pixels differ.

The current importer explicitly rejects this binary ISO JPEG with
"HDR gain map missing from MPF"; it is NOT an SDR file. This unsupported import
is recorded separately, not silently bypassed or presented as the colour fix.
Private inventory helper: artifact/build/indigo-color-2024/photos-jpeg.mjs.

Three ordered private probes start from the exact D production Portrait
baseline. All encoded item payloads, original ISO metadata/gain equation,
primary, source colour profile, Styles/Texture/depth and their references are
asserted unchanged. No source pixels are transcoded, no saturation/headroom
boost is applied, and no production files are changed:
- Color_3_PQ_ICC.HEIC: only replace tmap output colr with the passing Photos
  JPEG's alternate PQ ICC. 11,610,282 bytes, SHA256
  d8effa3e8e9d09e6004aa2dd66189c7062349aedae9cebb0aeee411ece7aba58.
- Color_4_ISO_RGB.HEIC: Color 3 minus only the separate Apple gain's auxC/auxl
  role; retain original ISO RGB tmap and all payloads. 11,610,267 bytes, SHA256
  6e8931a7086642bce8a335f22ebbaa97444ca1462d65b9bdb5ccb59fe8bf7110.
- Color_5_ISO_RGB_10.HEIC: Color 4 plus only derived tmap pixi 16 -> 10 bits
  per RGB component, matching measured native tmap bit declaration. Source
  HEVC remains unchanged. 11,610,267 bytes, SHA256
  cb3133e2308495371283b52d4aa3c2391dd41538e44a883f9e9066e39153a963.

Generator artifact/build/indigo-color-2024/iso-rgb.mjs passes all payload,
property/reference and worker read/discovery assertions. Those checks do NOT
prove physical Photos HDR colour, controls or Edit/Save correctness. Device
validation is pending. Earlier nclx-PQ, primary-tmap and linear-output pure-ISO
probes were rejected; these probes test the newly supplied actual PQ ICC while
keeping primary/preferred alternatives and gain equation unchanged. Neither
earlier failures nor this local success are grounds to promote a runtime fix.

## 10.155 — PQ/ISO probes rejected on device; minimize before further colour changes (2026-10-20)

The user reports Color 3 still has the old colour problem, while Color 4 and
Color 5 lose HDR entirely. Reject all three: the passing JPEG's alternate PQ
ICC does not by itself fix the HEIC editor path; disabling the legacy Apple
auxiliary loses working HDR even with that ICC and native-shaped tmap bit
declaration. Do not promote any of these changes, or repeat the same ISO-only
route with additional arbitrary colour headers.

Next controlled device reduction is the already built Control_Bare_RGB_HDR:
exact production H base, original ISO gain/tmap and separate Apple RGB gain,
with all private editing resources removed and source JPEG Exif restored.
11,410,637 bytes, SHA256
0bc3e24cfb32022b523b85a0cb8b27cc8cbc92b8204f1388a1d30179b4a3c48e.
There are deliberately no Styles/Texture/Portrait controls. Exposure Edit/Save
is the test. A passing result separates the private editing contract from the
RGB HEIC conversion as a whole; a failing result narrows it to the converted
HDR representation or remaining container behaviour. This is a group reduction,
not a one-field proof that a particular private metadata field is at fault.

A possible correction to investigate only with explicit reconstruction checks:
scalar Apple gain cannot carry independent chromatic amplification by itself.
Simply replacing the RGB gain with its luminance, as earlier rejected mono
probes did, discards that colour information. A scalar-compatible representation
must solve a corresponding SDR base from the desired HDR RGB, not keep the old
base unchanged. Such a representation deliberately changes SDR chromaticity;
it must not be advertised as original-SDR preservation, and must also keep
thumbnail/linear thumbnail and ISO/Apple equations consistent. It is not yet a
production fix. No zoom work is resumed.

## 10.156 — HDR-only control still fails; unify the actual gain input and equation (2026-10-20)

The user tests Color 6 / Control_Bare_RGB_HDR and reports the same HDR colour
error after an Exposure edit. Private Styles/Texture/Portrait are therefore
not necessary to reproduce this failure. Stop changing their calibration or
removing controls as a purported colour fix. The remaining reproducer includes
the RGB HDR conversion/container path; the exact private Photos stage remains
unobservable on Windows. The original edited JPEG still passes on the device.

An equation-only scalar-rebasing feasibility check is kept in
artifact/build/indigo-color-2024/scalar-reconstruction.mjs. On the existing
decoded 2016x1512 baseline, rebuilding both the base and scalar gain can reduce
linear HDR reconstruction MAE from .020708 to .000812. However it deliberately
changes SDR hue: mean 2.34 code levels over the image, 5.32 in the green-wall
ROI, and local changes up to 116 codes. Do NOT promote this as a faithful fix
when the user says SDR already matches. No such photo candidate is served.
This math check is not an emulation or acceptance test for Photos colour.

Next falsifiable representation hypothesis: the accepted baseline exposes two
different gain images/recipes. Its tmap consumes signed Adobe RGB gain 106,
while the Apple auxiliary is separate normalized RGB grid 62. The native
shared-gain relationship is absent for that normalized plane. Earlier shared
RGB probes instead relabelled raw signed Adobe samples without making their
Apple and ISO equations agree; their rejection does not test this correction.

Private Color 7 keeps primary 49, Apple auxiliary 62 -> [49], all image payloads,
profiles, headroom and private controls unchanged. Only tmap 102's dimg second
input is changed 106 -> 62, together with the NECESSARILY corresponding ISO
equation: one shared RGB parameter set min 0, max 3.257388, gamma 1, offsets 0,
base headroom 0, alternate headroom 3.257388, useBaseColorSpace true. RGB image
channels remain three; a single shared parameter set does not make them mono.
The source signed gain and its original Adobe metadata remain untouched but
are no longer the selected tmap input. This is one coherent representation
change, not a one-field causal proof.

Color 8 differs from Color 7 only by tmap colr: extended-linear P3 nclx becomes
the passing Photos JPEG's generic P3/PQ ICC. Both keep the working Apple aux
role, unlike rejected Color 4/5. No SDR rebasing or pixel re-encoding occurs.
- Color_7_Shared_RGB.HEIC: 11,597,020 bytes, SHA256
  15541d51d08093717058e5fc9194ff681b1542254842d64b55481a3f57871a49.
- Color_8_Shared_RGB_PQ.HEIC: 11,610,344 bytes, SHA256
  873aea1a56b395fc1a74bd7461907249b306058380a601f6d7e71260816f34a7.

Generator artifact/build/indigo-color-2024/shared-normalized.mjs verifies every
non-tmap payload and non-target property byte-exact, all non-tmap references
exact, worker read/discovery success, and identical ISO-vs-Apple multipliers
for all 9,144,576 actual decoded RGB gain samples (max error 1.78e-15).
Those checks establish equation consistency and preservation, NOT physical
Photos Edit/Save colour. Device results pending. Production remains unchanged.

## 10.157 — Shared normalized RGB still fails; test a genuinely rebased scalar pair (2026-10-20)

The user reports BOTH Color 7 and Color 8 still have the same HDR colour error.
Reject them. Shared RGB input/equation consistency and the actual passing PQ
ICC do not repair the physical Photos save result. Together with failing bare
Color 6, this rules out private Styles/Texture as a necessary trigger and rejects
the tested equation/topology/colour-header fixes. Do not state that the RGB
contract is accepted merely because its local equations agree.

One new candidate changes actual image data: Color_9_Rebased_Scalar.HEIC.
Start from production Portrait baseline D. Reconstruct its accepted normalized
RGB HDR scene at full 4032x3024, using bilinear sampling of its decoded 2016x1512
RGB gain. For each pixel solve a shared scalar multiplier that preserves SDR
luminance where representable, avoids base clipping, and stays within the same
source-derived headroom 9.562501043. Encode that multiplier as normalized-log
8-bit gray; then solve NEW SDR RGB = target HDR RGB / actual quantized multiplier.
This keeps chromatic HDR information in the corresponding base instead of
discarding it when making a gray gain. It is fundamentally different from the
earlier mono-gain-only substitutions that kept the source SDR base unchanged.

IMPORTANT TRADEOFF: SDR base pixels deliberately change hue to represent HDR
colour through a scalar gain. Mean absolute SDR code change is 2.239/255 over
the image, 1.844/255 in the pharmacy ROI, but local maximum changes are 122/255
and 99/255 respectively. Do not describe that as uniformly tiny, original-SDR
preservation, or a drop-in accepted fix. It is a private device feasibility
probe; no production import/export path or original Native preservation changes.

The gain is full-resolution 4032x3024 (48 lossless HEVC tiles), avoiding another
unknown downsampling/Photos upsampling step. Grid 193 is the only Apple HDR aux,
linked to primary 49, and the ISO second input of tmap 102. Its common ISO
parameters match the Apple normalized-log equation. The original two gain
resources/payloads remain as inactive data; original Apple gain 62 is demoted.
All 48 primary tiles are re-encoded losslessly from the newly solved YUV420,
with original base P3 ICC retained. Thumb 66 and Main10 P3-linear thumbnail 65
are regenerated from the new base so old-colour previews are not left behind.
Private Styles/Texture/Portrait/depth metadata and map payloads remain exact.

Helpers are private, under artifact/build/indigo-color-2024/:
scalar-pair.mjs, build-scalar-pair.mjs, verify-scalar-transport.mjs.
The solver's floating reconstruction max error is 8.88e-16; after 8-bit base
quantization HDR linear MAE is .000839 whole / .000633 pharmacy. Every encoded
base and gray gain tile is decoded and checked YUV byte-exact. The unavoidable
RGB/YUV420 conversion adds scene MAE .003837 whole / .002890 pharmacy; triangle
upper bounds on total reconstruction MAE are .004676 / .003523. These are local
representation checks, NOT a Photos renderer or a device acceptance oracle.
The source HDR target is D's accepted pre-edit Apple RGB reconstruction, not a
claim of exact recovery of the original JPEG's signed/offset ISO equation.

Candidate is 24,973,113 bytes, SHA256
bb3bcd3893f3cadf3c796039924ab37b7aaa597c898d48df15563dcf9a8addec.
Worker read/discovery and compatibility checks pass; physical View/Edit/Save
HDR colour, SDR appearance and private controls still need device validation.
Do not commit/deploy the representation as a fix without those results.
The user-stopped zoom investigation remains stopped.

## 10.158 — Color 9 accepted; port to fresh RGB HDR JPEG exports (2026-10-20)

The user reports Color 9 works and no longer has the colour bug. This is the
physical acceptance for the reported HDR colour issue; do not reinterpret it
as exact original-SDR equality, universal third-party compatibility, or a zoom
repair. Preserve the explicit SDR rebasing tradeoff from 10.157.

Production port is confined to importHdrJpeg when it has built an Apple RGB
auxiliary. makeRgbHdrEditable reads that freshly generated file's own decoded
SDR and normalized RGB gain, solves the same full-resolution scalar/base pair,
re-encodes the primary and both thumbnails, and shares the new scalar gain
between Apple and ISO readers. Native HEIC, ordinary SDR raster and the old
single-channel HDR import routes do not call this correction. Geometry now
reports the actual full-resolution gain. Private editing data stays intact;
previous gain resources remain inactive source data.

The runtime uses a generic D50 identity-TRC Linear Gray ICC generated from
readable fields, rather than embedding the test photo's generic Apple profile
bytes. Its transform is equivalent; its profile bytes/provenance differ. This
distinction and physical acceptance of the prototype must not be hidden by
claiming byte-identical output files. Numerical base and gain solver output
DOES match every accepted Color 9 raw sample in the local private control.

The first real browser integration exposed FFmpeg.wasm heap exhaustion during
the long second encoding pass. Releasing only before decoding was insufficient:
the next run failed at pair tile 41. The correction now releases the codec heap
after full-frame conversions, after each 12 paired tiles, and before thumbnails.
Encoded source data stays in JS; the next operation reloads pinned cached codec
assets. This bounds codec lifetime without retrying with a lower quality image.

Regression covers chromatic gain versus the old scalar-only failing control,
black/neutral pixels and immutable inputs, generated gray ICC, exact accepted
private raw samples, and actual buildRasterHeic -> scalar export -> Portrait /
Texture graph propagation. The call-site test first failed on the fresh tmap's
mdat storage: the private Portrait prototype had idat storage. The port now
handles both methods correctly. Repeated correction on an already full-resolution
scalar pair is byte-identical and performs no further encoding. Codec release
boundaries are also exercised. PWA cache v232 includes both new runtime modules;
the scalar export tests are required before CI/Pages publishing.

No commit/push/deployment has been performed for this port. Real browser finish
and output comparison are still in progress at this checkpoint.

Port validation complete locally: 121 tests passed, 2 absent optional fixtures
skipped, zero failed; PWA/paths/release/language checks pass. Real Bright and
HDR-native preservation fixtures run and retain their historical byte-identical
outputs. The actual browser JPEG import finishes in about 50 seconds for this
12MP scene, producing 24,818,608 bytes, SHA256
e7770f782891d785c0b6294c558420c0914c7fc7aff391d3bcfc636551e4c70a.
It has primary 1, shared ISO/Apple full-resolution gain 187 with 48 tiles,
Styles 97 and the matching scalar tmap equation. Source headroom uses the
published XMP precision, avoiding ceil-boundary differences from an unwritten
higher-precision JS value. Geometry reports 4032x3024 HDR rather than the old
half-size source gain. A real Portrait-controller run with ImageBitmap failure
forced also succeeds, retaining the 48-tile HDR pair plus depth and controls.

Important comparison limit: matching the solver's accepted raw samples is NOT
whole-file or final-pixel identity. FFmpeg.wasm and the native diagnostic's
YUV->RGB readback differ by up to 2 code values (mean .815 for base / .894 gain).
Changing unscaled conversion to accurate_rnd made chroma differences worse
(max 37/57), so that experiment is rejected. Default full-size conversion is
retained; area filtering is used only when resizing previews.
Private compare-hdr-scenes.mjs compares actual reconstructed HDR rather than
gain-code differences near black. Against accepted Color 9, the final app file
has linear scene MAE .005968 whole / .004342 pharmacy, integrated luminance
ratios 1.030586 / 1.037618, mean normalized RGB chroma L1 .018648 / .012161.
These are measured representation differences, not evidence of renewed Photos
save errors or proof that the runtime file passed a physical Edit/Save test.
The runtime's generated equivalent gray ICC also differs from the prototype.
The physical acceptance still applies to Color 9; the actual app-produced file
is offered for the final device check. No commit/push/deployment yet.

## 10.159 — Actual app-produced scalar HDR export accepted on iPhone (2026-10-20)

The user replies "ok rồi" to the final check of App_Styles_Texture.HEIC, the
actual browser output with SHA256
e7770f782891d785c0b6294c558420c0914c7fc7aff391d3bcfc636551e4c70a.
The question explicitly covers Photos Edit -> change Texture -> Done, retained
HDR/correct pharmacy-sign colour, and working Styles/Texture. This accepts the
production port, including its generated gray ICC and measured rounding/roughly
3-4% higher HDR luminance versus the private Color 9 prototype. It supersedes
the pending runtime-device acceptance in 10.158.

Select this rebased scalar pair as the accepted fix for the reported Indigo RGB
HDR colour/save issue. Retain the stated SDR chromaticity tradeoff, larger files
and additional processing work. Native Bright/HDR preservation remains separately
verified byte-for-byte. The stopped zoom investigation remains stopped; no claim
is made that every third-party HDR format or capture has been device-validated.
No earlier rejected colour/header/topology probes are promoted.

## 10.160 — Lossless removal of unreferenced mdat payload (2026-10-20)

The user authorizes removing the measured 7.28 MB of unreferenced data first.
Do not prune the separate inactive HDR item graphs (~4.04 MB), lower resolution,
re-encode pixels or change the accepted scalar/base solve as part of this work.

Fresh RGB HDR JPEG scalar exports now pack the union of ALL method-0 iloc
extents into one mdat. Shared, overlapping and multiple extents retain their
bytes and lengths. Every item remains, including inactive original HDR items;
all idat data, properties, references and private metadata remain unchanged.
Only method-0 absolute offsets are relocated. The helper rejects unsupported
layouts, external or out-of-mdat locations instead of discarding unknown data.
It is called only after the fresh RGB HDR scalar rewrite. The general graft
writer, native HEIC preservation and already-scalar no-op route are unchanged.

On the actual accepted Production_Scalar_Styles.HEIC, size changes from
24,818,608 to 17,534,602 bytes (29.34897% smaller). Removed bytes: 7,283,998
unreferenced payload bytes plus one 8-byte mdat header. Packed SHA256:
fd084dc41bbd73f83c7d159bc7ecf42f4b47e53d438679d3511d0a1770680653.
Private output: tests/private-fixtures/indigo-color-2024/Production_Scalar_Styles_Compact.HEIC.

The real raster -> scalar export call-site test initially failed with 148 orphan
bytes, then passes with zero. Regressions cover shared/overlapping/multiple
extents, idat and metadata equality, invalid locations, and byte-idempotence.
All extracted item payloads and all metadata except relocated offset fields
match the accepted real output exactly. Scalar/Portrait/Texture integration
still passes. Seven scalar tests and 59 related native/HDR/raster/worker/release
tests pass; two optional worker fixtures are absent. The real Bright and native
HDR preservation controls run and remain byte-identical to historical outputs.
PWA consistency passes; cache is v233. No codec quality or HDR equation changed.
The packed file has not yet received a new physical iPhone check; numerical and
byte comparisons are not a new claim of Photos device acceptance. No commit or
push performed for this packing change at this checkpoint.

Release authorization: the user subsequently replies "ok" and explicitly asks
to put this packing change into production. Proceed with master commit/push and
verify the Pages deployment for that exact commit. This is release approval;
the short reply does not independently document a detailed new iPhone test.
