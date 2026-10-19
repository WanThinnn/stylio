import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
function tag(bytes,d,tmap,sig){
 const colr=propertyBoxBytes(bytes,d.props,tmap,'colr'),bb=topBox(colr,'colr');
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),n=be32(icc,128);
 for(let i=0;i<n;i++){const p=132+i*12;if(String.fromCharCode(...icc.slice(p,p+4))!==sig)continue;
  const o=be32(icc,p+4),s=be32(icc,p+8);return icc.slice(o,o+s);}
 return null;
}
const files=process.argv.slice(2),records=[];
for(const file of files){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 records.push({file:path.basename(file),a2b:tag(b,d,tmap,'A2B0'),b2a:tag(b,d,tmap,'B2A0')});
}
const base=records[0];
for(const r of records.slice(1)){
 for(const key of ['a2b','b2a']){
  const a=base[key],b=r[key],n=Math.min(a.length,b.length),diff=[];
  for(let i=0;i<n;i++)if(a[i]!==b[i])diff.push(i);
  const ranges=[];for(const x of diff){const last=ranges.at(-1);if(last&&x===last[1]+1)last[1]=x;else ranges.push([x,x]);}
  console.log(JSON.stringify({base:base.file,other:r.file,tag:key.toUpperCase(),aBytes:a.length,bBytes:b.length,
    diffBytes:diff.length,diffFraction:diff.length/Math.max(a.length,b.length),ranges:ranges.slice(0,40)}));
 }
}
