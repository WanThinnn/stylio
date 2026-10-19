// Candidate P: keep O byte-exact except restore the historical Indigo/Adobe
// tmap derived-rendition colour declaration from PQ to extended-linear RGB.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes} from '../web/src/core/heif.js';
import {replaceItemPropertyWithSource} from '../web/src/raster/heif.js';
import {nclx} from '../web/src/raster/generated-profile.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [baseFile,outputFile]=process.argv.slice(2);
if(!baseFile||!outputFile)throw Error('Usage: node tools/indigo-linear-tmap-candidate.mjs <O.heic> <P.heic>');
assert.notEqual(path.resolve(baseFile).toLowerCase(),path.resolve(outputFile).toLowerCase());
const base=new Uint8Array(await fs.readFile(baseFile)),a=discoverHeic(base);
const tmap=[...a.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.ok(tmap!==undefined,'tmap required');
const raw=propertyBoxBytes(base,a.props,tmap,'colr');assert.ok(raw);
const b=topBox(raw,'colr'),kind=Buffer.from(raw.slice(b.off+b.hdr,b.off+b.hdr+4)).toString('ascii');
assert.equal(kind,'nclx');
const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
const primaries=v.getUint16(b.off+b.hdr+4),transfer=v.getUint16(b.off+b.hdr+6),matrix=v.getUint16(b.off+b.hdr+8),fullRange=Boolean(raw[b.off+b.hdr+10]&128);
assert.equal(primaries,12);assert.equal(transfer,16);assert.equal(matrix,0);assert.equal(fullRange,true);
let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
meta=replaceItemPropertyWithSource(meta,tmap,'colr',nclx(primaries,8,matrix,fullRange));
const output=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),meta,new Map()),d=discoverHeic(output);
assert.equal(d.primary,a.primary);assert.deepEqual(d.refs,a.refs);assert.equal(d.infos.size,a.infos.size);
const read=(bytes,g,id)=>g.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,g.meta):extractItem(bytes,g.iloc,id);
for(const id of a.infos.keys())assert.deepEqual(read(output,d,id),read(base,a,id),'item payload '+id);
const after=propertyBoxBytes(output,d.props,tmap,'colr'),ab=topBox(after,'colr'),av=new DataView(after.buffer,after.byteOffset,after.byteLength);
assert.equal(av.getUint16(ab.off+ab.hdr+4),12);assert.equal(av.getUint16(ab.off+ab.hdr+6),8);assert.equal(av.getUint16(ab.off+ab.hdr+8),0);assert.ok(after[ab.off+ab.hdr+10]&128);
const checked=await executeJob({operation:'read',file:new Blob([output])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outputFile,output,{flag:'wx'});
console.log(JSON.stringify({file:path.resolve(outputFile),bytes:output.length,sha256:crypto.createHash('sha256').update(output).digest('hex'),base:path.basename(baseFile),primary:d.primary,tmap,changeOnly:'tmap colr transfer 16(PQ) -> 8(linear)',allItemPayloadsExact:true,allReferencesExact:true,deviceValidation:'pending'},null,2));