import {FFMPEG_ASSETS} from './ffmpeg-assets.js';
import {downloadModelBytes, MODEL_CACHE_NAME} from '../core/model-download.js';
import {box, boxes, topBox, concat, u} from '../core/box.js';
import {readSpsInfo} from './hevc-linear-tags.js';

let worker, ready, serial = Promise.resolve(), nextId = 0;
const pending = new Map(), releaseListeners = new Set();
export function onEncoderRelease(callback) { releaseListeners.add(callback); }
export function releaseHevcEncoder() {
  worker?.terminate(); worker = null; ready = null;
  for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(Error('HEVC encoder released')); }
  pending.clear();
  for (const callback of releaseListeners) callback();
}
function request(message, transfer = [], onProgress) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { releaseHevcEncoder(); }, 180000);
    pending.set(id, {resolve, reject, timer, onProgress});
    worker.postMessage({...message, id}, transfer);
  });
}
async function verifiedAsset(asset, onProgress) {
  const bytes = await downloadModelBytes(asset.url, {onProgress: progress => onProgress?.({
    ...progress, stage: progress.source === 'cache' ? 'modelCache' : progress.source === 'cacheWarning' ? 'modelCacheWarning' : 'modelDownload', resource: 'ffmpeg', url: asset.url,
  })});
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) {
    try { await (await caches.open(MODEL_CACHE_NAME)).delete(asset.url); } catch { /* unavailable cache */ }
    throw Error('FFmpeg runtime integrity check failed');
  }
  return bytes;
}
export async function prepareHevcAssets() {
  for (const asset of FFMPEG_ASSETS) await verifiedAsset(asset);
}

export async function ensureHevcEncoder(onProgress) {
  if (!ready) ready = (async () => {
    if (!globalThis.crossOriginIsolated || !globalThis.SharedArrayBuffer)
      throw Error('Thumbnail encoding needs isolation headers. Reload the page after offline support is installed.');
    const script = await verifiedAsset(FFMPEG_ASSETS[0], onProgress);
    const wasm = await verifiedAsset(FFMPEG_ASSETS[1], onProgress);
    const threadScript = await verifiedAsset(FFMPEG_ASSETS[2], onProgress);
    worker = new Worker(new URL('./ffmpeg-worker.js', import.meta.url));
    worker.onmessage = ({data}) => {
      const call = pending.get(data.id); if (!call) return;
      if (data.progress !== undefined) { call.onProgress?.(data.progress); return; }
      pending.delete(data.id); clearTimeout(call.timer);
      if (data.error) call.reject(Error(data.error)); else call.resolve(data.output);
    };
    worker.onerror = (err) => {
      console.error("FFmpeg Worker error:", err);
      releaseHevcEncoder();
    };
    await request({operation: 'load', script, wasm, threadScript}, [script.buffer, wasm.buffer, threadScript.buffer]);
  })().catch(error => { releaseHevcEncoder(); throw error; });
  await ready;
}

// One-frame, one-track MP4 written by our own encoder; no uploaded MP4 parsing.
export function extractEncodedHevc(mp4) {
  function findRecord(start, end) {
    for (const b of boxes(mp4, start, end)) {
      if (b.type === 'hvcC') return mp4.slice(b.off + b.hdr, b.off + b.size);
      const skip = b.type === 'stsd' ? 8 : ['hvc1', 'hev1'].includes(b.type) ? 78 : 0;
      if (skip || ['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
        const found = findRecord(b.off + b.hdr + skip, b.off + b.size);
        if (found) return found;
      }
    }
  }
  const record = findRecord(0, mp4.length), mdat = topBox(mp4, 'mdat');
  if (!record || record.length < 23 || (record[21] & 3) !== 3) throw Error('Invalid generated HEVC configuration');
  let pos = mdat.off + mdat.hdr; const frames = [];
  while (pos < mdat.off + mdat.size) {
    const length = u(mp4, pos, 4), type = (mp4[pos + 4] >> 1) & 63;
    if (length < 2 || pos + 4 + length > mdat.off + mdat.size) throw Error('Truncated generated HEVC frame');
    if (type <= 31) {
      if (![19, 20].includes(type)) throw Error('Generated HEVC frame is not an IDR');
      frames.push(mp4.slice(pos, pos + 4 + length));
    } else if (![32, 33, 34].includes(type)) throw Error(`Unexpected generated HEVC NAL ${type}`);
    pos += 4 + length;
  }
  if (frames.length !== 1) throw Error('HEVC encoder returned no single IDR frame');
  let p = 23, sps;
  for (let i = 0; i < record[22]; i++) {
    const type = record[p++] & 63, count = u(record, p, 2); p += 2;
    if (![32, 33, 34].includes(type)) throw Error('Unexpected generated HEVC parameter array');
    for (let j = 0; j < count; j++) {
      const size = u(record, p, 2); p += 2;
      if (p + size > record.length) throw Error('Truncated generated HEVC parameter array');
      if (type === 33) sps = readSpsInfo(record.subarray(p, p + size));
      p += size;
    }
  }
  if (!sps || p !== record.length) throw Error('Invalid generated HEVC SPS');
  return {payload: concat(frames), hvcc: box('hvcC', record), record, sps};
}

// Match CLI encode_target_linear_thumbnail: RGB in stored orientation -> Main10.
export function encodeRgbThumbnail(rgb, width, height, onProgress) {
  const task = serial.catch(() => {}).then(async () => {
    if (![width, height].every(n => Number.isInteger(n) && n >= 2 && n <= 1024 && n % 2 === 0)
        || rgb.length !== width * height * 3) throw Error('Invalid thumbnail RGB');
    await ensureHevcEncoder(onProgress);
    onProgress?.({stage: 'encode'});
    const input = rgb.slice();
    const args = ['-hide_banner', '-threads', '1', '-filter_threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`,
      '-r', '1', '-i', 'input.raw', '-frames:v', '1', '-an',
      '-vf', 'scale=in_range=full:out_range=full,format=yuv420p10le', '-c:v', 'libx265',
      '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10', '-tag:v', 'hvc1',
      '-color_range', 'pc', '-color_primaries', 'unspecified', '-color_trc', 'unspecified', '-colorspace', 'unspecified',
      '-x265-params', 'info=0:pools=none:frame-threads=1:range=full:colorprim=2:transfer=2:colormatrix=2',
      '-movflags', '+faststart', 'output.mp4'];
    const output = await request({operation: 'encode', pixels: input, args}, [input.buffer]);
    const result = extractEncodedHevc(output);
    if (result.sps.luma !== 10 || result.sps.chromaDepth !== 10 || result.sps.chroma !== 1
        || result.sps.fullRange !== true || result.sps.primaries !== 2
        || result.sps.transfer !== 2 || result.sps.matrix !== 2)
      throw Error('Thumbnail encoder did not produce native full-range Main10 4:2:0');
    return result;
  });
  serial = task;
  return task;
}
