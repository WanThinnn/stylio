// JPEG MPF extraction and Apple Adaptive HDR -> ISO 21496-1 tmap metadata.
// No donor headroom, gamma, offsets or channel ranges are substituted.
import {box,concat,be} from './box.js';

const text=new TextDecoder(), enc=new TextEncoder();
const HDR_NS='http://ns.adobe.com/hdr-gain-map/1.0/';
export function hdrJpegError(message) {return Object.assign(new Error(message),{code:'err.hdrjpeg'});}
const fail=message=>{throw hdrJpegError(message);};
const starts=(data,value)=>data.length>=value.length&&value.every((v,i)=>data[i]===v);
const MPF=enc.encode('MPF\0'),ICC=enc.encode('ICC_PROFILE\0'),XMP=enc.encode('http://ns.adobe.com/xap/1.0/\0');

function jpegHeader(bytes,start=0,end=bytes.length) {
 if(start<0||end>bytes.length||start+4>end||bytes[start]!==255||bytes[start+1]!==216)fail('Invalid MPF JPEG start');
 const segments=[];let width,height,components,precision,p=start+2;
 while(p+2<=end){
  if(bytes[p++]!==255)fail('Invalid JPEG marker');
  while(bytes[p]===255)p++;
  const marker=bytes[p++];if(marker===218||marker===217)break;
  if(marker===1||marker>=208&&marker<=215)continue;
  if(p+2>end)fail('Truncated JPEG segment');
  const length=bytes[p]*256+bytes[p+1];
  if(length<2||p+length>end)fail('Truncated JPEG segment');
  const data=bytes.subarray(p+2,p+length);
  segments.push({marker,data,offset:p+2});
  if([192,193,194].includes(marker)){
   if(data.length<6)fail('Truncated JPEG dimensions');
   [precision,height,width,components]=[data[0],data[1]*256+data[2],data[3]*256+data[4],data[5]];
  }
  p+=length;
 }
 return {segments,width,height,components,precision};
}
function iccProfile(header) {
 const parts=header.segments.filter(s=>s.marker===226&&starts(s.data,ICC));
 if(!parts.length)return null;
 const count=parts[0].data[13];
 if(!count||parts.length!==count)fail('Incomplete JPEG ICC profile');
 const ordered=new Array(count);
 for(const {data} of parts){const i=data[12]-1;if(i<0||i>=count||ordered[i]||data[13]!==count)fail('Invalid JPEG ICC sequence');ordered[i]=data.subarray(14);}
 const profile=concat(ordered);
 if(profile.length<132||new DataView(profile.buffer,profile.byteOffset,profile.byteLength).getUint32(0)!==profile.length
   ||text.decode(profile.subarray(36,40))!=='acsp')fail('Invalid JPEG ICC profile');
 return profile;
}
function iccName(profile){
 if(!profile)return '';
 const view=new DataView(profile.buffer,profile.byteOffset,profile.byteLength),n=view.getUint32(128);
 if(132+n*12>profile.length)fail('Truncated ICC tag table');
 for(let i=0;i<n;i++){
  const p=132+i*12,o=view.getUint32(p+4),size=view.getUint32(p+8);
  if(o+size>profile.length)fail('Truncated ICC tag');
  if(text.decode(profile.subarray(p,p+4))!=='desc')continue;
  const type=text.decode(profile.subarray(o,o+4));
  if(type==='desc'){
   if(size<12)fail('Invalid ICC description');
   const length=view.getUint32(o+8);
   if(!length||12+length>size)fail('Invalid ICC description');
   return text.decode(profile.subarray(o+12,o+12+length)).replace(/\0.*$/s,'');
  }
  if(type==='mluc'){
   if(size<28)fail('Invalid ICC description');
   const length=view.getUint32(o+20),offset=view.getUint32(o+24);
   if(offset+length>size)fail('Invalid ICC description');
   return new TextDecoder('utf-16be').decode(profile.subarray(o+offset,o+offset+length));
  }
 }
 return '';
}
function mpfImages(segment,bytes) {
 const t=segment.data.subarray(4),v=new DataView(t.buffer,t.byteOffset,t.byteLength);
 if(t.length<8)fail('Truncated MPF TIFF');
 const order=text.decode(t.subarray(0,2)),little=order==='II';
 if(!['II','MM'].includes(order)||v.getUint16(2,little)!==42)fail('Invalid MPF TIFF');
 const at=(p,n)=>{if(p<0||p+n>t.length)fail('MPF offset out of range');return p;};
 const ifd=v.getUint32(4,little),count=v.getUint16(at(ifd,2),little);
 let number,entries;
 for(let i=0;i<count;i++){
  const p=at(ifd+2+i*12,12),tag=v.getUint16(p,little),type=v.getUint16(p+2,little),n=v.getUint32(p+4,little);
  if(tag===0xb001){if(type!==4||n!==1)fail('Invalid MPF image count');number=v.getUint32(p+8,little);}
  if(tag===0xb002){if(type!==7||n%16)fail('Invalid MPF entry table');entries={offset:v.getUint32(p+8,little),length:n};}
 }
 if(!number||number>16||!entries||entries.length!==number*16)fail('Invalid MPF image table');
 at(entries.offset,entries.length);
 const images=[];
 for(let i=0;i<number;i++){
  const p=entries.offset+i*16,length=v.getUint32(p+4,little),relative=v.getUint32(p+8,little);
  const start=relative===0?0:segment.offset+4+relative,end=start+length;
  if(length<4||end>bytes.length||bytes[end-2]!==255||bytes[end-1]!==217)fail('Truncated MPF image');
  if(images.some(image=>start<image.end&&end>image.start))fail('Overlapping MPF images');
  images.push({start,end,bytes:bytes.subarray(start,end),...jpegHeader(bytes,start,end)});
 }
 if(images[0].start!==0)fail('MPF primary image missing');
 return images;
}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function parseAdaptiveHdrXmp(xml) {
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('Unsupported HDR XMP declarations');
 const declarations=[...xml.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']([^"']+)["']/g)];
 const prefix=declarations.find(([, ,uri])=>uri===HDR_NS)?.[1];
 if(!prefix)fail('Unsupported JPEG HDR metadata');
 if(!xml.includes(prefix+':ChannelMetadata'))return parseAdobeHdrXmp(xml,prefix,declarations);
 const name=escape(prefix);
 const number=(field,source=xml)=>{
  const value=new RegExp(`<${name}:${field}\\b[^>]*>\\s*([-+0-9.eE]+)\\s*</${name}:${field}\\s*>`).exec(source)?.[1]
   ??new RegExp(`\\b${name}:${field}\\s*=\\s*["']([-+0-9.eE]+)["']`).exec(source)?.[1];
  if(value===undefined||!Number.isFinite(Number(value)))fail('Missing HDR '+field);
  return Number(value);
 };
 if(number('Version')!==1||number('BaseRenditionIsHDR')!==0)fail('Unsupported HDR base rendition/version');
 const baseHeadroom=number('BaseHeadroom'),alternateHeadroom=number('AlternateHeadroom');
 if(baseHeadroom<0||alternateHeadroom<=baseHeadroom||alternateHeadroom>32)fail('Invalid HDR headroom');
 const channelBlock=new RegExp(`<${name}:ChannelMetadata\\b[^>]*>([\\s\\S]*?)</${name}:ChannelMetadata\\s*>`).exec(xml)?.[1];
 if(channelBlock===undefined)fail('Invalid HDR channel metadata');
 const rdf=escape(declarations.find(([, ,uri])=>uri==='http://www.w3.org/1999/02/22-rdf-syntax-ns#')?.[1]||'rdf');
 const channels=[...channelBlock.matchAll(new RegExp(`<${rdf}:li\\b[^>]*>([\\s\\S]*?)</${rdf}:li\\s*>`,'g'))].map(([,part])=>{
  const min=number('GainMapMin',part),max=number('GainMapMax',part),gamma=number('Gamma',part),baseOffset=number('OffsetSDR',part),alternateOffset=number('OffsetHDR',part);
  if(min>max||Math.abs(min)>32||Math.abs(max)>32||gamma<=0||gamma>32||baseOffset<0||alternateOffset<0||baseOffset>16||alternateOffset>16)fail('Invalid HDR channel');
  return {min,max,gamma,baseOffset,alternateOffset};
 });
 if(![1,3].includes(channels.length))fail('Unsupported HDR channel count');
 return {baseHeadroom,alternateHeadroom,channels,useBaseColorSpace:true};
}

