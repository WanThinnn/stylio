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
 throw Error('missing '+sig);
}
function parseMab(b){
 const type=String.fromCharCode(...b.slice(0,4));
 const input=b[8],output=b[9];
 const B=be32(b,12),matrix=be32(b,16),M=be32(b,20),clut=be32(b,24),A=be32(b,28);
 const c=clut?{
   offset:clut,
   grid:Array.from(b.slice(clut,clut+16)),
   precision:b[clut+16],
   reserved:Array.from(b.slice(clut+17,clut+20)),
 }:null;
 return {type,input,output,offsets:{B,matrix,M,clut,A},clut:c};
}
for(const file of process.argv.slice(2)){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 const a=tag(b,d,tmap,'A2B0'),m=parseMab(a);
 const grid=m.clut?.grid.slice(0,m.input)??[],entries=grid.reduce((x,y)=>x*y,1);
 console.log(JSON.stringify({file:path.basename(file),bytes:a.length,...m,
  clutEntries:entries,clutPayloadBytes:entries*m.output*(m.clut?.precision??0),
  clutRegionBytes:m.offsets.matrix-m.offsets.clut}));
}
