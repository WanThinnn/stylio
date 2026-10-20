// JPEG RGB HDR only: port of the device-accepted rebased scalar export.
// Native HEIC processing does not import/call this module.
import {box,be,concat,topBox,boxes} from './box.js';
import {discoverHeic,extractItemData,propertyBoxBytes,dimensionsForItem,replaceItemPropertyWithSource,
 internIpcoProperty,addItems,setItemReference,setItemPropertyAssociations,replaceIdatItem,parseIloc} from './heif.js';
import {encodeTmapMetadata,parseTmapMetadata,yuv420Tile} from './jpeg-hdr.js';
import {decodeHevcYuv,convertHdrPixels,encodeHevcPixels,releaseHevcEncoder} from './ffmpeg-hevc.js';
import {p3ToLinearI420P10} from './linear-thumbnail.js';
import {rebaseRgbHdrPair,linearGrayColr} from './hdr-scalar-pair.js';
import {rebuildHeic} from '../styles/graft.js';
const defaultMedia={decodeHevcYuv,convertHdrPixels,encodeHevcPixels,releaseHevcEncoder};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

// Only fresh raster exports use this layout. Keep EVERY item, including inactive
// HDR graphs, and discard only mdat bytes outside the union of all iloc extents.
// No codecs, graph pruning, property changes or idat edits belong in this step.
export function compactRgbHdrMdat(source){
 const top=[...boxes(source,0,source.length)];
 if(top.length<3||top[0].type!=='ftyp'||top[1].type!=='meta'
  ||top.slice(2).some(b=>b.type!=='mdat')||top.at(-1).off+top.at(-1).size!==source.length)
  throw Error('Unexpected fresh HDR container layout');
 const meta=source.slice(top[1].off,top[1].off+top[1].size),iloc=parseIloc(meta,topBox(meta,'meta'));
 if(iloc.version!==1||iloc.offsetSize!==4||iloc.lengthSize!==4||iloc.baseOffsetSize!==0||iloc.indexSize!==0)
  throw Error('Unsupported fresh HDR item locations');
 const media=top.slice(2),extents=[];
 for(const it of iloc.items.values()){
  if(![0,1].includes(it.constructionMethod))throw Error('Unsupported fresh HDR item construction');
  if(it.constructionMethod===1)continue; // idat stays byte-identical inside meta.
  for(const e of it.extents){
   // Generated files use local data references and explicit, non-empty extents.
   if(!e.length||meta[it.extents[0].offsetPos-4]||meta[it.extents[0].offsetPos-3]
    ||!media.some(b=>e.offset>=b.off+b.hdr&&e.offset+e.length<=b.off+b.size))
    throw Error('Fresh HDR extent is not local mdat data');
   extents.push(e);
  }
 }
 extents.sort((a,b)=>a.offset-b.offset);
 const ranges=[];
 for(const e of extents){
  const last=ranges.at(-1),end=e.offset+e.length;
  if(last&&e.offset<=last.end)last.end=Math.max(last.end,end);
  else ranges.push({start:e.offset,end});
 }
 const payloadStart=top[0].size+meta.length+8;
 let cursor=payloadStart;
 for(const r of ranges){r.output=cursor;cursor+=r.end-r.start;}
 if(cursor>=2**32)throw Error('Compact HDR exceeds 32-bit item offsets');
 let n=0;
 for(const e of extents){
  while(ranges[n].end<=e.offset)n++;
  const r=ranges[n];meta.set(be(r.output+e.offset-r.start,4),e.offsetPos);
 }
 const out=new Uint8Array(cursor);
 out.set(source.subarray(0,top[0].size));out.set(meta,top[0].size);
 out.set(be(cursor-payloadStart+8,4),payloadStart-8);out.set(Uint8Array.of(109,100,97,116),payloadStart-4);
 for(const r of ranges)out.set(source.subarray(r.start,r.end),r.output);
 return out;
}

