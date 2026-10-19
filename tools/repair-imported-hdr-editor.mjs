// Device-validation adapter for HDR-primary Adobe/ISO imports. Does not enable
// this experimental contract in ordinary image processing or re-encode pixels.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerTmapHdr} from '../web/src/styles/hdr-compatibility.js';
import {discoverHeic,extractItemData,auxUriForItem,URI_HDR_GAIN} from '../web/src/raster/heif.js';
import {parseTmapMetadata} from '../web/src/raster/jpeg-hdr.js';

const [input,output,...flags]=process.argv.slice(2);
if(!input||!output||flags.some(x=>x!=='--headroom'))
 throw Error('Usage: node tools/repair-imported-hdr-editor.mjs <HDR-primary.heic> <new-output.heic> [--headroom]');
assert.notEqual(path.resolve(input).toLowerCase(),path.resolve(output).toLowerCase());
const source=new Uint8Array(await fs.readFile(input)),before=discoverHeic(source);
const headroom=flags.includes('--headroom');
const data=registerTmapHdr(source,{importedIso:true,headroom});
if(!data)throw Error('No change: unsupported HDR-primary import, or declaration already present');
const after=discoverHeic(data),inputs=before.refs.find(r=>r.type==='dimg'&&r.from===before.primary).to;
assert.equal(after.primary,before.primary);
assert.deepEqual(after.refs.find(r=>r.type==='dimg'&&r.from===after.primary).to,inputs);
assert.equal(after.hdrGrid,inputs[1]);
assert.equal(auxUriForItem(after.props,after.hdrGrid),URI_HDR_GAIN);
for(const id of before.infos.keys())
 assert.deepEqual(extractItemData(data,after,id),extractItemData(source,before,id),'source item '+id);
for(const ref of before.refs){
 if(ref.type==='auxl'&&ref.from===inputs[1])continue;
 assert.ok(after.refs.some(r=>r.type===ref.type&&r.from===ref.from&&JSON.stringify(r.to)===JSON.stringify(ref.to)));
}
assert.equal(registerTmapHdr(data,{importedIso:true,headroom}),null,'idempotent adapter');
const metadata=parseTmapMetadata(extractItemData(data,after,after.primary));
await fs.writeFile(output,data,{flag:'wx'});
console.log(JSON.stringify({file:path.resolve(output),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),
 primary:after.primary,base:inputs[0],gain:inputs[1],sourceHeadroom:2**metadata.alternateHeadroom,headroomAdded:headroom,
 allSourcePayloadsExact:true,deviceEditAndSaveHdr:'pending',productionEnabled:false},null,2));
