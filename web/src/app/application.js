import {getAppShell} from '../ui/shell/app-shell.js';
import {VERSION} from '../styles/port.js';
import {loadLibheif,releaseDecodeCache} from '../media/decode.js';
import {pickLanguage,rememberLanguage,applyLanguage,t} from '../ui/i18n.js';
import {AI_STRINGS} from '../ui/ai-strings.js';
import {prepareBrowser} from '../ui/startup.js';
import {releaseHevcEncoder} from '../codecs/ffmpeg-hevc.js';
import {releaseHevcEncoder as releaseRasterEncoder} from '../raster/ffmpeg-hevc.js';
import {releaseHeicProcessor} from '../media/heic-processing.js';
import {depthModel} from '../portrait/depth-models.js';
import {clearDownloadedAssets,clearAllAppCaches} from '../core/cache-cleanup.js';
import {createAiFeatureControls,showAiSettingsHintOnce} from '../ui/ai-feature-controls.js';
import {createResultView} from '../ui/results/result-view.js';
import {createHistoryStore,restoredFile} from '../ui/history-store.js';
import {confirmAction} from '../ui/confirm-dialog.js';
import {createLivePhotoSession} from '../media/live-photo-session.js';
import {createProfileRepository} from './processing/profiles.js';
import {createPhotoAnalysis} from './processing/photo-analysis.js';
import {createPortraitController} from './processing/portrait-controller.js';
import {createFileProcessor} from './processing/file-processor.js';
import {createTaskQueue} from './processing/task-queue.js';
import {createIsolatedProcessor} from './processing/isolated-processor.js';
import {getProcessingPreferences,PROCESSING_STORAGE_KEYS,parallelProcessingSupported} from '../ui/processing-preferences.js';
import {createScreenAwake} from '../ui/screen-awake.js';

