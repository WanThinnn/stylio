import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeForegroundMatte,fuseForegroundMattes,foregroundFocusPoint,mattePromptPoints,dominantForegroundMatte} from '../../web/src/portrait/foreground-matte.js';
import {foregroundImageInput,foregroundOutputMatte} from '../../web/src/portrait/foreground-matte-model.js';
import * as foreground from '../../web/src/portrait/foreground-matte.js';

const matte=(w,h,fn)=>{const a=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)a[y*w+x]=fn(x,y);return a;};

test('analyzeForegroundMatte preserves soft confidence and reports confident components',()=>{
  const w=8,h=6,input=matte(w,h,(x,y)=>x>=1&&x<=3&&y>=1&&y<=4?(x===1?160:240):10);
  const before=input.slice(),r=analyzeForegroundMatte(input,w,h);
  assert.deepEqual(input,before);
  assert.equal(r.confidentForeground,8);
  assert.equal(r.components.length,1);
  assert.equal(r.components[0].pixels,8);
  assert.equal(r.uncertain,4);
});

test('fuseForegroundMattes never erases confident Apple foreground',()=>{
  const w=10,h=8;
  const apple=matte(w,h,(x,y)=>x>=1&&x<=4&&y>=2&&y<=6?245:5);
  const generated=new Uint8Array(w*h);
  const out=fuseForegroundMattes({confidence:apple,width:w,height:h,source:'apple-pem'},
    {confidence:generated,width:w,height:h,source:'isnet'},w,h);
  for(let p=0;p<apple.length;p++)if(apple[p]>=224)assert.ok(out.confidence[p]>=apple[p]);
  assert.equal(out.source,'fused');
});

test('fuseForegroundMattes adds a connected held-object component but rejects a scene-spanning support plane',()=>{
  const w=20,h=12;
  const apple=matte(w,h,(x,y)=>x<=5&&y>=3&&y<=10?245:0);
  const generated=matte(w,h,(x,y)=>{
    if(x>=5&&x<=9&&y>=5&&y<=8)return 250;       // held object touching Apple subject
    if(y>=10)return 250;                         // scene-spanning table
    return 0;
  });
  const out=fuseForegroundMattes({confidence:apple,width:w,height:h,source:'apple-pem'},
    {confidence:generated,width:w,height:h,source:'isnet'},w,h);
  assert.ok(out.confidence[6*w+8]>31&&out.confidence[6*w+8]<224,
    'near held object remains a provisional addition for boundary refinement');
  assert.ok(out.confidence[11*w+15]<224,'scene-spanning support plane should remain background');
});

test('Apple-anchored geodesic fusion accepts a nearby held extension but cuts off a far object in the same IS-Net component',()=>{
  const w=100,h=60;
  const apple=matte(w,h,(x,y)=>x>=5&&x<=20&&y>=18&&y<=42?248:0);
  const generated=matte(w,h,(x,y)=>{
    if(x>=18&&x<=72&&y>=27&&y<=31)return 248;   // one long connected IS-Net bridge
    if(x>=21&&x<=27&&y>=22&&y<=38)return 252;   // nearby held object
    if(x>=60&&x<=78&&y>=15&&y<=43)return 252;   // unrelated far salient object
    return 0;
  });
  const out=fuseForegroundMattes({confidence:apple,width:w,height:h,source:'apple-pem'},
    {confidence:generated,width:w,height:h,source:'isnet'},w,h);
  assert.ok(out.confidence[30*w+25]>31&&out.confidence[30*w+25]<224,
    'near generated foreground should provisionally extend Apple PEM');
  assert.ok(out.confidence[30*w+67]<224,'far object must not join through a long connected generated component');
  assert.ok(out.report.acceptedGeneratedPixels>0);
  assert.ok(out.report.rejectedGeneratedPixels>0);
  assert.ok(out.report.maxExpansion<20,'expansion budget stays local at this working size');
});

