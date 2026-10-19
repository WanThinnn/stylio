import test from 'node:test';
import assert from 'node:assert/strict';
import {isoToAppleFallback,isoRgbToAppleFallback,isoRgbToAppleFallbackRgb,isoRgbToAppleLogGain} from '../../tools/lib/iso-apple-fallback.mjs';
import {decodeGainLog,bt709ToLinear} from '../../web/src/raster/jpeg-hdr.js';

const metadata={baseHeadroom:0,alternateHeadroom:2,channels:[{min:0,max:2,gamma:1,baseOffset:0,alternateOffset:0}]};
const iso=(s,l,m=metadata)=>Math.max(0,(l+m.channels[0].baseOffset)*2**decodeGainLog(s/255,m.channels[0])-m.channels[0].alternateOffset);
const apple=(s,l,h)=>l*(1+(h-1)*bt709ToLinear(s/255));

test('a separate Apple fallback preserves the actual ISO highlight rather than relabeling log samples',()=>{
  const samples=Uint8Array.of(0,64,128,192,255),luma=new Float32Array(samples.length).fill(.5);
  const result=isoToAppleFallback(samples,luma,metadata);
  assert.ok(Math.abs(apple(samples[2],.5,4)-iso(samples[2],.5))>.1,'the original relabel-only route is red-capable');
  for(let i=0;i<samples.length;i++)assert.ok(Math.abs(apple(result.samples[i],luma[i],result.headroom)-iso(samples[i],luma[i]))<.009);
  assert.deepEqual(samples,Uint8Array.of(0,64,128,192,255),'ISO source samples immutable');
  assert.equal(result.samples[0],0);assert.equal(result.samples.at(-1),255);
});

test('ISO offsets enter the scene equation before deriving the Apple luminance multiplier',()=>{
  const m={...metadata,channels:[{...metadata.channels[0],baseOffset:.005,alternateOffset:.005}]};
  const samples=Uint8Array.of(64,128,192),luma=Float32Array.of(.1,.2,.4),result=isoToAppleFallback(samples,luma,m);
  for(let i=0;i<samples.length;i++)assert.ok(Math.abs(apple(result.samples[i],luma[i],result.headroom)-iso(samples[i],luma[i],m))<.007);
});

test('unsupported geometry and channels are refused',()=>{
  assert.throws(()=>isoToAppleFallback(Uint8Array.of(1),new Float32Array(0),metadata));
  assert.throws(()=>isoToAppleFallback(Uint8Array.of(1),Float32Array.of(NaN),metadata));
  assert.throws(()=>isoToAppleFallback(Uint8Array.of(1),Float32Array.of(.5),{...metadata,channels:[]}));
});

test('a legacy single-channel fallback reports unrepresentable offsets instead of claiming exactness',()=>{
  const m={...metadata,channels:[{...metadata.channels[0],baseOffset:.005,alternateOffset:.005}]};
  const result=isoToAppleFallback(Uint8Array.of(255,255),Float32Array.of(0,.01),m);
  assert.equal(result.unrepresentableBlack,1);assert.equal(result.clippedHigh,1);
  assert.ok(result.maxAbsoluteSceneError>.01);assert.equal(result.headroom,4,'no guessed brightness boost');
});

test('the explicit Skia Apple power reader gets its own inverse curve rather than Rec.709 codes',()=>{
  const samples=Uint8Array.of(32,64,96,128,192,255),luma=new Float32Array(samples.length).fill(.5);
  const result=isoToAppleFallback(samples,luma,metadata,{transfer:'power-1.961'});
  const power=(code,base)=>base*(1+3*(code/255)**1.961);
  for(let i=0;i<samples.length;i++)assert.ok(Math.abs(power(result.samples[i],luma[i])-iso(samples[i],luma[i]))<.008,
    'preserve actual scene energy under the requested reader');
});

