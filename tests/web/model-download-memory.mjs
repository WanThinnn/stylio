import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function downloader({chunks,headers={},cached=null,failPut=false}={}){
 const source=readFileSync(new URL('../../web/src/core/model-download.js',import.meta.url),'utf8').replaceAll('export ','');
 const events=[],allocations=[],puts=[];let reads=0,requests=0;
 class TrackedBytes extends Uint8Array{
  constructor(value){super(value);if(typeof value==='number')allocations.push({bytes:value,reads});}
 }
 const cache={match:async()=>cached,delete:async()=>true,put:async(_url,response)=>{
  if(failPut)throw Error('quota');puts.push(new Uint8Array(await response.arrayBuffer()));
 }};
 const load=runInNewContext(source+';downloadModelBytes;',{
  Uint8Array:TrackedBytes,Response,AbortController,performance,setTimeout,clearTimeout,
  console:{warn(){}},fetch:async()=>{
   requests++;let index=0;
   return {ok:true,headers:new Headers(headers),body:{getReader:()=>({
    async read(){reads++;return index<chunks.length?{done:false,value:chunks[index++]}:{done:true};},
    releaseLock(){},cancel:async()=>{},
   })}};
  },
 });
 return {events,allocations,puts,requests:()=>requests,
  load:options=>load('https://test.invalid/model',{cacheStorage:{open:async()=>cache},onProgress:event=>events.push(event),...options})};
}

for(const compressed of [false,true])test(`known-size ${compressed?'compressed':'identity'} download fills one destination instead of retaining all chunks`,async()=>{
 const chunks=[Uint8Array.of(1,2),Uint8Array.of(3,4)],h=downloader({chunks,headers:{'content-length':compressed?'2':'4',...(compressed?{'content-encoding':'gzip'}:{})}});
 const bytes=await h.load({expectedBytes:4});assert.deepEqual(Array.from(bytes),[1,2,3,4]);
 assert.deepEqual(h.allocations,[{bytes:4,reads:0}],'one model-sized destination must exist before reading the stream');
 assert.equal(h.puts.length,1);assert.equal(h.events.at(-1).total,4);
});

test('a valid saved model emits only cache events and never fetches again',async()=>{
 const h=downloader({cached:new Response(Uint8Array.of(1,2,3),{headers:{'content-length':'3'}})});
 assert.deepEqual(Array.from(await h.load({expectedBytes:3})),[1,2,3]);
 assert.equal(h.requests(),0);assert.ok(h.events.every(event=>event.source==='cache'));
});

test('truncated and oversized model streams are rejected before storage',async()=>{
 for(const length of [3,5]){
  const h=downloader({chunks:[new Uint8Array(length)]});
  await assert.rejects(h.load({expectedBytes:4}),/Incomplete|exceeds/);
  assert.equal(h.puts.length,0);
 }
});

test('cache quota failures do not discard downloaded weights and are reported honestly',async()=>{
 const h=downloader({chunks:[Uint8Array.of(1,2)],failPut:true});
 assert.deepEqual(Array.from(await h.load({expectedBytes:2})),[1,2]);
 assert.ok(h.events.some(event=>event.source==='cacheWarning'));
});
