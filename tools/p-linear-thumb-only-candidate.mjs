import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes} from '../web/src/core/heif.js';
import {replaceItemPropertyWithSource as repointItemPropertyFromSource} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';

const [pPath,qPath,outPath]=process.argv.slice(2);
if(!pPath||!qPath||!outPath)throw Error('usage: node tools/p-linear-thumb-only-candidate.mjs <P> <Q> <R>');
const P=new Uint8Array(await fs.readFile(pPath)),Q=new Uint8Array(await fs.readFile(qPath));
const dp=discoverHeic(P),dq=discoverHeic(Q);
if(dp.linearThumb==null||dq.linearThumb==null)throw Error('missing linearThumb');
const pLt=dp.linearThumb,qLt=dq.linearThumb;
let meta=P.slice(dp.meta.off,dp.meta.off+dp.meta.size);
for(const type of ['ispe','pixi','hvcC','colr']){
  const source=propertyBoxBytes(Q,dq.props,qLt,type);
  if(!source)throw Error('Q linearThumb missing '+type);
  meta=repointItemPropertyFromSource(meta,pLt,type,source);
}
const itemBytes=(data,d,id)=>{
  const it=d.iloc.items.get(id);
  if(!it)throw Error('missing iloc '+id);
  if(it.constructionMethod===0)return extractItem(data,d.iloc,id);
  if(it.constructionMethod===1){
    const bytes=idatItemBytes(data,id,d.meta);
    if(!bytes)throw Error('unsupported idat item '+id);
    return bytes;
  }
  throw Error('unsupported construction method '+it.constructionMethod+' for '+id);
};
const payload=itemBytes(Q,dq,qLt);
const ftyp=P.slice(0,topBox(P,'ftyp').size);
const R=rebuildHeic(P,dp,ftyp,meta,new Map([[pLt,payload]]));
const dr=discoverHeic(R);
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const changed=[];
for(const [id] of dp.infos){
  if(!dr.infos.has(id))throw Error('item disappeared '+id);
  const a=itemBytes(P,dp,id),b=itemBytes(R,dr,id);
  if(!same(a,b))changed.push(id);
}
if(changed.length!==1||changed[0]!==pLt)throw Error('unexpected payload changes '+JSON.stringify(changed));
const refs=x=>JSON.stringify(x.refs.map(r=>({type:r.type,from:r.from,to:r.to})));
if(refs(dp)!==refs(dr))throw Error('graph references changed');
for(const id of dp.infos.keys()){
  if(id===pLt)continue;
  for(const type of ['ispe','pixi','hvcC','colr','auxC']){
    const a=propertyBoxBytes(P,dp.props,id,type),b=propertyBoxBytes(R,dr.props,id,type);
    if(Boolean(a)!==Boolean(b)||(a&&!same(a,b)))throw Error('non-linear property changed '+id+' '+type);
  }
}
await fs.writeFile(outPath,R);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
console.log(JSON.stringify({
  bytes:R.length,sha256:sha(R),linearThumb:pLt,sourceLinearThumb:qLt,
  changedPayloadItems:changed,
  pSha256:sha(P),qSha256:sha(Q),
  refsExact:true,nonLinearPropertiesExact:true
},null,2));
