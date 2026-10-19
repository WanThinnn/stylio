import test from 'node:test';
import assert from 'node:assert/strict';
import {aiSourceCanvas,displayToStoredTransform} from '../../web/src/portrait/ai-portrait-source.js';

function sourceEnvironment(t,{htmlFailure=false,heic=false}={}){
 const calls={html:0,heif:0,freed:0,revoked:[],draw:[]},canvases=[];
 const original=new Map(['document','Image','createImageBitmap','libheif'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 t.after(()=>{for(const[k,d]of original)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 globalThis.createImageBitmap=async()=>{throw Error('JPEG ImageBitmap unavailable');};
 globalThis.Image=class{width=640;height=480;async decode(){calls.html++;if(htmlFailure)throw Error('Image decode rejected');}};
 globalThis.libheif={HeifDecoder:class{
  decode(bytes){calls.heif++;calls.decoded=bytes;if(!heic)throw Error('JPEG sent to the HEIC decoder');
   return [{get_width:()=>640,get_height:()=>480,display:(_,done)=>done({}),free(){calls.freed++;}}];}
  free(){calls.freed++;}
 }};
 globalThis.document={createElement(type){
  assert.equal(type,'canvas');const context={setTransform(...v){calls.transform=v;},drawImage(...v){calls.draw.push(v);},resetTransform(){},
   createImageData:()=>({}),putImageData(){}};
  const canvas={width:0,height:0,getContext:()=>context};canvases.push(canvas);return canvas;
 }};
 t.mock.method(URL,'createObjectURL',()=> 'blob:test-jpeg');
 t.mock.method(URL,'revokeObjectURL',url=>calls.revoked.push(url));
 return {calls,canvases};
}

test('JPEG source survives ImageBitmap rejection without entering the HEIC decoder',async t=>{
 const {calls}=sourceEnvironment(t);
 const jpeg=new File([Uint8Array.of(255,216,255,217)],'Indigo.JPEG',{type:'image/jpeg'});
 const canvas=await aiSourceCanvas(new Uint8Array(),{width:320,height:240,angle:270,mirror:1},jpeg);
 assert.deepEqual([canvas.width,canvas.height],[320,240]);
 assert.equal(calls.html,1);assert.equal(calls.heif,0);
 assert.deepEqual(calls.transform,displayToStoredTransform(320,240,270,1));
 assert.equal(calls.draw.length,1);assert.deepEqual(calls.revoked,['blob:test-jpeg']);
});

test('raster decode failures free the canvas and object URL without trying a HEIC decoder',async t=>{
 const {calls,canvases}=sourceEnvironment(t,{htmlFailure:true});
 const file=new File([Uint8Array.of(255,216,255,217)],'image-without-mime');
 await assert.rejects(aiSourceCanvas(new Uint8Array(),{width:320,height:240},file),/AI source image decode failed/);
 assert.equal(calls.heif,0);assert.deepEqual(calls.revoked,['blob:test-jpeg']);
 assert.deepEqual([canvases[0].width,canvases[0].height],[0,0]);
});

test('native HEIC retains the existing libheif fallback and releases native handles',async t=>{
 const {calls,canvases}=sourceEnvironment(t,{heic:true});
 const bytes=Uint8Array.from([0,0,0,24,...new TextEncoder().encode('ftypheic'),0,0,0,0,...new TextEncoder().encode('mif1heic')]);
 const file=new File([bytes],'native.HEIC',{type:'image/heic'});
 const canvas=await aiSourceCanvas(bytes,{width:320,height:240},file);
 assert.deepEqual([canvas.width,canvas.height],[320,240]);
 assert.equal(calls.html,0);assert.equal(calls.heif,1);assert.deepEqual(calls.decoded,bytes);
 assert.equal(calls.freed,2);assert.deepEqual(calls.revoked,[]);
 assert.deepEqual([canvases[1].width,canvases[1].height],[0,0]);
});
