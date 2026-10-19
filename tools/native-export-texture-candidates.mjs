import fs from 'node:fs/promises';
import path from 'node:path';
import {executeJob} from '../web/src/media/heic-worker.js';
import {nativeStyleExportTextureCandidate} from '../web/src/styles/style-preservation.js';
import {writeZip} from '../web/src/core/zip.js';
const [output,...inputs]=process.argv.slice(2);
if(!output||!inputs.length)throw Error('Usage: node tools/native-export-texture-candidates.mjs <output-directory> <source.heic> [...]');
await fs.mkdir(output,{recursive:true});
const files=new Map();
for(const input of inputs){
 const source=new Uint8Array(await fs.readFile(input));
 if(!nativeStyleExportTextureCandidate(source))throw Error('Not a supported native Style export: '+path.basename(input));
 const {data}=await executeJob({operation:'texture',data:source,opts:{preserveStyles:true,allowMissingStyles:true}});
 const name=path.basename(input).replace(/\.heic$/i,'_TextureOnly.HEIC');
 await fs.writeFile(path.join(output,name),data);files.set(name,data);
 console.log(JSON.stringify({input:path.basename(input),output:name,sourceBytes:source.length,outputBytes:data.length}));
}
await fs.writeFile(path.join(output,'TextureOnly-candidates.zip'),writeZip(files));
