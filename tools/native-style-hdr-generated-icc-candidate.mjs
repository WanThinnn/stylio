import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  discoverHeic,extractItem,idatItemBytes,replaceItemPropertyWithSource,propertyBoxBytes,
} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,iccColr} from '../web/src/raster/jpeg-hdr.js';
import {referenceWhiteHagcFromTmap} from '../web/src/raster/editable-hdr-pair.js';
import {buildDisplayP3PqHagcIcc,inspectGeneratedPqIcc} from '../web/src/raster/pq-hagc-icc.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';

const [outDir,sourceFile]=process.argv.slice(2);
if(!outDir||!sourceFile)throw Error('Usage: node tools/native-style-hdr-generated-icc-candidate.mjs <out-dir> <CE.heic>');
await fs.mkdir(outDir,{recursive:true});
const source=new Uint8Array(await fs.readFile(sourceFile)),d=discoverHeic(source);
const read=(bytes,disc,id)=>{
  const it=disc.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,disc.meta):extractItem(bytes,disc.iloc,id);
};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
assert.notEqual(tmap,undefined);
const inputs=d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to;
assert.deepEqual(inputs,[d.primary,d.hdrGrid]);
const tmapPayload=read(source,d,tmap),metadata=parseTmapMetadata(tmapPayload);
assert.equal(metadata.channels.length,1);
const {baselineHdrHeadroom,payload:hagc}=referenceWhiteHagcFromTmap(metadata);
const icc=buildDisplayP3PqHagcIcc(hagc);
const iccInfo=inspectGeneratedPqIcc(icc);

const originalMeta=source.slice(d.meta.off,d.meta.off+d.meta.size);
const patchedMeta=replaceItemPropertyWithSource(originalMeta,tmap,'colr',iccColr(icc));
const ft=topBox(source,'ftyp');
const output=rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),patchedMeta,new Map());
const after=discoverHeic(output);

// Every item payload, including tmap metadata and gain-map HEVC, stays exact.
for(const [id] of d.iloc.items)assert.ok(same(read(output,after,id),read(source,d,id)),`item payload changed ${id}`);
assert.deepEqual(after.refs,d.refs,'item-reference graph changed');
assert.deepEqual(
  extractAppleMakerNoteTag(read(output,after,after.exifItem),0x54),
  extractAppleMakerNoteTag(read(source,d,d.exifItem),0x54),
  'Style marker changed'
);
const newColr=propertyBoxBytes(output,after.props,tmap,'colr');
assert.ok(newColr&&String.fromCharCode(...newColr.slice(8,12))==='prof');
const checked=await executeJob({operation:'read',file:new Blob([output])});
assert.equal(checked.discoveryError,null);
assert.equal(checked.compatibilityError,null);

const outName='local-generated-pq-hagc.HEIC',outPath=path.join(outDir,outName);
await fs.writeFile(outPath,output);
await fs.writeFile(path.join(outDir,'local-generated-pq-hagc.icc'),icc);
const report={
  output:outPath,bytes:output.length,
  source:path.basename(sourceFile),
  tmap,baselineHdrHeadroom,
  generatedIccBytes:icc.length,generatedIccTags:iccInfo.tags.map(x=>x.sig),
  allItemPayloadsExact:true,graphExact:true,styleMarkerExact:true,
  sourceTmapMetadataExact:same(read(output,after,tmap),tmapPayload),
  gainPayloadsExact:d.hdrTiles.every((id,i)=>same(read(output,after,after.hdrTiles[i]),read(source,d,id))),
  compatibility:checked.compatibility?.status??null,
  compatibilityReasons:checked.compatibility?.reasons??[],
  productionEnabled:false,
};
await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
