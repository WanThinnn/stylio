// Private same-capture diagnostic. J/K isolate selection/capture metadata;
// L retains the original native image base and may show its captured Bright
// rendition before entering Edit. None is an automatic edited-only repair.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag,listAppleMakerNoteTags,listExifMetadataEntries} from '../web/src/core/exif.js';
import {parseBplist,buildBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,reconstructedFile,originalFile]=process.argv.slice(2);
if(!output||!reconstructedFile||!originalFile)throw Error('Usage: node tools/native-style-base-variants.mjs <output-directory> <I.heic> <original-native.heic>');
const [reconstructed,original]=await Promise.all([reconstructedFile,originalFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(reconstructed),b=discoverHeic(original);
const exif=(data,d)=>extractItem(data,d.iloc,d.exifItem);
const tag=(data,d,id=0x54)=>extractAppleMakerNoteTag(exif(data,d),id);
assert.deepEqual(tag(reconstructed,a,0x2b),tag(original,b,0x2b),'same capture UUID required');
assert.notEqual(a.stylesItem,null);assert.notEqual(b.stylesItem,null);
const selected=parseBplist(tag(reconstructed,a).payload,{preserveReals:true});
const modern=parseBplist(tag(original,b).payload,{preserveReals:true});
assert.deepEqual([...selected.keys()].sort(),['0','1','2','3','4','5']);
assert.equal(modern.get('5'),1);assert.equal(modern.get('6'),4);assert.equal(modern.get('7'),0);
for(const key of ['0','1','2','3','4'])modern.set(key,selected.get(key));
const marker=buildBplist(modern),nativeTag5e=tag(original,b,0x5e);
function setTags(data,tags){
 const d=discoverHeic(data);let updated=exif(data,d);
 for(const [id,{payload,type}]of tags)updated=injectAppleMakerNoteTag(updated,payload,id,type);
 const ft=topBox(data,'ftyp');
 return rebuildHeic(data,d,data.slice(ft.off,ft.off+ft.size),data.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,updated]]));
}
function verify(source,data,allowed){
 const before=discoverHeic(source),after=discoverHeic(data);
 for(const [id,item]of before.iloc.items){
  if(id!==before.exifItem){
   const read=(bytes,d)=>item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
   assert.deepEqual(read(data,after),read(source,before),'picture/metadata payload '+id);
  }
  const props=(bytes,d)=>(d.props.associations.get(id)||[]).map(ref=>{
   const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
  });
  assert.deepEqual(props(data,after),props(source,before),'properties '+id);
 }
 assert.deepEqual(after.refs,before.refs,'all relationships unchanged');
 assert.deepEqual(listExifMetadataEntries(exif(data,after)),listExifMetadataEntries(exif(source,before)),'capture metadata');
 const unaffected=bytes=>listAppleMakerNoteTags(bytes).filter(t=>!allowed.has(t.tag));
 assert.deepEqual(unaffected(exif(data,after)),unaffected(exif(source,before)),'other MakerNotes');
 const selection=parseBplist(tag(data,after).payload),wanted=parseBplist(tag(reconstructed,a).payload);
 for(const key of ['0','1','2','3','4'])assert.equal(selection.get(key),wanted.get(key),'selected parameter '+key);
}
const modernTag={payload:marker,type:tag(reconstructed,a).type};
const j=setTags(reconstructed,[[0x54,modernTag]]);
const k=setTags(j,[[0x5e,nativeTag5e]]);
const texture=(await executeJob({operation:'texture',data:original,opts:{preserveStyles:true}})).data;
const l=setTags(texture,[[0x54,modernTag]]);
verify(reconstructed,j,new Set([0x54]));verify(j,k,new Set([0x5e]));verify(texture,l,new Set([0x54]));
await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [variant,data,base]of [['J_ModernSelection',j,'I'],['K_NativeCaptureTag',k,'J'],['L_OriginalImageBase',l,'original-native+Texture']]){
 const name='native-1_'+variant+'.HEIC';
 await fs.writeFile(path.join(output,name),data);files.set(name,data);
 report.push({file:name,bytes:data.length,base,presetParametersPreserved:true,allBasePayloadsExceptExifPreserved:true,
  initialDisplayMayRemainCapturedBright:variant.startsWith('L_'),productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-base-JKL.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
