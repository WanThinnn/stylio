# Scene-based relative Portrait response

Status: implemented experimental calibration; Photos device validation pending.
This is not metric depth recovery or a reproduction of Apple's private renderer.

## Device evidence

The V2 phone test accepts IMG_1880 and fresh-original iPhone 7 exports
(viewer f badge and editable aperture). It rejects equal generated ranges for
the two model tiers: IMG_2862 Standard is excessive at f/1.4, while Pro is
preferred. IMG_2694 remains too weak even at f/1.4.

Actual encoded depth explains why an EXIF-only multiplier is insufficient:

| Capture | Standard focus-to-background median | Pro median | Scene |
| --- | ---: | ---: | --- |
| 2862 | 100/255 | 47/255 | Background supports calibration |
| 2694 | 12/255 | 17/255 | Background below 2%; almost all depth is in front of focus |

The iPhone 7 pair also demonstrates the double digital-crop error: the same
3.99mm lens reports 28mm equivalent without zoom, and 53mm with 1.885x zoom.
Multiplying the latter equivalent by zoom again fabricates a second crop.
The 35mm-estimated projection no longer does this. Real camera depth keeps its
own original calibration.

## One algorithm, per-scene measurements

`describePortraitScene` measures the final fused relative-disparity map at its
initial focus. It uses local noise, robust depth span, separated foreground and
background populations, and confidence from the accepted subject matte. Sparse
outliers and flat depth cannot establish scene scale. When background support
is insufficient, a coherent foreground population can establish it instead.

There are no file-name, device-model, or Standard/Pro coefficients. The measured
profile is small numeric metadata and is fixed for the capture: moving focus
or aperture must not rescale the entire scene a second time.

For usable depth and known optics, the generated disparity range is:

```
G = fx * fy * pixelSize / imageDiagonal
range = (referenceG / G) * (base / 3) * target / measuredSeparation
```

This compensates the virtual-camera projection and the arbitrary relative model
scale. It removes the earlier artistic range floor/ceiling that over-constrained
telephoto and ultrawide inputs. Unknown optics or untrustworthy scene statistics
use an explicitly reported V2 fallback; they do not invent metric calibration.

The target blends a global complex-scene response of .335 toward 1 with accepted
subject confidence. These are **empirical effect calibration constants**, shared
across captures and tiers, anchored to the accepted Pro and isolated-subject
phone trials. Foreground attenuation .35 is an explicit preview policy. Neither
constant is an Apple parameter or proof that subject distance has been measured.
Scene normalization deliberately makes the median effect comparable; it cannot
guarantee physically correct blur for every monocular depth prediction.

## Preview and export

The preview now uses the canonical scene scale rather than optical-unit export
range. Circle of confusion is proportional to disparity difference and inverse
aperture. The previous pre-saturated shader curve broke scale compensation; a
real GPU readback reproduces this before the fix and matches afterwards.
f/16 is a nonzero aperture, distinct from Off. The preview is still approximate;
Photos owns the final native bokeh, edge treatment, and relighting.

Source photographic and encoded depth samples are not blurred or modified by
response calibration. New test outputs come from unmodified inputs, not earlier
Photos/Stylio saves. Existing native camera depth restoration remains unchanged.

## Reproduction

```
rtk proxy node --test tests/web/portrait-scene-response.mjs tests/web/portrait-geometry.mjs tests/web/portrait-orchestration.mjs tests/web/portrait-controller.mjs tests/web/ai-portrait-export.mjs
rtk node tools/smoke-portrait-preview.mjs
rtk node tools/check-portrait-scene-candidates.mjs
```

The last command requires private V2/V3 candidates. It reads HEVC luma directly,
checks unchanged encoded image/depth payloads, and compares calibrated median
response between tiers. It does not assert a Photos appearance from metadata.

Physical acceptance requires the same focus and scene compared in Photos at
f/1.4 and f/16, plus viewer f, editable aperture, and save/reopen checks. The new
6215 response is roughly 1.9x V2's measured effect, so its previously accepted
appearance specifically needs a regression check, not an assumed pass.
