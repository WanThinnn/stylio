import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProcessingBudget,createTaskQueue} from '../../web/src/app/processing/task-queue.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('shared mobile budget is FIFO, cancellation-safe and idempotently released',async()=>{
 const acquire=createProcessingBudget(),release=await acquire(),abort=new AbortController(),events=[];
 const cancelled=acquire({signal:abort.signal,onWait:()=>events.push('wait')});
 const rejected=assert.rejects(cancelled,{name:'AbortError'});
 const next=acquire().then(release=>{events.push('next');release();});
 abort.abort();await rejected;release();release();await next;
 assert.deepEqual(events,['wait','next']);
 const done=await acquire();done();
});

test('aborting before acquisition never consumes a resource slot',async()=>{
 const acquire=createProcessingBudget(),controller=new AbortController();controller.abort();
 await assert.rejects(acquire({signal:controller.signal}),{name:'AbortError'});
 const release=await acquire();release();
});

test('the actual raster workflow releases codec/model heaps before Portrait handoff and never allocates while queued',async()=>{
 const acquire=createProcessingBudget(),events=[],ui=()=>({set(){},note(){},progress(){},metadata:async()=>{},cleanup(){}});
 let used=0,peak=0,finishFirst;
 const createLane=name=>{
  const source=readFileSync(new URL('../../web/src/app/processing/file-processor.js',import.meta.url),'utf8')
   .replace(/^import .*;\r?\n/gm,'').replace('export function createFileProcessor','function createFileProcessor')
   .replace('await import("../../raster/raster-import.js")','({importRaster:testImport})');
  const create=runInNewContext(source+';createFileProcessor;',{
   File,Uint8Array,console,crossOriginIsolated:true,RASTER_MIMES:{jpeg:'image/jpeg'},
   readImageFile:async()=>{used++;peak=Math.max(peak,used);events.push(name+':read');return {bytes:Uint8Array.of(1),format:'jpeg'};},
   testImport:async()=>({data:Uint8Array.of(1),geometry:{resized:false}}),photoCaptureDate:()=>null,
   releaseDecodeCache(){events.push(name+':free');},releaseHevcEncoder(){},releaseRasterEncoder(){},releaseHeicProcessor(){},
  });
  return create({T:key=>key,getLanguage:()=> 'en',aiText:()=>({}),
   aiFeatures:{enabled:feature=>feature==='portrait'},selectedAiLevel:()=> 'standard',gpuAcceleration:{checked:true},
   acquireProcessingSlot:acquire,releaseIdleModels:async()=>{events.push(name+':models-free');used--;},
   analysis:{addMissingSoftSkin:async data=>data,adaptiveStyleCompletionNotice(){}},
   tryAiPortrait:async()=>{
    assert.ok(events.includes(name+':models-free'),'previous AI and codecs must be freed before waiting for Portrait');
    events.push(name+':portrait-queued');
    const release=await acquire();used++;peak=Math.max(peak,used);events.push(name+':portrait');
    try{if(name==='a')await new Promise(resolve=>finishFirst=resolve);}
    finally{used--;release();}
   },
  });
 };
 const a=createLane('a'),b=createLane('b');
 const blocked=await acquire();
 const queue=createTaskQueue({concurrency:()=>2,run:({processor,name})=>processor.handleFile(new File(['jpeg'],name+'.jpg'),ui())});
 const result=queue.enqueue([{processor:a,name:'a'},{processor:b,name:'b'}]);
 await tick();assert.deepEqual(events,[],'neither waiting lane may read input or load a codec');blocked();
 await tick();assert.ok(events.includes('a:portrait'));
 assert.ok(events.indexOf('b:read')<events.indexOf('a:portrait'),'second photo advances between first conversion and AI');
 assert.equal(events.includes('b:portrait'),false,'no second model download/session while first AI is live');
 finishFirst();await result;
 assert.equal(peak,1,'two admitted jobs share a single heavy-memory budget');assert.equal(used,0);
});

test('failed conversion cleans its own realm before allowing the other lane to allocate',async()=>{
 const acquire=createProcessingBudget(),events=[];
 const source=readFileSync(new URL('../../web/src/app/processing/file-processor.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function createFileProcessor','function createFileProcessor');
 const create=runInNewContext(source+';createFileProcessor;',{
  File,console:{error(){}},readImageFile:async()=>{throw Error('read failed');},
  releaseDecodeCache:()=>events.push('codec-free'),releaseHevcEncoder(){},releaseRasterEncoder(){},releaseHeicProcessor(){},
 });
 const processor=create({analysis:{},aiFeatures:{enabled:()=>true},T:k=>k,aiText:()=>({}),
  acquireProcessingSlot:acquire,releaseIdleModels:async()=>events.push('models-free')});
 await processor.handleFile(new File(['bad'],'bad.heic'),{set(){},progress(){}});
 const release=await acquire();events.push('next');release();
 assert.deepEqual(events,['codec-free','models-free','next']);
});