test('a diagnostic transfer choice cannot silently select an unknown gamma',()=>{
  assert.throws(()=>isoToAppleFallback(Uint8Array.of(128),Float32Array.of(.5),metadata,{transfer:'guessed-gamma'}));
});

test('RGB 0x20000 Apple log gain preserves each source HDR channel under log2 representation',()=>{
  const m={baseHeadroom:0,alternateHeadroom:2,channels:[
    {min:0,max:1.8,gamma:1,baseOffset:0,alternateOffset:0},
    {min:0,max:1.9,gamma:1,baseOffset:0,alternateOffset:0},
    {min:0,max:2.0,gamma:1,baseOffset:0,alternateOffset:0},
  ]};
  const gain=Uint8Array.of(32,64,96,128,160,192),rgb=Float32Array.of(.1,.2,.3,.4,.5,.6);
  const result=isoRgbToAppleLogGain(gain,rgb,m),stops=Math.log2(result.headroom);
  assert.equal(result.samples.length,gain.length);assert.equal(result.channels,3);assert.equal(result.representation,'log2');
  for(let i=0;i<gain.length;i++){
    const ch=m.channels[i%3],scene=Math.max(0,(rgb[i]+ch.baseOffset)*2**decodeGainLog(gain[i]/255,ch)-ch.alternateOffset);
    const rebuilt=rgb[i]*2**((result.samples[i]/255)*stops);
    assert.ok(Math.abs(rebuilt-scene)<.012);
  }
});

test('RGB Apple fallback preserves each source HDR channel under the Apple equation',()=>{
  const m={baseHeadroom:0,alternateHeadroom:2,channels:[
    {min:0,max:1.8,gamma:1,baseOffset:0,alternateOffset:0},
    {min:0,max:1.9,gamma:1,baseOffset:0,alternateOffset:0},
    {min:0,max:2.0,gamma:1,baseOffset:0,alternateOffset:0},
  ]};
  const gain=Uint8Array.of(32,64,96,128,160,192),rgb=Float32Array.of(.1,.2,.3,.4,.5,.6);
  const result=isoRgbToAppleFallbackRgb(gain,rgb,m);assert.equal(result.samples.length,gain.length);assert.equal(result.channels,3);
  for(let i=0;i<gain.length;i++){
    const ch=m.channels[i%3],scene=Math.max(0,(rgb[i]+ch.baseOffset)*2**decodeGainLog(gain[i]/255,ch)-ch.alternateOffset);
    assert.ok(Math.abs(apple(result.samples[i],rgb[i],result.headroom)-scene)<.009);
  }
});

test('RGB ISO fallback reconstructs per-channel HDR before solving one Apple luminance map',()=>{
  const m={baseHeadroom:0,alternateHeadroom:2,channels:[
    {min:-.5,max:2.2,gamma:1,baseOffset:1/64,alternateOffset:1/64},
    {min:-.4,max:2.4,gamma:1,baseOffset:1/64,alternateOffset:1/64},
    {min:-.3,max:2.6,gamma:1,baseOffset:1/64,alternateOffset:1/64},
  ]};
  const gain=Uint8Array.of(32,64,96,128,160,192),rgb=Float32Array.of(.1,.2,.3,.4,.5,.6);
  const result=isoRgbToAppleFallback(gain,rgb,m),weights=[.2289745641,.6917385218,.0792869141];
  assert.equal(result.samples.length,2);assert.equal(result.headroom,4);
  for(let i=0;i<2;i++){
    let base=0,scene=0;
    for(let c=0;c<3;c++){
      const p=i*3+c,ch=m.channels[c];base+=weights[c]*rgb[p];
      scene+=weights[c]*Math.max(0,(rgb[p]+ch.baseOffset)*2**decodeGainLog(gain[p]/255,ch)-ch.alternateOffset);
    }
    assert.ok(Math.abs(apple(result.samples[i],base,result.headroom)-scene)<.02);
  }
  assert.deepEqual(gain,Uint8Array.of(32,64,96,128,160,192),'RGB ISO samples immutable');
});
