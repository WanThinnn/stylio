import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

for(const name of ['foreground-matte-worker.js','subject-inference-worker.js']){
 for(const [source,expected]of [['cache','modelCache'],['cacheWarning','modelCacheWarning'],[undefined,'modelDownload']]){
  test(`${name}: ${source||'network'} has an honest stage and identifies its role`,async()=>{
   const url=new URL('../../web/src/portrait/'+name,import.meta.url),messages=[];
   const code=readFileSync(url,'utf8').replace(/^import .*;\r?\n/gm,'')
    .replaceAll('import.meta.url',JSON.stringify(url.href)).replace(/await import\([^)]*ort.webgpu.min.mjs[^)]*\)/g,'testOrt');
   const self={postMessage:event=>messages.push(event)};
   runInNewContext(code,{self,URL,Uint8Array,console,
    testOrt:{env:{webgpu:{},wasm:{}},InferenceSession:{create(){}}},
    fetch:async()=>({ok:true,json:async()=>({files:{
     'isnet-general-use-fp16.onnx':{url:'model',bytes:8,sha256:'0'.repeat(64)},
     'subject-encoder.onnx':{bytes:8,sha256:'0'.repeat(64)},
    }})}),
    downloadModelBytes:async(_url,{onProgress})=>{onProgress({source,loaded:8,total:8,complete:true});throw Error('end transfer probe');},
    subjectImageInput:()=>({}),depthWorkerFailure:error=>({error:error.message}),
   });
   await self.onmessage({data:{rgb:new Uint8Array(3),input:{width:1,height:1},guidance:{matte:{confidence:new Uint8Array(1)}},provider:'wasm'}});
   const transfer=messages.find(m=>m.progress?.loaded===8);
   assert.ok(transfer,'probe must reach the actual worker download callback');
   assert.equal(transfer.stage,expected);
   assert.equal(transfer.progress.resource,name.startsWith('foreground')?'segmentation':'segmentationRefinement');
  });
 }
}
