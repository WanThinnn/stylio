// Observed v7 Portrait REND capacity vector. This is a metadata consistency
// correction, not a tone mapper or a claim of measured Photos render parity.
import {extractItemData} from '../raster/heif.js';
import {parseTmapMetadata} from '../raster/jpeg-hdr.js';

export function portraitSourceHeadroom(bytes,d){
  if(d.hdrGrid===null||d.hdrGrid===undefined)return 1; // explicit SDR, no borrowed HDR capacity
  const values=[];
  for(const r of d.refs)if(r.type==='cdsc'&&r.to.includes(d.hdrGrid)&&d.infos.get(r.from)?.type==='mime'){
    const xmp=new TextDecoder().decode(extractItemData(bytes,d,r.from));
    for(const m of xmp.matchAll(/<(?:\w+:)?HDRGainMapHeadroom>([^<]+)<\//g))values.push(Number(m[1]));
  }
  if(values.length){
    const h=values[0];
    if(!Number.isFinite(h)||h<1||h>2**16||values.some(v=>!Number.isFinite(v)||Math.abs(v-h)>1e-6))
      throw Error('Ambiguous source Portrait HDR capacity');
    return h;
  }
  // Capacity is independent of gain-map min/gamma/offsets. The strict legacy
  // gain-equation converter is deliberately not used for this read-only query.
  const maps=[...d.infos].filter(([id,i])=>i.type==='tmap'&&d.refs.some(r=>r.type==='dimg'
    &&r.from===id&&r.to.length===2&&r.to[0]===d.primary&&r.to[1]===d.hdrGrid));
  if(maps.length!==1)return null;
  const m=parseTmapMetadata(extractItemData(bytes,d,maps[0][0]));
  return m.baseHeadroom===0&&m.alternateHeadroom>=0&&m.alternateHeadroom<=16?2**m.alternateHeadroom:null;
}

export function matchPortraitHdrCapacity(xmp,headroom){
  if(headroom===null)return xmp;
  if(!Number.isFinite(headroom)||headroom<1||headroom>2**16)throw Error('Invalid Portrait HDR capacity');
  return xmp.replace(/(<depthBlurEffect:RenderingParameters>)([^<]+)(<\/depthBlurEffect:RenderingParameters>)/,(_,open,encoded,close)=>{
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),v=new DataView(bytes.buffer),slots=new Map();
    if(bytes.length<16||String.fromCharCode(...bytes.slice(0,4))!=='REND'||v.getUint32(4,true)!==7
      ||v.getUint32(8,true)!==bytes.length||v.getUint32(12,true)!==1||(bytes.length-16)%8)
      throw Error('Unsupported Portrait HDR renderer');
    for(let p=16;p<bytes.length;p+=8){
      const id=v.getUint16(p,true);if(slots.has(id))throw Error('Duplicate Portrait renderer field');slots.set(id,p);
    }
    for(const id of [450,451,452,453]){
      const p=slots.get(id);
      if(p===undefined||v.getUint16(p+2,true)!==1||!Number.isFinite(v.getFloat32(p+4,true))||v.getFloat32(p+4,true)<=0)
        throw Error('Unsupported Portrait HDR capacity vector');
    }
    const original=v.getFloat32(slots.get(453)+4,true),ratio=headroom/original;
    if(Math.fround(headroom)===original)return open+encoded+close;
    // Keep the original optical/blur scaling. Change only the observed HDR
    // vector, all of which scales with capacity in the native v7 control.
    for(const id of [450,451,452]){const p=slots.get(id)+4;v.setFloat32(p,v.getFloat32(p,true)*ratio,true);}
    v.setFloat32(slots.get(453)+4,headroom,true);
    return open+btoa(String.fromCharCode(...bytes))+close;
  });
}
