import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stabilizeSubjectDepth} from '../../web/src/portrait/subject-depth-guidance.js';

test('a coherent segmented object stays in one focus group without pulling its surroundings forward',()=>{
  const w=96,h=128,gray=new Uint8Array(w*h),mask=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,inside=x>=37&&x<59&&y>=24&&y<104;
    gray[p]=inside?Math.round(209+(y-24)*26/80):80+Math.round(y/32);mask[p]=inside?255:0;
  }
  const before=gray.slice(),out=stabilizeSubjectDepth(gray,mask,w,h);
  assert.equal(out.report.applied,true);
  assert.ok(Math.abs(out.gray[32*w+48]-out.gray[80*w+48])<=2,'the cap and label must remain in the same focus group');
  for(let p=0;p<mask.length;p++)if(!mask[p])assert.equal(out.gray[p],gray[p],'background and supporting table are unchanged');
  assert.deepEqual(gray,before,'never modify the input field');
});

test('large real separation inside one semantic mask is not flattened',()=>{
  const w=96,h=128,gray=new Uint8Array(w*h).fill(90),mask=new Uint8Array(w*h);
  for(let y=24;y<104;y++)for(let x=30;x<66;x++){const p=y*w+x;mask[p]=255;gray[p]=y<50?120:240;}
  const out=stabilizeSubjectDepth(gray,mask,w,h);
  assert.equal(out.report.applied,false);assert.deepEqual(out.gray,gray);
});

test('a confident constant subject interior repairs its eroded rim without expanding the mask',()=>{
  const w=96,h=128,gray=new Uint8Array(w*h).fill(80),mask=new Uint8Array(w*h);
  for(let y=24;y<104;y++)for(let x=37;x<59;x++){
    const p=y*w+x;mask[p]=255;gray[p]=x===37||x===58||y===24||y===103?140:230;
  }
  const out=stabilizeSubjectDepth(gray,mask,w,h);
  assert.equal(out.report.applied,true);
  for(let p=0;p<mask.length;p++)assert.equal(out.gray[p],mask[p]?230:80);
});

test('uncertain, empty, full and already-correct masks cannot invent depth',()=>{
  const w=48,h=48,gray=new Uint8Array(w*h).fill(125),mask=new Uint8Array(w*h);
  assert.deepEqual(stabilizeSubjectDepth(gray,mask,w,h).gray,gray);
  mask.fill(255);assert.deepEqual(stabilizeSubjectDepth(gray,mask,w,h).gray,gray);
  mask.fill(128);assert.throws(()=>stabilizeSubjectDepth(gray,mask,w,h),/binary membership/);
  assert.throws(()=>stabilizeSubjectDepth(gray,new Uint8Array(3),w,h),/geometry/);
  assert.throws(()=>stabilizeSubjectDepth(new Float32Array(gray.length),mask,w,h),/geometry/);
  mask.fill(0);for(let y=12;y<36;y++)for(let x=18;x<30;x++)mask[y*w+x]=255;
  const out=stabilizeSubjectDepth(gray,mask,w,h);assert.equal(out.report.applied,false);assert.deepEqual(out.gray,gray);
});

const privateRoot=new URL('../private-fixtures/depth-bottle-2139/',import.meta.url);
test('reported bottle cap and label match the D candidate field with no changes outside its model mask',{
  skip:!fs.existsSync(new URL('sam-selected.gray',privateRoot))
},()=>{
  const original=new Uint8Array(fs.readFileSync(new URL('Bottle_A_Edge.gray',privateRoot))),mask=new Uint8Array(fs.readFileSync(new URL('sam-selected.gray',privateRoot)));
  const out=stabilizeSubjectDepth(original,mask,1024,768);
  const median=(left,top,right,bottom)=>{
    const values=[];for(let y=Math.floor(top*768);y<Math.floor(bottom*768);y++)for(let x=Math.floor(left*1024);x<Math.floor(right*1024);x++)values.push(out.gray[y*1024+x]);
    values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)];
  };
  assert.equal(out.report.applied,true);
  assert.ok(Math.abs(median(.40,.48,.43,.52)-median(.60,.48,.64,.52))<=1,'cap and label fit into one quantization step');
  for(let p=0;p<mask.length;p++)if(!mask[p])assert.equal(out.gray[p],original[p]);
  assert.equal(Buffer.compare(out.gray,fs.readFileSync(new URL('Bottle_D_Subject_Coherence.gray',privateRoot))),0,'already-delivered D remains immutable');
});
