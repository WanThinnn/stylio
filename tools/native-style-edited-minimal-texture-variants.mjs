import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,propertyBoxBytes} from '../web/src/core/heif.js';
import {addItems} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {URI_TEXTURE_STYLES,MATTE_2026_URIS,textureStylesPayload} from '../web/src/styles/texture.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,input,tag65Donor]=process.argv.slice(2);
if(!output||!input||!tag65Donor)throw Error(
  'Usage: node tools/native-style-edited-minimal-texture-variants.mjs <output-directory> <edited-native.heic> <iphone18-texture-donor.heic>'
);
await fs.mkdir(output,{recursive:true});

const read=async f=>new Uint8Array(await fs.readFile(f));
const source=await read(input), donor=await read(tag65Donor);
const s=discoverHeic(source), dd=discoverHeic(donor);
assert.equal(s.stylesItem,null,'expected edited export without standalone Styles graph');
assert.notEqual(s.hdrGrid,null,'expected edited HDR source');

const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const sourceExif=itemBytes(source,s,s.exifItem);
const source54=extractAppleMakerNoteTag(sourceExif,0x54);
const donor65=extractAppleMakerNoteTag(itemBytes(donor,dd,dd.exifItem),0x65);
assert.equal(donor65.type,7);
assert.equal(donor65.payload.length,74);

const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function assertSourceState(data){
  const d=discoverHeic(data);
  assert.equal(d.primary,s.primary);
  assert.notEqual(d.hdrGrid,null);
  assert(eq(extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x54).payload,source54.payload),
    'selected Style marker changed');
  for(const id of s.iloc.items.keys()){
    if(id===s.exifItem)continue;
    assert(eq(itemBytes(data,d,id),itemBytes(source,s,id)),'source item changed '+id);
  }
  return d;
}
function rebuildFromSource(meta,payloads){
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,s,source.slice(ft.off,ft.off+ft.size),meta,payloads);
}
function inject65(data){
  const d=discoverHeic(data), exif=itemBytes(data,d,d.exifItem);
  const patched=injectAppleMakerNoteTag(exif,donor65.payload,0x65,7);
  const ft=topBox(data,'ftyp');
  return rebuildHeic(data,d,data.slice(ft.off,ft.off+ft.size),
    data.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,patched]]));
}

// BM: only texture_styles metadata, primary-only. No 2026 matte items.
let meta=source.slice(s.meta.off,s.meta.off+s.meta.size);
let ids;
[meta,ids]=addItems(meta,[{
  key:'texture',itemType:'uri ',itemName:'metadata',
  contentType:URI_TEXTURE_STYLES,refType:'cdsc',refTo:[s.primary],
}]);
const textureId=ids.get('texture');
const bm=rebuildFromSource(meta,new Map([[textureId,textureStylesPayload()]]));

// Full Texture baseline is used only as a donor for the generated matte bytes/properties.
// BN itself is rebuilt directly from the edited source, with 12 mattes + XMP and no texture_styles.
const {data:full}=await executeJob({
  operation:'texture',data:source,opts:{preserveStyles:true,allowMissingStyles:true},
});
const fd=discoverHeic(full);
const matteIds=[...fd.infos.keys()].filter(id=>MATTE_2026_URIS.includes(auxUriForItem(fd.props,id)));
assert.equal(matteIds.length,12);
const fullXmpByMatte=new Map();
for(const r of fd.refs){
  if(r.type!=='cdsc'||r.to.length!==1||!matteIds.includes(r.to[0]))continue;
  if(fd.infos.get(r.from)?.type==='mime')fullXmpByMatte.set(r.to[0],r.from);
}
assert.equal(fullXmpByMatte.size,12);

let bnMeta=source.slice(s.meta.off,s.meta.off+s.meta.size);
let bnMattes;
const matteSpecs=matteIds.map((donorId,n)=>({
  key:`matte:${n}`,
  uri:auxUriForItem(fd.props,donorId),
  boxes:[
    propertyBoxBytes(full,fd.props,donorId,'ispe'),
    propertyBoxBytes(full,fd.props,donorId,'pixi'),
    propertyBoxBytes(full,fd.props,donorId,'hvcC'),
  ].filter(Boolean),
  refType:'auxl',refTo:[s.primary],
}));
[bnMeta,bnMattes]=addItems(bnMeta,matteSpecs);
let bnXmps;
[bnMeta,bnXmps]=addItems(bnMeta,matteIds.map((donorId,n)=>({
  key:`xmp:${n}`,itemType:'mime',contentType:'application/rdf+xml',
  refType:'cdsc',refTo:[bnMattes.get(`matte:${n}`)],
})));
const bnPayloads=new Map();
matteIds.forEach((donorId,n)=>{
  bnPayloads.set(bnMattes.get(`matte:${n}`),itemBytes(full,fd,donorId));
  bnPayloads.set(bnXmps.get(`xmp:${n}`),itemBytes(full,fd,fullXmpByMatte.get(donorId)));
});
const bn=rebuildFromSource(bnMeta,bnPayloads);

// BO: only the native iPhone 18 0x65 capture-generation marker. No Texture items.
const bo=inject65(source);
// BP: metadata-only BM plus 0x65. Still no matte graph.
const bp=inject65(bm);

const variants=[
  ['BM_MetadataOnly',bm],
  ['BN_MattesOnly',bn],
  ['BO_Native65Only',bo],
  ['BP_MetadataPlus65',bp],
];
const report=[];
for(const [label,data] of variants){
  const d=assertSourceState(data);
  const texture=[...d.infos].some(([,i])=>i.uri===URI_TEXTURE_STYLES);
  const mattes=[...d.infos.keys()].filter(id=>MATTE_2026_URIS.includes(auxUriForItem(d.props,id))).length;
  let tag65=false;
  try{tag65=extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x65).payload.length===74}catch{}
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  const file=path.basename(input).replace(/\.heic$/i,'')+'_'+label+'.HEIC';
  await fs.writeFile(path.join(output,file),data);
  report.push({
    file,bytes:data.length,editedPrimaryExact:true,hdrSourceItemsExact:true,
    selectedStyleMarkerExact:true,textureMetadata:texture,textureMattes:mattes,
    makerNote65:tag65,compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    productionRepair:false,
  });
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