// Adobe/Ultra HDR v1: per-channel RDF arrays or scalar attributes. Capacity,
// min/max and gamma have the same logarithmic/encoding conventions as tmap.
// https://developer.android.com/media/platform/hdr-image-format#hdr-gain-map-metadata
function parseAdobeHdrXmp(xml,prefix,declarations){
 const name=escape(prefix),rdf=escape(declarations.find(([, ,uri])=>uri==='http://www.w3.org/1999/02/22-rdf-syntax-ns#')?.[1]||'rdf');
 const value=field=>new RegExp(`\\b${name}:${field}\\s*=\\s*["']([^"']*)["']`).exec(xml)?.[1]
  ??new RegExp(`<${name}:${field}\\b[^>]*>([\\s\\S]*?)</${name}:${field}\\s*>`).exec(xml)?.[1];
 if(value('Version')?.trim()!=='1.0')fail('Unsupported Adobe HDR version');
 if(!['false','0'].includes((value('BaseRenditionIsHDR')??'False').trim().toLowerCase()))fail('Unsupported HDR base rendition');
 const numbers=(field,fallback)=>{
  const raw=value(field);if(raw===undefined){if(fallback===undefined)fail('Missing HDR '+field);return [fallback];}
  const list=[...raw.matchAll(new RegExp(`<${rdf}:li\\b[^>]*>([^<]*)</${rdf}:li\\s*>`,'g'))].map(m=>m[1]);
  const values=(list.length?list:[raw]).map(s=>{
   if(!s.trim()||!/^[-+0-9.eE]+$/.test(s.trim())||!Number.isFinite(Number(s)))fail('Invalid HDR '+field);return Number(s);
  });
  if(![1,3].includes(values.length))fail('Invalid HDR channel count');return values;
 };
 const fields=[numbers('GainMapMin',0),numbers('GainMapMax'),numbers('Gamma',1),numbers('OffsetSDR',1/64),numbers('OffsetHDR',1/64)];
 const channels=Array.from({length:Math.max(...fields.map(f=>f.length))},(_,i)=>{
  const [min,max,gamma,baseOffset,alternateOffset]=fields.map(f=>f[f.length===1?0:i]);
  if(min>max||Math.abs(min)>32||Math.abs(max)>32||gamma<=0||gamma>32||baseOffset<0||alternateOffset<0||baseOffset>16||alternateOffset>16)fail('Invalid HDR channel');
  return {min,max,gamma,baseOffset,alternateOffset};
 });
 const lo=numbers('HDRCapacityMin',0),hi=numbers('HDRCapacityMax');
 if(lo.length!==1||hi.length!==1||lo[0]<0||hi[0]<=lo[0]||hi[0]>32)fail('Invalid HDR headroom');
 return {baseHeadroom:lo[0],alternateHeadroom:hi[0],channels,useBaseColorSpace:true};
}

