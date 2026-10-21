import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeForegroundMatte,fuseForegroundMattes,foregroundFocusPoint,mattePromptPoints,dominantForegroundMatte,selectGeneratedPortraitMatte} from '../../web/src/portrait/foreground-matte.js';
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

test('generated Portrait selection rejects fragmented and ambiguous edge-entering scene saliency',()=>{
  const w=100,h=80;
  const fragmented=matte(w,h,(x,y)=>((x%19)<3&&(y%17)<3)?250:0);
  const sparse=selectGeneratedPortraitMatte({confidence:fragmented,width:w,height:h,source:'isnet'},w,h);
  assert.equal(sparse.matte,null);assert.equal(sparse.report.reason,'fragmented');
  const border=matte(w,h,(x,y)=>x>=65&&y>=15&&y<65?250:(x>=12&&x<27&&y>=25&&y<55?248:0));
  const entering=selectGeneratedPortraitMatte({confidence:border,width:w,height:h,source:'isnet'},w,h);
  assert.equal(entering.matte,null);assert.equal(entering.report.reason,'border-ambiguous');
});

test('generated Portrait selection keeps a single coherent subject even when tightly cropped',()=>{
  const w=100,h=80,confidence=matte(w,h,(x,y)=>x>=68&&y>=16&&y<67?250:0);
  const selected=selectGeneratedPortraitMatte({confidence,width:w,height:h,source:'isnet'},w,h);
  assert.ok(selected.matte);assert.equal(selected.report.applied,true);assert.equal(selected.report.dominance,1);
});

test('generated Portrait selection keeps one coherent interior subject and removes detached saliency',()=>{
  const w=100,h=80,confidence=matte(w,h,(x,y)=>{
    if(x>=34&&x<66&&y>=18&&y<67)return 250;
    if(x>=82&&x<88&&y>=25&&y<31)return 252;
    return 0;
  });
  const selected=selectGeneratedPortraitMatte({confidence,width:w,height:h,source:'isnet'},w,h);
  assert.ok(selected.matte);assert.equal(selected.report.applied,true);
  assert.ok(selected.matte.confidence[40*w+50]>=224);
  assert.equal(selected.matte.confidence[27*w+84],0);
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

test('geometry-aware autofocus selects a supported nearer foreground layer instead of the thick rear object',()=>{
 const w=100,h=80,confidence=new Uint8Array(w*h),gray=new Uint8Array(w*h).fill(80);
 for(let y=12;y<61;y++)for(let x=5;x<57;x++){const p=y*w+x;gray[p]=145+Math.floor(y/12);confidence[p]=250;}
 for(let y=19;y<68;y++)for(let x=52;x<73;x++){const p=y*w+x;gray[p]=220+Math.floor(y/20);confidence[p]=250;}
 const input={confidence,width:w,height:h,source:'edge-refined'},before=confidence.slice();
 const ordinary=foregroundFocusPoint(input,w,h);
 assert.ok(ordinary.x<.52,'reproduces largest-interior selection on the rear object');
 const point=foregroundFocusPoint(input,w,h,{gray});
 assert.ok(point.x>=.52&&point.x<.73,'a substantial, separate near layer supplies the initial focus');
 assert.ok(gray[Math.floor(point.y*h)*w+Math.floor(point.x*w)]>=220);
 assert.deepEqual(confidence,before,'focus selection cannot erase source matte membership');
});

test('geometry-aware focus does not split a continuous surface or chase a small near outlier',()=>{
 const w=80,h=60,confidence=new Uint8Array(w*h),gray=new Uint8Array(w*h).fill(40);
 for(let y=10;y<50;y++)for(let x=10;x<70;x++){confidence[y*w+x]=250;gray[y*w+x]=80+x;}
 const input={confidence,width:w,height:h,source:'edge-refined'},ordinary=foregroundFocusPoint(input,w,h);
 assert.deepEqual(foregroundFocusPoint(input,w,h,{gray}),ordinary,'a smooth surface is not two focus objects');
 gray.fill(100);gray[20*w+20]=250;
 assert.deepEqual(foregroundFocusPoint(input,w,h,{gray}),ordinary,'a high-depth speck cannot steal focus');
 const copy=gray.slice();
 assert.deepEqual(foregroundFocusPoint(input,w,h,{gray:Uint8Array.from(gray,v=>Math.round(v*.5)+5)}),ordinary);
 assert.deepEqual(gray,copy);
 assert.throws(()=>foregroundFocusPoint(input,w,h,{gray:new Uint8Array(2)}),/geometry/);
});

test('geometry-aware focus separates three supported foreground depth layers without a tier-specific threshold',()=>{
 const w=100,h=80,confidence=new Uint8Array(w*h),gray=new Uint8Array(w*h).fill(60);
 for(let y=12;y<62;y++)for(let x=5;x<74;x++){
  const p=y*w+x;confidence[p]=250;gray[p]=x<28?130:x<51?175:205;
 }
 const point=foregroundFocusPoint({confidence,width:w,height:h,source:'edge-refined'},w,h,{gray});
 assert.ok(point.x>=.51,'the nearest supported layer must not be merged with the middle layer');
 assert.equal(gray[Math.floor(point.y*h)*w+Math.floor(point.x*w)],205);
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
