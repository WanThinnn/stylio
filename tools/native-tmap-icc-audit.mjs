import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
for(const file of process.argv.slice(2)){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
 const tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 const colr=propertyBoxBytes(bytes,d.props,tmap,'colr');
 if(!colr){console.log(JSON.stringify({file:path.basename(file),profile:null}));continue;}
 const bb=topBox(colr,'colr'),kind=String.fromCharCode(...colr.slice(bb.off+bb.hdr,bb.off+bb.hdr+4));
 if(kind!=='prof'){console.log(JSON.stringify({file:path.basename(file),kind}));continue;}
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),count=be32(icc,128),tags=[];
 for(let i=0;i<count;i++){
  const p=132+i*12,sig=String.fromCharCode(...icc.slice(p,p+4)),off=be32(icc,p+4),size=be32(icc,p+8),data=icc.slice(off,off+size);
  tags.push({sig,off,size,hash:hash(data),hex:Buffer.from(data.slice(0,Math.min(size,128))).toString('hex')});
 }
 console.log(JSON.stringify({file:path.basename(file),iccBytes:icc.length,iccHash:hash(icc),tags},null,2));
}