/** Null for ordinary SDR JPEG. Broken formats supported by this importer must
 * never fall back to SDR. Photos duplicates can retain an orphaned Apple legacy
 * MPF auxiliary without the complete editable/HDR contract; those are treated
 * as raster input so the valid base photo is still processable. */
export function extractJpegHdr(bytes) {
 if(bytes[0]!==255||bytes[1]!==216)return null;
 const metadataText=text.decode(bytes);
 const hasHdrSignal=metadataText.includes(HDR_NS)||metadataText.includes('urn:iso:std:iso:ts:21496:-1');
 let primary;
 try{primary=jpegHeader(bytes);}catch(error){if(hasHdrSignal)throw error;return null;}
 const mpf=primary.segments.find(s=>s.marker===226&&starts(s.data,MPF));
 if(!mpf){if(hasHdrSignal)fail('HDR JPEG has no MPF image table');return null;}
 let images;
 try{images=mpfImages(mpf,bytes);}catch(error){if(hasHdrSignal)throw error;return null;}
 const candidates=images.slice(1).map(image=>({...image,xmp:image.segments.filter(s=>s.marker===225&&starts(s.data,XMP)).map(s=>text.decode(s.data.subarray(XMP.length))).join('\n')}))
  .filter(image=>image.xmp.includes(HDR_NS));
 if(!candidates.length){if(hasHdrSignal)fail('HDR gain map missing from MPF');return null;}
 if(candidates.length!==1)fail('Multiple HDR gain maps are unsupported');
 const gain=candidates[0],base=images[0];
 for(const image of [base,gain])if(image.precision!==8||![1,3].includes(image.components)||!image.width||!image.height
  ||image.width%2||image.height%2||image.width>8192||image.height>8192)fail('Unsupported HDR JPEG dimensions/channels');
 const adobe=!gain.xmp.includes(':ChannelMetadata');
 const metadata=parseAdaptiveHdrXmp(gain.xmp),baseIcc=iccProfile(base),alternateIcc=adobe?null:iccProfile(gain);
 const baseName=iccName(baseIcc),alternateName=iccName(alternateIcc);
 const primaries=!baseIcc||/sRGB/i.test(baseName)?'bt709':/^Display P3$/.test(baseName)?'smpte432':null;
 // Photos may supply a P3 SDR base with a BT.2100/PQ HDR rendition. These
 // profiles describe different renditions, not a requirement for equal gamuts.
 // Keep base primaries for gain calculations and retain the alternate ICC
 // verbatim on the tmap; never relabel the alternate as the base colour space.
 const supportedAlternate=primaries==='smpte432'
  ?/^Display P3;/.test(alternateName)||alternateName==='Rec. ITU-R BT.2100 PQ'
  :/sRGB|Rec\. ?709/i.test(alternateName);
 if(!primaries||(!adobe&&(!alternateIcc||!supportedAlternate))){
  const error=hdrJpegError(`Unsupported HDR JPEG colour profiles (base=${JSON.stringify(baseName.slice(0,96))}, alternate=${JSON.stringify(alternateName.slice(0,96))})`);
  error.hdrProfiles={base:baseName,alternate:alternateName,baseBytes:baseIcc?.length??0,alternateBytes:alternateIcc?.length??0};
  throw error;
 }
 // Gain-map ICC describes the alternate HDR rendition (e.g. P3/PQ), not the
 // numerical gain samples. Decode samples without browser ICC/HDR tone mapping.
 // Remove the now-stale MPF pointer from the isolated base stream. Some browser
 // decoders try to follow it and reject a base-only JPEG with an absent auxiliary.
 const baseOnly=concat([base.bytes.subarray(0,mpf.offset-4),base.bytes.subarray(mpf.offset+mpf.data.length)]);
 return {base:baseOnly,gain:gain.bytes,width:base.width,height:base.height,gainWidth:gain.width,gainHeight:gain.height,
  baseIcc,alternateIcc:adobe?null:alternateIcc,metadata,xmp:enc.encode(gain.xmp),primaries};
}

