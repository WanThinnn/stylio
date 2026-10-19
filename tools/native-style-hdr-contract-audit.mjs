import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {editableTmapHeadroom} from '../web/src/styles/hdr-compatibility.js';

const files=process.argv.slice(2);
if(!files.length) throw Error('Usage: node tools/native-style-hdr-contract-audit.mjs <file.heic> [...]');

const readItem=(bytes,d,id)=>{
  if(id==null)return null;
  const item=d.iloc.items.get(id);
  if(!item)return null;
  return item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
};

function parseTmap(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==62)return null;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let p=6;
  const rational=(signed=false)=>{
    const n=signed?v.getInt32(p):v.getUint32(p);
    const den=v.getUint32(p+4);p+=8;
    return den?n/den:null;
  };
  return {
    version:bytes[0],flags:bytes[5],
    base:rational(),alternate:rational(),min:rational(true),max:rational(true),
    gamma:rational(),baseOffset:rational(true),alternateOffset:rational(true),
  };
}

function xmpHeadrooms(bytes,d,hdr){
  const out=[];
  for(const r of d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(hdr))){
    const info=d.infos.get(r.from);
    if(info?.type!=='mime')continue;
    const payload=readItem(bytes,d,r.from);
    const text=new TextDecoder().decode(payload);
    const m=text.match(/HDRGainMapHeadroom>([^<]+)</);
    const version=text.match(/HDRGainMapVersion>([^<]+)</);
    out.push({item:r.from,contentType:info.contentType||null,headroom:m?Number(m[1]):null,version:version?Number(version[1]):null,text});
  }
  return out;
}

for(const file of files){
  const bytes=new Uint8Array(await fs.readFile(file));
  const d=discoverHeic(bytes);
  const tmap=[...d.infos].find(([,info])=>info.type==='tmap')?.[0]??null;
  const tmapBytes=tmap==null?null:readItem(bytes,d,tmap);
  const hdr=d.hdrGrid;
  const result={
    file:path.basename(file),
    bytes:bytes.length,
    primary:d.primary,
    hdrGrid:hdr,
    tmap,
    parsedTmap:parseTmap(tmapBytes),
    editableHeadroom:editableTmapHeadroom(bytes,d),
    hdrAuxRole:hdr==null?null:(()=>{
      for(const a of d.props.associations.get(hdr)||[]){
        const p=d.props.properties[a.index-1];
        if(p?.type==='auxC') return p.auxUri||null;
      }
      return null;
    })(),
    hdrAuxl:d.refs.filter(r=>r.type==='auxl'&&r.from===hdr).map(r=>r.to),
    hdrDescriptions:hdr==null?[]:xmpHeadrooms(bytes,d,hdr),
    alternateGroups:d.refs.filter(()=>false),
  };
  console.log(JSON.stringify(result,null,2));
}
