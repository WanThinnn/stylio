// Raster conversion adapted from ref/Elio-backup; isolated from the native HEIC path.
import {releaseHevcEncoder} from './ffmpeg-hevc.js';
import {buildGeneratedProfile,nclx} from './generated-profile.js';
import { topBox, metaChildren, findChild, be, box, concat } from "./box.js";
import {
  discoverHeic, discoverImageItems, parseIloc, parseIpcoIpma, extractItem, propertyForItem,
  replaceItemPropertyWithSource, compactItemProperties, repointItemProperty, removeItems, setItemReference, ispeBox, addItems,
  propertyBoxBytes, auxUriForItem, dimensionsForItem, DEPTH_URI, MATTE_URIS, URI_HDR_GAIN,
  appendIpcoProperty, associateItemProperty, setItemPropertyAssociations,
  itemOrientation, displayDimensions,
} from "./heif.js";
import { addTextureItems, upgradeStylesV16 } from "./texture.js";
import {
  applySceneStatistics, applyPersonMetadata, setPersonMasksValid, linearLumaFromRgb,
  buildLightMaps, applyLightMaps,
} from "./styles.js";
import {installPortraitMatte} from './portrait-matte.js';
import { extractRasterExif, preserveRasterExif, buildAppleStyleExif, readExifOrientation } from "./exif.js";
import { rasterFrame, rasterColr, rasterVideoColorSpace, checkEncodedColorSpace, resolveEncodedColorSpace } from "./raster-color.js";
import {blackWhiteI420, measureHevcRange, hevcOutputColor} from './hevc-color.js';
import { encodeSelectedLinearThumbnail as encodeLinearThumbnail, linearGeometry } from "./linear-thumbnail.js";
import { supportedHevcConfig } from "./hevc-encoder.js";
import {ensureHevcEncoder, encodeHevcPixels,decodeJpegYuv} from './ffmpeg-hevc.js';
import {extractJpegHdr,encodeTmapMetadata,iccColr,hdrJpegAlternateColr,rgbIsoToAppleGain,
  yuv420Tile,hdrJpegError,yuv420ToRgba,rebaseGainMapRgba} from './jpeg-hdr.js';
import {rgbaToI420} from './raster-color.js';
import {generateSyntheticHevc} from './synthetic-hevc.js';
import {buildStyleMarker,validateStyleRecommendation} from '../recommend/style-selection.js';
import {applyStyleDisplayRgba,shouldRenderStyleDisplay} from '../recommend/style-display-render.js';
import {makeRgbHdrEditable} from './hdr-scalar-export.js';

const TILE = 512, MAX_PRIMARY_TILES = 48;
const THUMB_W = 416, THUMB_H = 312;

const bytes = (s) => new TextEncoder().encode(s);

function withCompatibleBrand(ftyp,brand){
  const b=topBox(ftyp,'ftyp'),body=ftyp.subarray(b.off+b.hdr,b.off+b.size),tag=bytes(brand);
  for(let p=8;p+4<=body.length;p+=4)if(same(body.subarray(p,p+4),tag))return ftyp;
  return box('ftyp',concat([body,tag]));
}

function gridPayload(width,height,columns,rows){
  if(![width,height,columns,rows].every(Number.isInteger)||width<1||height<1||width>65535||height>65535
    ||columns<1||columns>256||rows<1||rows>256)throw Error('Invalid HDR grid payload');
  return concat([Uint8Array.of(0,0,rows-1,columns-1),be(width,2),be(height,2)]);
}

function colorContext(canvas, options = {}) {
  // Browser HEVC encoders commonly output BT.709. Convert source ICC/P3 colours here
  // rather than feeding P3 samples that the encoder may silently label as BT.709.
  return canvas.getContext("2d", { ...options, colorSpace: "srgb" });
}

function hvccBox(description) {
  const record = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice()
    : new Uint8Array(description).slice();
  return box("hvcC", record);
}

export async function encodeCanvases(width, height, count, draw, bitrate, progress, onProgress) {
  const config = await supportedHevcConfig(width, height, bitrate);
  if (!config) return encodeCanvasesUsing(width, height, count, draw, bitrate, progress, onProgress, null);
  try {
    return await encodeCanvasesUsing(width, height, count, draw, bitrate, progress, onProgress, config);
  } catch (error) {
    // isConfigSupported can succeed even when the OS encoder fails to start.
    // Retry from the original canvases with the verified software encoder.
    console.warn('Platform HEVC encoding failed; retrying with software encoder', error);
    return encodeCanvasesUsing(width, height, count, draw, bitrate, progress, onProgress, null);
  }
}

