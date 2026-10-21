import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAiFeatureControls} from '../../web/src/ui/ai-feature-controls.js';
import {createTaskQueue,createProcessingBudget} from '../../web/src/app/processing/task-queue.js';
import {createProcessingPreferences,PROCESSING_STORAGE_KEYS,memoryConstrainedProcessing} from '../../web/src/ui/processing-preferences.js';
import {createScreenAwake} from '../../web/src/ui/screen-awake.js';

// Exercise application wiring without downloading models, spawning workers or
// decoding photos. Domain factories are injected at the module boundary.
const source=readFileSync(new URL('../../web/src/app/application.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export function startApplication','function startApplication');
const resultViewSource=readFileSync(new URL('../../web/src/ui/results/result-view.js',import.meta.url),'utf8');
function harness({manualQueue=false,historyEntries=[],stallPreload=false,stallHistory=false,uncontrolled=false,nav={}}={}){
  const nodes=new Map(),calls=[],captured={},batches=new Map();
  const preferences=createProcessingPreferences({getItem:()=>null,setItem(){}});
  function batchFor(name){
    if(!batches.has(name)){
      let start,release;
      const started=new Promise(resolve=>start=resolve),gate=new Promise(resolve=>release=resolve);
      batches.set(name,{started,start,gate,release});
    }
    return batches.get(name);
  }
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    const listeners=new Map(),attrs=new Map();
    const n={id,checked:false,disabled:false,value:id==='depth-model'?'1':'en',
      childElementCount:0,dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},contains(){return false;}},
      parentElement:{style:{setProperty(){}},dataset:{}},
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
      dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);},
      fire(type,event={}){return Promise.all((listeners.get(type)||[]).map(fn=>fn(event)));},
      setAttribute(key,value){attrs.set(key,value);},removeAttribute(key){attrs.delete(key);},
      querySelector(selector){return node(id+selector);},append(){},replaceChildren(){},
      click(){calls.push(['picker']);}};
    nodes.set(id,n);return n;
  }
  const handleFile=async(file,ui,lane=0)=>{
    const batch=batchFor(file);calls.push(['start',file,lane]);batch.start();ui?.set('Working');
    if(manualQueue)await batch.gate;
    calls.push(['end',file,lane]);
  };
  const context={console,Event,setTimeout,clearTimeout,
    document:{getElementById:node,createElement:node,querySelectorAll:()=>[]},
    getAppShell:()=>({register(){},render(){}}),confirm:()=>true,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>true},
    navigator:{...nav,serviceWorker:{controller:uncontrolled?null:{postMessage:message=>calls.push(['worker',message.type])},
      ready:Promise.resolve({active:{postMessage:message=>calls.push(['worker',message.type])}})}},
    matchMedia:()=>({matches:false}),
    VERSION:'test',AI_STRINGS:{en:{},vi:{}},pickLanguage:()=> 'en',
    rememberLanguage:lang=>calls.push(['language',lang]),applyLanguage(){},t:(_lang,key)=>key,
    depthModel:id=>({label:id}),createAiFeatureControls,showAiSettingsHintOnce(){},confirmAction:async()=>true,
    prepareBrowser:async()=> 'ready-limited',prepareHevcAssets:()=>assert.fail('limited mode must not warm encoder'),
    loadLibheif:async()=>{},releaseDecodeCache(){},releaseHevcEncoder(){},releaseRasterEncoder(){},releaseHeicProcessor(){},
    clearDownloadedAssets:async()=>{},waitForVisiblePage:async()=>{},
    createPhotoAnalysis:deps=>{captured.analysis=deps;return {kind:'analysis'};},
    getProcessingPreferences:()=>preferences,PROCESSING_STORAGE_KEYS,memoryConstrainedProcessing,createTaskQueue,createProcessingBudget,createScreenAwake,
    createIsolatedProcessor:()=>({handleFile:(file,ui)=>handleFile(file,ui,1),releaseResources:async()=>{},dispose(){}}),
    createLivePhotoSession:deps=>{captured.live=deps;return {liveMovies:new Map(),livePhotos:[],attachMovie(){},handleMovie(){}};},
    createProfileRepository:()=>({preload:async()=>{calls.push(['profiles']);if(stallPreload)await new Promise(()=>{});},ensureProfileIndex(){},getProfile(){}}),
    createHistoryStore:()=>({list:async()=>stallHistory?new Promise(()=>{}):historyEntries,clear:async()=>calls.push(['history-clear']),remove:async()=>{},save:async()=>{}}),
    restoredFile:entry=>entry?.file||null,
    createResultView:deps=>{captured.results=deps;return (name,file,options={})=>{const item={name,file,options,outputs:[],states:[]};(captured.rows??=[]).push(item);return {output:(...args)=>item.outputs.push(args),set:(...args)=>item.states.push(args)};};},
    createPortraitController:deps=>{captured.portrait=deps;return {tryAiPortrait(){},runAiCandidate(){}};},
    createFileProcessor:deps=>{captured.processing=deps;return {handleFile};},
  };
  runInNewContext(source+'\nglobalThis.start=startApplication;',context);
  return {nodes,node,calls,captured,preferences,start:context.start,
    waitForStart:name=>batchFor(name).started,release:name=>batchFor(name).release()};
}

