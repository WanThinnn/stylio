import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {topBox,metaChildren,findChild,boxes} from '../web/src/core/box.js';
import {discoverHeic,propertyBoxBytes} from '../web/src/core/heif.js';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
const u=(d,p,n)=>{let v=0;for(let i=0;i<n;i++)v=v*256+d[p+i];return v;};
function infeFlags(data,meta){
  const iinf=findChild(metaChildren(data,meta),'iinf');
  const version=data[iinf.off+iinf.hdr],countSize=version===0?2:4;
  const out=new Map();
  for(const e of boxes(data,iinf.off+iinf.hdr+4+countSize,iinf.off+iinf.size)){
    if(e.type!=='infe')continue;
    let p=e.off+e.hdr;
    const iv=data[p],flags=u(data,p+1,3);p+=4;
    const iidSize=iv===2?2:4;
    if(iv!==2&&iv!==3)continue;
    const iid=u(data,p,iidSize);p+=iidSize+2;
    const type=String.fromCharCode(...data.slice(p,p+4));
    out.set(iid,{type,flags,hidden:Boolean(flags&1),bytes:e.size,hash:hash(data.slice(e.off,e.off+e.size))});
  }
  return out;
}
function altGroups(data,meta){
  const grpl=metaChildren(data,meta).find(x=>x.type==='grpl');
  if(!grpl)return [];
  const out=[];
  for(const b of boxes(data,grpl.off+grpl.hdr,grpl.off+grpl.size)){
    const p=b.off+b.hdr,version=data[p],flags=u(data,p+1,3);
    if(b.type!=='altr')continue;
    let q=p+4; const groupId=u(data,q,4);q+=4;const count=u(data,q,4);q+=4;
    const ids=[];for(let i=0;i<count;i++){ids.push(u(data,q,4));q+=4;}
    out.push({groupId,version,flags,ids,bytes:b.size,hash:hash(data.slice(b.off,b.off+b.size))});
  }
  return out;
}
const files=process.argv.slice(2);
for(const file of files){
  const data=new Uint8Array(await fs.readFile(file)),d=discoverHeic(data),meta=topBox(data,'meta');
  const flags=infeFlags(data,meta),tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
  const ids=[...new Set([d.primary,d.hdrGrid,tmap,d.stylesItem,d.linearThumb,d.deltaGrid,d.thumbnail,d.exifItem].filter(x=>x!=null))];
  const items={};
  for(const id of ids){
    const assoc=(d.props.associations.get(id)||[]).map(a=>({index:a.index,essential:a.essential,type:d.props.properties[a.index-1]?.type,hash:d.props.properties[a.index-1]?hash(data.slice(d.props.properties[a.index-1].box.off,d.props.properties[a.index-1].box.off+d.props.properties[a.index-1].box.size)):null}));
    items[id]={info:flags.get(id)||null,assoc,refsFrom:d.refs.filter(r=>r.from===id),refsTo:d.refs.filter(r=>r.to.includes(id)).map(r=>({type:r.type,from:r.from,to:r.to}))};
    for(const typ of ['colr','pixi','ispe','auxC','irot']){const raw=propertyBoxBytes(data,d.props,id,typ);if(raw)items[id][typ]={bytes:raw.length,hash:hash(raw)};}
  }
  const metaChildrenSummary=metaChildren(data,meta).map(b=>({type:b.type,bytes:b.size,hash:hash(data.slice(b.off,b.off+b.size))}));
  console.log(JSON.stringify({file:file.split(/[\\/]/).pop(),bytes:data.length,primary:d.primary,hdrGrid:d.hdrGrid,tmap,items,altr:altGroups(data,meta),metaChildren:metaChildrenSummary},null,2));
}