async function encodeCanvasesUsing(width, height, count, draw, bitrate, progress, onProgress, config) {
  if (!config) {
    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true,colorSpace:'srgb'});
    if(!ctx)throw Error('Could not create software HEVC canvas');
    const colorSpace=rasterVideoColorSpace(), chunks=[]; let hvcc;
    for(let i=0;i<count;i++) {
      draw(ctx,i);
      const pixels=rgbaToI420(ctx.getImageData(0,0,width,height).data,width,height,colorSpace);
      const result=await encodeHevcPixels(pixels,{width,height,pixelFormat:'yuv420p',...colorSpace},onProgress);
      if(hvcc&&!same(hvcc,result.hvcc))throw Error('Software HEVC configurations differ between tiles');
      hvcc=result.hvcc;chunks.push(result.payload);progress?.(i+1,count);
    }
    return {chunks,hvcc,colr:rasterColr(colorSpace)};
  }
  onProgress?.({stage: "codec", operation: "encode", source: "WebCodecs VideoEncoder"});
  let description = null, encoderError = null, inputColorSpace = null, outputColorSpace = null;
  const outputColorSpaces = [];
  const chunks = [];
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      if (metadata?.decoderConfig?.colorSpace) outputColorSpaces.push(metadata.decoderConfig.colorSpace);
      if (metadata?.decoderConfig?.description) {
        const source = metadata.decoderConfig.description;
        description = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
          : new Uint8Array(source).slice();
      }
      const payload = new Uint8Array(chunk.byteLength);
      chunk.copyTo(payload);
      chunks.push(payload);
    },
    error(error) { encoderError = error; },
  });
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = colorContext(canvas, { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Could not create raster import canvas");
  try {
    encoder.configure(config);
    // Full-range input endpoints stay unambiguous even if the encoder converts to
    // limited range but reports fullRange=true (observed on the user's iPhone).
    const probeSpace = {...rasterVideoColorSpace(), fullRange: true};
    const probe = new VideoFrame(blackWhiteI420(width, height), {format: 'I420',
      codedWidth: width, codedHeight: height, timestamp: 0, duration: 1_000_000, colorSpace: probeSpace});
    try { encoder.encode(probe, { keyFrame: true }); }
    finally { probe.close(); }
    await encoder.flush();
    if (encoderError) throw encoderError;
    if (!description || chunks.length !== 1) throw Error('HEVC colour calibration returned no probe frame');
    const fullRange = await measureHevcRange(description, chunks[0], config, onProgress);
    outputColorSpace = resolveEncodedColorSpace(hevcOutputColor(description, outputColorSpaces.at(-1), probeSpace, fullRange));
    // Keep input samples full-range; the measured output range belongs to the
    // encoded bitstream, not to the samples submitted to VideoFrame.
    inputColorSpace = {...outputColorSpace, fullRange: true};
    chunks.length = 0;
    outputColorSpaces.length = 0;
    for (let i = 0; i < count; i++) {
      draw(ctx, i);
      const prepared = rasterFrame(ctx, width, height, (i + 1) * 1_000_000, inputColorSpace);
      const frame = prepared.frame;
      if (inputColorSpace) checkEncodedColorSpace(prepared.colorSpace, inputColorSpace);
      else inputColorSpace = prepared.colorSpace;
      try { encoder.encode(frame, { keyFrame: true }); }
      finally { frame.close(); }
      if (encoder.encodeQueueSize > 3) await new Promise((resolve) => {
        const done = () => { encoder.removeEventListener("dequeue", done); resolve(); };
        encoder.addEventListener("dequeue", done, { once: true });
      });
      progress?.(i + 1, count);
    }
    await encoder.flush();
  } finally { if (encoder.state !== 'closed') encoder.close(); }
  if (encoderError) throw encoderError;
  if (!description || chunks.length !== count)
    throw new Error(`HEVC encoder returned ${chunks.length}/${count} raster frames`);
  for (const colorSpace of outputColorSpaces)
    checkEncodedColorSpace(hevcOutputColor(description, colorSpace, outputColorSpace, outputColorSpace.fullRange), outputColorSpace);
  return { chunks, hvcc: hvccBox(description), colr: rasterColr(outputColorSpace) };
}

function drawContained(ctx, image, width, height) {
  ctx.save();
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  ctx.restore();
}

const even = (value) => Math.max(16, Math.round(value / 2) * 2);

function fitWithinTileBudget(width, height, limit, tileSize = TILE) {
  if (Math.ceil(width / tileSize) * Math.ceil(height / tileSize) <= limit)
    return [width, height];
  let bestScale = 0;
  for (let columns = 1; columns <= limit; columns++) {
    const rows = Math.floor(limit / columns);
    const scale = Math.min(columns * tileSize / width, rows * tileSize / height, 1);
    if (scale > bestScale) bestScale = scale;
  }
  return [Math.max(1, Math.floor(width * bestScale)),
    Math.max(1, Math.floor(height * bestScale))];
}

export function targetGeometry(image) {
  if (![image.width, image.height].every(n => Number.isInteger(n) && n > 0))
    throw Error('Invalid raster image dimensions');
  // Keep the source's displayed pixel dimensions whenever 48 donor slots can hold it.
  // The donor carries irot=270, so the encoded grid uses the swapped stored dimensions.
  const fitted = fitWithinTileBudget(image.height, image.width, MAX_PRIMARY_TILES);
  // Very wide panoramas can fit 48 primary tiles but overflow the 12 HDR slots.
  const [storedWidth, storedHeight] = fitWithinTileBudget(...fitted, 12, TILE * 2);
  const displayWidth = storedHeight, displayHeight = storedWidth;
  const primaryColumns = Math.ceil(storedWidth / TILE);
  const primaryRows = Math.ceil(storedHeight / TILE);
  const mapScale = Math.min(1, 2880 / storedWidth, 2160 / storedHeight);
  const thumbScale = Math.min(THUMB_W / storedWidth, THUMB_H / storedHeight);
  const hdrWidth = Math.max(1, Math.round(storedWidth / 2));
  const hdrHeight = Math.max(1, Math.round(storedHeight / 2));
  const deltaWidth = Math.max(1, Math.round(storedWidth * mapScale));
  const deltaHeight = Math.max(1, Math.round(storedHeight * mapScale));
  return {
    displayWidth, displayHeight, storedWidth, storedHeight,
    sourceWidth: image.width, sourceHeight: image.height,
    resized: displayWidth !== image.width || displayHeight !== image.height,
    primaryColumns, primaryRows, primaryTiles: primaryColumns * primaryRows,
    hdrWidth, hdrHeight,
    hdrColumns: Math.ceil(hdrWidth / TILE), hdrRows: Math.ceil(hdrHeight / TILE),
    deltaWidth, deltaHeight,
    deltaColumns: Math.ceil(deltaWidth / TILE), deltaRows: Math.ceil(deltaHeight / TILE),
    thumbWidth: even(storedWidth * thumbScale), thumbHeight: even(storedHeight * thumbScale),
  };
}

function storedCanvas(image, geometry) {
  const canvas = document.createElement("canvas");
  canvas.width = geometry.storedWidth; canvas.height = geometry.storedHeight;
  const ctx = colorContext(canvas, { alpha: false });
  ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // The donor primary carries irot=270. Draw the upright source through
  // its inverse so Photos presents it upright after applying the item transform.
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.translate(-geometry.displayWidth / 2, -geometry.displayHeight / 2);
  ctx.drawImage(image, 0, 0, geometry.displayWidth, geometry.displayHeight);
  ctx.restore();
  return canvas;
}

function thumbnailCanvas(stored, geometry) {
  const canvas = document.createElement("canvas");
  canvas.width = geometry.thumbWidth; canvas.height = geometry.thumbHeight;
  const ctx = colorContext(canvas, { alpha: false });
  ctx.drawImage(stored, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function openBrowserImage(file, onProgress, {reportFailure = true} = {}) {
  let image, close = () => image?.close?.();
  onProgress?.({stage: "codec", operation: "decode", source: "createImageBitmap"});
  try { image = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    try { image = await createImageBitmap(file); }
    catch {
      const url = URL.createObjectURL(file);
      try {
        const element = new Image();
        onProgress?.({stage: "codec", operation: "decode", source: "Image.decode()"});
        element.src = url;
        await element.decode();
        image = element;
        close = () => URL.revokeObjectURL(url);
      } catch (error) {
        URL.revokeObjectURL(url);
        const reason = error?.message || String(error);
        if (reportFailure) onProgress?.({stage: "codec", operation: "decode", source: "Image.decode()", decodeError: reason});
        throw new Error(`Raster image decode failed: ${reason}`);
      }
    }
  }
  return { image, close };
}

async function openHdrBaseImage(hdr,orientation,colorSpace,onProgress){
  try{return await openBrowserImage(new File([hdr.base],'base.jpeg',{type:'image/jpeg'}),onProgress,{reportFailure:false});}
  catch(browserError){
    // Safari can reject the base member after it notices the original JPEG's
    // MPF/HDR structure, even though that extracted member is valid JPEG. The
    // gain-map path already has a deterministic FFmpeg decoder; use the same
    // decoder for the display base instead of rejecting a valid Indigo photo.
    onProgress?.({stage:'codec',operation:'decode',source:'FFmpeg.wasm / JPEG HDR base',
      browserDecodeError:String(browserError?.message||browserError)});
    const decoded=await decodeJpegYuv(hdr.base,{width:hdr.width,height:hdr.height,orientation},onProgress);
    const rgba=yuv420ToRgba(decoded.bytes,decoded.width,decoded.height);
    const canvas=document.createElement('canvas');canvas.width=decoded.width;canvas.height=decoded.height;
    const ctx=canvas.getContext('2d',{alpha:false,colorSpace});
    if(!ctx)throw Error('HDR JPEG fallback canvas unavailable');
    const actual=ctx.getContextAttributes?.().colorSpace;
    if(actual&&actual!==colorSpace)throw Error(`HDR JPEG fallback lost ${colorSpace} colour space`);
    let pixels;
    try{pixels=new ImageData(rgba,decoded.width,decoded.height,{colorSpace});}
    catch{pixels=ctx.createImageData(decoded.width,decoded.height);pixels.data.set(rgba);}
    ctx.putImageData(pixels,0,0);
    return {image:canvas,close(){canvas.width=canvas.height=0;},decoderFallback:true};
  }
}

export function sampleRasterLuma(image, width = 256, height = 192) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = colorContext(canvas, { alpha: false, willReadFrequently: true });
  if (!ctx) throw Error('Could not create tone-analysis canvas');
  // Letterboxing biases percentiles towards artificial black, particularly in
  // portraits/panoramas. Stretching for analysis samples the entire real image.
  ctx.drawImage(image, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, p = 0; i < rgba.length; i += 4) {
    rgb[p++] = rgba[i]; rgb[p++] = rgba[i + 1]; rgb[p++] = rgba[i + 2];
  }
  const luma = linearLumaFromRgb(rgb);
  canvas.width = canvas.height = 0;
  return luma;
}

/** Minimal Apple Exif containing Orientation=6 and only MakerNote tag 0x54. */
export function buildRasterExif(mn54, makerType = 7, sourceExif = null, geometry = null) {
  const minimal = buildAppleStyleExif(mn54, makerType,geometry?.exifOrientation??6);
  return sourceExif ? preserveRasterExif(sourceExif, minimal, {
    width: geometry?.storedWidth, height: geometry?.storedHeight,orientation:geometry?.exifOrientation??6,
  }) : minimal;
}

function setGridLayout(meta, iid, width, height, columns = null, rows = null) {
  const iloc = parseIloc(meta, topBox(meta, "meta"));
  const item = iloc.items.get(iid);
  if (!item || item.constructionMethod !== 1 || item.extents.length !== 1)
    throw new Error(`Grid item ${iid} is not stored in idat`);
  const idat = findChild(metaChildren(meta, topBox(meta, "meta")), "idat");
  const extent = item.extents[0];
  const offset = idat.off + idat.hdr + item.baseOffset + extent.offset;
  if (extent.length < 8 || meta[offset] !== 0 || (meta[offset + 1] & 1))
    throw new Error(`Grid item ${iid} has an unsupported descriptor`);
  const out = meta.slice();
  if (columns !== null && rows !== null) {
    if (columns < 1 || columns > 256 || rows < 1 || rows > 256)
      throw new Error(`Grid item ${iid} has invalid ${columns}x${rows} layout`);
    out[offset + 2] = rows - 1;
    out[offset + 3] = columns - 1;
  }
  out.set(be(width, 2), offset + 4);
  out.set(be(height, 2), offset + 6);
  return out;
}

function replaceIspe(meta, iid, width, height) {
  const props = parseIpcoIpma(meta, topBox(meta, "meta"));
  const ispe = propertyForItem(props, iid, "ispe");
  if (!ispe) throw new Error(`Item ${iid} has no ispe property`);
  return replaceItemPropertyWithSource(meta, iid, "ispe", ispeBox(width, height));
}

function same(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Capture a source Portrait depth auxiliary and its XMP sidecar for compatibility re-encode. */
export function extractPortraitDepth(source, discovery = discoverHeic(source)) {
  const depthId = [...discovery.infos.keys()]
    .find((iid) => auxUriForItem(discovery.props, iid) === DEPTH_URI);
  if (depthId === undefined) return null;
  const item = discovery.iloc.items.get(depthId);
  if (!item || item.constructionMethod !== 0 || !item.extents.length) return null;
  const boxes = ["ispe", "pixi", "colr", "hvcC", "irot", "imir"]
    .map((type) => propertyBoxBytes(source, discovery.props, depthId, type)).filter(Boolean);
  const auxc = propertyBoxBytes(source, discovery.props, depthId, "auxC");
  if (!auxc || !boxes.some((b) => String.fromCharCode(...b.slice(4, 8)) === "hvcC"))
    return null;
  const sidecars = [];
  for (const ref of discovery.refs) {
    if (ref.type !== "cdsc" || !ref.to.includes(depthId)) continue;
    const info = discovery.infos.get(ref.from);
    const sidecar = discovery.iloc.items.get(ref.from);
    if (info?.type !== "mime" || !sidecar || sidecar.constructionMethod !== 0) continue;
    sidecars.push({
      contentType: info.contentType || "application/rdf+xml",
      payload: extractItem(source, discovery.iloc, ref.from),
    });
  }
  return {
    itemType: discovery.infos.get(depthId)?.type || "hvc1",
    payload: extractItem(source, discovery.iloc, depthId), boxes, auxc, sidecars,
  };
}

function appendPortraitDepth(meta, payloads, depth, primary) {
  if (!depth) return [meta, null];
  const tmaps = [...discoverHeic(meta).infos]
    .filter(([, info]) => info.type === "tmap").map(([iid]) => iid);
  let assigned;
  [meta, assigned] = addItems(meta, [{
    key: "portrait-depth", itemType: depth.itemType || "hvc1",
    boxes: depth.boxes || [], auxc: depth.auxc,
    refType: "auxl", refTo: [primary, ...tmaps],
  }]);
  const depthId = assigned.get("portrait-depth");
  payloads.set(depthId, depth.payload);
  const specs = (depth.sidecars || []).map((sidecar, index) => ({
    key: `portrait-depth-xmp-${index}`, itemType: "mime",
    contentType: sidecar.contentType || "application/rdf+xml",
    refType: "cdsc", refTo: [depthId], _payload: sidecar.payload,
  }));
  if (specs.length) {
    let sidecarIds;
    [meta, sidecarIds] = addItems(meta, specs);
    for (const spec of specs) payloads.set(sidecarIds.get(spec.key), spec._payload);
  }
  return [meta, depthId];
}

/** Adapt the 48/12 donor graph to encoded raster geometry. Exported for container tests. */
export function buildRasterHeic(profile, encoded, sortedLuma = null, faceResult = null,
  geometry = null) {
  const manifest = profile.manifest;
  if (Number(manifest.primary_tile_count) !== 48 || Number(manifest.hdr_tile_count) !== 12)
    throw new Error("Raster import requires the 48/12 profile");
  if (encoded.main.length < 1 || encoded.main.length > 48)
    throw new Error("Raster import needs between 1 and 48 primary tiles");
  let meta = profile.meta.slice(), ftyp = profile.ftyp;
  const payloads = new Map(profile.retained);
  let primarySlots = manifest.donor_primary_tiles.map(Number);
  let hdrSlots = manifest.donor_hdr_tiles.map(Number);
  let deltaSlots = manifest.donor_delta_tiles.map(Number);
  if (geometry) {
    const primaryId = Number(manifest.donor_primary_item);
    const hdrId = Number(manifest.donor_hdr_grid_item);
    const deltaId = Number(manifest.donor_delta_grid_item);
    const tmapId = [...discoverHeic(meta).infos].find(([, info]) => info.type === "tmap")?.[0];
    const primaryColumns = geometry.primaryColumns ?? 8;
    const primaryRows = geometry.primaryRows ?? 6;
    const primaryCount = geometry.primaryTiles ?? encoded.main.length;
    if (primaryCount !== encoded.main.length || primaryCount > primarySlots.length
        || primaryColumns * primaryRows !== primaryCount)
      throw new Error("Raster geometry does not match encoded primary tiles");
    const unusedPrimary = primarySlots.slice(primaryCount);
    if (unusedPrimary.length) {
      meta = removeItems(meta, unusedPrimary);
      unusedPrimary.forEach((iid) => payloads.delete(iid));
    }
    primarySlots = primarySlots.slice(0, primaryCount);
    meta = setItemReference(meta, "dimg", primaryId, primarySlots);
    meta = setGridLayout(meta, primaryId, geometry.storedWidth, geometry.storedHeight,
      primaryColumns, primaryRows);
    meta = replaceIspe(meta, primaryId, geometry.storedWidth, geometry.storedHeight);

    const hdrColumns = geometry.hdrColumns ?? 4;
    const hdrRows = geometry.hdrRows ?? 3;
    const hdrCount = hdrColumns * hdrRows;
    if (hdrCount < 1 || hdrCount > hdrSlots.length)
      throw new Error("Raster HDR grid exceeds donor capacity");
    const unusedHdr = hdrSlots.slice(hdrCount);
    if (unusedHdr.length) {
      meta = removeItems(meta, unusedHdr);
      unusedHdr.forEach((iid) => payloads.delete(iid));
    }
    hdrSlots = hdrSlots.slice(0, hdrCount);
    meta = setItemReference(meta, "dimg", hdrId, hdrSlots);
    meta = setGridLayout(meta, hdrId, geometry.hdrWidth, geometry.hdrHeight,
      hdrColumns, hdrRows);
    meta = replaceIspe(meta, hdrId, geometry.hdrWidth, geometry.hdrHeight);
    if (Number.isFinite(deltaId)) {
      const deltaColumns = geometry.deltaColumns ?? 6;
      const deltaRows = geometry.deltaRows ?? 5;
      const deltaCount = deltaColumns * deltaRows;
      if (deltaCount > deltaSlots.length)
        throw new Error(`Raster StyleDeltaMap needs ${deltaCount} tiles`);
      const unusedDelta = deltaSlots.slice(deltaCount);
      if (unusedDelta.length) {
        meta = removeItems(meta, unusedDelta);
        unusedDelta.forEach((iid) => payloads.delete(iid));
      }
      deltaSlots = deltaSlots.slice(0, deltaCount);
      meta = setItemReference(meta, "dimg", deltaId, deltaSlots);
      meta = setGridLayout(meta, deltaId, geometry.deltaWidth, geometry.deltaHeight,
        deltaColumns, deltaRows);
      meta = replaceIspe(meta, deltaId, geometry.deltaWidth, geometry.deltaHeight);
    }
    if (tmapId !== undefined)
      meta = replaceIspe(meta, tmapId, geometry.displayWidth, geometry.displayHeight);
    meta = replaceIspe(meta, Number(manifest.donor_thumbnail_item),
      geometry.thumbWidth, geometry.thumbHeight);
  }

  // The donor's old people mattes must never leak into a newly imported screenshot/photo.
  const donorDiscovery = discoverHeic(meta);
  const donorMaskIds = new Set([...donorDiscovery.infos.keys()].filter(id =>
    Object.values(MATTE_URIS).includes(auxUriForItem(donorDiscovery.props, id))));
  const donorPeople = [...donorMaskIds, ...donorDiscovery.refs.filter(ref =>
    ref.type === 'cdsc' && ref.to.some(id => donorMaskIds.has(id))).map(ref => ref.from)];
  if (donorPeople.length) {
    meta = removeItems(meta, donorPeople);
    donorPeople.forEach((iid) => payloads.delete(iid));
  }

  primarySlots.forEach((iid, i) => payloads.set(iid, encoded.main[i]));
  payloads.set(Number(manifest.donor_thumbnail_item), encoded.thumb);
  payloads.set(Number(manifest.donor_linear_thumb_item), encoded.linearThumbnail?.payload || encoded.thumb);
  if(encoded.hdrChunks&&encoded.hdrChunks.length!==hdrSlots.length)throw Error('HDR tiles do not match gain-map geometry');
  hdrSlots.forEach((iid,i) => payloads.set(iid, encoded.hdrChunks?.[i]??encoded.hdr));
  const makerType = Number(manifest.smartstyle_makernote_type ?? 7);
  const exif = buildRasterExif(profile.mn54, makerType, encoded.sourceExif, geometry);
  payloads.set(Number(manifest.donor_exif_item), exif);

  let props = parseIpcoIpma(meta, topBox(meta, "meta"));
  for (const iid of primarySlots)
    meta = replaceItemPropertyWithSource(meta, iid, "hvcC", encoded.mainHvcc);
  const thumb = Number(manifest.donor_thumbnail_item);
  meta = replaceItemPropertyWithSource(meta, thumb, "hvcC", encoded.thumbHvcc);

  // Encoded RGB/YUV color must travel with its own colr, never the donor's ICC profile.
  const assignColor = (ids, color) => {
    let index;
    [meta, index] = appendIpcoProperty(meta, color);
    for (const iid of ids) {
      const current = parseIpcoIpma(meta, topBox(meta, "meta"));
      const kept = (current.associations.get(iid) || []).filter(a => !["colr", "clli", "mdcv"].includes(current.properties[a.index - 1]?.type));
      meta = setItemPropertyAssociations(meta, iid, [...kept.map(a => [a.index, a.essential]), [index, false]]);
    }
  };
  const tmapItems = [...discoverHeic(meta).infos].filter(([, info]) => info.type === "tmap")
    .map(([iid]) => iid);
  assignColor([Number(manifest.donor_primary_item), ...primarySlots, ...tmapItems],
    encoded.mainColr || rasterColr(rasterVideoColorSpace()));
  assignColor([thumb, Number(manifest.donor_linear_thumb_item)],
    encoded.thumbColr || rasterColr(rasterVideoColorSpace()));
  // WebCodecs raster frames are Main8 even when the generated template is Main10.
  let rasterPixiIndex;
  [meta, rasterPixiIndex] = appendIpcoProperty(meta, box('pixi', new Uint8Array([0,0,0,0,3,8,8,8])));
  for (const id of [Number(manifest.donor_primary_item), ...primarySlots, Number(manifest.donor_hdr_grid_item), ...hdrSlots, thumb]) {
    const current = parseIpcoIpma(meta, topBox(meta, 'meta'));
    const kept = (current.associations.get(id) || []).filter(a => current.properties[a.index - 1]?.type !== 'pixi');
    meta = setItemPropertyAssociations(meta, id, [...kept.map(a => [a.index, a.essential]), [rasterPixiIndex, false]]);
  }

  // linearthumbnail reuses the encoded thumbnail, including its dimensions/pixi/hvcC.
  const linear = Number(manifest.donor_linear_thumb_item);
  props = parseIpcoIpma(meta, topBox(meta, "meta"));
  for (const type of ["ispe", "pixi", "hvcC"]) {
    const from = propertyForItem(props, linear, type), to = propertyForItem(props, thumb, type);
    if (from && to && from.index !== to.index)
      meta = repointItemProperty(meta, linear, from.index, to.index);
    props = parseIpcoIpma(meta, topBox(meta, "meta"));
  }
  if (encoded.linearThumbnail) {
    const lt = encoded.linearThumbnail;
    for (const [type, value] of [["ispe", ispeBox(lt.width, lt.height)],
      ["pixi", lt.pixi], ["hvcC", lt.hvcc], ["colr", lt.colr]]) {
      let index;
      [meta, index] = appendIpcoProperty(meta, value);
      const current = parseIpcoIpma(meta, topBox(meta, "meta"));
      const kept = (current.associations.get(linear) || []).filter(a => {
        const name = current.properties[a.index - 1]?.type;
        return type === "colr" ? !["colr", "clli", "mdcv"].includes(name) : name !== type;
      });
      meta = setItemPropertyAssociations(meta, linear, [...kept.map(a => [a.index, a.essential]), [index, type === "hvcC"]]);
    }
  }

  for (const iid of hdrSlots)
    meta = replaceItemPropertyWithSource(meta, iid, "hvcC", encoded.hdrHvcc);
  // WebCodecs emits ordinary 3-plane video; point the gain-map grid at a 3x8 pixi.
  props = parseIpcoIpma(meta, topBox(meta, "meta"));
  const hdrGrid = Number(manifest.donor_hdr_grid_item);
  assignColor([hdrGrid, ...hdrSlots], encoded.hdrColr || rasterColr(rasterVideoColorSpace()));
  props = parseIpcoIpma(meta, topBox(meta, "meta"));
  const primary = Number(manifest.donor_primary_item);
  const hdrPixi = propertyForItem(props, hdrGrid, "pixi");
  const rgbPixi = propertyForItem(props, primary, "pixi");
  if (hdrPixi && rgbPixi && hdrPixi.index !== rgbPixi.index)
    meta = repointItemProperty(meta, hdrGrid, hdrPixi.index, rgbPixi.index);

  // RGB ISO gain maps need two semantic planes. The donor HDR grid becomes
  // the ISO tmap input; a separate Apple auxiliary is appended below.
  if(encoded.hdrMetadata&&encoded.appleHdrChunks){
    const current=parseIpcoIpma(meta,topBox(meta,'meta'));
    const kept=(current.associations.get(hdrGrid)||[])
      .filter(a=>current.properties[a.index-1]?.type!=='auxC')
      .map(a=>[a.index,a.essential]);
    meta=setItemPropertyAssociations(meta,hdrGrid,kept);
    meta=setItemReference(meta,'auxl',hdrGrid,[]);
  }

  const stylesId = Number(manifest.donor_styles_item);
  let styles = payloads.get(stylesId);
  if (sortedLuma) [styles] = applySceneStatistics(styles, "target", sortedLuma);
  if (encoded.lightMaps) [styles] = applyLightMaps(styles, ...encoded.lightMaps);
  if (faceResult?.state === "generated") {
    [styles] = setPersonMasksValid(styles);
    [styles] = applyPersonMetadata(styles, faceResult.personMetadata);
  }
  if (encoded.texture !== false) [styles] = upgradeStylesV16(styles);
  payloads.set(stylesId, styles);

  if(encoded.hdrMetadata){
    if(!encoded.hdrChunks||!encoded.hdrXmp||!encoded.hdrAlternateColr)throw Error('HDR metadata/resources incomplete');
    let ids;
    [meta,ids]=addItems(meta,[{key:'jpeg-hdr-tmap',itemType:'tmap',refType:'dimg',refTo:[primary,hdrGrid],
      boxes:[ispeBox(geometry.storedWidth,geometry.storedHeight),encoded.hdrAlternateColr,
        box('pixi',new Uint8Array([0,0,0,0,3,16,16,16]))]},
      {key:'jpeg-hdr-xmp',itemType:'mime',contentType:'application/rdf+xml',refType:'cdsc',refTo:[hdrGrid]}]);
    const tmap=ids.get('jpeg-hdr-tmap');
    payloads.set(tmap,encodeTmapMetadata(encoded.hdrMetadata));
    payloads.set(ids.get('jpeg-hdr-xmp'),encoded.hdrXmp);
    ftyp=withCompatibleBrand(ftyp,'tmap');
    // Preferred HDR alternative, with the SDR primary as the compatible fallback.
    const altr=box('altr',concat([new Uint8Array(4),be(1,4),be(2,4),be(tmap,4),be(primary,4)]));
    const m=topBox(meta,'meta');
    meta=box('meta',concat([meta.subarray(m.off+m.hdr,m.off+m.hdr+4),
      ...metaChildren(meta,m).map(b=>meta.subarray(b.off,b.off+b.size)),box('grpl',altr)]));
    // Photos can choose the HDR alternative. Its Styles/Exif/thumbnail and
    // auxiliaries must describe that rendition as well as the SDR primary.
    for(const ref of discoverHeic(meta).refs)
      if(['auxl','cdsc','thmb'].includes(ref.type)&&ref.to.includes(primary)&&!ref.to.includes(tmap))
        meta=setItemReference(meta,ref.type,ref.from,[...ref.to,tmap]);

    if(encoded.appleHdrChunks){
      if(encoded.appleHdrChunks.length!==hdrSlots.length||!encoded.appleHdrHvcc
        ||!Number.isFinite(encoded.appleHdrHeadroom)||encoded.appleHdrHeadroom<=1)
        throw Error('Apple HDR auxiliary is incomplete');
      const appleColr=encoded.appleHdrColr||nclx(2,2,6,true);
      const applePixi=box('pixi',new Uint8Array([0,0,0,0,3,8,8,8]));
      let tileIds;
      [meta,tileIds]=addItems(meta,encoded.appleHdrChunks.map((_,i)=>({
        key:`jpeg-apple-hdr-tile-${i}`,itemType:'hvc1',
        boxes:[ispeBox(TILE,TILE),applePixi,appleColr,encoded.appleHdrHvcc],
      })));
      const appleTiles=encoded.appleHdrChunks.map((_,i)=>tileIds.get(`jpeg-apple-hdr-tile-${i}`));
      let gridIds;
      [meta,gridIds]=addItems(meta,[{key:'jpeg-apple-hdr-grid',itemType:'grid',uri:URI_HDR_GAIN,
        refType:'auxl',refTo:[primary],boxes:[ispeBox(geometry.hdrWidth,geometry.hdrHeight),applePixi,appleColr]}]);
      const appleGrid=gridIds.get('jpeg-apple-hdr-grid');
      meta=setItemReference(meta,'dimg',appleGrid,appleTiles);
      payloads.set(appleGrid,gridPayload(geometry.hdrWidth,geometry.hdrHeight,geometry.hdrColumns,geometry.hdrRows));
      appleTiles.forEach((id,i)=>payloads.set(id,encoded.appleHdrChunks[i]));
      let sideIds;
      [meta,sideIds]=addItems(meta,[{key:'jpeg-apple-hdr-xmp',itemType:'mime',
        contentType:'application/rdf+xml',refType:'cdsc',refTo:[appleGrid]}]);
      payloads.set(sideIds.get('jpeg-apple-hdr-xmp'),bytes(
        `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>${encoded.appleHdrHeadroom.toFixed(9)}</HDRGainMap:HDRGainMapHeadroom></rdf:Description></rdf:RDF></x:xmpmeta>`));
    }
  }

  // A compatibility re-encode rebuilds the main/HDR graph, but Portrait depth is an
  // independent HEVC auxiliary. Keep its original bitstream, codec properties,
  // orientation, auxiliary relationship, and blur-parameter XMP sidecar intact.
  [meta] = appendPortraitDepth(meta, payloads, encoded.sourceDepth, primary);

  if (encoded.texture !== false) {
    let texturePayloads;
    [meta, texturePayloads] = addTextureItems(meta, primary, {
    matteOverrides: new Map([...(faceResult?.overrides || []), ...(encoded.sourceSkin || []), ...(encoded.sourceDngMattes || [])]),
    texturePeopleData: faceResult?.texturePeopleData,
  });
    for (const [iid, payload] of texturePayloads) payloads.set(iid, payload);
  }
  const portraitResult=installPortraitMatte(meta,payloads,null,null,encoded.sourceDngMattes?.get(MATTE_URIS.portraiteffectsmatte)
    ||faceResult?.overrides?.get(MATTE_URIS.portraiteffectsmatte),primary);
  meta=portraitResult.meta;
  meta=compactItemProperties(meta).meta;

  const iloc = parseIloc(meta, topBox(meta, "meta"));
  const ids = [...iloc.items].filter(([, item]) => item.constructionMethod === 0 && item.extents.length)
    .map(([iid]) => iid).sort((a, b) => a - b);
  const missing = ids.filter((iid) => !payloads.has(iid));
  if (missing.length) throw new Error(`Profile is missing payload(s): ${missing}`);
  let cursor = ftyp.length + meta.length + 8;
  const metaOut = meta.slice(), chunks = [];
  const outIloc = parseIloc(metaOut, topBox(metaOut, "meta"));
  for (const iid of ids) {
    const payload = payloads.get(iid);
    const extent = outIloc.items.get(iid).extents[0];
    metaOut.set(be(cursor, outIloc.offsetSize), extent.offsetPos);
    metaOut.set(be(payload.length, outIloc.lengthSize), extent.lengthPos);
    chunks.push(payload); cursor += payload.length;
  }
  if (cursor >= 2 ** 32) throw new Error("file too large for 32-bit offsets");
  const mdat = concat(chunks);
  const result = concat([ftyp, metaOut, box("mdat", mdat)]);
  const check = discoverHeic(result);
  for (const iid of ids)
    if (!same(extractItem(result, check.iloc, iid), payloads.get(iid)))
      throw new Error(`self-check failed: raster item ${iid} unreadable`);
  return result;
}


export function applyRasterStyleRecommendation(profile,value){
  if(value===undefined||value===null)return {profile,recommendation:null,error:null};
  try{
    const recommendation=validateStyleRecommendation(value);
    return {profile:{...profile,mn54:buildStyleMarker(recommendation,profile.mn54)},recommendation,error:null};
  }catch(error){
    console.warn('Invalid Suggested Styles recommendation; retaining Standard',error);
    return {profile,recommendation:null,error:`Invalid recommendation: ${String(error?.message||error)}`};
  }
}

function renderStyleDisplayCanvas(ctx,width,height,recommendation){
  if(!recommendation||!shouldRenderStyleDisplay(recommendation))return false;
  const pixels=ctx.getImageData(0,0,width,height),styled=applyStyleDisplayRgba(pixels.data,recommendation);
  pixels.data.set(styled);ctx.putImageData(pixels,0,0);return true;
}

function styleAnalysisImage(source,maxSide=640){
  const scale=Math.min(1,maxSide/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true,colorSpace:'srgb'});
  if(!ctx)throw Error('Suggested Styles analysis canvas unavailable');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,width,height);
  const rgba=new Uint8ClampedArray(ctx.getImageData(0,0,width,height).data);
  canvas.width=canvas.height=0;
  return {data:rgba,width,height};
}
async function suggestStyleForImage(image,request,onProgress){
  if(!request)return {recommendation:null,error:null};
  try{
    const {recommendStyleRgb}=await import('../recommend/style-runtime.js');
    const sample=styleAnalysisImage(image);
    const recommendation=await recommendStyleRgb(sample,{...request,
      onProgress:progress=>onProgress?.({...progress,styleStage:progress.stage,stage:'styleSuggestion'})});
    return {recommendation,error:null};
  }catch(error){
    console.warn('Suggested Styles unavailable; retaining Standard',error);
    return {recommendation:null,error:String(error?.message||error)};
  }
}

/** Browser-decoded still image -> new HEIC. No source HEIC graph is re-encoded here. */
export async function importRaster(file, profile, onProgress = () => {},
  {analyze = true, detail = null, styleRecommendation = null, styleSuggestion = null} = {}) {
  // Independent Main10 auxiliary/masks always require the verified WASM encoder.
  let opened, stored, enhanced;
  let detailSkipped = null;
  try {
    const sourceBytes=new Uint8Array(await file.arrayBuffer());
    const sourceHdr=extractJpegHdr(sourceBytes);
    if(sourceHdr)return await importHdrJpeg(sourceHdr,sourceBytes,onProgress,{analyze,detail,styleRecommendation,styleSuggestion});
    const sourceExif = extractRasterExif(sourceBytes);
    opened = await openBrowserImage(file, onProgress);
    let image = opened.image;
    if (!image.width || !image.height) throw Error('Raster image decode failed: empty image');
    if(detail){
      try{
        const {enhanceRasterImage}=await import('../detail/detail-raster.js');
        enhanced=await enhanceRasterImage(image,{...detail,onProgress});
        image=enhanced;
      }catch(error){
        detailSkipped=String(error?.message||error);
        console.warn('AI detail unavailable, preserving unchanged raster input',error);
      }
    }
    const suggested=styleRecommendation!==undefined&&styleRecommendation!==null
      ?{recommendation:styleRecommendation,error:null}
      :await suggestStyleForImage(image,styleSuggestion,onProgress);
    await ensureHevcEncoder(onProgress);
    const geometry = targetGeometry(image);
    onProgress({stage: 'prepare', ...geometry});
    const assets = await generateSyntheticHevc(onProgress);
    // Construct neutral maps and scene metadata rather than borrowing another photo.
    profile = buildGeneratedProfile('48-12', assets);
    const styled=applyRasterStyleRecommendation(profile,suggested.recommendation);
    profile=styled.profile;
    const linearThumbnail = await encodeLinearThumbnail(image, {angle: 270}, onProgress);
    stored = storedCanvas(image, geometry);
    const styleDisplayRendered=Boolean(styled.recommendation&&shouldRenderStyleDisplay(styled.recommendation));
    const main = await encodeCanvases(TILE, TILE, geometry.primaryTiles, (ctx, i) => {
      ctx.fillStyle = 'black'; ctx.fillRect(0, 0, TILE, TILE);
      ctx.drawImage(stored, -(i % geometry.primaryColumns) * TILE,
        -Math.floor(i / geometry.primaryColumns) * TILE);
      if(styleDisplayRendered)renderStyleDisplayCanvas(ctx,TILE,TILE,styled.recommendation);
    }, 3_000_000, (done, total) => onProgress({stage: 'main', done, total}), onProgress);
    onProgress({stage: 'auxiliary'});
    const thumb = await encodeCanvases(geometry.thumbWidth, geometry.thumbHeight, 1,
      ctx => {ctx.drawImage(stored, 0, 0, geometry.thumbWidth, geometry.thumbHeight);
        if(styleDisplayRendered)renderStyleDisplayCanvas(ctx,geometry.thumbWidth,geometry.thumbHeight,styled.recommendation);},
      800_000, undefined, onProgress);
    // A neutral auxiliary is compatibility data, not recovered HDR from an SDR input.
    const hdr = await encodeCanvases(TILE, TILE, 1, ctx => {
      ctx.fillStyle = 'black'; ctx.fillRect(0, 0, TILE, TILE);
    }, 200_000, undefined, onProgress);
    onProgress({stage: 'assemble'});
    const data = buildRasterHeic(profile, {
      main: main.chunks, mainHvcc: main.hvcc, mainColr: main.colr,
      thumb: thumb.chunks[0], thumbHvcc: thumb.hvcc, thumbColr: thumb.colr,
      hdr: hdr.chunks[0], hdrHvcc: hdr.hvcc, hdrColr: hdr.colr,
      sourceExif, linearThumbnail, texture: true,
      // Like the HEIC route, spatial maps follow the primary's stored orientation.
      lightMaps: analyze ? buildLightMaps(sampleRasterLuma(stored, 32, 32)) : null,
    }, analyze ? Array.from(sampleRasterLuma(image)).sort((a, b) => a - b) : null, null, geometry);
    return {data, geometry, detailApplied:Boolean(enhanced), detailSkipped,styleDisplayRendered,
      ...(styled.recommendation?{styleRecommendation:styled.recommendation}:{}),
      ...((suggested.error||styled.error)?{styleSuggestionError:suggested.error||styled.error}:{})};
  } finally {
    opened?.close();
    if (stored) stored.width = stored.height = 0;
    if (enhanced) enhanced.width = enhanced.height = 0;
    releaseHevcEncoder();
  }
}


function readManagedRgba(image,width,height,colorSpace){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true,colorSpace});
  if(!ctx)throw Error('HDR detail colour-managed canvas unavailable');
  const actual=ctx.getContextAttributes?.().colorSpace;
  if(actual&&actual!==colorSpace)throw Error(`HDR detail canvas lost ${colorSpace} colour space`);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,width,height);
  const data=ctx.getImageData(0,0,width,height,{colorSpace});
  if(data.colorSpace&&data.colorSpace!==colorSpace)throw Error('HDR detail readback changed colour space');
  const rgba=new Uint8ClampedArray(data.data);
  canvas.width=canvas.height=0;
  return rgba;
}

