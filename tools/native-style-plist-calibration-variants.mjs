import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,listExifMetadataEntries} from '../web/src/core/exif.js';
import {parseBplist,buildBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,ceFile,nativeFile]=process.argv.slice(2);
if(!output||!ceFile||!nativeFile)throw Error(
  'Usage: node tools/native-style-plist-calibration-variants.mjs <output-dir> <CE.heic> <same-capture-native-full.heic>'
);
await fs.mkdir(output,{recursive:true});

const [base,native]=await Promise.all([ceFile,nativeFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const a=discoverHeic(base),b=discoverHeic(native);
for(const d of [a,b])assert.notEqual(d.stylesItem,null,'Styles plist required');
const read=(bytes,d,id)=>{
  const it=d.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
};
const same=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
const capture=(bytes,d)=>listExifMetadataEntries(read(bytes,d,d.exifItem))
  .filter(e=>[0x110,0x9003,0x9291,0x829a,0x829d].includes(e.tag));
assert.deepEqual(capture(base,a),capture(native,b),'native reference must be same capture');
assert.deepEqual(extractAppleMakerNoteTag(read(base,a,a.exifItem),0x2b),
  extractAppleMakerNoteTag(read(native,b,b.exifItem),0x2b),'capture UUID mismatch');
const marker=extractAppleMakerNoteTag(read(base,a,a.exifItem),0x54);
const baseStyles=read(base,a,a.stylesItem),nativeStyles=read(native,b,b.stylesItem);

function replaceStyles(payload){
  const ft=topBox(base,'ftyp');
  return rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),
    base.slice(a.meta.off,a.meta.off+a.meta.size),new Map([[a.stylesItem,payload]]));
}
function basePl(){return parseBplist(baseStyles,{preserveReals:true});}
function nativePl(){return parseBplist(nativeStyles,{preserveReals:true});}
function nativeLinearFields(keys){
  const p=basePl(),n=nativePl(),six=p.get('6'),nsix=n.get('6');
  const linear=six instanceof Map?six.get('LinearImage'):null,nlinear=nsix instanceof Map?nsix.get('LinearImage'):null;
  assert(linear instanceof Map&&nlinear instanceof Map);
  for(const key of keys)linear.set(key,nlinear.get(key));
  six.set('LinearImage',linear);p.set('6',six);
  return buildBplist(p);
}
function nativeLinearOnly(){
  const p=basePl(),n=nativePl(),six=p.get('6'),nsix=n.get('6');
  assert(six instanceof Map&&nsix instanceof Map&&nsix.get('LinearImage') instanceof Map);
  six.set('LinearImage',nsix.get('LinearImage'));p.set('6',six);
  return buildBplist(p);
}
function nativeRangeIH(){
  const p=basePl(),n=nativePl();
  for(const key of ['i','h'])p.set(key,n.get(key));
  return buildBplist(p);
}
function nativeLinearRangeIH(){
  const p=basePl(),n=nativePl(),six=p.get('6'),nsix=n.get('6');
  six.set('LinearImage',nsix.get('LinearImage'));p.set('6',six);
  for(const key of ['i','h'])p.set(key,n.get(key));
  return buildBplist(p);
}
function nativeCore(){
  const p=basePl(),n=nativePl(),six=p.get('6'),nsix=n.get('6');
  six.set('LinearImage',nsix.get('LinearImage'));p.set('6',six);
  for(const key of ['0','4','h','i','j','k'])if(n.has(key))p.set(key,n.get(key));else p.delete(key);
  return buildBplist(p);
}

const variants=[
  ['CK','NativeLinearWhitePoint',nativeLinearFields(['whitePoint'])],
  ['CL','NativeLinearHighKey',nativeLinearFields(['highKey'])],
  ['CM','NativeLinearWhiteAndHigh',nativeLinearFields(['whitePoint','highKey'])],
  ['CF','NativeLinearImage',nativeLinearOnly()],
  ['CG','NativeRangeIH',nativeRangeIH()],
  ['CH','NativeLinearPlusRangeIH',nativeLinearRangeIH()],
  ['CI','NativeCalibrationCore',nativeCore()],
  ['CJ','NativeFullStylesPlist',nativeStyles],
];
const report=[];
for(const [id,label,payload] of variants){
  const data=replaceStyles(payload),d=discoverHeic(data);
  assert.equal(d.stylesItem,a.stylesItem);assert.equal(d.hdrGrid,a.hdrGrid);assert.equal(d.linearThumb,a.linearThumb);
  assert.deepEqual(extractAppleMakerNoteTag(read(data,d,d.exifItem),0x54),marker,'selected Style marker changed');
  for(const [iid] of a.iloc.items){
    if(iid===a.stylesItem)continue;
    assert(same(read(data,d,iid),read(base,a,iid)),`non-Styles payload changed ${iid}`);
  }
  assert.deepEqual(d.refs,a.refs,'relationships changed');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  const file=`native-1_${id}_${label}.HEIC`;
  await fs.writeFile(path.join(output,file),data);
  const pl=parseBplist(payload,{preserveReals:true}),six=pl.get('6');
  report.push({
    file,bytes:data.length,
    changedOnlyStylesPayload:true,
    sourceStyleMarkerExact:true,
    primaryHdrLinearTextureExact:true,
    schema:pl.get('0'),
    linearImageWhitePoint:six instanceof Map&&six.get('LinearImage') instanceof Map?six.get('LinearImage').get('whitePoint')?.value??six.get('LinearImage').get('whitePoint'):null,
    originalRangeMax:pl.get('i') instanceof Map?pl.get('i').get('OriginalRangeMax')?.value??pl.get('i').get('OriginalRangeMax'):null,
    gain:pl.get('i') instanceof Map?pl.get('i').get('Gain')?.value??pl.get('i').get('Gain'):null,
    h:pl.get('h')?.value??pl.get('h')??null,
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    researchUsesOriginalCalibration:true,
    productionRepair:false,
  });
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
