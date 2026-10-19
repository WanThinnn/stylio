import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,replaceIdatItem} from '../web/src/core/heif.js';
import {parseTmapMetadata} from '../web/src/raster/jpeg-hdr.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,ceFile]=process.argv.slice(2);
if(!output||!ceFile)throw Error('Usage: node tools/native-style-hdr-tmap-mode-candidate.mjs <output-dir> <CE.heic>');
await fs.mkdir(output,{recursive:true});

const base=new Uint8Array(await fs.readFile(ceFile)),d=discoverHeic(base);
const read=(bytes,disc,id)=>{
  const it=disc.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,disc.meta):extractItem(bytes,disc.iloc,id);
};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const tmapId=[...d.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.notEqual(tmapId,undefined,'tmap required');
const originalTmap=read(base,d,tmapId);
const metadata=parseTmapMetadata(originalTmap);
assert.equal(metadata.useBaseColorSpace,false,'candidate expects flattened tmap mode');
const patchedTmap=originalTmap.slice();
patchedTmap[5]|=64;
assert.equal(patchedTmap.length,originalTmap.length);
for(let i=0;i<originalTmap.length;i++){
  if(i===5)continue;
  assert.equal(patchedTmap[i],originalTmap[i],`unexpected tmap byte change at ${i}`);
}
assert.equal(originalTmap[5]&64,0);
assert.equal(patchedTmap[5]&64,64);
const patchedMetadata=parseTmapMetadata(patchedTmap);
assert.equal(patchedMetadata.useBaseColorSpace,true);

const ft=topBox(base,'ftyp');
const patchedMeta=replaceIdatItem(base.slice(d.meta.off,d.meta.off+d.meta.size),tmapId,patchedTmap);
const data=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),patchedMeta,new Map());
const out=discoverHeic(data);
for(const [id] of d.iloc.items){
  if(id===tmapId)continue;
  assert(same(read(data,out,id),read(base,d,id)),`payload changed ${id}`);
}
assert.deepEqual(out.refs,d.refs,'graph relationships changed');
assert.deepEqual(out.props,d.props,'item properties changed');
assert.deepEqual(
  extractAppleMakerNoteTag(read(data,out,out.exifItem),0x54),
  extractAppleMakerNoteTag(read(base,d,d.exifItem),0x54),
  'selected Style marker changed'
);
const checked=await executeJob({operation:'read',file:new Blob([data])});
assert.equal(checked.discoveryError,null);
assert.equal(checked.compatibilityError,null);

const name='CN_BaseColorSpaceOnly.HEIC';
await fs.writeFile(path.join(output,name),data);
const report={
  file:name,
  bytes:data.length,
  changedItem:tmapId,
  originalFlags:originalTmap[5],
  candidateFlags:patchedTmap[5],
  useBaseColorSpaceBefore:false,
  useBaseColorSpaceAfter:true,
  allOtherTmapBytesExact:true,
  allOtherItemPayloadsExact:true,
  graphExact:true,
  selectedStyleMarkerExact:true,
  compatibility:checked.compatibility?.status||null,
  compatibilityReasons:checked.compatibility?.reasons||[],
  productionRepair:false,
};
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