function rgbSamplesToRgba(samples){
  if(!(samples instanceof Uint8Array)||samples.length%3)throw Error('Invalid Apple RGB gain samples');
  const out=new Uint8ClampedArray(samples.length/3*4);
  for(let i=0,p=0;i<samples.length;i+=3,p+=4){
    out[p]=samples[i];out[p+1]=samples[i+1];out[p+2]=samples[i+2];out[p+3]=255;
  }
  return out;
}

async function encodeHdrCanvasTiles(image,geometry,color,colorSpace,onProgress,styleRecommendation=null){
  const chunks=[];let hvcc;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true,colorSpace});
  if(!ctx)throw Error('HDR AI tile canvas unavailable');
  const actual=ctx.getContextAttributes?.().colorSpace;
  if(actual&&actual!==colorSpace)throw Error(`HDR AI tile canvas lost ${colorSpace} colour space`);
  try{
    for(let i=0;i<geometry.primaryTiles;i++){
      ctx.fillStyle='black';ctx.fillRect(0,0,TILE,TILE);
      ctx.drawImage(image,-(i%geometry.primaryColumns)*TILE,-Math.floor(i/geometry.primaryColumns)*TILE);
      if(styleRecommendation)renderStyleDisplayCanvas(ctx,TILE,TILE,styleRecommendation);
      const pixels=ctx.getImageData(0,0,TILE,TILE,{colorSpace});
      const yuv=rgbaToI420(pixels.data,TILE,TILE,color);
      const encoded=await encodeHevcPixels(yuv,{width:TILE,height:TILE,pixelFormat:'yuv420p',...color},onProgress);
      if(hvcc&&!same(hvcc,encoded.hvcc))throw Error('HDR AI primary tile configurations disagree');
      hvcc=encoded.hvcc;chunks.push(encoded.payload);
      onProgress?.({stage:'main',done:i+1,total:geometry.primaryTiles});
    }
  }finally{canvas.width=canvas.height=0;}
  return {chunks,hvcc};
}

