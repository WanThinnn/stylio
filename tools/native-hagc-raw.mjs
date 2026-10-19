import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
for(const file of process.argv.slice(2)){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
 const tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0],colr=propertyBoxBytes(bytes,d.props,tmap,'colr'),bb=topBox(colr,'colr');
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),count=be32(icc,128);
 for(let i=0;i<count;i++){
  const p=132+i*12,sig=String.fromCharCode(...icc.slice(p,p+4));if(sig!=='HAGC')continue;
  const off=be32(icc,p+4),size=be32(icc,p+8),tag=icc.slice(off,off+size);
  console.log(JSON.stringify({file:path.basename(file),size,hex:Buffer.from(tag).toString('hex'),lenField:be32(tag,8),tail:Buffer.from(tag.slice(12+be32(tag,8))).toString('hex')}));
 }
}
