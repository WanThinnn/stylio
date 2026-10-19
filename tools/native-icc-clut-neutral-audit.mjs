import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseHagcIccTag} from '../web/src/raster/hagc.js';

const be16=(b,o)=>(b[o]<<8)|b[o+1];
const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
function iccAndTag(bytes,d,tmap,sig){
 const colr=propertyBoxBytes(bytes,d.props,tmap,'colr'),bb=topBox(colr,'colr');
 const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),n=be32(icc,128);
 for(let i=0;i<n;i++){const p=132+i*12;if(String.fromCharCode(...icc.slice(p,p+4))!==sig)continue;
  const o=be32(icc,p+4),s=be32(icc,p+8);return {icc,tag:icc.slice(o,o+s)};}
 throw Error('missing '+sig);
}
for(const file of process.argv.slice(2)){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 const a2b=iccAndTag(bytes,d,tmap,'A2B0').tag,hagc=parseHagcIccTag(iccAndTag(bytes,d,tmap,'HAGC').tag).metadata;
 const clut=be32(a2b,24),grid=a2b[clut],data=clut+20;
 const at=(r,g,b)=>{
   // ICC CLUT ordering: last input channel varies fastest.
   const idx=((r*grid+g)*grid+b)*3;
   return [0,1,2].map(c=>be16(a2b,data+(idx+c)*2)/65535);
 };
 const neutral=[];
 for(let i=0;i<grid;i++)neutral.push({node:i,x:i/(grid-1),out:at(i,i,i)});
 console.log(JSON.stringify({
   file:path.basename(file),grid,
   hagc:{
     baseline:hagc.adaptiveToneMap.baselineHdrHeadroom,
     alternate:hagc.adaptiveToneMap.alternates[0]?.alternateHdrHeadroom,
     points:hagc.adaptiveToneMap.alternates[0]?.gainCurve.controlPoints,
   },
   neutral
 },null,2));
}