export async function makeRgbHdrEditable(source,{headroom,primaries},onProgress,media=defaultMedia){
 let phase='read';try{
 const d=discoverHeic(source),tmap=[...d.infos].find(([,i])=>i.type==='tmap')?.[0];
 if(tmap===undefined||d.hdrGrid===null||!d.thumbnail||!d.linearThumb)throw Error('RGB HDR export resources missing');
 const [width,height]=dimensionsForItem(d.props,d.primary),[gainWidth,gainHeight]=dimensionsForItem(d.props,d.hdrGrid);
 const inputs=d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to;
 const oldMetadata=parseTmapMetadata(extractItemData(source,d,tmap));
 if(inputs?.[1]===d.hdrGrid&&gainWidth===width&&gainHeight===height&&oldMetadata.channels.length===1
  &&oldMetadata.channels[0].min===0&&oldMetadata.channels[0].gamma===1&&oldMetadata.channels[0].baseOffset===0
  &&oldMetadata.channels[0].alternateOffset===0)return {data:source,metrics:{alreadyScalar:true}};
 const side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(d.hdrGrid)&&d.infos.get(r.from)?.type==='mime');
 if(!side||!Number.isFinite(headroom)||headroom<=1||headroom>32)throw Error('RGB HDR headroom missing');
 const xml=new TextDecoder().decode(extractItemData(source,d,side.from));
 const declared=Number(/<HDRGainMap:HDRGainMapHeadroom>([^<]+)/.exec(xml)?.[1]);
 if(!Number.isFinite(declared)||Math.abs(declared-headroom)>1e-7)throw Error('RGB HDR headroom declarations disagree');
 // Use the file's published precision, as the accepted prototype does. Rounding
 // at ceil() boundaries must not depend on a more precise, unwritten JS value.
 headroom=declared;
 const prop=(id,type)=>propertyBoxBytes(source,d.props,id,type);
 async function readGrid(id){
  const [w,h]=dimensionsForItem(d.props,id),tiles=d.refs.find(r=>r.type==='dimg'&&r.from===id)?.to;
  if(!tiles?.length)throw Error('RGB HDR grid missing');
  const [tw,th]=dimensionsForItem(d.props,tiles[0]),cols=extractItemData(source,d,id)[3]+1,frame=new Uint8Array(w*h*1.5);
  for(let n=0;n<tiles.length;n++){
   const hv=prop(tiles[n],'hvcC'),tile=await media.decodeHevcYuv(hv.slice(topBox(hv,'hvcC').hdr),extractItemData(source,d,tiles[n]),{width:tw,height:th},onProgress);
   let from=0,to=0;
   for(let p=0;p<3;p++){
    const k=p?2:1,W=w/k,H=h/k,TW=tw/k,TH=th/k,x=n%cols*TW,y=Math.floor(n/cols)*TH;
    for(let j=0;j<Math.min(TH,H-y);j++)frame.set(tile.subarray(from+j*TW,from+j*TW+Math.max(0,Math.min(TW,W-x))),to+(y+j)*W+x);
    from+=TW*TH;to+=W*H;
   }
   onProgress?.({stage:'auxiliary',done:n+1,total:tiles.length});
  }
  return media.convertHdrPixels(frame,{width:w,height:h,from:'yuv420p',to:'rgb24'},onProgress);
 }
 // The first import has already run dozens of x265 jobs. Free its codec heap
 // before decoding/rebuilding another full-size pair; keep encoded bytes in JS.
 media.releaseHevcEncoder?.();
 phase='decode base';const base=await readGrid(d.primary);
 phase='decode gain';const gain=await readGrid(d.hdrGrid);
 phase='solve pair';
 const solved=await rebaseRgbHdrPair(base,gain,{width,height,gainWidth,gainHeight,headroom,primaries},onProgress);
 phase='convert rebased base';
 const baseYuv=await media.convertHdrPixels(solved.base,{width,height,from:'rgb24',to:'yuv420p'},onProgress);
 const grayYuv=new Uint8Array(width*height*1.5);grayYuv.set(solved.gain);grayYuv.fill(128,width*height);
 let meta=source.slice(d.meta.off,d.meta.off+d.meta.size);const payloads=new Map(),encodedGain=[];
 const cols=Math.ceil(width/512),rows=Math.ceil(height/512),colour={primaries,transfer:'iec61966-2-1',matrix:'smpte170m',fullRange:true};
 if(cols*rows!==d.primaryTiles.length)throw Error('RGB HDR primary geometry mismatch');
 // Bound the codec heap after full-frame conversions and during the longer
 // paired encode. x265's retained heap otherwise fails near tile 41 at 12 MP.
 media.releaseHevcEncoder?.();
 for(let n=0;n<d.primaryTiles.length;n++){
  if(n&&n%12===0)media.releaseHevcEncoder?.();
  phase='encode pair tile '+n;
  const tile=(frame)=>yuv420Tile(frame,width,height,n%cols,Math.floor(n/cols));
  const b=await media.encodeHevcPixels(tile(baseYuv),{width:512,height:512,pixelFormat:'yuv420p',...colour},onProgress);
  meta=replaceItemPropertyWithSource(meta,d.primaryTiles[n],'hvcC',b.hvcc);payloads.set(d.primaryTiles[n],b.payload);
  const g=await media.encodeHevcPixels(tile(grayYuv),{width:512,height:512,pixelFormat:'yuv420p',
   primaries:'unspecified',transfer:'linear',matrix:'smpte170m',fullRange:true},onProgress);
  if(encodedGain.length&&!same(g.hvcc,encodedGain[0].hvcc))throw Error('Scalar HDR gain configurations disagree');
  encodedGain.push(g);onProgress?.({stage:'main',done:n+1,total:d.primaryTiles.length});
 }
 media.releaseHevcEncoder?.();
 for(const [id,isLinear]of [[d.thumbnail,false],[d.linearThumb,true]]){
  phase=isLinear?'linear thumbnail':'thumbnail';
  const [w,h]=dimensionsForItem(d.props,id);
  let rgba=await media.convertHdrPixels(solved.base,{width,height,from:'rgb24',to:'rgba',outWidth:w,outHeight:h},onProgress);
  if(isLinear&&primaries==='bt709'){
   // Small colour-managed conversion only; numeric gain data never enters canvas.
   const c=document.createElement('canvas');c.width=w;c.height=h;
   const ctx=c.getContext('2d',{colorSpace:'display-p3'});
   if(!ctx||ctx.getContextAttributes?.().colorSpace!=='display-p3')throw Error('HDR thumbnail requires P3');
   ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h,{colorSpace:'srgb'}),0,0);
   rgba=new Uint8Array(ctx.getImageData(0,0,w,h,{colorSpace:'display-p3'}).data);c.width=c.height=0;
  }
  let samples;
  if(isLinear)samples=p3ToLinearI420P10(rgba,w,h);
  else{
   const rgb=new Uint8Array(w*h*3);for(let p=0,i=0;p<rgba.length;p+=4){rgb[i++]=rgba[p];rgb[i++]=rgba[p+1];rgb[i++]=rgba[p+2];}
   samples=await media.convertHdrPixels(rgb,{width:w,height:h,from:'rgb24',to:'yuv420p'},onProgress);
  }
  const encoded=await media.encodeHevcPixels(samples,{width:w,height:h,...(isLinear?
   {pixelFormat:'yuv420p10le',primaries:'smpte432',transfer:'linear',matrix:'bt709',fullRange:false}:
   {pixelFormat:'yuv420p',...colour})},onProgress);
  payloads.set(id,encoded.payload);meta=replaceItemPropertyWithSource(meta,id,'hvcC',encoded.hvcc);
  if(!isLinear)meta=replaceItemPropertyWithSource(meta,id,'colr',prop(d.primary,'colr'));
 }
 const sharedBoxes=[prop(d.primaryTiles[0],'ispe'),encodedGain[0].hvcc,prop(d.hdrGrid,'pixi'),linearGrayColr(),
  prop(d.primary,'ispe'),prop(d.hdrGrid,'auxC')];
 const indices=[];for(const b of sharedBoxes){let index;[meta,index]=internIpcoProperty(meta,b);indices.push(index);}
 const [ispe,hv,pixi,colr,fullIspe,auxc]=indices;
 const specs=encodedGain.map((_,n)=>({key:'scalar-gain-'+n,itemType:'hvc1',reuse:[[ispe,false],[hv,true],[pixi,true],[colr,true]]}));
 specs.push({key:'scalar-grid',itemType:'grid',refType:'auxl',refTo:[d.primary],reuse:[[fullIspe,false],[pixi,true],[colr,true],[auxc,true]]});
 let ids;[meta,ids]=addItems(meta,specs);const newGrid=ids.get('scalar-grid');
 const tileIds=encodedGain.map((g,n)=>{const id=ids.get('scalar-gain-'+n);payloads.set(id,g.payload);return id;});
 payloads.set(newGrid,concat([Uint8Array.of(0,0,rows-1,cols-1),be(width,2),be(height,2)]));
 meta=setItemReference(meta,'dimg',newGrid,tileIds);
 meta=setItemPropertyAssociations(meta,d.hdrGrid,(d.props.associations.get(d.hdrGrid)||[])
  .filter(a=>d.props.properties[a.index-1].type!=='auxC').map(a=>[a.index,a.essential]));
 meta=setItemReference(meta,'auxl',d.hdrGrid,[]);meta=setItemReference(meta,'cdsc',side.from,[newGrid]);
 meta=setItemReference(meta,'dimg',tmap,[d.primary,newGrid]);
 const metadata=encodeTmapMetadata(solved.metadata);
 if(d.iloc.items.get(tmap)?.constructionMethod===1)meta=replaceIdatItem(meta,tmap,metadata);
 else payloads.set(tmap,metadata);
 phase='pack referenced data';
 const data=compactRgbHdrMdat(rebuildHeic(source,d,source.slice(0,topBox(source,'ftyp').size),meta,payloads));
 return {data,metrics:solved.metrics};
 }catch(error){throw new Error(`Editable HDR (${phase}): ${error.message}`,{cause:error});}
}