export const iccColr=profile=>box('colr',concat([enc.encode('prof'),profile]));

export function hdrJpegAlternateColr(hdr){
 if(hdr?.alternateIcc)return iccColr(hdr.alternateIcc);
 const primaries=hdr?.primaries==='smpte432'?12:hdr?.primaries==='bt709'?1:null;
 if(!primaries)fail('Unsupported HDR rendition primaries');
 // Historical Adobe/no-alternate-ICC files describe the derived rendition as
 // extended-linear RGB in the source primaries.
 return box('colr',concat([enc.encode('nclx'),be(primaries,2),be(8,2),be(0,2),Uint8Array.of(128)]));
}

export function parseTmapMetadata(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22)fail('Invalid tmap metadata');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes[0]!==0||v.getUint16(1)!==0||v.getUint16(3)!==0)fail('Unsupported tmap metadata version');
 const flags=bytes[5],channels=(flags&128)?3:1,useBaseColorSpace=Boolean(flags&64);
 if(bytes.length!==22+channels*40)fail('Invalid tmap metadata length');
 let p=6;
 const rational=(signed=false)=>{
  const n=signed?v.getInt32(p):v.getUint32(p),den=v.getUint32(p+4);p+=8;
  if(!den)fail('Invalid tmap rational');return n/den;
 };
 const baseHeadroom=rational(),alternateHeadroom=rational(),items=[];
 for(let i=0;i<channels;i++){
  const min=rational(true),max=rational(true),gamma=rational(),baseOffset=rational(true),alternateOffset=rational(true);
  if(![min,max,gamma,baseOffset,alternateOffset].every(Number.isFinite)||min>max||gamma<=0||baseOffset<0||alternateOffset<0)
    fail('Invalid tmap channel');
  items.push({min,max,gamma,baseOffset,alternateOffset});
 }
 if(!Number.isFinite(baseHeadroom)||!Number.isFinite(alternateHeadroom)||baseHeadroom===alternateHeadroom)
  fail('Invalid tmap headroom');
 return {baseHeadroom,alternateHeadroom,channels:items,useBaseColorSpace};
}

