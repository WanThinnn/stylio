import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {box,topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [vFile,outFile]=process.argv.slice(2);
if(!vFile||!outFile)throw Error('Usage: node tools/indigo-v-historical-brand-candidate.mjs <V.heic> <W.heic>');
assert.notEqual(path.resolve(vFile).toLowerCase(),path.resolve(outFile).toLowerCase());
const V=new Uint8Array(await fs.readFile(vFile)),v=discoverHeic(V);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

const ft=topBox(V,'ftyp'),body=V.slice(ft.off+ft.hdr,ft.off+ft.size);
assert.ok(body.length>=8&&((body.length-8)%4===0),'invalid ftyp');
const text=new TextEncoder(),major=new TextDecoder().decode(body.slice(0,4)),minor=body.slice(4,8),brands=[];
for(let p=8;p<body.length;p+=4)brands.push(new TextDecoder().decode(body.slice(p,p+4)));
assert.ok(brands.includes('tmap'),'V must advertise tmap before historical-brand test');
const kept=brands.filter(b=>b!=='tmap');
const parts=[text.encode(major),minor,...kept.map(b=>text.encode(b))];
let total=0;for(const part of parts)total+=part.length;
const payload=new Uint8Array(total);let at=0;for(const part of parts){payload.set(part,at);at+=part.length;}
const ftyp=box('ftyp',payload);
const meta=V.slice(v.meta.off,v.meta.off+v.meta.size);
const out=rebuildHeic(V,v,ftyp,meta,new Map()),d=discoverHeic(out);
assert.equal(d.primary,v.primary);assert.equal(d.hdrGrid,v.hdrGrid);assert.deepEqual(d.refs,v.refs);
for(const [id]of v.infos)assert.deepEqual(read(out,d,id),read(V,v,id),'payload changed '+id);
for(const id of v.infos.keys())assert.deepEqual(d.props.associations.get(id)||[],v.props.associations.get(id)||[],'props changed '+id);
const checked=await executeJob({operation:'read',file:new Blob([out])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({
 file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(vFile),
 majorBrand:major,brandsBefore:brands,brandsAfter:kept,
 allPayloadsExact:true,allRefsExact:true,allPropertiesExact:true,
 purpose:'match historical IDG compatible brands',deviceValidation:'pending'
},null,2));