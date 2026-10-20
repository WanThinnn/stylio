import test from 'node:test';
import assert from 'node:assert/strict';
import {subjectDecoderPrompts,refineSubjectMatte} from '../../web/src/portrait/subject-mask.js';
import {fuseForegroundMattes} from '../../web/src/portrait/foreground-matte.js';

const makeMatte=(w,h)=>{
  const confidence=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(x>=2&&x<=5&&y>=2&&y<=5)confidence[y*w+x]=245;
    else if(x>=1&&x<=6&&y>=1&&y<=6)confidence[y*w+x]=128;
    else confidence[y*w+x]=5;
  }
  return {confidence,width:w,height:h,source:'fused'};
};

test('matte-guided EdgeSAM prompts include positive foreground and negative background points',()=>{
  const w=8,h=8,matte=makeMatte(w,h),prompts=subjectDecoderPrompts(matte,w,h,{angle:0,mirror:null},{positiveCount:4,negativeCount:4});
  assert.ok(prompts.some(p=>p.label===1));
  assert.ok(prompts.some(p=>p.label===0));
  for(const p of prompts){
    assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
    const x=Math.min(w-1,Math.floor(p.x*w)),y=Math.min(h-1,Math.floor(p.y*h)),value=matte.confidence[y*w+x];
    if(p.label===1)assert.ok(value>=224);
    else assert.ok(value<=31);
  }
});

test('EdgeSAM refinement changes only matte uncertainty and never confident foreground/background',()=>{
  const w=8,h=8,matte=makeMatte(w,h),before=matte.confidence.slice();
  const masks=new Float32Array(w*h).fill(-4);
  for(let y=1;y<=6;y++)for(let x=1;x<=6;x++)masks[y*w+x]=4;
  const result=refineSubjectMatte(masks,w,h,Float32Array.of(.95),matte,w,h,{angle:0,mirror:null});
  assert.equal(result.report.applied,true);
  let uncertainChanged=0;
  for(let p=0;p<before.length;p++){
    if(before[p]>=224||before[p]<=31)assert.equal(result.matte.confidence[p],before[p]);
    else if(result.matte.confidence[p]!==before[p])uncertainChanged++;
  }
  assert.ok(uncertainChanged>0);
  assert.deepEqual(matte.confidence,before,'input matte is immutable');
});

test('EdgeSAM candidate dominated by confirmed background is rejected',()=>{
  const w=8,h=8,matte=makeMatte(w,h),masks=new Float32Array(w*h).fill(4);
  const result=refineSubjectMatte(masks,w,h,Float32Array.of(.99),matte,w,h,{angle:0,mirror:null});
  assert.equal(result.report.applied,false);
  assert.equal(result.report.reason,'no-matte-constrained-mask');
  assert.deepEqual(result.matte.confidence,matte.confidence);
});

test('IS-Net proposals can be confirmed or rejected by EdgeSAM without erasing Apple foreground',()=>{
  const w=8,h=8,apple=makeMatte(w,h),generated={...apple,confidence:new Uint8Array(w*h).fill(255),source:'isnet'};
  const positive=3*w+1,negative=1*w+1;
  apple.confidence[negative]=0;
  const fused=fuseForegroundMattes(apple,generated,w,h);
  assert.ok(fused.confidence[negative]>31&&fused.confidence[negative]<224,
    'generated additions must remain editable uncertainty');
  const masks=new Float32Array(w*h).fill(-12);
  for(let y=2;y<=5;y++)for(let x=2;x<=5;x++)masks[y*w+x]=12;
  masks[positive]=12;
  const out=refineSubjectMatte(masks,w,h,Float32Array.of(.98),fused,w,h,{angle:0,mirror:null});
  assert.ok(out.matte.confidence[positive]>=224,'SAM confirms the held-object proposal');
  assert.ok(out.matte.confidence[negative]<=31,'SAM rejects the background proposal');
  assert.equal(out.matte.confidence[3*w+3],apple.confidence[3*w+3]);
  assert.ok(out.matte.confidence[1*w+2]>=apple.confidence[1*w+2],
    'conflicting SAM evidence must not erase the original soft Apple boundary');
});
