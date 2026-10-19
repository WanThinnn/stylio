import {decodeGainLog,bt709ToLinear} from '../../web/src/raster/jpeg-hdr.js';

// Diagnostic only. An Apple auxiliary reader and an ISO tmap reader must not be
// handed identical numerical samples under incompatible gain equations.
export function isoToAppleFallback(samples,linearLuma,metadata,{transfer='bt709'}={}){
  // Apple documents the piecewise Rec.709 curve. Skia's Apple reader uses a
  // power of 1.961 instead. Keep that explicit diagnostic choice separate;
  // it is evidence about Skia, not proof of Photos' internal decoder.
  if(!['bt709','power-1.961'].includes(transfer))throw Error('Unsupported Apple fallback transfer');
  const channel=metadata?.channels?.[0],headroom=2**metadata?.alternateHeadroom;
  if(!(samples instanceof Uint8Array)||!(linearLuma instanceof Float32Array)
      ||samples.length!==linearLuma.length||metadata?.channels?.length!==1
      ||![headroom,channel?.min,channel?.max,channel?.gamma,channel?.baseOffset,channel?.alternateOffset].every(Number.isFinite)
      ||headroom<=1||headroom>32||channel.min>channel.max||channel.gamma<=0
      ||channel.baseOffset<0||channel.alternateOffset<0
      ||linearLuma.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Unsupported ISO-to-Apple fallback');
  const output=new Uint8Array(samples.length),clamp=x=>Math.max(0,Math.min(1,x));
  const oetf=transfer==='bt709'?(x=>x<.018?4.5*x:1.099*x**.45-.099):(x=>x**(1/1.961));
  const eotf=transfer==='bt709'?bt709ToLinear:(x=>x**1.961);
  let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sum=0,max=0;
  for(let i=0;i<samples.length;i++){
    const base=linearLuma[i],scene=Math.max(0,(base+channel.baseOffset)*2**decodeGainLog(samples[i]/255,channel)-channel.alternateOffset);
    const multiplier=base>0?scene/base:1;
    if(multiplier<1)clippedLow++;
    if(multiplier>headroom)clippedHigh++;
    if(base===0&&scene>0)unrepresentableBlack++;
    output[i]=Math.round(255*oetf(clamp((multiplier-1)/(headroom-1))));
    const reconstructed=base*(1+(headroom-1)*eotf(output[i]/255)),error=Math.abs(reconstructed-scene);
    sum+=error;max=Math.max(max,error);
  }
  return {samples:output,headroom,transfer,clippedLow,clippedHigh,unrepresentableBlack,
    meanAbsoluteSceneError:samples.length?sum/samples.length:0,maxAbsoluteSceneError:max};
}

// Diagnostic RGB ISO -> scalar Apple fallback. Reconstruct the HDR alternate
// per RGB channel first, then solve a single luminance multiplier for Apple's
// legacy auxiliary reader. This intentionally does not mutate or replace the
// source RGB ISO gain map/tmap; it exists only as a parallel editor fallback.
export function isoRgbToAppleLogGain(samples,linearRgb,metadata){
  const headroom=2**metadata?.alternateHeadroom,stops=Math.log2(headroom),channels=metadata?.channels;
  if(!(samples instanceof Uint8Array)||!(linearRgb instanceof Float32Array)
      ||samples.length!==linearRgb.length||samples.length%3!==0||channels?.length!==3
      ||![headroom,stops,...channels.flatMap(c=>[c?.min,c?.max,c?.gamma,c?.baseOffset,c?.alternateOffset])].every(Number.isFinite)
      ||headroom<=1||headroom>32||stops<=0||channels.some(c=>c.min>c.max||c.gamma<=0||c.baseOffset<0||c.alternateOffset<0)
      ||linearRgb.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Unsupported RGB ISO-to-Apple log gain');
  const clamp=x=>Math.max(0,Math.min(1,x)),output=new Uint8Array(samples.length);
  let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sum=0,max=0;
  for(let i=0;i<samples.length;i++){
    const c=i%3,ch=channels[c],base=linearRgb[i];
    const scene=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(samples[i]/255,ch)-ch.alternateOffset);
    const multiplier=base>0?scene/base:1;
    if(multiplier<1)clippedLow++;if(multiplier>headroom)clippedHigh++;if(base===0&&scene>0)unrepresentableBlack++;
    output[i]=Math.round(255*clamp(Math.log2(Math.max(1,multiplier))/stops));
    const rebuilt=base*2**((output[i]/255)*stops),error=Math.abs(rebuilt-scene);sum+=error;max=Math.max(max,error);
  }
  return {samples:output,headroom,channels:3,representation:'log2',clippedLow,clippedHigh,unrepresentableBlack,
    meanAbsoluteSceneError:output.length?sum/output.length:0,maxAbsoluteSceneError:max};
}

export function isoRgbToAppleFallbackRgb(samples,linearRgb,metadata,{transfer='bt709'}={}){
  if(!['bt709','power-1.961'].includes(transfer))throw Error('Unsupported Apple fallback transfer');
  const headroom=2**metadata?.alternateHeadroom,channels=metadata?.channels;
  if(!(samples instanceof Uint8Array)||!(linearRgb instanceof Float32Array)
      ||samples.length!==linearRgb.length||samples.length%3!==0||channels?.length!==3
      ||![headroom,...channels.flatMap(c=>[c?.min,c?.max,c?.gamma,c?.baseOffset,c?.alternateOffset])].every(Number.isFinite)
      ||headroom<=1||headroom>32||channels.some(c=>c.min>c.max||c.gamma<=0||c.baseOffset<0||c.alternateOffset<0)
      ||linearRgb.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Unsupported RGB ISO-to-Apple fallback');
  const oetf=transfer==='bt709'?(x=>x<.018?4.5*x:1.099*x**.45-.099):(x=>x**(1/1.961));
  const eotf=transfer==='bt709'?bt709ToLinear:(x=>x**1.961),clamp=x=>Math.max(0,Math.min(1,x));
  const output=new Uint8Array(samples.length);let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sum=0,max=0;
  for(let i=0;i<samples.length;i++){
    const c=i%3,ch=channels[c],base=linearRgb[i];
    const scene=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(samples[i]/255,ch)-ch.alternateOffset);
    const multiplier=base>0?scene/base:1;
    if(multiplier<1)clippedLow++;
    if(multiplier>headroom)clippedHigh++;
    if(base===0&&scene>0)unrepresentableBlack++;
    output[i]=Math.round(255*oetf(clamp((multiplier-1)/(headroom-1))));
    const reconstructed=base*(1+(headroom-1)*eotf(output[i]/255)),error=Math.abs(reconstructed-scene);
    sum+=error;max=Math.max(max,error);
  }
  return {samples:output,headroom,transfer,channels:3,clippedLow,clippedHigh,unrepresentableBlack,
    meanAbsoluteSceneError:output.length?sum/output.length:0,maxAbsoluteSceneError:max};
}

export function isoRgbToAppleFallback(samples,linearRgb,metadata,{transfer='bt709',weights=[.2289745641,.6917385218,.0792869141]}={}){
  if(!['bt709','power-1.961'].includes(transfer))throw Error('Unsupported Apple fallback transfer');
  const headroom=2**metadata?.alternateHeadroom,channels=metadata?.channels;
  if(!(samples instanceof Uint8Array)||!(linearRgb instanceof Float32Array)
      ||samples.length!==linearRgb.length||samples.length%3!==0||channels?.length!==3
      ||weights.length!==3||!weights.every(Number.isFinite)
      ||![headroom,...channels.flatMap(c=>[c?.min,c?.max,c?.gamma,c?.baseOffset,c?.alternateOffset])].every(Number.isFinite)
      ||headroom<=1||headroom>32||channels.some(c=>c.min>c.max||c.gamma<=0||c.baseOffset<0||c.alternateOffset<0)
      ||linearRgb.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Unsupported RGB ISO-to-Apple fallback');
  const oetf=transfer==='bt709'?(x=>x<.018?4.5*x:1.099*x**.45-.099):(x=>x**(1/1.961));
  const eotf=transfer==='bt709'?bt709ToLinear:(x=>x**1.961),clamp=x=>Math.max(0,Math.min(1,x));
  const output=new Uint8Array(samples.length/3);let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sum=0,max=0;
  for(let i=0,p=0;i<output.length;i++,p+=3){
    let baseLuma=0,sceneLuma=0;
    for(let c=0;c<3;c++){
      const base=linearRgb[p+c],ch=channels[c],scene=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(samples[p+c]/255,ch)-ch.alternateOffset);
      baseLuma+=weights[c]*base;sceneLuma+=weights[c]*scene;
    }
    const multiplier=baseLuma>0?sceneLuma/baseLuma:1;
    if(multiplier<1)clippedLow++;
    if(multiplier>headroom)clippedHigh++;
    if(baseLuma===0&&sceneLuma>0)unrepresentableBlack++;
    output[i]=Math.round(255*oetf(clamp((multiplier-1)/(headroom-1))));
    const reconstructed=baseLuma*(1+(headroom-1)*eotf(output[i]/255)),error=Math.abs(reconstructed-sceneLuma);
    sum+=error;max=Math.max(max,error);
  }
  return {samples:output,headroom,transfer,clippedLow,clippedHigh,unrepresentableBlack,
    meanAbsoluteSceneError:output.length?sum/output.length:0,maxAbsoluteSceneError:max};
}
