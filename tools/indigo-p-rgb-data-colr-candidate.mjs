// Candidate X: keep device-proven P viewer byte-exact and change only the
// separate Apple RGB auxiliary's container colour declaration from P3/sRGB
// image signalling (12/13/6) to data-like signalling matching its HEVC SPS
// (2/2/6). No image/gain payload, graph, tmap, headroom, Styles or codec bytes change.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,auxUriForItem,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {replaceItemPropertyWithSource} from '../web/src/raster/heif.js';
import {nclx} from '../web/src/raster/generated-profile.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [pFile,outFile]=process.argv.slice(2);
if(!pFile||!outFile)throw Error('Usage: node tools/indigo-p-rgb-data-colr-candidate.mjs <P.heic> <X.heic>');
assert.notEqual(path.resolve(pFile).toLowerCase(),path.resolve(outFile).toLowerCase());
const P=new Uint8Array(await fs.readFile(pFile)),p=discoverHeic(P),apple=p.hdrGrid,tiles=p.hdrTiles||[];
assert.equal(auxUriForItem(p.props,apple),URI_HDR_GAIN);assert.ok(tiles.length);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const parseNclx=raw=>{const b=topBox(raw,'colr'),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);return {primaries:v.getUint16(b.off+b.hdr+4),transfer:v.getUint16(b.off+b.hdr+6),matrix:v.getUint16(b.off+b.hdr+8),fullRange:Boolean(raw[b.off+b.hdr+10]&128)};};
const before=parseNclx(propertyBoxBytes(P,p.props,apple,'colr'));
assert.deepEqual(before,{primaries:12,transfer:13,matrix:6,fullRange:true});
for(const id of tiles){
  const hv=propertyBoxBytes(P,p.props,id,'hvcC'),b=topBox(hv,'hvcC'),s=hevcSpsColor(hv.slice(b.off+b.hdr,b.off+b.size));
  assert.equal(s.primaries,2);assert.equal(s.transfer,2);assert.equal(s.matrix,6);assert.equal(s.fullRange,true);
}
const dataColr=nclx(2,2,6,true);
let meta=P.slice(p.meta.off,p.meta.off+p.meta.size);
meta=replaceItemPropertyWithSource(meta,apple,'colr',dataColr);
for(const id of tiles)meta=replaceItemPropertyWithSource(meta,id,'colr',dataColr);
const out=rebuildHeic(P,p,P.slice(0,topBox(P,'ftyp').size),meta,new Map()),d=discoverHeic(out);
assert.deepEqual(d.refs,p.refs);assert.equal(d.primary,p.primary);assert.equal(d.hdrGrid,apple);
for(const id of p.infos.keys())assert.deepEqual(read(out,d,id),read(P,p,id),'payload '+id);
for(const id of p.infos.keys()){
  for(const type of ['ispe','pixi','hvcC','auxC','irot']){
    const a=propertyBoxBytes(P,p.props,id,type),b=propertyBoxBytes(out,d.props,id,type);
    if(Boolean(a)!==Boolean(b)||(a&&!same(a,b)))throw Error('unexpected property change '+id+' '+type);
  }
  if(id!==apple&&!tiles.includes(id)){
    const a=propertyBoxBytes(P,p.props,id,'colr'),b=propertyBoxBytes(out,d.props,id,'colr');
    if(Boolean(a)!==Boolean(b)||(a&&!same(a,b)))throw Error('non-Apple colr changed '+id);
  }
}
assert.deepEqual(parseNclx(propertyBoxBytes(out,d.props,apple,'colr')),{primaries:2,transfer:2,matrix:6,fullRange:true});
for(const id of tiles)assert.deepEqual(parseNclx(propertyBoxBytes(out,d.props,id,'colr')),{primaries:2,transfer:2,matrix:6,fullRange:true});
const checked=await executeJob({operation:'read',file:new Blob([out])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(pFile),primary:d.primary,appleAux:apple,appleTiles:tiles.length,
  change:'Apple RGB aux colr only: nclx 12/13/6 -> 2/2/6 full-range; payloads/refs/hvcC exact',before,after:parseNclx(propertyBoxBytes(out,d.props,apple,'colr')),
  allPayloadsExact:true,refsExact:true,hvccExact:true,viewerPExact:true,deviceValidation:'pending'},null,2));