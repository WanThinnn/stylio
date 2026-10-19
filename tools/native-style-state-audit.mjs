// Diagnostic inventory for native Photographic Styles/current-rendition experiments.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {boxes,metaChildren,topBox,u} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,listAppleMakerNoteTags} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';

const files=process.argv.slice(2);
if(!files.length) throw Error('Usage: node tools/native-style-state-audit.mjs <file.heic> [...]');

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16);
const read=(bytes,d,id)=>{
  if(id===null||id===undefined)return null;
  const item=d.iloc.items.get(id);
  if(!item)return null;
  return item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
};
const itemSummary=(bytes,d,id)=>{
  if(id===null||id===undefined)return null;
  const info=d.infos.get(id),payload=read(bytes,d,id);
  const properties=(d.props.associations.get(id)||[]).map(a=>{
    const p=d.props.properties[a.index-1],raw=bytes.slice(p.box.off,p.box.off+p.box.size);
    return {index:a.index,essential:a.essential,type:p.type,hash:hash(raw),bytes:raw.length};
  });
  return {id,type:info?.type||null,name:info?.name||null,uri:auxUriForItem(d.props,id)||null,
    payloadBytes:payload?.length??0,payloadHash:payload?hash(payload):null,properties};
};
function alternateGroups(bytes,d){
  const meta=topBox(bytes,'meta');
  const out=[];
  for(const child of metaChildren(bytes,meta)){
    if(child.type!=='grpl')continue;
    for(const group of boxes(bytes,child.off+child.hdr,child.off+child.size)){
      if(group.type!=='altr')continue;
      const at=group.off+group.hdr;
      const groupId=u(bytes,at+4,4),count=u(bytes,at+8,4),ids=[];
      for(let i=0;i<count;i++)ids.push(u(bytes,at+12+i*4,4));
      out.push({groupId,ids});
    }
  }
  return out;
}
function marker(bytes,d){
  try{
    const exif=read(bytes,d,d.exifItem),tag=extractAppleMakerNoteTag(exif,0x54),parsed=parseBplist(tag.payload);
    return {type:tag.type,keys:parsed instanceof Map?[...parsed.entries()]:null,payloadHash:hash(tag.payload)};
  }catch(error){return {error:String(error.message||error)};}
}
function makerNotes(bytes,d){
  try{
    const exif=read(bytes,d,d.exifItem);
    return listAppleMakerNoteTags(exif).map(x=>({tag:'0x'+x.tag.toString(16),type:x.type,bytes:x.payload.length,hash:hash(x.payload)}));
  }catch(error){return [{error:String(error.message||error)}];}
}

for(const file of files){
  const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
  const tmaps=[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);
  const refsOf=id=>id==null?[]:d.refs.filter(r=>r.from===id||r.to.includes(id));
  const summary={
    file:path.basename(file),bytes:bytes.length,items:d.infos.size,primary:d.primary,hdrGrid:d.hdrGrid,
    stylesItem:d.stylesItem,linearThumb:d.linearThumb,deltaGrid:d.deltaGrid,thumbnail:d.thumbnail,exifItem:d.exifItem,
    marker:marker(bytes,d),alternateGroups:alternateGroups(bytes,d),
    primaryItem:itemSummary(bytes,d,d.primary),hdrItem:itemSummary(bytes,d,d.hdrGrid),
    tmapItems:tmaps.map(id=>itemSummary(bytes,d,id)),
    primaryRefs:refsOf(d.primary),hdrRefs:refsOf(d.hdrGrid),tmapRefs:tmaps.flatMap(refsOf),
    makerNotes:makerNotes(bytes,d),
  };
  console.log(JSON.stringify(summary,null,2));
}
