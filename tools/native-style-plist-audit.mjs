import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {parseBplist} from '../web/src/core/bplist.js';

const files=process.argv.slice(2);
const read=(bytes,d,id)=>{
  const it=d.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
};
function plain(v,depth=0){
  if(depth>8)return '[depth]';
  if(v instanceof Map)return Object.fromEntries([...v.entries()].map(([k,x])=>[String(k),plain(x,depth+1)]));
  if(Array.isArray(v))return v.map(x=>plain(x,depth+1));
  if(v instanceof Uint8Array)return {__bytes:v.length,__hex:[...v.slice(0,32)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  if(v&&typeof v==='object'){
    if('value' in v&&Object.keys(v).length<=2)return Number(v.value);
    const out={};for(const [k,x] of Object.entries(v))out[k]=plain(x,depth+1);return out;
  }
  return v;
}
for(const file of files){
  const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
  if(d.stylesItem==null){console.log(JSON.stringify({file:path.basename(file),styles:null},null,2));continue;}
  const obj=plain(parseBplist(read(bytes,d,d.stylesItem),{preserveReals:true}));
  console.log(JSON.stringify({file:path.basename(file),stylesItem:d.stylesItem,styles:obj},null,2));
}
