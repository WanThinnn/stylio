# Stylio

**English** · [Tiếng Việt](docs/readme/README.vi.md) · [简体中文](docs/readme/README.zh-CN.md)

**Stylio** - a name formed from Styles and Elio - is an open-source, on-device photo processing tool focused on interoperability with Apple Photos: Photographic Styles, iOS 27 Texture/Grain, HDR interoperability, AI-powered Portrait, and preserving as much original photo data as possible.

> [!NOTE]
> Current version: **[v1.1.0 — Release notes](release_note/v1.1.0.md)**<br>
> Independent and open-source. Not affiliated with Apple.

## Try it

**Web app:** https://wanthinnn.github.io/stylio

Stylio runs locally in your browser. Your photos are not uploaded.

On iPhone, add Stylio to the Home Screen for the full-screen PWA experience.

## What's new in v1.1.0

- **Edited native Styles reconstruction** for supported iPhone 16/17 Photos Current exports, retaining the selected Style while adding Texture/Grain and preserving supported HDR editing resources.
- **Third-party HDR JPEG compatibility**, including the tested Adobe RGB gain-map / Project Indigo workflow, with rebuilt base + gain data for more reliable HDR colour after supported Photos edits.
- **More natural AI Portrait** using available Apple matte guidance, IS-Net foreground matting and matte-guided EdgeSAM-3x refinement for thin edges, held objects, fingers and other difficult foreground boundaries.
- **Improved Portrait metadata and HDR preservation**, including the quick Portrait/ƒ toggle, editable aperture on validated exports, native depth calibration when available, source-aware generated-depth geometry and better HDR behaviour.
- **Refined AI tiers and reliability:** Standard uses Depth Anything V2 Small FP32, Pro uses Depth Anything V3 Small FP32, and both share the same accepted foreground/refinement pipeline with sequential worker cleanup and graceful fallback.
- **Release notes inside Settings:** tap **App version** to read the current release notes in-app, including offline after the required assets have been cached.

## Preview

<p align="center">
  <img src="docs/demo/img/demo-3.png" width="72%" alt="Stylio main interface">
</p>

<p align="center">
  <img src="docs/demo/img/demo-1.png" width="45%" alt="Stylio workflow">
  <img src="docs/demo/img/demo-2.png" width="45%" alt="Stylio settings">
</p>

## Main features

- **Photographic Styles porting** for supported older-iPhone HEIC photos, plus reconstruction of supported edited-native iPhone 16/17 Styles exports.
- **Texture & Grain** metadata support for the iOS 27 Photos editing controls.
- **HDR import and preservation** for supported native HEIC resources and compatible gain-map JPEG workflows, including tested third-party camera output.
- **AI Portrait / Depth Effect** with editable aperture, Portrait Lighting, foreground refinement and source-aware depth geometry on supported outputs.
- **Smart Enhance** features including local detail restoration and Adaptive Styles analysis.
- **Original-data preservation** for existing HEIC/HDR/Portrait/Styles resources whenever the source provides them.
- **HEIC, JPEG, PNG and DNG** input support in the browser workflow.
- **Local-first processing** with optional WebGPU acceleration and CPU fallback.
- **PWA app shell**, persistent History, Light/Dark/System appearance, and English/Vietnamese/Chinese UI.

## Basic workflow

1. Open Stylio and choose a photo.
2. Optionally enable **Smart Enhance** or configure individual AI features.
3. Process the image.
4. Save the result as a file.
5. Open it in Apple Photos and continue editing there.

Keep your originals. Stylio rewrites photo files and remains experimental.

## Documentation

The detailed material that used to make this README very long now lives in `docs/`:

- [Browser setup, compatibility and architecture](docs/web/browser-guide.md)
- [Photo processing, Portrait, HDR and DNG notes](docs/web/processing-guide.md)
- [AI model assets](docs/models/ai-assets.md)
- [CLI, upstream Shalielie heritage and reverse-engineering notes](docs/project/upstream-cli-and-research.md)
- [Technical findings and device experiments](facts.md)

The Python CLI is still included for research, batch work and compatibility testing, but Stylio's primary user experience is the browser/PWA app.

## Project origin

Stylio builds on [Shalielie by nathanatgit](https://github.com/nathanatgit/Shalielie) with [HoLanLa by joy-0220-yoj](https://github.com/joy-0220-yoj/HoLanLa.git) and retains its MIT license and copyright notice.

The browser/PWA experience, AI-assisted workflows, multilingual UI and current Stylio feature set are maintained by **Elio (WanThinnn)**.

## License

[MIT](LICENSE). Third-party AI runtimes/models keep their own licenses and notices under `web/vendor/`.

Apple, iPhone, Apple Photos and Photographic Styles are trademarks of Apple Inc. They are referenced only to describe interoperability.