test('dominantForegroundMatte isolates the largest confident subject and nearby soft boundary',()=>{
  const w=30,h=20,confidence=matte(w,h,(x,y)=>{
    if(x>=3&&x<=12&&y>=4&&y<=16)return 248;      // dominant hand/person
    if(x>=20&&x<=23&&y>=5&&y<=8)return 250;      // unrelated confident object
    if(x>=13&&x<=15&&y>=7&&y<=13)return 120;     // soft subject boundary
    return 0;
  });
  const out=dominantForegroundMatte({confidence,width:w,height:h,source:'apple-pem'},w,h);
  assert.ok(out);
  assert.ok(out.confidence[10*w+8]>=224);
  assert.ok(out.confidence[10*w+14]>31,'near soft support should remain with dominant subject');
  assert.equal(out.confidence[6*w+21],0,'smaller disconnected confident component is not a focus anchor');
  assert.equal(out.report.ignoredComponents,1);
});

test('Portrait anchor retains PEM-connected fingers and metal when skin is split by occlusion',()=>{
  const w=80,h=60,apple=matte(w,h,(x,y)=>{
    if(x>=8&&x<34&&y>=14&&y<50)return 250;
    if(x>=34&&x<51&&y>=26&&y<31)return 248; // metal connects hand to occluded finger
    if(x>=49&&x<56&&y>=22&&y<37)return 252;
    if(x>=63&&x<70&&y>=12&&y<20)return 250; // unrelated PEM component
    return 0;
  });
  const skin=matte(w,h,(x,y)=>
    ((x>=8&&x<34&&y>=14&&y<50)||(x>=49&&x<56&&y>=22&&y<37))?250:0);
  assert.equal(typeof foreground.portraitFocusAnchor,'function');
  const out=foreground.portraitFocusAnchor(
    {confidence:apple,width:w,height:h,source:'apple-pem'},
    {confidence:skin,width:w,height:h,source:'apple-skin'},w,h);
  assert.ok(out.confidence[28*w+52]>=224,'occluded finger must survive');
  assert.ok(out.confidence[28*w+42]>=224,'metal connection must survive');
  assert.equal(out.confidence[15*w+66],0,'unrelated detached object is not the focus group');
});

test('foregroundFocusPoint lies in the deepest confident foreground interior',()=>{
  const w=12,h=10,confidence=matte(w,h,(x,y)=>x>=2&&x<=8&&y>=2&&y<=8?250:0);
  const p=foregroundFocusPoint({confidence,width:w,height:h,source:'apple-pem'},w,h);
  assert.ok(p);
  const x=Math.floor(p.x*w),y=Math.floor(p.y*h);
  assert.ok(confidence[y*w+x]>=224);
  assert.ok(x>=4&&x<=6&&y>=4&&y<=6);
});

test('mattePromptPoints returns foreground positives and background negatives deterministically',()=>{
  const w=14,h=10,confidence=matte(w,h,(x,y)=>x>=3&&x<=8&&y>=2&&y<=7?245:5);
  const a=mattePromptPoints({confidence,width:w,height:h,source:'fused'},w,h,{positiveCount:4,negativeCount:4});
  const b=mattePromptPoints({confidence,width:w,height:h,source:'fused'},w,h,{positiveCount:4,negativeCount:4});
  assert.deepEqual(a,b);
  assert.ok(a.positive.length>0&&a.negative.length>0);
  for(const p of a.positive)assert.ok(confidence[Math.min(h-1,Math.floor(p.y*h))*w+Math.min(w-1,Math.floor(p.x*w))]>=224);
  for(const p of a.negative)assert.ok(confidence[Math.min(h-1,Math.floor(p.y*h))*w+Math.min(w-1,Math.floor(p.x*w))]<=31);
});

test('foreground model preprocessing uses the documented v/255-0.5 normalization',()=>{
  const rgb=new Uint8Array([0,128,255,255,128,0,64,64,64,192,192,192]);
  const input=foregroundImageInput(rgb,2,2,{angle:0,mirror:null},16);
  assert.equal(input.data.length,3*16*16);
  assert.ok(input.data.every(Number.isFinite));
  assert.ok(Math.min(...input.data)>=-.5001&&Math.max(...input.data)<=.5001);
});

test('foreground model output min-max normalizes to a stored-orientation confidence matte',()=>{
  const values=new Float32Array([0,.25,.5,1]);
  const out=foregroundOutputMatte(values,2,2,2,2,{angle:0,mirror:null});
  assert.equal(out.confidence.length,4);
  assert.equal(Math.min(...out.confidence),0);
  assert.equal(Math.max(...out.confidence),255);
  assert.equal(out.min,0);assert.equal(out.max,1);
});
