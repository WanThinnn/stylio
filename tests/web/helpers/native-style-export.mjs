import fs from 'node:fs';
import {loadProfile} from '../../../web/src/core/zip.js';
import {be,box,concat,topBox} from '../../../web/src/core/box.js';
import {discoverHeic,idatItemBytes} from '../../../web/src/core/heif.js';
import {removeItems,addItems,setItemPropertyAssociations,setItemReference} from '../../../web/src/raster/heif.js';
import {buildBplist,BplistReal} from '../../../web/src/core/bplist.js';
import {injectAppleMakerNoteTag} from '../../../web/src/core/exif.js';
import {encodeTmapMetadata} from '../../../web/src/raster/jpeg-hdr.js';

const profile=loadProfile(new Uint8Array(fs.readFileSync(new URL('../../../web/profiles/48-12.zip',import.meta.url))));
function exif(model,marker){
  const name=new TextEncoder().encode(model+'\0');
  const maker=concat([new TextEncoder().encode('Apple iOS'),new Uint8Array(3),new TextEncoder().encode('MM'),be(0,2),new Uint8Array(4)]);
  const tiff=concat([new TextEncoder().encode('MM'),be(42,2),be(8,4),be(2,2),
    be(0x110,2),be(2,2),be(name.length,4),be(76,4),
    be(0x8769,2),be(4,2),be(1,4),be(38,4),new Uint8Array(4),
    be(1,2),be(0x927c,2),be(7,2),be(maker.length,4),be(56,4),new Uint8Array(4),maker,name]);
  return injectAppleMakerNoteTag(concat([be(6,4),new TextEncoder().encode('Exif\0\0'),tiff]),buildBplist(marker),0x54,7);
}

// A graph fixture, with synthetic picture samples and no personal EXIF or pixels.
export async function nativeStyleExport({model='iPhone 16 Pro',preset=1,tone=0,color=0,palette=1,modernMarker=false,iso=true,retainLinearThumb=false}={}){
  const p=await profile,d=discoverHeic(p.meta);
  const keep=new Set([d.primary,...d.primaryTiles,d.hdrGrid,...d.hdrTiles,d.thumbnail,d.exifItem,
    ...(retainLinearThumb&&d.linearThumb!==null?[d.linearThumb]:[])]);
  let meta=removeItems(p.meta,[...d.infos.keys()].filter(id=>!keep.has(id)));
  const graph=discoverHeic(meta);
  const hdrProps=graph.props.associations.get(graph.hdrGrid).filter(a=>graph.props.properties[a.index-1].type!=='auxC').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,graph.hdrGrid,hdrProps);
  meta=setItemReference(meta,'auxl',graph.hdrGrid,[]);
  const marker=new Map([['0',1],['1',new BplistReal(tone)],['2',new BplistReal(color)],['3',new BplistReal(palette)],['4',preset],['5',modernMarker?1:0]]);
  if(modernMarker){marker.set('6',4);marker.set('7',0);}
  const payloads=new Map([[graph.exifItem,exif(model,marker)]]);
  if(iso){
    let ids;[meta,ids]=addItems(meta,[{key:'iso',itemType:'tmap',refType:'dimg',refTo:[graph.primary,graph.hdrGrid]}]);
    payloads.set(ids.get('iso'),encodeTmapMetadata({baseHeadroom:0,alternateHeadroom:2,useBaseColorSpace:false,channels:[{min:0,max:2,gamma:1,baseOffset:.005,alternateOffset:.005}]}));
  }
  const final=discoverHeic(meta),chunks=[];let cursor=p.ftyp.length+meta.length+8;
  for(const [id,item] of final.iloc.items){
    if(item.constructionMethod===1)continue;
    const info=final.infos.get(id);
    const value=payloads.get(id)||(info.type==='grid'?p.retained.get(id)||idatItemBytes(p.meta,id,d.meta):Uint8Array.of(0,0,0,4,38,1,id&255,0));
    if(!value)throw Error('Missing synthetic item '+id);
    meta.set(be(cursor,4),item.extents[0].offsetPos);meta.set(be(value.length,4),item.extents[0].lengthPos);
    chunks.push(value);cursor+=value.length;
  }
  return concat([p.ftyp,meta,box('mdat',concat(chunks))]);
}
