// Recreate diagnostic L from the exact Bright+Texture control and the same-capture
// Photos-saved Standard current marker. This keeps every non-Exif Bright+Texture
// payload/property/reference exact and changes only MakerNote 0x54.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag} from '../web/src/core/exif.js';
import {parseBplist,buildBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';

const [output,brightTextureFile,standardCurrentFile]=process.argv.slice(2);
if(!output||!brightTextureFile||!standardCurrentFile)
  throw Error('Usage: node tools/native-style-build-l-from-controls.mjs <output.heic> <bright+texture.heic> <standard-current.heic>');

const [bright,standard]=await Promise.all(
  [brightTextureFile,standardCurrentFile].map(async f=>new Uint8Array(await fs.readFile(f)))
);
const b=discoverHeic(bright),s=discoverHeic(standard);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tag=(bytes,d,id)=>extractAppleMakerNoteTag(read(bytes,d,d.exifItem),id);

assert.deepEqual(tag(bright,b,0x2b),tag(standard,s,0x2b),'same capture UUID required');
assert.notEqual(b.stylesItem,null,'Bright control must retain native Styles graph');

const original=parseBplist(tag(bright,b,0x54).payload,{preserveReals:true});
const current=parseBplist(tag(standard,s,0x54).payload,{preserveReals:true});
assert.equal(original.get('4'),16,'expected original Bright');
assert.equal(current.get('4'),1,'expected current Standard');
assert.equal(original.get('5'),1,'expected modern original marker');
assert.equal(original.get('6'),4,'expected modern marker key 6');
assert.equal(original.get('7'),0,'expected modern marker key 7');

for(const key of ['0','1','2','3','4'])original.set(key,current.get(key));
const marker=buildBplist(original);
const exif=injectAppleMakerNoteTag(
  read(bright,b,b.exifItem),marker,0x54,tag(bright,b,0x54).type
);
const data=rebuildHeic(
  bright,b,
  bright.slice(0,topBox(bright,'ftyp').size),
  bright.slice(b.meta.off,b.meta.off+b.meta.size),
  new Map([[b.exifItem,exif]])
);
const d=discoverHeic(data);
for(const id of b.iloc.items.keys())if(id!==b.exifItem)
  assert.deepEqual(read(data,d,id),read(bright,b,id),'unchanged Bright+Texture payload '+id);
assert.deepEqual(d.refs,b.refs,'all Bright+Texture references exact');
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,data);
console.log(JSON.stringify({file:path.basename(output),bytes:data.length,preset:1,base:'exact Bright+Texture',productionRepair:false},null,2));
