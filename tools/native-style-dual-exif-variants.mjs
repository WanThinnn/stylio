// Same-capture diagnostic: model Photos original/current state with two Exif items.
// AQ already keeps an exact Bright editor graph plus an exact Standard preferred rendition.
// These variants keep every image/calibration/Texture payload exact and vary only which
// Exif state describes each rendition. They are diagnostics, never production repair.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {be,findChild,metaChildren,topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {addItems,setItemReference} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {hasTexture} from '../web/src/styles/texture.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,aqFile,brightFile,standardFile]=process.argv.slice(2);
if(!output||!aqFile||!brightFile||!standardFile)
  throw Error('Usage: node tools/native-style-dual-exif-variants.mjs <output-directory> <AQ.heic> <original-bright.heic> <native-standard-current.heic>');

const [aq,bright,standard]=await Promise.all(
  [aqFile,brightFile,standardFile].map(async file=>new Uint8Array(await fs.readFile(file)))
);
const a=discoverHeic(aq),b=discoverHeic(bright),s=discoverHeic(standard);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const exif=(bytes,d)=>read(bytes,d,d.exifItem);
const tag=(bytes,d,id)=>extractAppleMakerNoteTag(exif(bytes,d),id);

assert.deepEqual(tag(aq,a,0x2b),tag(bright,b,0x2b),'AQ/Bright capture UUID');
assert.deepEqual(tag(aq,a,0x2b),tag(standard,s,0x2b),'AQ/Standard capture UUID');
const brightSelection=parseBplist(tag(bright,b,0x54).payload);
const standardSelection=parseBplist(tag(standard,s,0x54).payload);
assert.equal(brightSelection.get('4'),16,'original Bright marker');
assert.equal(standardSelection.get('4'),1,'current Standard marker');

const tmaps=[...a.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);
assert.equal(tmaps.length,2,'AQ must contain Bright and Standard tmaps');
const dimg=id=>a.refs.find(r=>r.type==='dimg'&&r.from===id)?.to||[];
const brightTmap=tmaps.find(id=>dimg(id)[0]===a.primary);
const standardTmap=tmaps.find(id=>id!==brightTmap);
assert.notEqual(brightTmap,undefined,'Bright tmap');
assert.notEqual(standardTmap,undefined,'Standard tmap');
const [standardPrimary,standardHdr]=dimg(standardTmap);
assert.ok(standardPrimary&&standardHdr,'Standard tmap targets');
assert.notEqual(standardPrimary,a.primary,'distinct Standard primary');

const originalMeta=aq.slice(a.meta.off,a.meta.off+a.meta.size);
const ftyp=aq.slice(0,topBox(aq,'ftyp').size);

function setPrimary(meta,id){
  const m=topBox(meta,'meta'),pitm=findChild(metaChildren(meta,m),'pitm');
  const version=meta[pitm.off+pitm.hdr],size=version===0?2:4;
  const out=meta.slice();
  out.set(be(id,size),pitm.off+pitm.hdr+4);
  return out;
}

function buildVariant({standardTargets,brightTargets,primary=a.primary}){
  let meta=originalMeta;
  // Existing AQ Exif becomes the exact original Bright Exif.
  meta=setItemReference(meta,'cdsc',a.exifItem,brightTargets);
  let ids;[meta,ids]=addItems(meta,[{
    key:'standard-exif',itemType:'Exif',itemName:a.infos.get(a.exifItem)?.name||'',
    refType:'cdsc',refTo:standardTargets,
  }]);
  const standardExif=ids.get('standard-exif');
  if(primary!==a.primary)meta=setPrimary(meta,primary);
  const payloads=new Map([
    [a.exifItem,exif(bright,b)],
    [standardExif,exif(standard,s)],
  ]);
  const data=rebuildHeic(aq,a,ftyp,meta,payloads);
  return {data,standardExif};
}

const variants=[
  ['BE_DualExif_PrimaryTargets',
    {brightTargets:[a.primary],standardTargets:[standardPrimary]}],
  ['BF_DualExif_FullRenditionTargets',
    {brightTargets:[a.primary,brightTmap],standardTargets:[standardPrimary,standardTmap]}],
  ['BG_DualExif_StandardTmapOnly',
    {brightTargets:[a.primary],standardTargets:[standardTmap]}],
  ['BH_DualExif_StandardPrimary',
    {brightTargets:[a.primary,brightTmap],standardTargets:[standardPrimary,standardTmap],primary:standardPrimary}],
];

await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,opts]of variants){
  const {data,standardExif}=buildVariant(opts),d=discoverHeic(data);
  // discoverHeic intentionally resolves the appended Standard Exif as the active one.
  assert.equal(d.exifItem,standardExif,'active Exif should be current Standard');
  assert.equal(parseBplist(extractAppleMakerNoteTag(read(data,d,standardExif),0x54).payload).get('4'),1);
  const brightExif=[...d.infos].filter(([id,info])=>info.type==='Exif'&&id!==standardExif).map(([id])=>id);
  assert.ok(brightExif.includes(a.exifItem),'original Bright Exif retained');
  assert.equal(parseBplist(extractAppleMakerNoteTag(read(data,d,a.exifItem),0x54).payload).get('4'),16);
  assert.notEqual(d.stylesItem,null);assert.equal(hasTexture(d.infos),true);

  // Every original AQ payload except the Exif replacement stays byte exact.
  for(const id of a.iloc.items.keys())if(id!==a.exifItem)
    assert.deepEqual(read(data,d,id),read(aq,a,id),'unchanged AQ payload '+id);

  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);
  assert.equal(checked.compatibilityError,null);
  const name=`native-1_${label}.HEIC`;
  await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({
    file:name,bytes:data.length,primary:opts.primary===standardPrimary?'exact native Standard':'exact original Bright',
    brightExifTargets:opts.brightTargets,standardExifTargets:opts.standardTargets,
    dualExif:true,sameCapture:true,styles:true,texture:true,hdr:true,
    imageCalibrationAndTexturePayloadsExact:true,
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    productionRepair:false,
  });
}
await fs.writeFile(path.join(output,'Styles-preview-BE-BH.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
