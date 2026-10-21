import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {depthModel,asDisparity} from '../../web/src/portrait/depth-models.js';
import {depthImageInput,depthOutputToStored} from '../../web/src/portrait/depth-orientation.js';

const workerSource=readFileSync(new URL('../../web/src/portrait/ai-inference-worker.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'')
 .replace('import.meta.url',JSON.stringify(new URL('../../web/src/portrait/ai-inference-worker.js',import.meta.url).href))
 .replace("await import('../../vendor/ai-portrait/ort.webgpu.min.mjs')",'testOrt');

for(const modelId of ['lite','standard','pro']){
test(`actual ${modelId} depth worker sees upright RGB and returns stored-coordinate depth`,async()=>{
 const width=4,height=2,rgb=Uint8Array.from({length:width*height*3},(_,i)=>20+i),saved=rgb.slice();
 const seen={},asset={bytes:1,sha256:'00'},messages=[];
 const guidance={rgb:rgb.slice(),person:new Uint8Array(width*height).fill(255),width,height,orientation:{angle:270,mirror:null}};
 const ort={env:{wasm:{},webgpu:{}},Tensor:class{constructor(type,data,dims){this.data=data;this.dims=dims;}dispose(){}},InferenceSession:{
  async create(){return {inputNames:['image'],async run(feeds){
   seen.input=feeds.image;
   return {predicted_depth:{dims:[1,4,2],getData:async()=>Float32Array.from({length:8},(_,i)=>i+1),dispose(){}}};
  },async release(){seen.released=true;}};}
 }};
 const self={navigator:{},postMessage:value=>messages.push(value)};
 runInNewContext(workerSource,{URL,Uint8Array,Float32Array,console,self,testOrt:ort,depthModel,asDisparity,depthImageInput,depthOutputToStored,
  downloadModelBytes:async()=>Uint8Array.of(0),crypto:{subtle:{digest:async()=>Uint8Array.of(0).buffer}},
  fetch:async()=>({ok:true,json:async()=>({files:Object.fromEntries(depthModel(modelId).files.map(f=>[f,asset]))})}),
  refineDepth(values,mw,mh,guideRgb,gw,gh){
   seen.output={values,mw,mh};assert.equal(guideRgb,guidance.rgb);assert.deepEqual([gw,gh],[width,height]);
   return new Uint8Array(width*height);
  },
  protectPersonDepth(gray,person,gw,gh){assert.equal(person,guidance.person);assert.deepEqual([gw,gh],[width,height]);return gray;},
  depthWorkerFailure:error=>({error:error.message}),
 });
 await self.onmessage({data:{rgb,input:{width,height},guidance,provider:'wasm',modelId}});
 assert.ok(!messages.some(m=>m.error),JSON.stringify(messages));
 assert.deepEqual(Array.from(seen.input.dims),modelId==='pro'?[1,1,3,4,2]:[1,3,4,2],
  'portrait stored sideways must be rotated upright before the neural network');
 // Independent clockwise quarter-turn: display rows are stored bottom-to-top columns.
 const expectedIndices=[4,0,5,1,6,2,7,3],mean=[.485,.456,.406],std=[.229,.224,.225];
 for(let p=0;p<8;p++)for(let c=0;c<3;c++)assert.ok(Math.abs(seen.input.data[c*8+p]-(rgb[expectedIndices[p]*3+c]/255-mean[c])/std[c])<1e-6);
 assert.deepEqual([seen.output.mw,seen.output.mh],[4,2],'refinement must still operate in stored coordinates');
 const expected=[2,4,6,8,1,3,5,7].map(x=>modelId==='pro'?Math.fround(1/x):x);
 assert.deepEqual(Array.from(seen.output.values),expected,'inverse orientation restores exactly the corresponding pixel');
 assert.deepEqual(rgb,saved);assert.equal(seen.released,true);
});
}

test('all HEIF rotations and mirror axes permute RGB losslessly and restore float depth exactly',()=>{
 const w=3,h=2,source=[0,1,2,3,4,5],rgb=Uint8Array.from(source.flatMap(v=>[v,v+10,v+20]));
 for(const angle of [0,90,180,270])for(const mirror of [null,0,1]){
  let expected=[[0,1,2],[3,4,5]];
  if(mirror===0)expected.reverse();
  if(mirror===1)expected=expected.map(row=>row.slice().reverse());
  // Independent matrix rotation: HEIF irot is counterclockwise.
  for(let turn=0;turn<angle/90;turn++)expected=expected[0].map((_,i)=>expected.map(row=>row[row.length-1-i]));
  const image=depthImageInput(rgb,w,h,{angle,mirror}),order=expected.flat();
  assert.deepEqual([image.width,image.height],[expected[0].length,expected.length]);
  for(let p=0;p<6;p++)assert.deepEqual(Array.from(image.rgb.slice(p*3,p*3+3)),[order[p],order[p]+10,order[p]+20]);
  const output=depthOutputToStored(Float32Array.from(order,v=>v+.125),image.width,image.height,{angle,mirror});
  assert.deepEqual([output.mw,output.mh],[w,h]);assert.deepEqual(Array.from(output.values),source.map(v=>v+.125));
 }
 assert.deepEqual(rgb,Uint8Array.from(source.flatMap(v=>[v,v+10,v+20])));
 assert.equal(depthImageInput(rgb,w,h).rgb,rgb,'upright inputs take the allocation-free path');
 const values=Float32Array.from(source);assert.equal(depthOutputToStored(values,w,h).values,values);
 for(const orientation of [{angle:45},{mirror:2}])assert.throws(()=>depthImageInput(rgb,w,h,orientation),/geometry/);
 assert.throws(()=>depthOutputToStored(new Float32Array(2),w,h),/geometry/);
});
