import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,auxUriForItem} from '../web/src/core/heif.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';

const hash=b=>b?crypto.createHash('sha256').update(b).digest('hex').slice(0,16):null;
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const boxInfo=(b,d,id,type)=>{
 const raw=propertyBoxBytes(b,d.props,id,type); if(!raw)return null;
 if(type==='colr'){
   const bb=topBox(raw,'colr'),kind=String.fromCharCode(...raw.slice(bb.off+bb.hdr,bb.off+bb.hdr+4));
   return {kind,bytes:raw.length,hash:hash(raw),text:Buffer.from(raw).toString('latin1').includes('Linear Gray')?'Linear Gray':null};
 }
 return {bytes:raw.length,hash:hash(raw)};
};
for(const file of process.argv.slice(2)){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b),ft=topBox(b,'ftyp');
 const hdr=d.hdrGrid,tmap=[...d.infos].find(([,x])=>x.type==='tmap')?.[0]??null,first=d.hdrTiles[0];
 const hvcc=propertyBoxBytes(b,d.props,first,'hvcC');
 const rec=hvcc?(()=>{const bb=topBox(hvcc,'hvcC');return hvcc.slice(bb.off+bb.hdr,bb.off+bb.size);})():null;
 console.log(JSON.stringify({
  file:path.basename(file),brands:Buffer.from(b.slice(ft.off+8,ft.off+ft.size)).toString('latin1'),
  primary:d.primary,
  hdr:{grid:hdr,dims:dimensionsForItem(d.props,hdr),aux:auxUriForItem(d.props,hdr),
    ispe:boxInfo(b,d,hdr,'ispe'),pixi:boxInfo(b,d,hdr,'pixi'),colr:boxInfo(b,d,hdr,'colr'),irot:boxInfo(b,d,hdr,'irot'),
    tileCount:d.hdrTiles.length,firstTile:first,firstTileDims:dimensionsForItem(d.props,first),
    tilePixi:boxInfo(b,d,first,'pixi'),tileColr:boxInfo(b,d,first,'colr'),
    tileHvcc:rec?{hash:hash(rec),sps:hevcSpsColor(rec)}:null,
    refs:d.refs.filter(r=>r.from===hdr||r.to.includes(hdr))
  },
  tmap:tmap==null?null:{id:tmap,hash:hash(read(b,d,tmap)),ispe:boxInfo(b,d,tmap,'ispe'),pixi:boxInfo(b,d,tmap,'pixi'),colr:boxInfo(b,d,tmap,'colr'),
    refs:d.refs.filter(r=>r.from===tmap||r.to.includes(tmap))}
 },null,2));
}