test('application initializes one shared session and supplies live language/settings to processors',async()=>{
  const h=harness();await h.start();
  assert.equal(h.node('file').disabled,false);
  assert.equal(h.node('enhance-ai').disabled,false);
  assert.equal(h.captured.processing.analysis.kind,'analysis');
  assert.equal(h.captured.processing.liveMovies,h.captured.results.liveMovies);
  assert.equal(h.captured.processing.livePhotos,h.captured.results.livePhotos);
  assert.equal(h.captured.portrait.aiCandidates,h.captured.results.aiCandidates);
  assert.equal(h.captured.processing.aiFeatures,h.captured.results.aiFeatures);
  assert.equal(h.captured.processing.getLanguage(),'en');
  h.node('lang').value='vi';await h.node('lang').fire('change');
  assert.equal(h.captured.processing.getLanguage(),'vi');
  h.node('depth-model').value='2';
  await h.node('depth-model').fire('input');
  assert.equal(h.captured.processing.selectedAiLevel(),'pro');
  assert.equal(h.node('depth-model-value').textContent,'pro');
  assert.equal(h.node('depth-model').parentElement.dataset.level,'2');
  assert.ok(h.calls.some(([type,value])=>type==='worker'&&value==='WARM_CACHE'));
});

test('separate picker/drop batches remain serialized and cache cleanup stays locked while queued',async()=>{
  const h=harness({manualQueue:true});await h.start();
  h.node('file').files=['first'];await h.node('file').fire('change');
  await h.node('drop').fire('drop',{preventDefault(){},dataTransfer:{files:['second']}});
  assert.equal(h.node('clear-assets').disabled,true);
  assert.equal(h.node('full-cleanup').disabled,true);
  assert.equal(h.node('clear-history').disabled,true);
  await h.waitForStart('first');
  assert.deepEqual(h.calls.filter(([type])=>type==='start'),[['start','first',0]]);
  h.release('first');await h.waitForStart('second');
  h.release('second');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.calls.filter(([type])=>['start','end'].includes(type)),
    [['start','first',0],['end','first',0],['start','second',0],['end','second',0]]);
  assert.equal(h.node('clear-assets').disabled,false);
  assert.equal(h.node('full-cleanup').disabled,false);
  assert.equal(h.node('clear-history').disabled,false);
});

test('all selected photos appear in History before the first conversion finishes',async()=>{
  const h=harness({manualQueue:true});await h.start();
  const files=[{name:'queued-a.heic'},{name:'queued-b.heic'},{name:'queued-c.heic'}];
  h.node('file').files=files;await h.node('file').fire('change');
  assert.equal(h.captured.rows?.length,3,'every selected file needs a queued History entry immediately');
  assert.deepEqual(h.captured.rows.map(row=>row.name),files.map(file=>file.name));
  for(const file of files)h.release(file);
});

test('three-stop model range updates the displayed name and the actual processing level',async()=>{
  const h=harness();await h.start();
  for(const [index,name]of ['lite','standard','pro'].entries()){
    h.node('depth-model').value=String(index);await h.node('depth-model').fire('input');
    assert.equal(h.captured.processing.selectedAiLevel(),name);
    assert.equal(h.node('depth-model-value').textContent,name);
    assert.equal(h.node('depth-model').parentElement.dataset.level,String(index));
  }
});

