import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const be16=(b,o)=>(b[o]<<8)|b[o+1];
const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
const s15=(b,o)=>new DataView(b.buffer,b.byteOffset+o,4).getInt32(0)/65536;
function tag(bytes,d,tmap,sig){
 const colr=propertyBoxBytes(bytes,d.props,tmap,'colr'),bb=topBox(colr,'colr');
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),n=be32(icc,128);
 for(let i=0;i<n;i++){const p=132+i*12;if(String.fromCharCode(...icc.slice(p,p+4))!==sig)continue;
  const o=be32(icc,p+4),s=be32(icc,p+8);return icc.slice(o,o+s);}
 throw Error('missing '+sig);
}
function curvesAt(a2b,off,countChannels,x){
 const result=[];let p=off;
 for(let c=0;c<countChannels;c++){
  if(String.fromCharCode(...a2b.slice(p,p+4))!=='curv')throw Error('unsupported curve');
  const count=be32(a2b,p+8),pos=Math.max(0,Math.min(1,x))*(count-1),i=Math.floor(pos),t=pos-i;
  const v0=be16(a2b,p+12+i*2)/65535,v1=be16(a2b,p+12+Math.min(count-1,i+1)*2)/65535;
  result.push(v0+(v1-v0)*t);
  p+=(12+count*2+3)&~3;
 }
 return result;
}
function clutAt(a2b,off,input){
 const grid=a2b[off],data=off+20;
 const pos=input.map(x=>Math.max(0,Math.min(1,x))*(grid-1));
 const lo=pos.map(Math.floor),hi=lo.map((x,i)=>Math.min(grid-1,x+1)),t=pos.map((x,i)=>x-lo[i]);
 const at=(r,g,b,c)=>be16(a2b,data+((((r*grid+g)*grid+b)*3+c)*2))/65535;
 const out=[0,0,0];
 for(let dr=0;dr<2;dr++)for(let dg=0;dg<2;dg++)for(let db=0;db<2;db++){
  const r=dr?hi[0]:lo[0],g=dg?hi[1]:lo[1],b=db?hi[2]:lo[2];
  const w=(dr?t[0]:1-t[0])*(dg?t[1]:1-t[1])*(db?t[2]:1-t[2]);
  for(let c=0;c<3;c++)out[c]+=w*at(r,g,b,c);
 }
 return out;
}
function matrixAt(a2b,off,v){
 const m=Array.from({length:12},(_,i)=>s15(a2b,off+i*4));
 return [
  m[0]*v[0]+m[1]*v[1]+m[2]*v[2]+m[9],
  m[3]*v[0]+m[4]*v[1]+m[5]*v[2]+m[10],
  m[6]*v[0]+m[7]*v[1]+m[8]*v[2]+m[11],
 ];
}
const m1=2610/16384,m2=2523/32,c1=3424/4096,c2=2413/128,c3=2392/128;
const pq=e=>{const n=e**(1/m2);return Math.max((n-c1)/(c2-c3*n),0)**(1/m1);};
for(const file of process.argv.slice(2)){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 const a2b=tag(bytes,d,tmap,'A2B0'),A=be32(a2b,28),clut=be32(a2b,24),matrix=be32(a2b,16);
 const samples=[];
 for(const e of [0,.0833333333,.1666666667,.25,.3333333333,.4166666667,.5,.5833333333,.6666666667,.75,.8333333333,.9166666667,1]){
  const av=curvesAt(a2b,A,3,e),cv=clutAt(a2b,clut,av),xyz=matrixAt(a2b,matrix,cv);
  const relative=10000*pq(e)/203;
  samples.push({e,a:av[0],clut:cv[0],Y:xyz[1],pqRelative:relative,ratio:relative?xyz[1]/relative:null});
 }
 console.log(JSON.stringify({file:path.basename(file),samples},null,2));
}