export function encodeTmapMetadata(metadata) {
 const {baseHeadroom,alternateHeadroom,channels,useBaseColorSpace}=metadata;
 if(![1,3].includes(channels.length))fail('Invalid tmap channels');
 const out=new Uint8Array(22+channels.length*40),v=new DataView(out.buffer);let p=6;
 // tmap version(8), minimum_version(16), writer_version(16), flags(8).
 out[5]=(channels.length===3?128:0)|(useBaseColorSpace?64:0);
 const rational=(value,signed=false)=>{
  const n=Math.round(value*1_000_000);
  if(!Number.isFinite(value)||n<(signed?-2147483648:0)||n>(signed?2147483647:4294967295))fail('Invalid tmap rational');
  signed?v.setInt32(p,n):v.setUint32(p,n);v.setUint32(p+4,1_000_000);p+=8;
 };
 rational(baseHeadroom);rational(alternateHeadroom);
 for(const c of channels){rational(c.min,true);rational(c.max,true);rational(c.gamma);rational(c.baseOffset,true);rational(c.alternateOffset,true);}
 return out;
}


const clamp01=value=>Math.max(0,Math.min(1,value));
export const srgbToLinear=value=>{value=clamp01(value);return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;};
export const bt709ToLinear=value=>{value=clamp01(value);return value<.081?value/4.5:((value+.099)/1.099)**(1/.45);};
export function encodedToLinear(value,transfer='srgb'){
 if(transfer==='srgb'||transfer==='iec61966-2-1')return srgbToLinear(value);
 if(transfer==='bt709'||transfer==='smpte170m')return bt709ToLinear(value);
 fail('Unsupported HDR transfer');
}

/** Convert a per-channel ISO gain map to Apple's normalized-log 0x20000
 * auxiliary representation without collapsing RGB chromatic gain to mono. */
export function rgbIsoToAppleGain(baseRgba,gainRgba,metadata){
 if(!(baseRgba instanceof Uint8Array||baseRgba instanceof Uint8ClampedArray)
   ||!(gainRgba instanceof Uint8Array||gainRgba instanceof Uint8ClampedArray)
   ||baseRgba.length!==gainRgba.length||baseRgba.length%4
   ||metadata?.channels?.length!==3)fail('Unsupported RGB ISO-to-Apple gain conversion');
 const headroom=2**metadata.alternateHeadroom,stops=Math.log2(headroom),channels=metadata.channels;
 if(!Number.isFinite(headroom)||headroom<=1||headroom>32||!Number.isFinite(stops)||stops<=0)
  fail('Invalid Apple HDR headroom');
 const output=new Uint8Array(baseRgba.length/4*3),clamp=value=>Math.max(0,Math.min(1,value));
 let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sum=0,max=0;
 for(let p=0,o=0;p<baseRgba.length;p+=4){
  for(let c=0;c<3;c++,o++){
   const ch=channels[c];
   if(!ch||![ch.min,ch.max,ch.gamma,ch.baseOffset,ch.alternateOffset].every(Number.isFinite)
     ||ch.min>ch.max||ch.gamma<=0||ch.baseOffset<0||ch.alternateOffset<0)
    fail('Invalid RGB HDR channel metadata');
   const base=encodedToLinear(baseRgba[p+c]/255,'srgb');
   const scene=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(gainRgba[p+c]/255,ch)-ch.alternateOffset);
   const multiplier=base>0?scene/base:1;
   if(multiplier<1)clippedLow++;
   if(multiplier>headroom)clippedHigh++;
   if(base===0&&scene>0)unrepresentableBlack++;
   const code=Math.round(255*clamp(Math.log2(Math.max(1,multiplier))/stops));
   output[o]=code;
   const rebuilt=base*2**((code/255)*stops),error=Math.abs(rebuilt-scene);
   sum+=error;max=Math.max(max,error);
  }
 }
 return {samples:output,headroom,channels:3,representation:'log2-0x20000',
  clippedLow,clippedHigh,unrepresentableBlack,
  meanAbsoluteSceneError:output.length?sum/output.length:0,maxAbsoluteSceneError:max};
}

