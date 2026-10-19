import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox,box,concat} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {addItems} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,input]=process.argv.slice(2);
if(!output||!input)throw Error(
  'Usage: node tools/native-style-edited-container-integrity-variants.mjs <output-directory> <edited-native.heic>'
);
await fs.mkdir(output,{recursive:true});

const source=new Uint8Array(await fs.readFile(input));
const s=discoverHeic(source);
assert.equal(s.stylesItem,null,'expected edited export without standalone Styles graph');
assert.notEqual(s.hdrGrid,null,'expected HDR source');
assert.notEqual(s.exifItem,null,'expected Exif');

const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const sourceExif=itemBytes(source,s,s.exifItem);
const source54=extractAppleMakerNoteTag(sourceExif,0x54);
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const ft=topBox(source,'ftyp');
const ftyp=source.slice(ft.off,ft.off+ft.size);
const meta0=source.slice(s.meta.off,s.meta.off+s.meta.size);

function assertSemanticSourceState(data,label){
  const d=discoverHeic(data);
  assert.equal(d.primary,s.primary,label+': primary changed');
  assert.notEqual(d.hdrGrid,null,label+': HDR graph missing');
  assert(eq(extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x54).payload,source54.payload),
    label+': selected Style marker changed');
  for(const id of s.iloc.items.keys()){
    if(id===s.exifItem&&label==='BT_ExifRelocated')continue;
    assert(eq(itemBytes(data,d,id),itemBytes(source,s,id)),label+': source item changed '+id);
  }
  assert(eq(itemBytes(data,d,d.exifItem),sourceExif),label+': Exif payload changed');
  return d;
}

// BQ: exact source bytes, control.
const bq=source.slice();

// BR: append an inert top-level free box. No existing box or extent moves.
const br=concat([source,box('free',new Uint8Array(32))]);

// BS: add one unreferenced, unknown metadata URI item. This grows meta and shifts
// all construction_method=0 source extents, but changes no existing payload/reference.
let bsMeta=meta0.slice(), bsIds;
[bsMeta,bsIds]=addItems(bsMeta,[{
  key:'inert',itemType:'uri ',itemName:'diagnostic',
  contentType:'urn:stylio:diagnostic:inert',
}]);
const bsId=bsIds.get('inert');
const bs=rebuildHeic(source,s,ftyp,bsMeta,new Map([[bsId,new Uint8Array([0])]]));

// BT: keep the exact same meta graph and exact same Exif bytes, but relocate the Exif
// payload to a newly appended mdat through the normal rebuild path.
assert.equal(s.iloc.items.get(s.exifItem).constructionMethod,0,
  'BT requires an external edited Exif item');
const oldExifOffset=s.iloc.items.get(s.exifItem).extents[0].offset;
const bt=rebuildHeic(source,s,ftyp,meta0.slice(),new Map([[s.exifItem,sourceExif]]));

const variants=[
  ['BQ_ExactSourceControl',bq],
  ['BR_TopLevelFreeBox',br],
  ['BS_InertMetaItem',bs],
  ['BT_ExifRelocated',bt],
];

const report=[];
for(const [label,data] of variants){
  const d=assertSemanticSourceState(data,label);
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  const file=path.basename(input).replace(/\.heic$/i,'')+'_'+label+'.HEIC';
  await fs.writeFile(path.join(output,file),data);
  report.push({
    file,bytes:data.length,
    byteExactSource:eq(data,source),
    selectedStyleMarkerExact:true,
    exifPayloadExact:true,
    hdrSourceItemsExact:true,
    metaBytesDelta:data.length-source.length,
    exifOffset:s.iloc.items.get(s.exifItem).constructionMethod===0
      ?d.iloc.items.get(d.exifItem).extents[0].offset:null,
    exifRelocated:label==='BT_ExifRelocated'
      ?d.iloc.items.get(d.exifItem).extents[0].offset!==oldExifOffset:false,
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    productionRepair:false,
  });
}
assert(report.find(x=>x.file.includes('BT_'))?.exifRelocated,'BT did not relocate Exif');
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
