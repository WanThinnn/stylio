import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortraitProgress} from '../../web/src/app/processing/portrait-progress.js';
import {AI_STRINGS} from '../../web/src/ui/ai-strings.js';

test('Portrait progress follows actual work and remains monotonic across decoder loads and fallback',()=>{
 const values=[],states=[],progress=createPortraitProgress({progress:v=>values.push(v),aiState:v=>states.push(v)},()=>AI_STRINGS.en,'standard');
 progress.start();assert.equal(values.at(-1),35);
 for(const resource of ['depth','segmentation','segmentationRefinement']){
  progress.update('modelDownload',{resource,loaded:5,total:10});
  assert.match(states.at(-1),/Downloading/);assert.match(states.at(-1),/50%/);assert.ok(!states.at(-1).includes('{model}'));
  progress.update('modelLoading',{resource});assert.match(states.at(-1),/Initializing/);
  assert.ok(!progress.describe('modelLoading').includes('{model}'),'failure diagnostics must resolve the same role label');
  progress.update('inference',{resource});
  assert.equal(states.at(-1),AI_STRINGS.en[{depth:'inference',segmentation:'segmenting',segmentationRefinement:'refiningEdges'}[resource]]);
  progress.update('qualityFallback');
 }
 progress.update('modelCache',{resource:'segmentationRefinement',source:'cache',loaded:10,total:10});
 assert.match(states.at(-1),/Reading the saved Segmentation Refinement Model/);assert.doesNotMatch(states.at(-1),/Downloading/);
 progress.update('refining',{resource:'geometry'});assert.equal(values.at(-1),88);
 progress.update('encoding');assert.equal(values.at(-1),92);progress.update('preview');assert.equal(values.at(-1),98);
 assert.ok(values.every((value,index)=>index===0||value>=values[index-1]));
});

test('legacy cached download callbacks do not misreport network activity',()=>{
 for(const lang of ['vi','en','zh']){
  const states=[],progress=createPortraitProgress({progress(){},aiState:v=>states.push(v)},()=>AI_STRINGS[lang],'lite');
  progress.update('download',{source:'cache',loaded:100,total:100,resource:'depth'});
  assert.equal(states.at(-1),AI_STRINGS[lang].modelCache.replace('{model}',AI_STRINGS[lang].depthModel));
  for(const key of ['depthModel','segmentationModel','segmentationRefinementModel']){
   assert.ok(AI_STRINGS[lang][key]);assert.doesNotMatch(AI_STRINGS[lang][key],/Depth Anything|IS-Net|EdgeSAM/);
  }
 }
});
