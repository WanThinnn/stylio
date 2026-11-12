import {createFileProcessor} from './processing/file-processor.js';
import {createPhotoAnalysis} from './processing/photo-analysis.js';
import {createPortraitController} from './processing/portrait-controller.js';
import {createProfileRepository} from './processing/profiles.js';
import {createProcessingBudget} from './processing/task-queue.js';
import {t} from '../ui/i18n.js';
import {AI_STRINGS} from '../ui/ai-strings.js';
import {livePhotoIdentifierFromExif,movieStyleTracks,photoContentIdentifier,validateLivePair} from '../media/live-photo.js';
import {addMovieTexture} from '../media/native-movie-texture.js';
import {hasTexture} from '../styles/texture.js';
import {discoverHeic} from '../core/heif.js';
import {captureDateFromExif,photoCaptureDate} from '../media/photo-date.js';
import {extractRasterExif} from '../raster/exif.js';
import {imageFormat} from '../media/image-format.js';

async function readFile(route, name) {
  const response = await fetch(route, {cache: 'no-store'});
  if (!response.ok) throw Error(`Could not read ${name}.`);
  return new File([await response.blob()], name);
}

async function writeFile(route, body) {
  const response = await fetch(route, {method: 'POST', body, headers: {'X-Stylio-Result': '1'}});
  if (!response.ok) throw Error('Could not write the processed result.');
}

async function releaseIdleModels() {
  const [{releaseOrtModels},{releaseDetailWorkers},{releaseStyleRecommender}] = await Promise.all([
    import('../vision/ort-vision.js'), import('../detail/detail-inference.js'), import('../recommend/style-runtime.js'),
  ]);
  releaseDetailWorkers();
  releaseStyleRecommender();
  await releaseOrtModels();
}

export function createNativeEngine(notify) {
  const profiles = createProfileRepository();
  const acquireProcessingSlot = createProcessingBudget({concurrency: 1});

  async function process({route, name, paired, options = {}}) {
    const lang = AI_STRINGS[options.language] ? options.language : 'en';
    const T = key => t(lang, key);
    const aiText = () => AI_STRINGS[lang];
    const aiFeatures = {enabled: feature => options[feature] === true};
    const gpuAcceleration = {checked: options.gpu !== false && Boolean(globalThis.navigator?.gpu)};
    const selectedAiLevel = () => ['lite', 'standard', 'pro'].includes(options.model) ? options.model : 'standard';
    const analysis = createPhotoAnalysis({T, aiText, aiFeatures, gpuAcceleration, selectedAiLevel});
    const {tryAiPortrait} = createPortraitController({
      aiFeatures, aiCandidates: [], aiText, gpuAcceleration, selectedAiLevel, acquireProcessingSlot,
    });
    const notes = new Map();
    const cleanups = [];
    let output;
    let failure;
    let portraitApplied = false;
    let portraitPreserved = false;
    const ui = {
      set(message, kind) {
        if (kind === 'err') failure = message;
        notify({message});
      },
      progress: progress => notify({progress}),
      note(message, key = 'status') {
        if (message) notes.set(key, message);
        else notes.delete(key);
      },
      aiState(message) { if (message) notify({message}); },
      output(file) { output = file; },
      cleanup(dispose) { cleanups.push(dispose); },
      cancelAi: () => () => {},
      aiBusy() {},
      aiView(applied) { portraitApplied = applied; },
      portraitSkipped(reason) { portraitPreserved = reason === 'existing-depth'; },
      portraitPreview() {},
      metadata() {},
      portraitAdvice(message) { ui.note(message, 'portrait'); },
      adaptiveStyleAdvice(message) { ui.note(message, 'adaptive-style'); },
    };

    try {
      const file = await readFile(`${route}/input`, name);
      const processor = createFileProcessor({
        T, getLanguage: () => lang, aiText, aiFeatures, gpuAcceleration, selectedAiLevel,
        ...profiles, tryAiPortrait, analysis, acquireProcessingSlot, releaseIdleModels,
        packageLivePhotos: false,
      });
      await processor.handleFile(file, ui);
      if (failure || !output) throw Error(failure || 'The processing engine did not produce a photo.');

      let movie = 'none';
      if (paired) {
        const source = new Uint8Array(await file.arrayBuffer());
        const result = new Uint8Array(await output.arrayBuffer());
        const motion = await readFile(`${route}/movie`, 'original.mov');
        const motionBytes = new Uint8Array(await motion.arrayBuffer());
        movie = livePhotoDisposition(source, result, motionBytes);
        if (movie === 'needs-texture') {
          let updated;
          try {
            const template = await readFile('/live-photo-video/template.mov', 'Texture video template');
            const candidate = addMovieTexture(motionBytes, new Uint8Array(await template.arrayBuffer()));
            if (livePhotoDisposition(source, result, candidate) === 'compatible') updated = candidate;
          } catch (error) { console.warn('Could not add Live Photo Texture metadata', error); }
          if (updated) {
            await writeFile(`${route}/movie-output`, updated);
            movie = 'repaired';
          } else {
            movie = 'needs-tracks';
          }
        }
      }

      await writeFile(`${route}/output`, output);
      const depthWarning = options.portrait === true && !portraitApplied && !portraitPreserved
        ? notes.get('ai-error') || notes.get('ai') || notes.get('compatibility') || 'The photo has no compatible Lighting Depth result.'
        : null;
      return {name: output.name, movie, notes: [...notes.values()], depthWarning};
    } finally {
      await Promise.allSettled(cleanups.map(async dispose => dispose()));
    }
  }

  return {process, inspectSharedPhoto};
}

export async function inspectSharedPhoto(route) {
  const file = await readFile(route, 'shared photo');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = imageFormat(bytes);
  const rasterExif = ['jpeg','png','webp'].includes(format);
  if (format !== 'heic' && !rasterExif) return null;
  let identifier = null;
  let capture = null;
  try {
    const exif = rasterExif ? extractRasterExif(bytes) : null;
    if (format === 'jpeg') identifier = livePhotoIdentifierFromExif(exif);
    if (format === 'heic') identifier = photoContentIdentifier(bytes);
    capture = rasterExif ? captureDateFromExif(exif) : photoCaptureDate(bytes);
  } catch { /* A JPEG with no readable EXIF can still match a local photo. */ }
  return {identifier, format, date: capture?.date ?? null, timestamp: capture?.timestamp ?? null};
}

export function livePhotoDisposition(source, output, movie) {
  try {
    const pairing = validateLivePair(source, movie);
    if (photoContentIdentifier(output) !== pairing.identifier) return 'mismatch';
    if (source.length === output.length && source.every((byte, index) => byte === output[index])) return 'compatible';
    const {stylesItem, infos} = discoverHeic(output);
    const texture = hasTexture(infos);
    const tracks = movieStyleTracks(movie);
    if (stylesItem !== null && !tracks.styles) return 'needs-tracks';
    if (texture && !tracks.texture) return tracks.styles ? 'needs-texture' : 'needs-tracks';
    return 'compatible';
  } catch {
    return 'mismatch';
  }
}
