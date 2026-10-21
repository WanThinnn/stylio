import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Keep the real queue/publication lifecycle; replace only costly AI/codec imports.
function controller({failure=null,previewPending=false,disparityMax,previewDisparityMax}={}){
 let source=readFileSync(new URL('../../web/src/app/processing/portrait-controller.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function createPortraitController','function createPortraitController');
 for(const[name,replacement]of [
  ["await import('../../portrait/ai-portrait.js')",'testDependencies'],
  ["await import('../../portrait/ai-portrait-export.js')",'testDependencies'],
 ]){assert.ok(source.includes(name));source=source.replace(name,replacement);}
 const create=runInNewContext(source+';createPortraitController;',{
  AbortController,DOMException,setTimeout,clearTimeout,Uint8Array,File,
  releaseDecodeCache(){},releaseHevcEncoder(){},releaseRasterEncoder(){},releaseHeicProcessor(){},photoCaptureDate:()=>null,
  console:{warn(){}},testDependencies:{createAiPortrait:async()=>{if(failure)throw failure;return {};},
   exportAiPortrait:async()=>({data:Uint8Array.of(1),report:{disparityMax,previewDisparityMax},dispose(){},withSettings(){}})},
 });
 const ui={outputPendingState:true,progress(){},aiState(){},note(){},aiBusy(){},aiView(){},cancelAi:()=>()=>{},cleanup(){},
  output(file){this.published=file;},outputPending(pending){this.outputPendingState=pending;},
  async portraitPreview(result){this.previewResult=result;this.portraitPending=previewPending;},
 };
 const runner=create({aiFeatures:{enabled:id=>id==='portrait'},aiCandidates:[],aiText:()=>({}),
  gpuAcceleration:{checked:true},selectedAiLevel:()=> 'lite'});
 const original=new File([Uint8Array.of(0)],'styles.HEIC');
 return {ui,original,candidate:{ui,outputFile:original,name:'photo.JPEG',state:'new'},runner};
}

for(const[kind,failure]of [['failure',Error('inference failed')],['cancellation',new DOMException('Cancelled','AbortError')],['success',null]]){
 test(`queued Portrait ${kind} releases the save lock after publishing`,async()=>{
  const {ui,original,candidate,runner}=controller({failure});
  await runner.runAiCandidate(candidate);
  assert.equal(ui.outputPendingState,false,'queue pending must not survive completion');
  assert.equal(ui.published,failure?original:candidate.aiFile);
  assert.equal(candidate.state,failure?(failure.name==='AbortError'?'new':'failed'):'done');
 });
}

test('a genuine pending Portrait preview continues to protect the downloadable result',async()=>{
 const {ui,candidate,runner}=controller({previewPending:true});
 await runner.runAiCandidate(candidate);
 assert.equal(candidate.state,'done');assert.equal(ui.outputPendingState,true);
});

test('interactive preview receives the same normalized disparity range as the exported Portrait',async()=>{
 const {ui,candidate,runner}=controller({disparityMax:12.469766884405981});
 await runner.runAiCandidate(candidate);
 assert.equal(candidate.state,'done');assert.equal(ui.previewResult.disparityMax,12.469766884405981);
});

test('scene preview uses the optical-compensated preview response instead of physical disparity units',async()=>{
 const {ui,candidate,runner}=controller({disparityMax:24,previewDisparityMax:2});
 await runner.runAiCandidate(candidate);
 assert.equal(candidate.state,'done');assert.equal(ui.previewResult.disparityMax,2);
});
