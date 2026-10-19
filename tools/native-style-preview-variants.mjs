// Private same-capture experiment: keep L's native editing resources while
// replacing its full display image and ordinary thumbnail with the edited view.
// This still needs the original capture and has NOT been accepted on-device.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {box,topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,dimensionsForItem,ispeBox,appendIpcoProperty} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag,listExifMetadataEntries,listAppleMakerNoteTags} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,baseFile,editedFile]=process.argv.slice(2);
if(!output||!baseFile||!editedFile)throw Error('Usage: node tools/native-style-preview-variants.mjs <output-directory> <L.heic> <edited-native.heic>');
const [base,edited]=await Promise.all([baseFile,editedFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(edited);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const exif=(bytes,d)=>read(bytes,d,d.exifItem);
assert.deepEqual(extractAppleMakerNoteTag(exif(base,a),0x2b),extractAppleMakerNoteTag(exif(edited,b),0x2b),'same capture UUID');
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary));
assert.deepEqual(read(base,a,a.primary),read(edited,b,b.primary),'same primary grid layout');
assert.equal(a.primaryTiles.length,b.primaryTiles.length);assert.notEqual(a.thumbnail,null);
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);assert.notEqual(a.deltaGrid,null);
const beforeSelection=parseBplist(extractAppleMakerNoteTag(exif(base,a)).payload),currentTag=extractAppleMakerNoteTag(exif(edited,b));
const currentSelection=parseBplist(currentTag.payload);
for(const key of ['0','1','2','3','4'])assert.equal(beforeSelection.get(key),currentSelection.get(key),'current selection '+key);
await fs.mkdir(output,{recursive:true});
const [width,height]=dimensionsForItem(a.props,a.thumbnail);
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:100*1024*1024}));
const png=run(['-noautorotate','-i',editedFile,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
const rgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${width}:${height}:flags=lanczos`,
 '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
const mp4=path.join(output,'standard-preview-thumbnail.mp4');
run(['-y','-threads','1','-filter_threads','1','-f','rawvideo','-pix_fmt','rgb24','-s',`${width}x${height}`,'-r','1','-i','pipe:0',
 '-vf','scale=in_range=full:out_range=full:out_color_matrix=bt601,format=yuv420p',
 '-frames:v','1','-an','-c:v','libx265','-preset','ultrafast','-crf','18','-profile:v','main','-tag:v','hvc1',
 '-color_range','pc','-color_primaries','smpte432','-color_trc','iec61966-2-1','-colorspace','smpte170m',
 '-x265-params','info=0:pools=none:frame-threads=1:log-level=error:range=full:colorprim=12:transfer=13:colormatrix=6','-movflags','+faststart',mp4],rgb);
const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(mp4))),sps=hevcSpsColor(encoded.hvcc.slice(8));
assert.equal(sps.luma,8);assert.equal(sps.chroma,1);assert.equal(sps.fullRange,true);
assert.equal(sps.primaries,12);assert.equal(sps.transfer,13);assert.equal(sps.matrix,6);
let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const replacements=new Map([[a.thumbnail,encoded.payload]]),propertyIds=new Map();
for(const [i,id]of a.primaryTiles.entries()){
 const source=b.primaryTiles[i];replacements.set(id,read(edited,b,source));
 const refs=[];
 for(const ref of b.props.associations.get(source)||[]){
  let index=propertyIds.get(ref.index);
  if(index===undefined){
   const p=b.props.properties[ref.index-1];[meta,index]=appendIpcoProperty(meta,edited.slice(p.box.off,p.box.off+p.box.size));
   propertyIds.set(ref.index,index);
  }
  refs.push([index,ref.essential]);
 }
 meta=setItemPropertyAssociations(meta,id,refs);
}
// Replace only the ordinary display thumbnail codec. Keep its source colour,
// geometry, orientation and thmb relationship; never replace linearThumb here.
const thumbnailRefs=[];
for(const ref of a.props.associations.get(a.thumbnail)||[]){
 const p=a.props.properties[ref.index-1];
 if(p.type==='hvcC'){
  let index;[meta,index]=appendIpcoProperty(meta,encoded.hvcc);thumbnailRefs.push([index,ref.essential]);
 }else thumbnailRefs.push([ref.index,ref.essential]);
}
meta=setItemPropertyAssociations(meta,a.thumbnail,thumbnailRefs);
const ft=topBox(base,'ftyp'),m=rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),meta,replacements);
const md=discoverHeic(m),updated=injectAppleMakerNoteTag(exif(m,md),currentTag.payload,0x54,currentTag.type);
const n=rebuildHeic(m,md,m.slice(0,topBox(m,'ftyp').size),m.slice(md.meta.off,md.meta.off+md.meta.size),new Map([[md.exifItem,updated]]));
const changed=new Set([...a.primaryTiles,a.thumbnail,a.exifItem]);
const properties=(bytes,d,id)=>(d.props.associations.get(id)||[]).map(ref=>{
 const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
});
const report=[],files=new Map();
for(const [label,data]of [['M_StandardDisplay',m],['N_StandardDisplayLegacy',n]]){
 const d=discoverHeic(data);
 for(const id of a.iloc.items.keys()){
  if(!changed.has(id)){
   assert.deepEqual(read(data,d,id),read(base,a,id),'native editing/HDR payload '+id);
   assert.deepEqual(properties(data,d,id),properties(base,a,id),'native editing/HDR properties '+id);
  }
 }
 assert.deepEqual(d.refs,a.refs,'all native relationships');
 for(const [i,id]of a.primaryTiles.entries()){
  assert.deepEqual(read(data,d,id),read(edited,b,b.primaryTiles[i]),'exact Standard display sample '+id);
  assert.deepEqual(properties(data,d,id),properties(edited,b,b.primaryTiles[i]),'matching display decoder '+id);
 }
 assert.deepEqual(listExifMetadataEntries(exif(data,d)),listExifMetadataEntries(exif(base,a)));
 assert.deepEqual(listAppleMakerNoteTags(exif(data,d)).filter(t=>t.tag!==0x54),listAppleMakerNoteTags(exif(base,a)).filter(t=>t.tag!==0x54));
 const selected=parseBplist(extractAppleMakerNoteTag(exif(data,d)).payload);
 for(const key of ['0','1','2','3','4'])assert.equal(selected.get(key),currentSelection.get(key));
 const name='native-1_'+label+'.HEIC';await fs.writeFile(path.join(output,name),data);files.set(name,data);
 report.push({file:name,bytes:data.length,markerKeys:[...selected.keys()],nativeEditingPayloadsExact:true,
  nativeHdrExact:true,primaryDisplayMatchesEditedSource:true,ordinaryThumbnailRegenerated:true,
  previewHdrNeedsDeviceValidation:true,productionRepair:false});
}
await fs.rm(mp4);
await fs.writeFile(path.join(output,'Styles-preview-MN.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
