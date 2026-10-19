import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {topBox} from '../web/src/core/box.js';
import {
  discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,auxUriForItem
} from '../web/src/core/heif.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';

const files=process.argv.slice(2);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hex=b=>b?Buffer.from(b).toString('hex'):null;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
const hvcc=id=>(bytes,d)=>{
  const p=propertyBoxBytes(bytes,d.props,id,'hvcC'); if(!p)return null;
  const box=topBox(p,'hvcC'); return p.slice(box.off+box.hdr,box.off+box.size);
};
for(const file of files){
  const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b),ft=topBox(b,'ftyp');
  const hdr=d.hdrGrid;
  const tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0]??null;
  const props=id=>(d.props.associations.get(id)||[]).map(a=>{
    const p=d.props.properties[a.index-1];
    return {index:a.index,essential:a.essential,type:p?.type,bytes:p?hex(b.slice(p.box.off,p.box.off+p.box.size)):null,auxUri:p?.auxUri||null};
  });
  const tiles=d.hdrTiles.map(id=>{
    const rec=hvcc(id)(b,d);
    return {id,dims:dimensionsForItem(d.props,id),props:props(id).map(x=>({type:x.type,essential:x.essential,auxUri:x.auxUri,bytes:x.type==='hvcC'?undefined:x.bytes})),
      hvcc:rec?{hash:hash(rec),sps:hevcSpsColor(rec)}:null};
  });
  console.log(JSON.stringify({
    file:path.basename(file),bytes:b.length,
    brands:Buffer.from(b.slice(ft.off+8,ft.off+ft.size)).toString('latin1'),
    primary:d.primary,hdrGrid:hdr,hdrGridDims:hdr==null?null:dimensionsForItem(d.props,hdr),
    hdrGridAuxUri:hdr==null?null:auxUriForItem(d.props,hdr),
    hdrGridProps:hdr==null?[]:props(hdr),
    hdrTiles:tiles,
    hdrRefs:hdr==null?[]:d.refs.filter(r=>r.from===hdr||r.to.includes(hdr)),
    tmap,tmapProps:tmap==null?[]:props(tmap),
    tmapRefs:tmap==null?[]:d.refs.filter(r=>r.from===tmap||r.to.includes(tmap)),
    tmapHash:tmap==null?null:hash(read(b,d,tmap)),
  },null,2));
}