test('ready output is persisted immediately and preview enrichment cannot block F5 history restore',()=>{
  assert.match(resultViewSource,/const persistHistory=\(\)=>persistedOutput&&historyStore\?\.save\?\.\(\{[\s\S]*?preview:previewSnapshot,thumbnail:historyThumbnail/s);
  assert.doesNotMatch(resultViewSource,/persistedOutput&&previewSnapshotPromise\.then/);
  assert.match(resultViewSource,/previewSnapshotPromise\.then\(preview=>\{previewSnapshot=preview;void persistHistory\(\);\}\)/);
  const listener=resultViewSource.indexOf("image.addEventListener('load'");
  const sourceAssignment=resultViewSource.indexOf('image.src=url');
  assert.ok(listener>=0&&sourceAssignment>listener,'preview listeners must be attached before the blob URL can load');
});

test('persistent history is restored as ready downloadable results without reprocessing',async()=>{
  const file={name:'saved-result.heic',type:'image/heic',size:4096},preview={type:'image/jpeg',size:2048},thumbnail='data:image/jpeg;base64,thumb';
  const h=harness({historyEntries:[{id:'persisted-1',name:'original.heic',file,preview,thumbnail}]});await h.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.captured.rows.length,1);
  assert.equal(h.captured.rows[0].name,'original.heic');
  assert.equal(h.captured.rows[0].options.historyId,'persisted-1');
  assert.equal(h.captured.rows[0].options.restored,true);
  assert.equal(h.captured.rows[0].options.restoredPreview,preview);
  assert.equal(h.captured.rows[0].options.restoredThumbnail,thumbnail);
  assert.equal(h.captured.rows[0].outputs.length,1);
  assert.equal(h.captured.rows[0].outputs[0][0],file);
  assert.equal(h.captured.rows[0].outputs[0][1].metadata,false);
  assert.equal(h.captured.rows[0].outputs[0][1].persist,false);
  assert.equal(h.captured.rows[0].states[0][0],'st.ready');
  assert.equal(h.captured.rows[0].states[0][1],'ok');
});

test('a stalled profile prefetch or history read never blocks app readiness',async()=>{
  const h=harness({stallPreload:true,stallHistory:true});
  assert.equal(await Promise.race([h.start().then(()=> 'ready'),new Promise(resolve=>setTimeout(()=>resolve('blocked'),30))]),'ready');
  assert.equal(h.node('file').disabled,false);
});

test('first-visit offline preparation starts after the worker activates even before initial control',async()=>{
  const h=harness({uncontrolled:true});await h.start();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.calls.some(([type,message])=>type==='worker'&&message==='WARM_CACHE'));
});

test('late history restoration cannot resurrect entries after the user clears History',async()=>{
  let restore;
  const h=harness({historyEntries:new Promise(resolve=>restore=resolve)});await h.start();
  h.node('file').files=[{name:'new.heic'}];await h.node('file').fire('change');await new Promise(resolve=>setImmediate(resolve));
  await h.node('clear-history').fire('click');
  restore([{id:'old',name:'old.heic',file:{name:'old.heic',type:'image/heic'}}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.captured.rows.length,1,'only the new import was registered; cancelled restoration must not add the old entry');
  assert.ok(h.calls.some(([type])=>type==='history-clear'));
});

test('parallel preference starts two isolated lanes and changing it does not interrupt active work',async()=>{
  const h=harness({manualQueue:true});await h.start();
  h.preferences.set('parallel',true);
  h.node('file').files=['first','second','third'];await h.node('file').fire('change');
  await Promise.all([h.waitForStart('first'),h.waitForStart('second')]);
  assert.deepEqual(h.calls.filter(([type])=>type==='start'),[['start','first',0],['start','second',1]]);
  h.preferences.set('parallel',false);h.release('first');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.some(([type,file])=>type==='start'&&file==='third'),false);
  h.release('second');await h.waitForStart('third');h.release('third');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.node('clear-assets').disabled,false);
});

test('iOS and Safari admit two lanes but both use the same single-slot memory budget',async()=>{
  for(const nav of [{userAgent:'iPhone Version/27 Safari/605.1'},
    {userAgent:'Macintosh Version/27 Safari/605.1'},
    {userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}]){
    const h=harness({manualQueue:true,nav});await h.start();h.preferences.set('parallel',true);
    h.node('file').files=['first','second'];await h.node('file').fire('change');
    await Promise.all([h.waitForStart('first'),h.waitForStart('second')]);
    assert.deepEqual(h.calls.filter(([type])=>type==='start'),[['start','first',0],['start','second',1]]);
    assert.equal(h.captured.processing.acquireProcessingSlot,h.captured.portrait.acquireProcessingSlot);
    const acquire=h.captured.processing.acquireProcessingSlot;
    const release=await acquire();let secondGranted=false;
    const pending=acquire().then(release=>{secondGranted=true;release();});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(secondGranted,false);
    release();await pending;assert.equal(secondGranted,true);
    h.release('first');h.release('second');
  }
});

test('clearing history releases result cleanups and clears the shared Live Photo/AI session',async()=>{
  const h=harness();await h.start();let disposed=0;
  h.captured.results.resultCleanups.add(()=>disposed++);
  h.captured.results.livePhotos.push({});h.captured.results.liveMovies.set('id',{});
  h.captured.results.aiCandidates.push({ui:{}});
  await h.node('clear-history').fire('click');
  assert.equal(disposed,1);
  assert.equal(h.captured.results.resultCleanups.size,0);
  assert.equal(h.captured.results.livePhotos.length,0);
  assert.equal(h.captured.results.liveMovies.size,0);
  assert.equal(h.captured.results.aiCandidates.length,0);
});
