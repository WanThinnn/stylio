#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath=resolve(root,'web/vendor/ai-portrait/foreground-assets.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const [name,asset]=Object.entries(manifest.files)[0];
const destination=resolve(root,'web/vendor/ai-portrait',name);
const response=await fetch(asset.url,{redirect:'follow'});
if(!response.ok)throw Error(`Foreground matte model download failed: HTTP ${response.status}`);
const bytes=new Uint8Array(await response.arrayBuffer());
if(bytes.length!==asset.bytes)throw Error(`Foreground matte model size mismatch: ${bytes.length} != ${asset.bytes}`);
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==asset.sha256)throw Error(`Foreground matte model SHA-256 mismatch: ${hash}`);
await mkdir(dirname(destination),{recursive:true});
await writeFile(destination,bytes);
console.log(`Verified ${name}: ${bytes.length} bytes, sha256 ${hash}`);
console.log(`Saved to ${destination}`);
