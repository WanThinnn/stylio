import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const be16=(b,o)=>(b[o]<<8)|b[o+1];
const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
function tag(bytes,d,tmap,sig){
 const colr=propertyBoxBytes(bytes,d.props,tmap,'colr'),bb=topBox(colr,'colr');
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),n=be32(icc,128);
 for(let i=0;i<n;i++){const p=132+i*12;if(String.fromCharCode(...icc.slice(p,p+4))!==sig)continue;
  const o=be32(icc,p+4),s=be32(icc,p+8);return icc.slice(o,o+s);}
 throw Error('missing '+sig);
}
function curveAt(curve,x){
 const count=be32(curve,8);if(!count)return x;
 const pos=Math.max(0,Math.min(1,x))*(count-1),i=Math.floor(pos),t=pos-i;
 const a=be16(curve,12+i*2)/65535,b=be16(curve,12+Math.min(count-1,i+1)*2)/65535;
 return a+(b-a)*t;
}
for(const file of process.argv.slice(2)){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 const a2b=tag(bytes,d,tmap,'A2B0'),A=be32(a2b,28),clut=be32(a2b,24);
 const curves=[];let p=A;
 for(let c=0;c<3;c++){
   const type=String.fromCharCode(...a2b.slice(p,p+4));if(type!=='curv')throw Error('A curve not curv');
   const count=be32(a2b,p+8),size=12+count*2,aligned=(size+3)&~3;
   curves.push(a2b.slice(p,p+size));p+=aligned;
 }
 const nodes=[];
 for(let i=0;i<13;i++){const x=i/12;nodes.push({x,a:curves.map(c=>curveAt(c,x))});}
 const matrixBytes=a2b.slice(be32(a2b,16));
 console.log(JSON.stringify({file:path.basename(file),A,clut,ARegionBytes:clut-A,
   curveCounts:curves.map(c=>be32(c,8)),curvesIdentical:Buffer.from(curves[0]).equals(Buffer.from(curves[1]))&&Buffer.from(curves[0]).equals(Buffer.from(curves[2])),
   nodes,matrixHex:Buffer.from(matrixBytes).toString('hex')},null,2));
}
