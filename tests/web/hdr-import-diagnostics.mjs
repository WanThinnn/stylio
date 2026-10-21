import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('HDR import retains the failing phase and original codec error',async()=>{
 const code=readFileSync(new URL('../../web/src/raster/raster-import.js',import.meta.url),'utf8');
 const failure=Error('WASM allocation failed');
 const importHdr=runInNewContext(code.slice(code.indexOf('async function importHdrJpeg('))+'\nimportHdrJpeg;',{
  Uint8Array,TILE:512,extractRasterExif:()=>null,readExifOrientation:()=>1,targetGeometry:()=>({}),
  ensureHevcEncoder:async()=>{throw failure;},
 });
 await assert.rejects(importHdr({width:3024,height:4032,gainWidth:1512,gainHeight:2016},new Uint8Array(),()=>{},{analyze:true}),error=>{
  assert.equal(error,failure);assert.equal(error.code,'err.hdrjpeg');
  assert.equal(error.hdrStage,'encoder-load');return true;
 });
});

test('file processing shows HDR diagnostics without publishing an incomplete output',async()=>{
 const source=readFileSync(new URL('../../web/src/app/processing/file-processor.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function createFileProcessor','function createFileProcessor')
  .replace('await import("../../raster/raster-import.js")','({importRaster:failImport})');
 const failure=Object.assign(Error('HEVC encoder released'),{code:'err.hdrjpeg',hdrStage:'main-tiles'});
 const create=runInNewContext(source+'\ncreateFileProcessor;',{
  File,Uint8Array,crossOriginIsolated:true,console:{error(){},warn(){}},
  readImageFile:async()=>({bytes:new Uint8Array([255,216,255]),format:'jpeg'}),
  RASTER_MIMES:{jpeg:'image/jpeg'},failImport:async()=>{throw failure;},
  releaseDecodeCache(){},releaseHevcEncoder(){},releaseRasterEncoder(){},releaseHeicProcessor(){},
 });
 const events=[],ui={set:(...args)=>events.push(['set',...args]),note:(...args)=>events.push(['note',...args]),progress(){},output(){throw Error('must not publish');}};
 const processor=create({row:()=>ui,T:key=>key,getLanguage:()=> 'en',aiText:()=>({}),
  aiFeatures:{enabled:()=>false},gpuAcceleration:{checked:true},selectedAiLevel:()=> 'standard',analysis:{}});
 await processor.handleFile(new File([new Uint8Array([255,216,255])],'IDG_test.jpg',{type:'image/jpeg'}));
 assert.ok(events.some(e=>e[0]==='set'&&e[1]==='err.hdrjpeg'));
 assert.ok(events.some(e=>e[0]==='note'&&/main-tiles/.test(e[1])&&/HEVC encoder released/.test(e[1])));
 failure.message='FFmpeg exit 1: '+('encoder progress '.repeat(40))+'Cannot allocate memory';
 await processor.handleFile(new File([new Uint8Array([255,216,255])],'IDG_test.jpg',{type:'image/jpeg'}));
 assert.ok(events.some(e=>e[0]==='note'&&/Cannot allocate memory/.test(e[1])),'long codec logs must retain the final error, not just the banner');
});
