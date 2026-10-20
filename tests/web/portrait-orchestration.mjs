import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {inferDepth} from '../../web/src/portrait/ai-inference.js';
import {depthModel} from '../../web/src/portrait/depth-models.js';
import {shapeAiDisparity,AI_DISPARITY_MAX} from '../../web/src/portrait/ai-depth-refinement.js';
import {fuseForegroundMattes,foregroundFocusPoint,portraitFocusAnchor} from '../../web/src/portrait/foreground-matte.js';
import {fusePortraitDepth} from '../../web/src/portrait/subject-depth-guidance.js';

// Exercise the actual orchestration with model/decode boundaries substituted.
// Timeout cases use the real worker watchdog, not a hand-created error name.
const source=readFileSync(new URL('../../web/src/portrait/ai-portrait.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export async function createAiPortrait','async function createAiPortrait');

function harness({apple=true,foreground,subject}={}){
  const width=64,height=64,confidence=new Uint8Array(width*height),calls=[],canvases=[],events=[];
  for(let y=12;y<52;y++)for(let x=12;x<52;x++)confidence[y*width+x]=245;
  const matte={width,height,confidence,source:'apple-pem'},gray=new Uint8Array(width*height).fill(150);
  const context={Uint8Array,console:{warn(){}},navigator:{gpu:{}},crossOriginIsolated:true,
    depthModel,shapeAiDisparity,AI_DISPARITY_MAX,fuseForegroundMattes,foregroundFocusPoint,portraitFocusAnchor,fusePortraitDepth,
    discoverHeic:()=>({props:{},primary:1}),dimensionsForItem:()=>[width,height],
    inferenceGeometry:()=>({width,height}),itemOrientation:()=>({angle:0,mirror:null}),
    storedPointToDisplay:(x,y)=>({x,y}),depthInputBudgets:()=>[64],
    awaitAiSource:create=>create(),aiSourceCanvas:async()=>{const canvas={width,height};canvases.push(canvas);return canvas;},
    rgbSample:()=>new Uint8Array(width*height*3),readApplePortraitMatte:async()=>apple?matte:null,readAppleSkinMatte:async()=>null,
    inferDepth:async(rgb,geometry,options)=>{calls.push({stage:'depth',modelId:options.modelId});return {gray:gray.slice()};},
    inferForegroundMatte:async(...args)=>{calls.push({stage:'foreground',options:args[4]});return foreground?foreground(...args):{...matte,source:'isnet'};},
    refinePortraitSubject:async(...args)=>{calls.push({stage:'subject'});return subject?subject(...args):{matte:args[0],subjectReport:{applied:false}};},
  };
  const create=runInNewContext(source+'\ncreateAiPortrait;',context);
  return {run:options=>create(new Uint8Array(),stage=>events.push(stage),null,options),calls,canvases,events,gray};
}

async function watchdog(signal){
  return inferDepth(new Uint8Array(3),{width:1,height:1},{signal,timeoutMs:5,
    workerFactory:()=>({postMessage(){},terminate(){}})});
}

test('optional IS-Net watchdog retains Apple guidance and completes depth fusion',async()=>{
  const h=harness({foreground:(rgb,w,h,o,{signal})=>watchdog(signal)});
  const output=await h.run({modelId:'standard'});
  assert.match(output.foregroundReport.generatedError,/timed out/);
  assert.equal(h.calls.filter(c=>c.stage==='subject').length,1);
  assert.ok(h.events.includes('qualityFallback'));assert.ok(output.gray instanceof Uint8Array);
  assert.ok(h.canvases.every(c=>c.width===0&&c.height===0));
});

test('optional EdgeSAM watchdog retains the accepted foreground matte',async()=>{
  const h=harness({subject:(matte,rgb,w,h,o,{signal})=>watchdog(signal)});
  const output=await h.run({modelId:'pro'});
  assert.equal(output.foregroundReport.edge.reason,'unavailable');
  assert.match(output.foregroundReport.edge.error,/timed out/);
  assert.ok(h.events.includes('qualityFallback'));assert.equal(output.gray.length,4096);
});

test('parent cancellation still rejects instead of silently publishing a fallback',async()=>{
  const controller=new AbortController();
  const h=harness({foreground:async(rgb,w,h,o,{signal})=>{
    const pending=watchdog(signal);controller.abort();return pending;
  }});
  await assert.rejects(h.run({modelId:'standard',signal:controller.signal}),{name:'AbortError'});
  assert.equal(h.calls.filter(c=>c.stage==='subject').length,0);
  assert.ok(h.canvases.every(c=>c.width===0&&c.height===0));
});

test('Standard and Pro use identical foreground stages and select only a different depth model',async()=>{
  const outputs=[];
  for(const modelId of ['standard','pro']){
    const h=harness(),output=await h.run({modelId});outputs.push(output);
    assert.deepEqual(h.calls.map(c=>c.stage),['depth','foreground','subject']);
    assert.equal(h.calls[0].modelId,modelId);
    assert.equal(h.calls[1].options.modelId,undefined,'foreground inference has no tier-specific policy');
  }
  assert.deepEqual(outputs[0].gray,outputs[1].gray);
  assert.deepEqual(structuredClone(outputs[0].foregroundReport),structuredClone(outputs[1].foregroundReport));
});

test('without foreground guidance, optional failure returns generated depth without guessing a subject',async()=>{
  const h=harness({apple:false,foreground:()=>watchdog()});
  const output=await h.run({modelId:'standard'});
  assert.equal(output.foregroundReport.reason,'no-foreground-guidance');
  assert.equal(h.calls.filter(c=>c.stage==='subject').length,0);
  assert.deepEqual(output.gray,shapeAiDisparity(h.gray));
});

test('Lite without Apple guidance remains depth-only and does not download a new foreground model',async()=>{
  const h=harness({apple:false}),output=await h.run({modelId:'lite'});
  assert.deepEqual(h.calls.map(c=>c.stage),['depth']);
  assert.equal(output.foregroundReport.reason,'no-foreground-guidance');
});
