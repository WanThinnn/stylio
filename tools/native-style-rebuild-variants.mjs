import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,ispeBox,idatItemBytes} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag,listExifMetadataEntries,listAppleMakerNoteTags} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';
import {loadProfile,writeZip} from '../web/src/core/zip.js';
import {addTexture,hasTexture} from '../web/src/styles/texture.js';
import {patch} from '../web/src/styles/port.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {buildStyleMarker} from '../web/src/recommend/style-selection.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {topBox,box} from '../web/src/core/box.js';
import assert from 'node:assert/strict';

const [output,...inputs]=process.argv.slice(2);
if(!output||!inputs.length)throw Error('Usage: node tools/native-style-rebuild-variants.mjs <output-directory> <source.heic> [...]');
await fs.mkdir(output,{recursive:true});
const profile=await loadProfile(new Uint8Array(await fs.readFile(new URL('../web/profiles/48-12.zip',import.meta.url))));
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:64*1024*1024}));
const files=new Map(),report=[];
function setMarker(data,payload){
 const d=discoverHeic(data),ft=topBox(data,'ftyp');
 return rebuildHeic(data,d,data.slice(0,ft.size),data.slice(d.meta.off,d.meta.off+d.meta.size),
   new Map([[d.exifItem,injectAppleMakerNoteTag(extractItem(data,d.iloc,d.exifItem),payload,0x54,7)]]));
}
function validateSource(source,data){
 const a=discoverHeic(source),b=discoverHeic(data);
 const exif=(bytes,d)=>extractItem(bytes,d.iloc,d.exifItem);
 assert.deepEqual(listExifMetadataEntries(exif(data,b)),listExifMetadataEntries(exif(source,a)),'capture EXIF');
 const maker=bytes=>listAppleMakerNoteTags(bytes).filter(x=>x.tag!==0x54).sort((x,y)=>x.tag-y.tag);
 assert.deepEqual(maker(exif(data,b)),maker(exif(source,a)),'other MakerNote tags');
 for(const [id,item] of a.iloc.items){
  if(id===a.exifItem)continue;
  const read=(bytes,d)=>item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
  assert.deepEqual(read(data,b),read(source,a),'original payload '+id);
  const props=(bytes,d)=>(d.props.associations.get(id)||[]).map(r=>{const p=d.props.properties[r.index-1];return {essential:r.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};});
  assert.deepEqual(props(data,b),props(source,a),'original properties '+id);
  assert.deepEqual(b.refs.filter(r=>r.from===id),a.refs.filter(r=>r.from===id),'original references '+id);
 }
}
for(const input of inputs){
 const source=new Uint8Array(await fs.readFile(input)),d=discoverHeic(source);
 if(d.stylesItem!==null||hasTexture(d.infos))throw Error('Use the edited native source, without Styles graph or Texture: '+input);
 const original=extractAppleMakerNoteTag(extractItem(source,d.iloc,d.exifItem)),marker=parseBplist(original.payload);
 const upgraded=buildStyleMarker({styleId:marker.get('4'),tone:marker.get('1'),color:marker.get('2'),palette:marker.get('3'),level:'standard',confidence:1},original.payload);
 const raster=run(['-i',input,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
 const samples=new Map();
 const decode=async(_bytes,{width,height})=>{
  const key=width+'x'+height;
  if(!samples.has(key))samples.set(key,run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${width}:${height}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],raster));
  return samples.get(key);
 };
 const rgb=await decode(source,{width:1024,height:768}),mp4=path.join(output,path.basename(input)+'.thumbnail.mp4');
 // Same RGB -> Main10 thumbnail transport as the browser encoder. This is an
 // isolated reconstruction experiment, not recovered native capture calibration.
 run(['-y','-threads','1','-filter_threads','1','-f','rawvideo','-pix_fmt','rgb24','-s','1024x768','-r','1','-i','pipe:0',
   '-frames:v','1','-an','-c:v','libx265','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p10le','-profile:v','main10','-tag:v','hvc1',
   '-x265-params','info=0:pools=none:frame-threads=1:log-level=error','-movflags','+faststart',mp4],rgb);
 const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(mp4)));
 const linearThumb={sample:encoded.payload,hvcC:encoded.hvcc,ispe:ispeBox(1024,768),pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
 const texture=addTexture(source,{preserveStyles:true,allowMissingStyles:true}).data;
 const reconstructed=await patch(source,profile,{experimental:true,linearThumb,decode,sceneStats:'target',lightMaps:'target',texture:true});
 if(reconstructed.report.decodeError)throw Error(reconstructed.report.decodeError);
 const variants=[['A_MarkerTexture',setMarker(texture,upgraded)],['B_GraphLegacy',reconstructed.data],['C_GraphModern',setMarker(reconstructed.data,upgraded)]];
 for(const [kind,data] of variants){
  validateSource(source,data);
  const graph=discoverHeic(data),selected=parseBplist(extractAppleMakerNoteTag(extractItem(data,graph.iloc,graph.exifItem)).payload);
  for(const key of ['0','1','2','3','4'])assert.equal(selected.get(key),marker.get(key),'selected preset parameter '+key);
  const name=path.basename(input).replace(/\.heic$/i,'_'+kind+'.HEIC');
  await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({source:path.basename(input),file:name,bytes:data.length,styles:graph.stylesItem,texture:hasTexture(graph.infos),markerKeys:[...selected.keys()],styleId:selected.get('4'),sourceImageHdrPreserved:true});
 }
 await fs.rm(mp4);
}
await fs.writeFile(path.join(output,'Styles-rebuild-ABC.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
