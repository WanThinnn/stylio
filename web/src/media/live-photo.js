// Pair existing Live Photo resources. Never rewrite or re-encode the movie.
import {discoverHeic, extractItem} from '../core/heif.js';
import {extractAppleMakerNoteTag} from '../core/exif.js';
import {writeZip} from '../core/zip.js';

const decode = bytes => new TextDecoder().decode(bytes).replace(/\0+$/, '').trim();
export function livePhotoIdentifierFromExif(exif) {
  try {
    const value = decode(extractAppleMakerNoteTag(exif, 0x11).payload);
    return /^[\w-]{8,128}$/.test(value) ? value : null;
  } catch { return null; }
}

export function photoContentIdentifier(bytes) {
  try {
    const d = discoverHeic(bytes);
    if (d.exifItem === null) return null;
    return livePhotoIdentifierFromExif(extractItem(bytes,d.iloc,d.exifItem));
  } catch { return null; }
}
function boxes(bytes,start=0,end=bytes.length) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), out=[];
  for(let p=start;p<end;) {
    if(p+8>end)throw Error('Truncated MOV box');
    let size=view.getUint32(p),header=8;
    if(size===1){if(p+16>end)throw Error('Truncated MOV extended size');size=Number(view.getBigUint64(p+8));header=16;}
    if(size===0)size=end-p;
    if(!Number.isSafeInteger(size)||size<header||p+size>end)throw Error('Invalid MOV box size');
    out.push({type:decode(bytes.subarray(p+4,p+8)),start:p+header,end:p+size});p+=size;
  }
  return out;
}
export function movieStyleTracks(bytes) {
  const moov=boxes(bytes).find(box=>box.type==='moov');
  if(!moov)throw Error('MOV has no movie metadata');
  const tracks=boxes(bytes,moov.start,moov.end)
    .filter(box=>box.type==='trak').map(box=>decode(bytes.subarray(box.start,box.end)));
  const has=tag=>tracks.some(track=>track.includes(`com.apple.quicktime.${tag}`));
  return {
    styles:['video-map.smart-style-linear-thumbnail','video-map.sky','video-map.person','video-map.skin','smartstyle-info'].every(has),
    texture:has('texturestyle-info'),
  };
}
export function moviePairingMetadata(bytes) {
  const moov=boxes(bytes).find(b=>b.type==='moov');
  if(!moov)throw Error('MOV has no movie metadata');
  let contentIdentifier=null,hasStillImageTimeKey=false;
  const visit=(start,end,depth=0)=>{
    if(depth>12)throw Error('MOV metadata nesting is too deep');
    const children=boxes(bytes,start,end);
    for(const b of children) {
      if(b.type==='trak'&&decode(bytes.subarray(b.start,b.end)).includes('com.apple.quicktime.still-image-time'))hasStillImageTimeKey=true;
      if(['moov','udta'].includes(b.type))visit(b.start,b.end,depth+1);
      if(b.type==='meta') {
        // ISO FullBox metadata has a four-byte version/flags prefix.
        const prefix=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(b.start);
        const meta=boxes(bytes,b.start+(prefix===0?4:0),b.end),keys=meta.find(x=>x.type==='keys'),ilst=meta.find(x=>x.type==='ilst');
        if(!keys||!ilst)continue;
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        if(keys.start+8>keys.end)throw Error('Truncated MOV keys');
        const count=view.getUint32(keys.start+4),names=[];let p=keys.start+8;
        for(let i=0;i<count;i++) {
          if(p+8>keys.end)throw Error('Truncated MOV key');const size=view.getUint32(p);
          if(size<8||p+size>keys.end)throw Error('Invalid MOV key');
          names.push(decode(bytes.subarray(p+8,p+size)));p+=size;
        }
        for(const entry of boxes(bytes,ilst.start,ilst.end)) {
          const index=view.getUint32(entry.start-4);
          if(names[index-1]!=='com.apple.quicktime.content.identifier')continue;
          const data=boxes(bytes,entry.start,entry.end).find(x=>x.type==='data');
          if(data&&data.start+8<=data.end)contentIdentifier=decode(bytes.subarray(data.start+8,data.end));
        }
      }
    }
  };
  visit(moov.start,moov.end);
  return {contentIdentifier,hasStillImageTimeKey};
}
export function validateLivePair(photo,movie) {
  const identifier=photoContentIdentifier(photo),metadata=moviePairingMetadata(movie);
  if(!identifier)throw Error('The HEIC has no readable Live Photo content identifier. Export the unmodified original.');
  if(!metadata.contentIdentifier||identifier!==metadata.contentIdentifier)throw Error('HEIC and MOV content identifiers do not match.');
  if(!metadata.hasStillImageTimeKey)throw Error('MOV has no Live Photo still-image-time metadata key.');
  return {identifier,...metadata};
}
export function livePhotoPackage(source,output,movie,name='LivePhoto') {
  const verified=validateLivePair(source,movie);
  if(photoContentIdentifier(output)!==verified.identifier)throw Error('Processing changed the Live Photo content identifier; pair export stopped.');
  const stem=name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_')||'LivePhoto';
  const manifest={version:1,contentIdentifier:verified.identifier,photo:`${stem}.HEIC`,movie:`${stem}.MOV`,
    movieUnmodified:true,stillImageOnlyEdited:true,
    importNote:'Import both resources with a Live Photo-aware importer. Browser Save to Photos does not create a paired Photos asset. Movie frames do not receive the still image Styles.'};
  return writeZip(new Map([[manifest.photo,output],[manifest.movie,movie],['pair.json',new TextEncoder().encode(JSON.stringify(manifest,null,2))]]));
}

// Follow the same File as the still download. A delayed read must never publish
// an older focus setting, toggle state, or a result whose history row was removed.
export function createLivePhotoExport(source,{onReady,onError}) {
  let file=null,movie=null,revision=0,disposed=false;
  async function refresh() {
    const current=++revision,chosen=file,paired=movie;
    if(disposed||!chosen||!paired)return;
    const isCurrent=()=>!disposed&&revision===current;
    try {
      const output=new Uint8Array(await chosen.arrayBuffer());
      if(!isCurrent())return;
      const data=livePhotoPackage(source,output,paired,chosen.name);
      onReady({data,name:chosen.name.replace(/\.[^.]+$/,'')+'_LivePhoto.zip',file:chosen});
    } catch(error) { if(isCurrent())onError(error); }
  }
  return {
    setOutput(value){if(disposed)return;file=value;return refresh();},
    setMovie(value){if(disposed||movie===value)return;movie=value;return refresh();},
    dispose(){disposed=true;revision++;source=file=movie=null;},
  };
}
