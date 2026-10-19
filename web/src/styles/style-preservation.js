import {discoverHeic, extractItem,auxUriForItem,DEPTH_URI} from '../core/heif.js';
import {exifCameraModel,extractAppleMakerNoteTag} from '../core/exif.js';
import {parseBplist} from '../core/bplist.js';

function nativeStyleSelection(exif) {
  try {
    const tag=extractAppleMakerNoteTag(exif,0x54);
    if(![1,7].includes(tag.type))return false;
    const marker=parseBplist(tag.payload);
    return marker instanceof Map&&marker.get('0')===1
      &&Number.isInteger(marker.get('4'))&&marker.get('4')>=1
      &&['1','2'].every(key=>Number.isFinite(marker.get(key)));
  } catch { return false; }
}

export function nativeTextureCapture(data, discovery = discoverHeic(data)) {
  if (discovery.exifItem === null) return false;
  const exif=extractItem(data,discovery.iloc,discovery.exifItem);
  const model=exifCameraModel(exif);
  const generation=/^iPhone (\d+)(?:\s|$)/.exec(model||'');
  if(!generation||Number(generation[1])<18)return false;
  try {
    const tag=extractAppleMakerNoteTag(exif,0x65);
    return tag.type===7&&tag.payload.length>0;
  } catch { return false; }
}

export function preserveNativeStyles(data, discovery = discoverHeic(data)) {
  if(discovery.stylesItem!==null)return true;
  if (discovery.exifItem === null) return false;
  const exif=extractItem(data, discovery.iloc, discovery.exifItem);
  const model = exifCameraModel(exif);
  const generation = /^iPhone (\d+)(?:\s|$)/.exec(model || '');
  return Boolean(generation&&Number(generation[1])>=16&&nativeStyleSelection(exif));
}

/** Recognize the six-key iPhone 16/17 export seen after changing a captured Style.
 * This identifies a file shape, not edit history or guaranteed Photos controls.
 * Opaque native markers and Portrait exports remain on their existing routes.
 */
export function nativeStyleExportTextureCandidate(data, d = discoverHeic(data)) {
  if(d.stylesItem!==null||d.linearThumb!==null||d.deltaGrid!==null||d.hdrGrid===null||d.exifItem===null)return false;
  if([...d.infos.keys()].some(id=>auxUriForItem(d.props,id)===DEPTH_URI))return false;
  const exif=extractItem(data,d.iloc,d.exifItem);
  if(!/^iPhone (16|17)(?:\s|$)/.test(exifCameraModel(exif)||''))return false;
  try{
    const tag=extractAppleMakerNoteTag(exif,0x54),marker=parseBplist(tag.payload);
    return [1,7].includes(tag.type)&&marker instanceof Map
      &&[...marker.keys()].sort().join(',')==='0,1,2,3,4,5'
      &&marker.get('0')===1&&marker.get('5')===0
      &&Number.isInteger(marker.get('4'))&&marker.get('4')>=1&&marker.get('4')<=16
      &&['1','2'].every(key=>Number.isFinite(marker.get(key))&&Math.abs(marker.get(key))<=1)
      &&Number.isFinite(marker.get('3'))&&marker.get('3')>=0&&marker.get('3')<=1
      &&[...d.infos].some(([id,info])=>info.type==='tmap'
        &&d.refs.some(ref=>ref.type==='dimg'&&ref.from===id&&ref.to.length===2&&ref.to[0]===d.primary&&ref.to[1]===d.hdrGrid));
  }catch{return false;}
}

/** Processing-route guard: complete native graphs and ordinary native-style files may
 * use Texture-only. A proven flattened Current export and native Portrait rebuild must
 * continue into graph reconstruction instead of being swallowed by the native fast path.
 */
export function useTextureOnlyNativeStylePath({textureOnly,rebuildNativePortrait,editedStyleExportCandidate,stylesItem}) {
  return Boolean((textureOnly&&!rebuildNativePortrait&&!editedStyleExportCandidate)||stylesItem!==null);
}

/** Missing native Styles with an actual native selection: identifies missing data,
 * not whether or how the user edited the photo.
 */
export function styleReconstructionRisk(data, discovery = discoverHeic(data)) {
  if (discovery.stylesItem !== null || !preserveNativeStyles(data,discovery)) return null;
  const model = exifCameraModel(extractItem(data, discovery.iloc, discovery.exifItem));
  return {cameraModel: model, nativeStylesMissing: true, hdrGainMapMissing: discovery.hdrGrid === null};
}
