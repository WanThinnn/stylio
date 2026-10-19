// Private same-capture diagnosis after O/P/Q retained the full-preview cast.
// R removes one opaque capture record; S tests photo-identifier reuse separately.
// Neither metadata mutation is an automatic production policy.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {box,boxes,topBox,be,concat} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,parseIloc} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,removeAppleMakerNoteTag,injectAppleMakerNoteTag,listAppleMakerNoteTags,listExifMetadataEntries} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,sourceFile]=process.argv.slice(2);
if(!output||!sourceFile)throw Error('Usage: node tools/native-style-preview-metadata-variants.mjs <output-directory> <Q.heic>');
const source=new Uint8Array(await fs.readFile(sourceFile)),a=discoverHeic(source);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const exif=read(source,a,a.exifItem),identifier=extractAppleMakerNoteTag(exif,0x2b);
assert.equal(identifier.type,2);
const originalId=new TextDecoder().decode(identifier.payload);
assert.match(originalId,/^[0-9A-F-]{36}\0$/i);
assert.equal(extractAppleMakerNoteTag(exif,0x5e).payload.length,4);
for(const key of ['hdrGrid','stylesItem','linearThumb','deltaGrid'])assert.notEqual(a[key],null,key);
function replaceExif(value){
 const meta=source.slice(a.meta.off,a.meta.off+a.meta.size),iloc=parseIloc(meta,topBox(meta,'meta'));
 const ft=topBox(source,'ftyp'),ftyp=source.slice(ft.off,ft.off+ft.size);
 const others=[...boxes(source,0,source.length)].filter(b=>!['ftyp','meta','mdat'].includes(b.type)).map(b=>source.slice(b.off,b.off+b.size));
 let cursor=ftyp.length+meta.length+others.reduce((n,b)=>n+b.length,0)+8;const payloads=[];
 for(const [id,item]of iloc.items){
  if(item.constructionMethod===1)continue;
  assert.equal(item.constructionMethod,0);assert.equal(item.extents.length,1);
  const payload=id===a.exifItem?value:read(source,a,id),extent=item.extents[0];
  meta.set(be(cursor,4),extent.offsetPos);meta.set(be(payload.length,4),extent.lengthPos);cursor+=payload.length;payloads.push(payload);
 }
 return concat([ftyp,meta,...others,box('mdat',concat(payloads))]);
}
const r=replaceExif(removeAppleMakerNoteTag(exif,0x5e));
const fresh=new TextEncoder().encode(randomUUID().toUpperCase()+'\0');
assert.equal(fresh.length,identifier.payload.length);assert.notDeepEqual(fresh,identifier.payload);
const s=replaceExif(injectAppleMakerNoteTag(exif,fresh,0x2b,identifier.type));
const props=(bytes,d,id)=>(d.props.associations.get(id)||[]).map(ref=>{
 const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
});
await fs.mkdir(output,{recursive:true});const files=new Map(),report=[];
for(const [label,data,changedTag]of [['R_WithoutOpaqueTag',r,0x5e],['S_FreshIdentifier',s,0x2b]]){
 const d=discoverHeic(data),savedExif=read(data,d,d.exifItem);
 for(const id of a.infos.keys()){
  if(id!==a.exifItem)assert.deepEqual(read(data,d,id),read(source,a,id),'unchanged sample '+id);
  assert.deepEqual(props(data,d,id),props(source,a,id),'unchanged properties '+id);
 }
 assert.deepEqual(d.refs,a.refs,'all graph relationships');
 assert.deepEqual(listExifMetadataEntries(savedExif),listExifMetadataEntries(exif),'all semantic capture Exif');
 const unaffected=bytes=>listAppleMakerNoteTags(bytes).filter(t=>t.tag!==changedTag);
 assert.deepEqual(unaffected(savedExif),unaffected(exif),'all unrelated MakerNotes');
 if(changedTag===0x5e)assert.throws(()=>extractAppleMakerNoteTag(savedExif,0x5e),/not found/);
 else assert.deepEqual(extractAppleMakerNoteTag(savedExif,0x2b).payload,fresh);
 const checked=await executeJob({operation:'read',file:new Blob([data])});
 assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);assert.equal(checked.compatibility?.status,'known-compatible');
 const name='native-1_'+label+'.HEIC';await fs.writeFile(path.join(output,name),data);files.set(name,data);
 report.push({file:name,bytes:data.length,base:'Q',changedMakerTag:'0x'+changedTag.toString(16),
  primaryHdrStylesTexturePayloadsExact:true,otherCaptureMetadataExact:true,compatibility:checked.compatibility.status,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-RS.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
