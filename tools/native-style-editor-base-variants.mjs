// Align the editable Styles auxiliaries with a baked Standard primary.
// Y regenerates the linear thumbnail from the same-capture Native Standard
// rendition. Z additionally neutralizes StyleDelta samples.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {box,topBox} from '../web/src/core/box.js';
import {
  appendIpcoProperty,
  dimensionsForItem,
  discoverHeic,
  extractItem,
  idatItemBytes,
  ispeBox,
  propertyBoxBytes,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {loadProfile,writeZip} from '../web/src/core/zip.js';

const [output,sourceFile,referenceFile]=process.argv.slice(2);
if(!output||!sourceFile||!referenceFile)
  throw Error('Usage: node tools/native-style-editor-base-variants.mjs <output-directory> <X.heic> <native-standard-current.heic>');

const [source,reference]=await Promise.all([sourceFile,referenceFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(source),b=discoverHeic(reference);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
for(const key of ['stylesItem','linearThumb','deltaGrid','hdrGrid'])assert.notEqual(a[key],null,key);
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary),'same geometry');
assert.deepEqual(
  extractAppleMakerNoteTag(read(source,a,a.exifItem),0x2b),
  extractAppleMakerNoteTag(read(reference,b,b.exifItem),0x2b),
  'same capture UUID',
);

await fs.mkdir(output,{recursive:true});
const [tw,th]=dimensionsForItem(a.props,a.linearThumb);
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{
  input,maxBuffer:128*1024*1024,
}));
const png=run(['-noautorotate','-i',referenceFile,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
const rgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${tw}:${th}:flags=lanczos`,
  '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
const mp4=path.join(output,'native-standard-linear-thumbnail.mp4');
run(['-y','-threads','1','-filter_threads','1','-f','rawvideo','-pix_fmt','rgb24','-s',`${tw}x${th}`,'-r','1','-i','pipe:0',
  '-frames:v','1','-an','-c:v','libx265','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p10le','-profile:v','main10',
  '-tag:v','hvc1','-x265-params','info=0:pools=none:frame-threads=1:log-level=error','-movflags','+faststart',mp4],rgb);
const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(mp4)));
await fs.rm(mp4);

let ymeta=source.slice(a.meta.off,a.meta.off+a.meta.size);
const linearBoxes={hvcC:encoded.hvcc,ispe:ispeBox(tw,th),pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
const linearRefs=[];
for(const ref of a.props.associations.get(a.linearThumb)||[]){
  const property=a.props.properties[ref.index-1],replacement=linearBoxes[property.type];
  if(replacement){
    let index;[ymeta,index]=appendIpcoProperty(ymeta,replacement);linearRefs.push([index,ref.essential]);
  }else linearRefs.push([ref.index,ref.essential]);
}
ymeta=setItemPropertyAssociations(ymeta,a.linearThumb,linearRefs);
const ftyp=source.slice(0,topBox(source,'ftyp').size);
const y=rebuildHeic(source,a,ftyp,ymeta,new Map([[a.linearThumb,encoded.payload]]));

const yd=discoverHeic(y);
const profile=await loadProfile(new Uint8Array(await fs.readFile(new URL('../web/profiles/48-12.zip',import.meta.url))));
const pd=discoverHeic(profile.meta),neutral=profile.retained.get(pd.deltaTiles[0]);
assert.ok(neutral);assert.ok(pd.deltaTiles.every(id=>Buffer.from(profile.retained.get(id)).equals(Buffer.from(neutral))));
const neutralHvcc=propertyBoxBytes(profile.meta,pd.props,pd.deltaTiles[0],'hvcC');
let zmeta=y.slice(yd.meta.off,yd.meta.off+yd.meta.size),neutralCodec;
[zmeta,neutralCodec]=appendIpcoProperty(zmeta,neutralHvcc);
const zvalues=new Map();
for(const id of yd.deltaTiles){
  assert.deepEqual(dimensionsForItem(yd.props,id),dimensionsForItem(pd.props,pd.deltaTiles[0]));
  zvalues.set(id,neutral);
  const refs=(yd.props.associations.get(id)||[]).map(ref=>[
    yd.props.properties[ref.index-1].type==='hvcC'?neutralCodec:ref.index,ref.essential,
  ]);
  zmeta=setItemPropertyAssociations(zmeta,id,refs);
}
const z=rebuildHeic(y,yd,y.slice(0,topBox(y,'ftyp').size),zmeta,zvalues);

const files=new Map(),report=[];
for(const [label,data,changed]of [
  ['Y_NativeRenditionLinear',y,new Set([a.linearThumb])],
  ['Z_NativeRenditionLinearNeutralDelta',z,new Set([a.linearThumb,...a.deltaTiles])],
]){
  const d=discoverHeic(data);
  assert.notEqual(d.stylesItem,null);assert.notEqual(d.linearThumb,null);assert.notEqual(d.deltaGrid,null);assert.notEqual(d.hdrGrid,null);
  for(const id of a.infos.keys()){
    if(changed.has(id))continue;
    assert.deepEqual(read(data,d,id),read(source,a,id),'unchanged payload '+id);
  }
  assert.deepEqual(d.refs,a.refs,'editing relationships');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
  assert.equal(checked.compatibility?.status,'known-compatible',JSON.stringify(checked.compatibility?.reasons));
  const name=`native-1_${label}.HEIC`;await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,styles:true,texture:true,hdr:true,
    nativeStandardPrimaryHdrExact:true,linearThumbnailFromNativeStandard:true,
    neutralDelta:label.startsWith('Z_'),compatibility:checked.compatibility.status,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-YZ.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