/** Decode full-range JPEG YUV420 samples into encoded RGB gain-map samples. */
export function yuv420ToRgba(source,width,height,{matrix='smpte170m',fullRange=true}={}){
 if(width%2||height%2||source.length!==width*height*1.5)fail('Invalid JPEG YUV samples');
 const coeff=matrix==='bt709'?[.2126,.0722]:['smpte170m','bt470bg'].includes(matrix)?[.299,.114]:null;
 if(!coeff)fail('Unsupported YUV matrix');
 const [kr,kb]=coeff,kg=1-kr-kb,plane=width*height,chroma=plane/4,out=new Uint8ClampedArray(plane*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,c=Math.floor(y/2)*(width/2)+Math.floor(x/2);
  const Y=fullRange?source[i]/255:(source[i]-16)/219;
  const cb=(source[plane+c]-128)/(fullRange?255:224),cr=(source[plane+chroma+c]-128)/(fullRange?255:224);
  const p=i*4;
  out[p]=Math.round(255*clamp01(Y+2*(1-kr)*cr));
  out[p+1]=Math.round(255*clamp01(Y-2*kb*(1-kb)/kg*cb-2*kr*(1-kr)/kg*cr));
  out[p+2]=Math.round(255*clamp01(Y+2*(1-kb)*cb));out[p+3]=255;
 }
 return out;
}
function channelMeta(metadata,c){
 const channel=metadata.channels[metadata.channels.length===1?0:c];
 if(!channel)fail('Missing HDR gain-map channel');
 return channel;
}
/** ISO 21496-1 gain sample -> logarithmic (base-2) gain. */
export function decodeGainLog(sample,channel){
 const {min,max,gamma}=channel;
 if(max===min)return min;
 return min+Math.pow(clamp01(sample),1/gamma)*(max-min);
}
/** Logarithmic gain -> encoded gain-map sample using existing metadata. */
export function encodeGainLog(logGain,channel){
 const {min,max,gamma}=channel;
 if(max===min)return .5;
 const normalized=clamp01((logGain-min)/(max-min));
 return Math.pow(normalized,gamma);
}
/**
 * Recompute gain-map samples after the SDR baseline was restored by AI.
 *
 * The original HDR alternate is reconstructed in linear light. The same
 * per-channel linear detail delta introduced by AI is added to that HDR
 * alternate, then a new gain map is solved against the restored SDR base.
 * Metadata remains unchanged so headroom behaviour is preserved.
 */
export function rebaseGainMapRgba(originalBase,restoredBase,gainMap,metadata,{transfer='srgb'}={}){
 if(originalBase.length!==restoredBase.length||originalBase.length!==gainMap.length||originalBase.length%4)
  fail('HDR gain-map rebase dimensions disagree');
 const output=new Uint8ClampedArray(gainMap.length);let clipped=0,maxError=0;
 for(let p=0;p<gainMap.length;p+=4){
  for(let c=0;c<3;c++){
   const meta=channelMeta(metadata,c),oldSdr=encodedToLinear(originalBase[p+c]/255,transfer);
   const newSdr=encodedToLinear(restoredBase[p+c]/255,transfer),sample=gainMap[p+c]/255;
   const oldLog=decodeGainLog(sample,meta);
   const oldHdr=Math.max(0,(oldSdr+meta.baseOffset)*2**oldLog-meta.alternateOffset);
   // Transfer exactly the AI's linear-light detail correction to the HDR alternate.
   const newHdr=Math.max(0,oldHdr+(newSdr-oldSdr));
   const ratio=(newHdr+meta.alternateOffset)/Math.max(1e-8,newSdr+meta.baseOffset);
   const solved=Math.log2(Math.max(1e-8,ratio));
   const bounded=Math.max(meta.min,Math.min(meta.max,solved));
   if(bounded!==solved)clipped++;
   const encoded=encodeGainLog(bounded,meta);
   output[p+c]=Math.round(255*encoded);
   // Quantized round-trip error in linear HDR units.
   const decoded=(newSdr+meta.baseOffset)*2**decodeGainLog(output[p+c]/255,meta)-meta.alternateOffset;
   maxError=Math.max(maxError,Math.abs(decoded-newHdr));
  }
  output[p+3]=255;
 }
 return {rgba:output,clipped,components:(gainMap.length/4)*3,maxError};
}

export function yuv420Tile(source,width,height,column,row,tile=512) {
 if(width%2||height%2||source.length!==width*height*1.5||tile%2)fail('Invalid JPEG YUV samples');
 const output=new Uint8Array(tile*tile*1.5);output.fill(128,tile*tile);
 let fromOffset=0,toOffset=0;
 for(let plane=0;plane<3;plane++){
  const scale=plane?2:1,w=width/scale,h=height/scale,size=tile/scale,x=column*size,y=row*size;
  for(let line=0;line<Math.min(size,h-y);line++){
   const n=Math.max(0,Math.min(size,w-x));
   output.set(source.subarray(fromOffset+(y+line)*w+x,fromOffset+(y+line)*w+x+n),toOffset+line*size);
  }
  fromOffset+=w*h;toOffset+=size*size;
 }
 return output;
}
