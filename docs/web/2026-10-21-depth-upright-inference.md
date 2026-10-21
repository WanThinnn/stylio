# Upright neural depth input (v248)

## Confirmed boundary bug

The supplied suitcase, desk and plant images have canonical HEIF rotation 270
degrees. `aiSourceCanvas` correctly recovers stored coordinates for the depth
auxiliary, but the depth worker was feeding those stored, sideways RGB pixels
directly to V2/V3. IS-Net and EdgeSAM already transform their inputs to display
orientation. The depth network therefore saw a different orientation from the
foreground networks. This is independent of the blur-range calibration.

The actual worker regression goes red before the repair: a 4x2 stored image
with 270-degree rotation enters Standard as `[1,3,2,4]` and Pro as
`[1,1,3,2,4]`, rather than the upright 4x2-height tensors. The caller also did
not pass orientation to the worker.

## Repair

`depth-orientation.js` permutes RGB into display orientation before tensor
normalization. It inverse-permutes float disparity back into stored coordinates
before RGB-guided refinement, Apple matte protection, focus fusion and export.
There is no interpolation, crop, model change, per-file correction, blur-scale
change or concurrent second model. Upright, unmirrored inputs use a no-copy path.
The existing working-grid/input-size budgets remain unchanged.

Tests exercise the real worker with mocked model/codec boundaries for all three
tiers, plus independent matrix permutations for all four rotations and both
mirror axes. Float depths round-trip exactly and stored RGB/PEM guidance remains
aligned. Camera depth is not routed through this inference worker.

## Real-image measurements

Desktop WebGPU replays use the iPhone input-size budget; they are not Safari.
Before/after use the same source pixels, foreground models and focus selection.

| Pro replay region | Old final focus gap | Upright final focus gap |
| --- | ---: | ---: |
| Suitcase | -9 | -3 |
| Brown bag | -4 | +1 |
| Wipes | +80 | +2 |

These are 8-bit relative disparity-code differences, not metres or direct blur
radii. Scene calibration and optical factors also affect Photos rendering. The
desk wall and wooden support still have questionable relative geometry (and
the wall ordering changes in the Pro replay); this repair is not evidence that
the entire depth map is physically correct. Do not flatten those surfaces or
substitute another tier merely to make one sample look sharp.

## Private test candidates

The supplied `unmodified` pair files already contain AI Portrait depth. Private
replay copies remove that old depth/sidecar and the known libheif-incompatible
thumbnail-to-tmap target, keeping every other item payload byte-identical. No
user source is overwritten and no Styles processing is applied again. The
production refusal to replace existing depth is unchanged.

One v248 candidate set contains three scenes x Standard/Pro, exported with the
real browser path at f/1.4. Identical duplicate focus sidecars inherited from
the earlier exports are removed only in the test artifacts; one unambiguous
focus descriptor remains. All non-depth HEVC payloads, Styles, linear thumbnail
and primary/HDR colour profiles match the replay sources. HEVC depth readback
passes for all six outputs. Test scripts/data stay in ignored private fixtures.

`http://192.168.1.3:8786/` serves only these six files for two hours, until
22:04:36 local time on 2026-10-21. GETs are verified byte-identical to disk and
unlisted routes return 404. The page asks the user to check f/1.4, f/16, Off,
Portrait icon, re-editability and HDR in iPhone Photos. No new push is made.

## Verification and remaining work

- 293 focused regression cases: 285 pass, 8 missing-private-fixture skips,
  zero failures (Portrait, orientation, HDR, native, Styles, Texture, startup,
  compatibility and module paths).
- PWA and whitespace checks pass; the live test tunnel serves v248 modules.
- The user confirms IDG import now runs on iPhone after the v247 update.
- v248 depth candidates still require physical iPhone evaluation. The wall/
  support-surface ambiguity is a separate remaining model/geometry limitation.
- No native-equivalent blur accuracy or complete fix across all scenes is claimed.