// App wiring and session lifecycle; domain workflows live in their modules.
export function startApplication(){
  const shell=getAppShell();
  const preferences=getProcessingPreferences();
  let parallelProcessor=null,screenAwake;
  const $ = (id) => document.getElementById(id);
  const fileInput = $("file"), drop = $("drop"), list = $("list");
  const aiPortrait = $("ai-portrait"), aiDetail = $("ai-detail"), aiStyleSuggest=$("ai-style-suggest"), enhanceAi = $("enhance-ai");
  const gpuAcceleration=$('gpu-acceleration');
  const modelSelector=$('depth-model'),clearAssets=$('clear-assets'),fullCleanup=$('full-cleanup');
  const modelLevels=['lite','standard','pro'];
  const appStorageKeys=['psport.lang','stylio-theme-v1','stylio-result-preview-v1','photo-format-tip-dismissed-v1','stylio-ai-settings-hint-v2','stylio-has-processed','depth-model','depth-gpu-acceleration',...PROCESSING_STORAGE_KEYS];
  const aiSettings=$('ai-settings');

  const selectedAiLevel=()=>modelLevels[Number(modelSelector.value)];
  function renderModel(){
    const name=depthModel(selectedAiLevel()).label;
    $('depth-model-value').textContent=name;modelSelector.setAttribute('aria-valuetext',name);
    modelSelector.parentElement.style.setProperty('--model-position',['20px','50%','calc(100% - 20px)'][Number(modelSelector.value)]);
    modelSelector.parentElement.dataset.level=modelSelector.value;
  }
  let clearingAssets=false,fullCleaning=false,assetStatus='';
  try{const saved=localStorage.getItem('depth-model')||'standard';depthModel(saved);modelSelector.value=modelLevels.indexOf(saved);}catch{}

  renderModel();
  modelSelector.addEventListener('input',()=>{
    renderModel();try{localStorage.setItem('depth-model',selectedAiLevel());}catch{}
  });
  try{gpuAcceleration.checked=localStorage.getItem('depth-gpu-acceleration')!=='off';}catch{}
  gpuAcceleration.addEventListener('change',()=>{
    try{localStorage.setItem('depth-gpu-acceleration',gpuAcceleration.checked?'on':'off');}catch{}
  });
  const clearHistory = $('clear-history');
  const historyStore=createHistoryStore();
  let historyEpoch=0;
  const previewEnabled=()=>$('result-preview')?.checked!==false;
  const resultUrls = new Set(), resultCleanups = new Set();
  const aiCandidates = [];
  let browserReady = false, pendingTasks = 0;
  const aiFeatures=createAiFeatureControls({
    master:enhanceAi,
    features:{portrait:aiPortrait,detail:aiDetail,style:aiStyleSuggest},
    isAvailable:()=>browserReady&&!clearingAssets&&!fullCleaning,
  });
  function refreshHistoryButton() {
    clearHistory.hidden = !list.childElementCount;
    clearHistory.disabled = pendingTasks > 0;
    if($('refresh-app'))$('refresh-app').disabled=pendingTasks>0||clearingAssets||fullCleaning||document.documentElement?.dataset.updating==='true';
    clearAssets.disabled=!browserReady||pendingTasks>0||clearingAssets||fullCleaning||aiCandidates.some(candidate=>candidate.ui.portraitPending);
    fullCleanup.disabled=!browserReady||pendingTasks>0||clearingAssets||fullCleaning||aiCandidates.some(candidate=>candidate.ui.portraitPending);
  }
  function queueTask(task,lane) {
    if(document.documentElement?.dataset.updating==='true')return Promise.resolve();
    return queue.enqueue([{task,lane}]).catch(error=>console.warn('Queued task failed',error));
  }
  clearHistory.addEventListener('click', async() => {
    if (pendingTasks) return;
    if(!await confirmAction({
      title:T('shell.clear').replace('{count}',String(list.childElementCount)),
      detail:T('confirm.cannotundo'),
      confirmLabel:T('action.delete'),
      cancelLabel:T('action.cancel'),
    }))return;
    if(pendingTasks)return;
    historyEpoch++;
    for (const cleanup of resultCleanups) cleanup();
    resultCleanups.clear();
    for (const url of resultUrls) URL.revokeObjectURL(url);
    resultUrls.clear(); livePhotos.length = 0; liveMovies.clear(); aiCandidates.length = 0;
    parallelProcessor?.dispose();parallelProcessor=null;
    void historyStore.clear();
    list.replaceChildren(); fileInput.value = ''; releaseDecodeCache();
    releaseHevcEncoder(); releaseRasterEncoder(); releaseHeicProcessor();
    void import('../detail/detail-inference.js').then(({releaseDetailWorkers})=>releaseDetailWorkers()).catch(()=>{});
    void import('../recommend/style-runtime.js').then(({releaseStyleRecommender})=>releaseStyleRecommender()).catch(()=>{});
    refreshHistoryButton();
  });
  clearAssets.addEventListener('click',async()=>{
    if(clearAssets.disabled)return;
    clearingAssets=true;assetStatus='cleaning';translateAi();refreshHistoryButton();
    aiFeatures.sync();
    $('model-options').disabled=modelSelector.disabled=gpuAcceleration.disabled=true;
    fileInput.disabled=true;drop.setAttribute('aria-disabled','true');
    try{
      releaseDecodeCache();releaseHevcEncoder();releaseRasterEncoder();releaseHeicProcessor();
      await parallelProcessor?.releaseResources();
      const [{releaseOrtModels},{releaseDetailWorkers},{releaseStyleRecommender}]=await Promise.all([
        import('../vision/ort-vision.js'),import('../detail/detail-inference.js'),import('../recommend/style-runtime.js')]);
      releaseDetailWorkers();releaseStyleRecommender();await releaseOrtModels();
      await clearDownloadedAssets();assetStatus='cleaned';
    }catch(error){console.warn('Cache cleanup unavailable',error);assetStatus='cleanupFailed';}
    finally{clearingAssets=false;aiFeatures.sync();$('model-options').disabled=modelSelector.disabled=gpuAcceleration.disabled=false;fileInput.disabled=!browserReady;drop.setAttribute('aria-disabled',String(!browserReady));translateAi();refreshHistoryButton();}
  });
  fullCleanup.addEventListener('click',async()=>{
    if(fullCleanup.disabled)return;
    if(!await confirmAction({
      title:T('confirm.resettitle'),detail:T('confirm.resetdetail'),confirmLabel:T('action.reset'),cancelLabel:T('action.cancel')
    }))return;
    if(pendingTasks)return;
    historyEpoch++;
    fullCleaning=true;fullCleanup.setAttribute('aria-busy','true');$('full-cleanup-status').textContent=T('settings.fullcleaning');
    refreshHistoryButton();aiFeatures.sync();
    $('model-options').disabled=modelSelector.disabled=gpuAcceleration.disabled=true;
    fileInput.disabled=true;drop.setAttribute('aria-disabled','true');
    let reloading=false;
    try{
      for(const cleanup of [...resultCleanups])cleanup();
      resultCleanups.clear();
      for(const url of resultUrls)URL.revokeObjectURL(url);
      resultUrls.clear();livePhotos.length=0;liveMovies.clear();aiCandidates.length=0;
      parallelProcessor?.dispose();parallelProcessor=null;
      if(historyStore.destroy)await historyStore.destroy();else await historyStore.clear();list.replaceChildren();fileInput.value='';
      releaseDecodeCache();releaseHevcEncoder();releaseRasterEncoder();releaseHeicProcessor();
      const [{releaseOrtModels},{releaseDetailWorkers},{releaseStyleRecommender}]=await Promise.all([
        import('../vision/ort-vision.js'),import('../detail/detail-inference.js'),import('../recommend/style-runtime.js')]);
      releaseDetailWorkers();releaseStyleRecommender();await releaseOrtModels();
      await clearAllAppCaches();
      for(const key of appStorageKeys)try{localStorage.removeItem(key);}catch{}
      for(const key of ['stylio-screen','counted'])try{sessionStorage.removeItem(key);}catch{}
      $('full-cleanup-status').textContent='';
      reloading=true;location.reload();
    }catch(error){
      console.warn('Full Stylio cleanup unavailable',error);
      $('full-cleanup-status').textContent=T('settings.fullcleanupfailed');
    }finally{
      if(!reloading){
        fullCleaning=false;fullCleanup.removeAttribute('aria-busy');
        $('model-options').disabled=modelSelector.disabled=gpuAcceleration.disabled=false;
        fileInput.disabled=!browserReady;drop.setAttribute('aria-disabled',String(!browserReady));aiFeatures.sync();refreshHistoryButton();
      }
    }
  });
  const aiText = () => AI_STRINGS[lang] || AI_STRINGS.en;
  function translateAi() {
    $("enhance-ai-label").textContent = aiText().masterToggle;
    $("ai-portrait-label").textContent = aiText().toggle;
    $("ai-portrait-hint").textContent = aiText().hint;
    $("ai-portrait-hint").hidden = false;
    $("ai-detail-label").textContent = aiText().detailToggle;
    $("ai-detail-hint").textContent = aiText().detailHint;
    $('ai-style-suggest-label').textContent=aiText().styleToggle;
    $('ai-style-suggest-hint').textContent=aiText().styleHint;

    $('ai-settings').hidden=false;
    $('ai-settings-label').textContent=aiText().settings;
    $('ai-settings-discovery-copy').textContent=aiText().settingsDiscovery;
    $('gpu-acceleration-label').textContent=aiText().acceleration;
    $('gpu-acceleration-hint').textContent=aiText().accelerationHint;
    $('depth-model-label').textContent=aiText().model;
    $('depth-model-hint').textContent=aiText().modelHint;
    $('clear-assets-label').textContent=aiText().cleanup;
    $('clear-assets-hint').textContent=aiText().cleanupHint;
    $('clear-assets-status').textContent=assetStatus?aiText()[assetStatus]:'';
    clearAssets.dataset.state=assetStatus;clearAssets.setAttribute('aria-busy',String(clearingAssets));
    clearAssets.title=assetStatus==='cleanupFailed'?aiText().cleanupFailed:aiText().cleanupHint;
  }
  aiPortrait.addEventListener('change', () => {
    translateAi();
    for (const candidate of aiCandidates) {
      if (!aiFeatures.enabled('portrait')) {
        candidate.controller?.abort();
        candidate.ui.outputPending(false);
        candidate.ui.output(candidate.outputFile);
        candidate.ui.aiView(false);candidate.ui.aiBusy(false);
        candidate.ui.aiState('');candidate.ui.note('', 'ai');candidate.ui.note('', 'ai-error');
      } else if (candidate.aiFile) {
        candidate.ui.outputPending(Boolean(candidate.ui.portraitPending));
        candidate.ui.output(candidate.aiFile);candidate.ui.note(aiText().ready, 'ai');
        candidate.ui.aiView(true);
      } else if (['new', 'failed'].includes(candidate.state)) {
        candidate.ui.outputPending(true);candidate.ui.queued?.();
        queueTask(() => (candidate.run?candidate.run():runAiCandidate(candidate)),candidate.lane);
      }
    }
  });

  aiStyleSuggest.addEventListener('change',()=>{
    if(aiStyleSuggest.checked)return;
    void import('../recommend/style-runtime.js').then(({releaseStyleRecommender})=>releaseStyleRecommender()).catch(()=>{});
  });

  // Fetch the decoder while the visitor is still choosing a photo,
  // so the first photo does not wait for the download, and someone just reading the page
  // downloads nothing. A failure here is harmless: ensureDecode() tries again and falls back.
  const warmDecoder = () => { loadLibheif().catch(() => {}); };
  for (const ev of ["pointerdown", "dragenter", "focus"]) drop.addEventListener(ev, warmDecoder, { once: true });

  let lang = pickLanguage();
  const T = (key) => t(lang, key);
  function showBootError(message){
    const boot=$('boot');boot.replaceChildren();boot.className='err app-error-banner';
    const icon=document.createElement('span');icon.className='app-error-icon';icon.setAttribute('aria-hidden','true');
    icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>';
    const copy=document.createElement('span');copy.className='app-error-copy';copy.textContent=message;
    const retry=document.createElement('button');retry.className='app-error-retry';retry.type='button';retry.textContent=T('btn.retry');retry.addEventListener('click',()=>location.reload());
    boot.append(icon,copy,retry);
  }
  const analysis=createPhotoAnalysis({T,aiText,aiFeatures,selectedAiLevel,gpuAcceleration});
  const {liveMovies,livePhotos,attachMovie,handleMovie}=createLivePhotoSession({T});
  const profiles=createProfileRepository();
  const {ensureProfileIndex,getProfile}=profiles;
  const row=createResultView({list,T,aiText,resultCleanups,resultUrls,aiCandidates,livePhotos,liveMovies,aiFeatures,refreshHistoryButton,shell,historyStore,previewEnabled,preferences});
  async function restorePersistentHistory(){
    const epoch=historyEpoch;
    const entries=await historyStore.list();
    if(epoch!==historyEpoch||fullCleaning)return;
    const restore=()=>{
      for(const entry of entries){
        const file=restoredFile(entry);
        if(!file)continue;
        const ui=row(entry.name||entry.fileName||file.name,file,{
          historyId:entry.id,restored:true,restoredPreview:entry.preview||null,restoredThumbnail:entry.thumbnail||null
        });
        ui.output(file,{metadata:false,persist:false});
        ui.set(T('st.ready'),'ok');
      }
    };
    if(shell.batch)shell.batch(restore);else restore();
    refreshHistoryButton();
  }
  const {tryAiPortrait,runAiCandidate}=createPortraitController({aiFeatures,aiCandidates,aiText,gpuAcceleration,selectedAiLevel});
  const processingDependencies={row,T,getLanguage:()=>lang,aiText,aiFeatures,aiCandidates,gpuAcceleration,selectedAiLevel,handleMovie,liveMovies,livePhotos,attachMovie,ensureProfileIndex,getProfile,tryAiPortrait,analysis};
  const processor=createFileProcessor(processingDependencies);
  const queue=createTaskQueue({
    concurrency:()=>preferences.get('parallel')&&parallelProcessingSupported(navigator)?2:1,
    onChange:state=>{pendingTasks=state.pending;refreshHistoryButton();screenAwake?.setBusy(state.active>0);},
    async run(job,lane){
      if(job.task)return job.task();
      try{
        if(lane===0)await processor.handleFile(job.file,job.ui);
        else{
          parallelProcessor??=createIsolatedProcessor(processingDependencies);
          await parallelProcessor.handleFile(job.file,job.ui);
        }
      }catch(error){console.warn('Photo processing unavailable',error);job.ui.set(T('err.resources'),'err');}
    },
  });
  screenAwake=createScreenAwake({enabled:()=>preferences.get('keepAwake'),onState:state=>{
    const hint=$('keep-awake-status');if(!hint)return;
    const key=!navigator.wakeLock?.request?'settings.awakeunsupported'
      :'settings.'+({active:'awakeactive',unsupported:'awakeunsupported',unavailable:'awakeunavailable'}[state]||'awakehint');
    hint.dataset.i18n=key;hint.textContent=T(key);
  }});
  if(!navigator.wakeLock?.request){$('keep-screen-awake').disabled=true;
    $('keep-awake-status').dataset.i18n='settings.awakeunsupported';$('keep-awake-status').textContent=T('settings.awakeunsupported');}
  preferences.subscribe(key=>{if(key==='parallel')queue.refresh();if(key==='keepAwake')screenAwake.refresh();});
  const enqueueFiles=files=>{
    if(!browserReady||clearingAssets||fullCleaning||document.documentElement?.dataset.updating==='true'||!files.length)return;
    let jobs;
    const register=()=>{jobs=files.map(file=>{const ui=row(file.name,file);ui.queued?.();return {file,ui};});};
    if(shell.batch)shell.batch(register);else register();
    void queue.enqueue(jobs).catch(error=>console.warn('Photo queue failed',error));
  };

  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    enqueueFiles([...e.dataTransfer.files]);
  });
  drop.addEventListener("click", () => { if (browserReady) fileInput.click(); });
  fileInput.addEventListener("change", () => {
    enqueueFiles([...fileInput.files]);
    fileInput.value = "";
  });

  $("lang").addEventListener("change", () => {
    lang = $("lang").value;
    rememberLanguage(lang);
    applyLanguage(lang);
    translateAi();shell.render();
  });

  // Visit counter behind the README badge. The only request this site makes to a
  // counter service, and it carries nothing but the fact that the page was opened —
  // no photo ever reaches it. Fired once per browser session so a reload is not a
  // new visit, and fire-and-forget: a counter that is down is not worth an error.
  // If sessionStorage is blocked the visit goes uncounted, which undercounts
  // rather than counting every reload of a private-mode window as a new visitor.
  function countVisit() {
    try {
      if (sessionStorage.getItem("counted")) return;
      sessionStorage.setItem("counted", "1");
    } catch (e) {
      return;
    }
    fetch("https://abacus.jasoncameron.dev/hit/nathanatgit-shalielie/web").catch(() => {});
  }

  return (async () => {
    applyLanguage(lang);
    translateAi();
    $("version").textContent = VERSION;
    countVisit();
    $('boot').textContent = T('st.preparing');
    try {
      const browserMode=await prepareBrowser();
      if(browserMode==='reloading')return 'reloading';
      // The profile index is only required by legacy/full reconstruction. A transient
      // deploy/cache miss must not block native HEIC editing or the rest of the UI.
      void profiles.preload();

      browserReady = true;refreshHistoryButton();
      fileInput.disabled = false; drop.setAttribute('aria-disabled', 'false');
      aiFeatures.sync();
      void restorePersistentHistory().catch(error=>console.warn('History restore unavailable',error));
      showAiSettingsHintOnce({hint:$('ai-settings-discovery'),settings:aiSettings});
      $('boot').textContent = '';
      const controller=navigator.serviceWorker?.controller;
      if(controller)controller.postMessage({type:'WARM_CACHE'});
      else navigator.serviceWorker?.ready?.then(registration=>registration.active?.postMessage({type:'WARM_CACHE'})).catch(()=>{});
      // Leave heavy encoders/models lazy; cached UI and native metadata editing
      // must not allocate their WASM heaps merely because the PWA was reopened.
      if(browserMode!=='ready')console.warn('Running without cross-origin isolation; threaded HEVC/AI features will request isolation when used.');
    } catch (e) {
      console.error('Browser preparation failed', e);
      showBootError(T(e?.code==='BROWSER_INSECURE_CONTEXT'?'err.setup':'err.resources'));
    }
  })();

}

