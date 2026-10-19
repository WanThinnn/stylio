import fs from 'node:fs/promises';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';
const [pPath,qPath]=process.argv.slice(2);
const P=new Uint8Array(await fs.readFile(pPath)),Q=new Uint8Array(await fs.readFile(qPath));
const p=discoverHeic(P),q=discoverHeic(Q),same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
for(const type of ['ispe','pixi','hvcC','colr']){
 const target=propertyBoxBytes(Q,q.props,q.linearThumb,type);
 const matches=[];
 for(const prop of p.props.properties){
   const box=P.subarray(prop.box.off,prop.box.off+prop.box.size);
   if(same(target,box))matches.push({index:prop.index,type:prop.type});
 }
 console.log(type,matches);
}