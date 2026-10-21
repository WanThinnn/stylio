import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readApplicationSource} from './helpers/application-source.mjs';

const app=readApplicationSource();
const raster=readFileSync(new URL('../../web/src/raster/raster-import.js',import.meta.url),'utf8');

test('Suggested Styles stays lazy when the independent feature is disabled',()=>{
  assert.match(app,/async function recommendHeicStyle[\s\S]*if\(!aiFeatures\.enabled\('style'\)\|\|preserveNativeStyles\(bytes,d\)\)return null;[\s\S]*import\('\.\.\/\.\.\/recommend\/style-runtime\.js'\)/);
  assert.match(raster,/async function suggestStyleForImage\(image,request,onProgress\)\{\s*if\(!request\)return \{recommendation:null,error:null\};[\s\S]*import\('\.\.\/recommend\/style-runtime\.js'\)/);
  assert.match(app,/styleSuggestion:aiFeatures\.enabled\('style'\)\?\{level:selectedAiLevel\(\),provider:/);
});

test('native preservation classification happens before any HEIC recommendation',()=>{
  const contract=app.indexOf('const {compatibility,compatibilityPreflight}=input');
  const classify=app.indexOf('const textureOnly=unknownAppleContract?false:preserveNativeStyles(bytes,d);',contract);
  const nativeBranch=app.indexOf('if (nativeTexture && !hasTexture(d.infos))',classify);
  const patchBranch=app.indexOf('const needsExperimental = d.hdrGrid === null',nativeBranch);
  const recommend=app.indexOf("opts.styleRecommendation=await recommendHeicStyle(bytes,d,ui)",patchBranch);
  assert.ok(contract>=0&&contract<classify&&classify<nativeBranch&&nativeBranch<patchBranch&&patchBranch<recommend);
  assert.equal((app.match(/opts\.styleRecommendation=await recommendHeicStyle/g)||[]).length,1);
  const helper=app.slice(app.indexOf('async function recommendHeicStyle'),app.indexOf('async function handleFile'));
  const bypass=helper.indexOf("preserveNativeStyles(bytes,d))return null"),load=helper.indexOf("import('../../recommend/style-runtime.js')");
  assert.ok(bypass>=0&&load>=0&&bypass<load,'a native Style marker/graph must return before loading the recommender');
  assert.doesNotMatch(app,/modernNativeCamera/,'camera model alone must not bypass third-party iPhone photos');
});

test('raster Detail changes pixels before Suggested Styles analyzes them',()=>{
  const detail=raster.indexOf('if(detail){');
  const assignsEnhanced=raster.indexOf('image=enhanced;',detail);
  const suggest=raster.indexOf('await suggestStyleForImage(image,styleSuggestion,onProgress)',detail);
  assert.ok(detail>=0&&detail<assignsEnhanced&&assignsEnhanced<suggest);
});

test('HEIC recommendation canonicalizes stored pixels to display orientation before inference',()=>{
  assert.match(app,/const orientation=rasterHeif\.itemOrientation\(bytes,rd\.props,rd\.primary\);[\s\S]*decodeToRgb\(bytes,\{width:sampleWidth,height:sampleHeight,\.\.\.orientation\}\)[\s\S]*orientStyleImage\([\s\S]*recommendStyleRgb\(display,/);
});

test('shared AI level and GPU toggle are forwarded to both raster and HEIC recommendation paths',()=>{
  assert.match(app,/styleSuggestion:aiFeatures\.enabled\('style'\)\?\{level:selectedAiLevel\(\),provider:gpuAcceleration\.checked\?'webgpu':'wasm'\}/);
  assert.match(app,/recommendStyleRgb\([\s\S]*level:selectedAiLevel\(\),provider:gpuAcceleration\.checked\?'webgpu':'wasm'/);
});

test('Adaptive Styles completion notice is gated by the feature and an actual recommendation',()=>{
  assert.match(app,/function adaptiveStyleCompletionNotice\(ui,recommendation\)\{\s*if\(!aiFeatures\.enabled\('style'\)\|\|!recommendation\)return;\s*ui\.adaptiveStyleAdvice\(aiText\(\)\.styleCompletionNotice\);\s*\}/);
  assert.match(app,/await tryAiPortrait\(null,output,ui,file\.name,file\);\s*adaptiveStyleCompletionNotice\(ui,result\.styleRecommendation\);/,
    'raster guidance should appear only after all selected processing completes');
  assert.match(app,/await tryAiPortrait\(bytes,shareFile,ui,file\.name,file,preserveIncomplete\);\}\s*adaptiveStyleCompletionNotice\(ui,adaptiveStyleRecommendation\);/,
    'HEIC guidance should appear only after all selected processing completes');
});

test('Suggested Styles bakes SDR and HDR display bases while retaining editable metadata',()=>{
  const patch=app.indexOf('await patchInWorker(bytes, profile, opts)');
  const softSkin=app.indexOf('data=await addMissingSoftSkin(data,file,ui',patch);
  const restore=app.indexOf('restoreNativePortraitInWorker(data',softSkin);
  const display=app.indexOf("import('../../recommend/style-display-heic.js')",restore);
  const publish=app.indexOf('const shareFile = new File([data]',display);
  assert.ok(patch>=0&&softSkin>patch&&restore>softSkin&&display>restore&&publish>display,
    'the display rendition must be the final HEIC pixel operation before publishing');
  assert.match(app,/if\(adaptiveStyleRecommendation\)[\s\S]*renderSuggestedStyleDisplay\(data,adaptiveStyleRecommendation/);
  assert.doesNotMatch(app,/report\.styleRecommendation&&d\.hdrGrid===null/);
  assert.match(app,/const needsStyledDisplay=shouldRenderStyleDisplay\(adaptiveStyleRecommendation\);[\s\S]*if\(needsStyledDisplay&&!rendered\.rendered\)[\s\S]*if\(needsStyledDisplay\)throw error;/,
    'metadata-only recommendations must not be published as successfully applied Styles');
  const linear=raster.indexOf('const linearThumbnail = await encodeLinearThumbnail(image');
  const render=raster.indexOf('const styleDisplayRendered=',linear);
  assert.ok(linear>=0&&render>linear,'linear thumbnail stays based on the unbaked editable source');
  assert.match(raster,/ctx\.drawImage\(stored,[\s\S]*renderStyleDisplayCanvas\(ctx,TILE,TILE,styled\.recommendation\)/);
  assert.match(raster,/if\(enhanced\|\|styleDisplayRendered\)main=await encodeHdrCanvasTiles[\s\S]*styleDisplayRendered\?styled\.recommendation:null/,
    'HDR JPEG imports must bake the suggested display colour into their primary too');
});
