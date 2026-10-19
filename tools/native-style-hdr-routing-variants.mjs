import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem} from '../web/src/core/heif.js';
import {setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,caFile]=process.argv.slice(2);
if(!output||!caFile)throw Error('Usage: node tools/native-style-hdr-routing-variants.mjs <output-dir> <CA.heic>');
await fs.mkdir(output,{recursive:true});
const sourceStem=path.basename(caFile).replace(/\.heic$/i,'').replace(/_(?:BY|BZ|CA)_[^.]+$/,'');

const base=new Uint8Array(await fs.readFile(caFile)),d=discoverHeic(base);
assert.notEqual(d.hdrGrid,null);assert.notEqual(d.stylesItem,null);assert.notEqual(d.linearThumb,null);
assert.equal(auxUriForItem(d.props,d.hdrGrid),'urn:com:apple:photo:2020:aux:hdrgainmap');

const read=(bytes,disc,id)=>{
  const it=disc.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,disc.meta):extractItem(bytes,disc.iloc,id);
};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const marker=extractAppleMakerNoteTag(read(base,d,d.exifItem),0x54).payload;
const hdrXmp=d.refs
  .filter(r=>r.type==='cdsc'&&r.to.includes(d.hdrGrid))
  .map(r=>r.from)
  .find(id=>d.infos.get(id)?.type==='mime'&&new TextDecoder().decode(read(base,d,id)).includes('http://ns.apple.com/HDRGainMap/1.0/'));
assert.notEqual(hdrXmp,undefined,'CA HDR XMP item missing');

const variants=[
  {id:'CB',label:'NoAuxC_AuxlXmp',auxC:false,auxl:true,xmp:true},
  {id:'CC',label:'AuxC_NoAuxl_Xmp',auxC:true,auxl:false,xmp:true},
  {id:'CD',label:'XmpOnly_NoAuxCNoAuxl',auxC:false,auxl:false,xmp:true},
  {id:'CE',label:'AuxCAuxl_NoXmp',auxC:true,auxl:true,xmp:false},
];

function build(v){
  let meta=base.slice(d.meta.off,d.meta.off+d.meta.size);
  if(!v.auxC){
    const assoc=(d.props.associations.get(d.hdrGrid)||[])
      .filter(a=>d.props.properties[a.index-1]?.type!=='auxC')
      .map(a=>[a.index,a.essential]);
    meta=setItemPropertyAssociations(meta,d.hdrGrid,assoc);
  }
  if(!v.auxl)meta=setItemReference(meta,'auxl',d.hdrGrid,[]);
  if(!v.xmp)meta=setItemReference(meta,'cdsc',hdrXmp,[]);
  const ft=topBox(base,'ftyp');
  return rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),meta,new Map());
}

const report=[];
for(const v of variants){
  const data=build(v),a=discoverHeic(data);
  assert.equal(a.stylesItem,d.stylesItem);assert.equal(a.linearThumb,d.linearThumb);assert.equal(a.hdrGrid,d.hdrGrid);
  assert(same(extractAppleMakerNoteTag(read(data,a,a.exifItem),0x54).payload,marker),'Style marker changed');
  for(const [id] of d.iloc.items)assert(same(read(data,a,id),read(base,d,id)),`payload changed ${id}`);
  const aux=auxUriForItem(a.props,a.hdrGrid);
  const auxl=a.refs.find(r=>r.type==='auxl'&&r.from===a.hdrGrid)?.to||[];
  const xmp=a.refs.find(r=>r.type==='cdsc'&&r.from===hdrXmp)?.to||[];
  assert.equal(Boolean(aux),v.auxC);assert.equal(auxl.includes(a.primary),v.auxl);assert.equal(xmp.includes(a.hdrGrid),v.xmp);
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  const name=`${sourceStem}_${v.id}_${v.label}.HEIC`;
  await fs.writeFile(path.join(output,name),data);
  report.push({
    file:name,bytes:data.length,auxC:aux||null,auxlTargets:auxl,hdrXmpTargets:xmp,
    primaryExact:true,hdrPayloadExact:true,linearThumbExact:true,stylesItemExact:true,
    selectedStyleMarkerExact:true,allItemPayloadsExact:true,
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    productionRepair:false,
  });
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
