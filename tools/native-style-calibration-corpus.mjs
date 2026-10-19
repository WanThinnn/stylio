import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {parseBplist} from '../web/src/core/bplist.js';

const files=process.argv.slice(2);
const read=(bytes,d,id)=>{
  const it=d.iloc.items.get(id);
  return it.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
};
function tmap(bytes){
  if(!bytes||bytes.length!==62)return null;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);let p=6;
  const q=(signed=false)=>{const n=signed?v.getInt32(p):v.getUint32(p),den=v.getUint32(p+4);p+=8;return den?n/den:null;};
  return {base:q(),alternate:q(),min:q(true),max:q(true),gamma:q(),baseOffset:q(true),alternateOffset:q(true)};
}
function mapObj(v){return v instanceof Map?Object.fromEntries(v):null;}
const rows=[];
for(const file of files){
  const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
  if(d.stylesItem==null)continue;
  const pl=parseBplist(read(bytes,d,d.stylesItem),{preserveReals:true});
  const six=pl.get('6');
  const tone=six instanceof Map?mapObj(six.get('ToneMappedImage')):null;
  const linear=six instanceof Map?mapObj(six.get('LinearImage')):null;
  const irange=mapObj(pl.get('i'));
  const tid=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
  const tm=tid===undefined?null:tmap(read(bytes,d,tid));
  rows.push({
    file:path.basename(file),schema:pl.get('0'),tone,linear,range:irange,h:pl.get('h'),
    tmap:tm,headroom:tm?2**tm.alternate:null,
  });
}
console.log(JSON.stringify(rows,null,2));
