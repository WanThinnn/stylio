// Add the omitted editor headroom sidecar to an existing reconstructed output.
// A same-capture uploaded source is required to verify exact image/HDR data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {registerTmapHdr,editableTmapHeadroom} from '../web/src/styles/hdr-compatibility.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [sourceFile,rebuiltFile,outputFile]=process.argv.slice(2);
if(!sourceFile||!rebuiltFile||!outputFile)
  throw Error('Usage: node tools/repair-rebuilt-native-hdr.mjs <native-current.heic> <rebuilt.heic> <output.heic>');
assert.notEqual(path.resolve(outputFile),path.resolve(sourceFile));
assert.notEqual(path.resolve(outputFile),path.resolve(rebuiltFile));
const [source,rebuilt]=await Promise.all([sourceFile,rebuiltFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const s=discoverHeic(source),b=discoverHeic(rebuilt);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tmapIds=d=>[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);
const metadata=(bytes,d,id)=>(d.props.associations.get(id)||[]).map(ref=>{
  const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
});
assert.notEqual(b.stylesItem,null,'reconstructed Styles required');
assert.notEqual(b.linearThumb,null,'reconstructed linear thumbnail required');
assert.notEqual(b.deltaGrid,null,'reconstructed StyleDelta required');
assert.equal(tmapIds(s).length,1);assert.equal(tmapIds(b).length,1);
assert.deepEqual(extractAppleMakerNoteTag(read(source,s,s.exifItem),0x2b),
  extractAppleMakerNoteTag(read(rebuilt,b,b.exifItem),0x2b),'same capture');
assert.deepEqual(extractAppleMakerNoteTag(read(source,s,s.exifItem),0x54),
  extractAppleMakerNoteTag(read(rebuilt,b,b.exifItem),0x54),'same selected Style and parameters');
const sourceIds=[s.primary,...s.primaryTiles,s.hdrGrid,...s.hdrTiles,...tmapIds(s)];
const rebuiltIds=[b.primary,...b.primaryTiles,b.hdrGrid,...b.hdrTiles,...tmapIds(b)];
assert.equal(sourceIds.length,rebuiltIds.length);
for(let i=0;i<sourceIds.length;i++)
  assert.deepEqual(read(source,s,sourceIds[i]),read(rebuilt,b,rebuiltIds[i]),'source image/HDR payload '+sourceIds[i]);
const headroom=editableTmapHeadroom(source,s);assert.ok(headroom>1);
assert.equal(editableTmapHeadroom(rebuilt,b),headroom);

const data=registerTmapHdr(rebuilt,{headroom:true});
assert.ok(data,'file already has the complete HDR declarations');
const d=discoverHeic(data);
for(const id of b.infos.keys()){
  assert.deepEqual(read(data,d,id),read(rebuilt,b,id),'retained payload '+id);
  assert.deepEqual(metadata(data,d,id),metadata(rebuilt,b,id),'retained properties '+id);
  assert.deepEqual(d.refs.filter(ref=>ref.from===id),b.refs.filter(ref=>ref.from===id),'retained references '+id);
}
assert.equal(d.infos.size,b.infos.size+1,'only one HDR metadata item added');
assert.equal(registerTmapHdr(data,{headroom:true}),null,'idempotent repair');
const checked=await executeJob({operation:'read',file:new Blob([data])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
assert.equal(checked.compatibility?.status,'known-compatible');
await fs.mkdir(path.dirname(path.resolve(outputFile)),{recursive:true});
await fs.writeFile(outputFile,data,{flag:'wx'});
const report={file:outputFile,source:path.basename(sourceFile),rebuilt:path.basename(rebuiltFile),
  sourceBytes:source.length,beforeBytes:rebuilt.length,afterBytes:data.length,headroom,
  allExistingPayloadsPropertiesReferencesExact:true,sourceImageAndHdrExact:true,selectedStyleExact:true,
  addedItems:1,compatibility:checked.compatibility.status,deviceValidation:'pending',
  sha256:crypto.createHash('sha256').update(data).digest('hex')};
await fs.writeFile(outputFile+'.json',JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report,null,2));