async function encodeYuvGrid(yuv,width,height,columns,rows,color,stage,onProgress){
  const chunks=[];let hvcc;
  for(let i=0;i<columns*rows;i++){
    const tile=yuv420Tile(yuv,width,height,i%columns,Math.floor(i/columns));
    const encoded=await encodeHevcPixels(tile,{width:TILE,height:TILE,pixelFormat:'yuv420p',...color},onProgress);
    if(hvcc&&!same(hvcc,encoded.hvcc))throw Error(`${stage} tile configurations disagree`);
    hvcc=encoded.hvcc;chunks.push(encoded.payload);onProgress?.({stage,done:i+1,total:columns*rows});
  }
  return {chunks,hvcc};
}

async function importHdrJpeg(hdr,sourceBytes,onProgress,{analyze,detail=null,styleRecommendation=null,styleSuggestion=null}) {
  let opened,enhanced;
  try {
    const sourceExif=extractRasterExif(sourceBytes),orientation=readExifOrientation(sourceExif??new Uint8Array())||1;
    const swap=orientation>=5,width=swap?hdr.height:hdr.width,height=swap?hdr.width:hdr.height;
    const gainWidth=swap?hdr.gainHeight:hdr.gainWidth,gainHeight=swap?hdr.gainWidth:hdr.gainHeight;
    const geometry={...targetGeometry({width:height,height:width}),
      displayWidth:width,displayHeight:height,sourceWidth:width,sourceHeight:height,storedWidth:width,storedHeight:height,
      hdrWidth:gainWidth,hdrHeight:gainHeight,hdrColumns:Math.ceil(gainWidth/TILE),hdrRows:Math.ceil(gainHeight/TILE),
      exifOrientation:1,resized:false};
    geometry.primaryColumns=Math.ceil(width/TILE);geometry.primaryRows=Math.ceil(height/TILE);
    geometry.primaryTiles=geometry.primaryColumns*geometry.primaryRows;
    if(geometry.primaryTiles>48||geometry.hdrColumns*geometry.hdrRows>12)throw hdrJpegError('HDR JPEG exceeds the preserved-image tile budget');
    await ensureHevcEncoder(onProgress);
    const assets=await generateSyntheticHevc(onProgress);
    let profile=buildGeneratedProfile('48-12',assets);
    // The dedicated JPEG route encodes normalized upright planes, not the SDR
    // canvas route's 270-degree stored image. All template items share this irot.
    const pd=discoverHeic(profile.meta);
    for(const property of pd.props.properties)if(property.type==='irot')profile.meta[property.box.off+property.box.hdr]=0;
    const color={primaries:hdr.primaries,transfer:'iec61966-2-1',matrix:'smpte170m',fullRange:true};
    const colorSpace=hdr.primaries==='smpte432'?'display-p3':'srgb';
    opened=await openHdrBaseImage(hdr,orientation,colorSpace,onProgress);
    let working=opened.image,detailSkipped=null,rebase=null,decodedGain=null;
    if(detail){
      try{
        const {enhanceRasterImage}=await import('../detail/detail-raster.js');
        enhanced=await enhanceRasterImage(opened.image,{...detail,onProgress,colorSpace});
        const originalBase=readManagedRgba(opened.image,gainWidth,gainHeight,colorSpace);
        const restoredBase=readManagedRgba(enhanced,gainWidth,gainHeight,colorSpace);
        decodedGain=await decodeJpegYuv(hdr.gain,{width:hdr.gainWidth,height:hdr.gainHeight,orientation},onProgress);
        if(decodedGain.width!==gainWidth||decodedGain.height!==gainHeight)throw Error('HDR gain-map orientation mismatch');
        rebase=rebaseGainMapRgba(originalBase,restoredBase,
          yuv420ToRgba(decodedGain.bytes,gainWidth,gainHeight),hdr.metadata);
        const clippedRatio=rebase.components?rebase.clipped/rebase.components:0;
        if(clippedRatio>.02)throw Error(`AI HDR gain-map range exceeded at ${(100*clippedRatio).toFixed(2)}% of components`);
        working=enhanced;
        onProgress?.({stage:'hdrDetail',clipped:rebase.clipped,components:rebase.components,maxError:rebase.maxError});
      }catch(error){
        detailSkipped=String(error?.message||error);
        console.warn('HDR AI detail unavailable; preserving the original HDR pair',error);
        if(enhanced)enhanced.width=enhanced.height=0;
        enhanced=null;rebase=null;working=opened.image;
      }
    }
    const suggested=styleRecommendation!==undefined&&styleRecommendation!==null
      ?{recommendation:styleRecommendation,error:null}
      :await suggestStyleForImage(working,styleSuggestion,onProgress);
    const styled=applyRasterStyleRecommendation(profile,suggested.recommendation);profile=styled.profile;
    const styleDisplayRendered=Boolean(styled.recommendation&&shouldRenderStyleDisplay(styled.recommendation));
    const linearThumbnail=await encodeLinearThumbnail(working,{angle:0},onProgress);
    const thumb=await encodeCanvases(geometry.thumbWidth,geometry.thumbHeight,1,
      ctx=>{ctx.drawImage(working,0,0,geometry.thumbWidth,geometry.thumbHeight);
        if(styleDisplayRendered)renderStyleDisplayCanvas(ctx,geometry.thumbWidth,geometry.thumbHeight,styled.recommendation);},
      800_000,undefined,onProgress);
    let main;
    if(enhanced||styleDisplayRendered)main=await encodeHdrCanvasTiles(working,geometry,color,colorSpace,onProgress,
      styleDisplayRendered?styled.recommendation:null);
    else{
      const decoded=await decodeJpegYuv(hdr.base,{width:hdr.width,height:hdr.height,orientation},onProgress);
      main=await encodeYuvGrid(decoded.bytes,decoded.width,decoded.height,
        geometry.primaryColumns,geometry.primaryRows,color,'main',onProgress);
    }
    let gain;
    if(rebase){
      const gainYuv=rgbaToI420(rebase.rgba,gainWidth,gainHeight,color);
      gain=await encodeYuvGrid(gainYuv,gainWidth,gainHeight,
        geometry.hdrColumns,geometry.hdrRows,color,'auxiliary',onProgress);
    }else{
      decodedGain??=await decodeJpegYuv(hdr.gain,{width:hdr.gainWidth,height:hdr.gainHeight,orientation},onProgress);
      gain=await encodeYuvGrid(decodedGain.bytes,decodedGain.width,decodedGain.height,
        geometry.hdrColumns,geometry.hdrRows,color,'auxiliary',onProgress);
    }
    let appleHdr=null;
    if(hdr.metadata.channels.length===3){
      decodedGain??=await decodeJpegYuv(hdr.gain,{width:hdr.gainWidth,height:hdr.gainHeight,orientation},onProgress);
      const gainRgba=rebase?.rgba??yuv420ToRgba(decodedGain.bytes,gainWidth,gainHeight);
      const baseRgba=readManagedRgba(working,gainWidth,gainHeight,colorSpace);
      const converted=rgbIsoToAppleGain(baseRgba,gainRgba,hdr.metadata);
      const appleColor={primaries:'unspecified',transfer:'unspecified',matrix:'smpte170m',fullRange:true};
      const appleYuv=rgbaToI420(rgbSamplesToRgba(converted.samples),gainWidth,gainHeight,appleColor);
      const encodedApple=await encodeYuvGrid(appleYuv,gainWidth,gainHeight,
        geometry.hdrColumns,geometry.hdrRows,appleColor,'appleHdr',onProgress);
      appleHdr={chunks:encodedApple.chunks,hvcc:encodedApple.hvcc,
        headroom:converted.headroom,colr:nclx(2,2,6,true)};
    }
    const data=buildRasterHeic(profile,{main:main.chunks,mainHvcc:main.hvcc,
      mainColr:hdr.baseIcc?iccColr(hdr.baseIcc):rasterColr(color),
      thumb:thumb.chunks[0],thumbHvcc:thumb.hvcc,thumbColr:thumb.colr,linearThumbnail,
      hdrChunks:gain.chunks,hdrHvcc:gain.hvcc,hdrColr:rasterColr(color),
      hdrMetadata:hdr.metadata,hdrXmp:hdr.xmp,hdrAlternateColr:hdrJpegAlternateColr(hdr),sourceExif,
      ...(appleHdr?{appleHdrChunks:appleHdr.chunks,appleHdrHvcc:appleHdr.hvcc,
        appleHdrHeadroom:appleHdr.headroom,appleHdrColr:appleHdr.colr}:{}),
      lightMaps:analyze?buildLightMaps(sampleRasterLuma(working,32,32)):null,
    },analyze?Array.from(sampleRasterLuma(working)).sort((a,b)=>a-b):null,null,geometry);
    // Photos does not preserve this RGB legacy auxiliary reliably after saving.
    // Rebase both SDR and scalar gain, as validated on the physical Indigo case.
    // This call is confined to freshly imported RGB HDR JPEGs, never Native HEIC.
    const editable=appleHdr?await makeRgbHdrEditable(data,{headroom:appleHdr.headroom,primaries:hdr.primaries},onProgress):null;
    const outputGeometry=editable?{...geometry,hdrWidth:width,hdrHeight:height,
      hdrColumns:geometry.primaryColumns,hdrRows:geometry.primaryRows}:geometry;
    const result={data:editable?.data??data,geometry:outputGeometry,hdr:true,detailApplied:Boolean(enhanced&&rebase),detailSkipped,styleDisplayRendered,
      ...(editable?{hdrScalarRebased:true,hdrRebase:editable.metrics}:{}),
      ...(styled.recommendation?{styleRecommendation:styled.recommendation}:{}),
      ...((suggested.error||styled.error)?{styleSuggestionError:suggested.error||styled.error}:{})};
    if(rebase)result.hdrDetail={clipped:rebase.clipped,components:rebase.components,maxError:rebase.maxError};
    if(enhanced)enhanced.width=enhanced.height=0;
    return result;
  }catch(error){if(!error.code)error.code='err.hdrjpeg';throw error;}
  finally{opened?.close();if(enhanced)enhanced.width=enhanced.height=0;}
}
