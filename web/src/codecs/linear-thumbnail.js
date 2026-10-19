import { decodeToRgb } from '../media/decode.js';
import {
  discoverHeic,dimensionsForItem,irotAngleForItem,imirAxisForItem,ispeBox,
  extractItem,idatItemBytes,
} from '../core/heif.js';
import { box } from '../core/box.js';
import { encodeRgbThumbnail, releaseHevcEncoder } from './ffmpeg-hevc.js';
import {releaseHevcEncoder as releaseRasterHevc} from '../raster/ffmpeg-hevc.js';
import {decodeGridBilinearRgb,decodeGridBilinearLuma} from '../raster/heic-grid-sample.js';
import {parseTmapMetadata} from '../raster/jpeg-hdr.js';
import {synthesizeHdrLinearThumbnailRgb} from '../raster/hdr-linear-thumbnail.js';

function itemBytes(bytes,d,id){
  const item=d.iloc.items.get(id);
  if(!item)throw Error('HEIC linear-thumbnail source item missing');
  return item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
}
function linearGeometry(d){
  const [pw,ph]=dimensionsForItem(d.props,d.primary);
  return pw>=ph?[1024,768]:[768,1024];
}
function isoTmapForLinearThumbnail(bytes,d){
  if(d.hdrGrid===null||!d.hdrTiles?.length||!d.primaryTiles?.length)return null;
  for(const [id,info] of d.infos){
    if(info.type!=='tmap')continue;
    const inputs=d.refs.find(r=>r.type==='dimg'&&r.from===id)?.to;
    if(inputs?.length!==2||inputs[0]!==d.primary||inputs[1]!==d.hdrGrid)continue;
    const metadata=parseTmapMetadata(itemBytes(bytes,d,id));
    if(metadata.channels?.length!==1||!(metadata.baseHeadroom<metadata.alternateHeadroom))return null;
    return {id,metadata};
  }
  return null;
}
function resultFromEncoded(encoded,width,height){
  return {
    sample:encoded.payload,hvcC:encoded.hvcc,ispe:ispeBox(width,height),
    pixi:box('pixi',new Uint8Array([0,0,0,0,3,10,10,10])),
  };
}

/**
 * Source-only HDR-aware linear thumbnail for flattened Apple edited exports.
 *
 * The primary and ISO gain map are sampled directly from HEVC tiles in stored
 * orientation at thumbnail resolution. This avoids a full 24 MP canvas and,
 * crucially, preserves the HDR highlight residual that an SDR-only thumbnail
 * loses. The returned transport matches native linear thumbnails: Main10,
 * full-range, VUI 2/2/2.
 */
export async function generateHdrAwareLinearThumbnail(bytes,onProgress){
  const d=discoverHeic(bytes),tmap=isoTmapForLinearThumbnail(bytes,d);
  if(!tmap)throw Error('No supported ISO HDR graph for linear-thumbnail reconstruction');
  const [width,height]=linearGeometry(d);
  try{
    onProgress?.({stage:'linearPrimaryDecode'});
    const primary=await decodeGridBilinearRgb(bytes,d,d.primary,d.primaryTiles,width,height,onProgress,'linearPrimaryDecode');
    onProgress?.({stage:'linearGainDecode'});
    const gain=await decodeGridBilinearLuma(bytes,d,d.hdrGrid,d.hdrTiles,width,height,onProgress,'linearGainDecode');
    if(primary.width!==gain.width||primary.height!==gain.height)
      throw Error('HDR linear-thumbnail source geometry disagrees');
    const rgb=synthesizeHdrLinearThumbnailRgb(primary.bytes,gain.bytes,tmap.metadata,{transfer:primary.color.transfer});
    // Release the decode worker before x265 starts; Safari is sensitive to two
    // simultaneous FFmpeg WASM heaps even at thumbnail resolution.
    releaseRasterHevc();
    const encoded=await encodeRgbThumbnail(rgb,width,height,onProgress);
    return resultFromEncoded(encoded,width,height);
  }finally{
    releaseRasterHevc();
    releaseHevcEncoder();
  }
}

// The CLI photo-graph path needs only a linear-thumbnail auxiliary item, not a
// newly inserted ordinary thumbnail. Keep the existing primary/auxiliary graph.
export async function generateLinearThumbnail(bytes,onProgress){
  const d=discoverHeic(bytes),tmap=isoTmapForLinearThumbnail(bytes,d);
  // A supported HDR graph must not silently fall back to an SDR-only thumbnail:
  // that truncates the native specular tail and makes Photos' editable HDR weak.
  if(tmap)return generateHdrAwareLinearThumbnail(bytes,onProgress);

  const [width,height]=linearGeometry(d);
  onProgress?.({stage:'decode'});
  const rgb=await decodeToRgb(bytes,{width,height,
    angle:irotAngleForItem(bytes,d.props,d.primary),
    mirror:imirAxisForItem(bytes,d.props,d.primary)});
  try{
    const encoded=await encodeRgbThumbnail(rgb,width,height,onProgress);
    return resultFromEncoded(encoded,width,height);
  }finally{
    // Safari has a limited memory budget; keep downloaded assets cached, not WASM heaps.
    releaseHevcEncoder();
  }
}
