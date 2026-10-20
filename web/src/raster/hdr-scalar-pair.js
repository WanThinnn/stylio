// Editable scalar HDR needs a matching base: collapsing RGB gain alone loses hue.
// This deliberately changes SDR chromaticity; source Native HEIC never uses it.
import {box,concat,be} from './box.js';
import {srgbToLinear,iccColr} from './jpeg-hdr.js';
const linear=Float64Array.from({length:256},(_,i)=>srgbToLinear(i/255));
const encode=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
export async function rebaseRgbHdrPair(base,gain,{width,height,gainWidth,gainHeight,headroom,primaries='smpte432'},onProgress){
 if(![width,height,gainWidth,gainHeight].every(n=>Number.isInteger(n)&&n>0&&n<=8192)
   ||!(base instanceof Uint8Array)||!(gain instanceof Uint8Array)
   ||base.length!==width*height*3||gain.length!==gainWidth*gainHeight*3
   ||!Number.isFinite(headroom)||headroom<=1||headroom>32||!['smpte432','bt709'].includes(primaries))
  throw Error('Invalid RGB HDR pair');
 const weights=primaries==='smpte432'?[.2289745641,.6917385218,.0792869141]:[.2126,.7152,.0722];
 const output=new Uint8Array(base.length),gray=new Uint8Array(width*height),stops=Math.log2(headroom);
 const multipliers=Float64Array.from({length:256},(_,i)=>headroom**(i/255));
 let error=0,delta=0,maxDelta=0,maxFloatError=0;
 for(let y=0;y<height;y++){
  const fy=Math.max(0,Math.min(gainHeight-1,(y+.5)*gainHeight/height-.5)),y0=Math.floor(fy),y1=Math.min(y0+1,gainHeight-1),ty=fy-y0;
  for(let x=0;x<width;x++){
   const fx=Math.max(0,Math.min(gainWidth-1,(x+.5)*gainWidth/width-.5)),x0=Math.floor(fx),x1=Math.min(x0+1,gainWidth-1),tx=fx-x0;
   const at=[(y0*gainWidth+x0)*3,(y0*gainWidth+x1)*3,(y1*gainWidth+x0)*3,(y1*gainWidth+x1)*3];
   const i=y*width+x,p=i*3,hdr=[];let ys=0,yh=0,peak=0;
   for(let c=0;c<3;c++){
    const a=gain[at[0]+c]*(1-tx)+gain[at[1]+c]*tx,b=gain[at[2]+c]*(1-tx)+gain[at[3]+c]*tx;
    const sdr=linear[base[p+c]],v=sdr*headroom**((a*(1-ty)+b*ty)/255);hdr.push(v);
    ys+=weights[c]*sdr;yh+=weights[c]*v;peak=Math.max(peak,v);
   }
   const boost=Math.min(headroom,Math.max(1,ys>0?yh/ys:1,peak));
   const code=Math.min(255,Math.ceil(255*Math.log2(boost)/stops)),factor=multipliers[code];gray[i]=code;
   for(let c=0;c<3;c++){
    const value=hdr[c]/factor,q=Math.max(0,Math.min(255,Math.round(255*encode(value))));output[p+c]=q;
    error+=Math.abs(linear[q]*factor-hdr[c]);maxFloatError=Math.max(maxFloatError,Math.abs(value*factor-hdr[c]));
    const change=Math.abs(q-base[p+c]);delta+=change;maxDelta=Math.max(maxDelta,change);
   }
  }
  if(onProgress&&y%64===0){onProgress({stage:'auxiliary',done:y,total:height});await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return {base:output,gain:gray,headroom,metadata:{baseHeadroom:0,alternateHeadroom:stops,useBaseColorSpace:true,
  channels:[{min:0,max:stops,gamma:1,baseOffset:0,alternateOffset:0}]},
  metrics:{sdrPixelsChanged:delta>0,sdrMeanCodeChange:delta/base.length,sdrMaxCodeChange:maxDelta,
   hdrLinearMae:error/base.length,maxFloatError}};
}

// A generic ICC v4 D50 gray profile with an identity TRC, constructed from
// readable colour constants. No donor photo/Apple opaque profile is embedded.
export function linearGrayColr(){
 const text=s=>new TextEncoder().encode(s),fixed=x=>be(Math.round(x*65536),4);
 const mluc=s=>{const v=concat([text('mluc'),new Uint8Array(4),be(1,4),be(12,4),text('enUS'),be(s.length*2,4),be(28,4),
  ...Array.from(s,c=>be(c.charCodeAt(0),2))]);return concat([v,new Uint8Array((4-v.length%4)%4)]);};
 const tags=[['desc',mluc('Linear Gray')],['cprt',mluc('Stylio')],
  ['wtpt',concat([text('XYZ '),new Uint8Array(4),fixed(.9642),fixed(1),fixed(.8249)])],
  ['kTRC',concat([text('para'),new Uint8Array(8),fixed(1)])]];
 let cursor=132+tags.length*12;const table=[];
 for(const [name,bytes]of tags){table.push(text(name),be(cursor,4),be(bytes.length,4));cursor+=bytes.length;}
 const header=new Uint8Array(132),view=new DataView(header.buffer);view.setUint32(0,cursor);view.setUint32(8,0x04200000);
 header.set(text('mntrGRAYXYZ '),12);view.setUint16(24,2026);view.setUint16(26,1);view.setUint16(28,1);
 header.set(text('acsp'),36);view.setUint32(64,1);header.set(fixed(.9642),68);header.set(fixed(1),72);header.set(fixed(.8249),76);
 view.setUint32(128,tags.length);return iccColr(concat([header,...table,...tags.map(x=>x[1])]));
}
