// Optional Portrait orchestration; preserves the normal output on failure.
import {releaseDecodeCache} from '../../media/decode.js';
import {releaseHevcEncoder} from '../../codecs/ffmpeg-hevc.js';
import {releaseHevcEncoder as releaseRasterEncoder} from '../../raster/ffmpeg-hevc.js';
import {releaseHeicProcessor} from '../../media/heic-processing.js';
import {photoCaptureDate} from '../../media/photo-date.js';
import {createPortraitProgress} from './portrait-progress.js';
export function createPortraitController({aiFeatures,aiCandidates,aiText,gpuAcceleration,selectedAiLevel,lane=0,acquireProcessingSlot}){
  // Keep the normal result for toggle-off/cancellation. Only opt-in adds Portrait.
  async function tryAiPortrait(source, outputFile, ui, name, sourceFile = null, preserveIncomplete = false) {
    const {portraitEligibility} = await import('../../portrait/ai-portrait-container.js');
    const candidate = {outputFile, sourceFile, ui, name, state: 'new',lane,
      skip: preserveIncomplete ? 'unverified-styles' : source ? portraitEligibility(source) : null};
    aiCandidates.push(candidate);
    candidate.run=()=>runAiCandidate(candidate);
    if (aiFeatures.enabled('portrait')&&!candidate.skip) await runAiCandidate(candidate);
    else {
      if(candidate.skip){candidate.state='skipped';ui.aiState('');ui.note(candidate.skip==='unverified-styles'?aiText().compatibility:aiText().skip,candidate.skip==='unverified-styles'?'compatibility':'ai');}
      ui.output(outputFile);ui.progress?.(100);ui.aiBusy(false);
    }
  }

  async function runAiCandidate(candidate) {
    if (!aiFeatures.enabled('portrait') || !['new', 'failed'].includes(candidate.state)) return;
    const {ui, name, sourceFile} = candidate;
    if (candidate.skip) { candidate.state = 'skipped'; ui.aiState('');ui.note(candidate.skip==='unverified-styles'?aiText().compatibility:aiText().skip,candidate.skip==='unverified-styles'?'compatibility':'ai');ui.progress?.(100);ui.aiBusy(false); return; }
    candidate.state = 'running';
    const modelId=selectedAiLevel(),progress=createPortraitProgress(ui,aiText,modelId);progress.start();
    ui.note('', 'ai-error');
    ui.aiBusy(true);
    const controller=new AbortController();candidate.controller=controller;
    const removeCancel=ui.cancelAi(controller);
    // Downloads have a stall timeout; GPU phases have their own watchdog.
    let deadline,releaseSlot;
    let lastStage='loading';
    const provider=gpuAcceleration.checked?'webgpu':'wasm';
    try {
      releaseSlot=await acquireProcessingSlot?.({signal:controller.signal,onWait:()=>ui.aiState(aiText().waitingResources)});
      controller.signal.throwIfAborted();
      deadline=setTimeout(()=>controller.abort(new DOMException('AI timed out','TimeoutError')),600000);
      const {createAiPortrait} = await import('../../portrait/ai-portrait.js');
      const {exportAiPortrait} = await import('../../portrait/ai-portrait-export.js');
      const data = new Uint8Array(await candidate.outputFile.arrayBuffer());
      // These serialized conversion jobs are finished. Free their WASM heaps
      // before loading the GPU model, especially after JPEG/PNG or thumbnails.
      releaseDecodeCache();releaseHevcEncoder();releaseRasterEncoder();releaseHeicProcessor();
      // Suggested Styles uses its own ORT/WebGPU session. Never keep that session
      // alive while loading the much larger depth model, especially on Safari.
      if(aiFeatures.enabled('style'))await import('../../recommend/style-runtime.js').then(({releaseStyleRecommender})=>releaseStyleRecommender()).catch(()=>{});
      const result = await createAiPortrait(data,(stage,event)=>{
        lastStage=stage;
        progress.update(stage,event);
      },sourceFile,{signal:controller.signal,provider,modelId});
      lastStage='encoding';progress.update('encoding');
      const output=await exportAiPortrait(result,()=>{}, {signal:controller.signal});
      ui.cleanup(output.dispose);
      controller.signal.throwIfAborted();
      if(!aiFeatures.enabled('portrait'))throw new DOMException('AI disabled','AbortError');
      const date=photoCaptureDate(output.data);
      const publish=(data,metadata=true)=>{
        candidate.aiFile=new File([data],name.replace(/\.[^.]+$/,'')+'_Portrait.HEIC',{
          type:'image/heic',...(date?.timestamp!==undefined?{lastModified:date.timestamp}:{})});
        if(aiFeatures.enabled('portrait'))ui.output(candidate.aiFile,{metadata});
      };
      publish(output.data);
      progress.update('preview');
      const previewResult={...result,disparityMax:output.report?.previewDisparityMax??output.report?.disparityMax??result.disparityMax};
      try{await ui.portraitPreview(previewResult,async(settings,isCurrent)=>{const updated=await output.withSettings(settings);if(isCurrent())publish(updated.data,false);});}
      catch(error){console.warn('Portrait preview unavailable; edit focus in Photos',error);}
      candidate.state = 'done';
      ui.aiView(aiFeatures.enabled('portrait'));
      if(aiFeatures.enabled('portrait')){ui.progress?.(100);ui.aiState('');ui.note(result.subjectReport?.reason==='unavailable'?`${aiText().ready} ${aiText().subjectUnavailable}`:aiText().ready,'ai');}
    } catch(error) {
      candidate.state = error.name==='AbortError'?'new':'failed';
      console.warn('Optional AI Portrait failed',error);
      ui.aiState(!aiFeatures.enabled('portrait')?'':error.name==='AbortError'?aiText().cancelled:error.name==='TimeoutError'?aiText().timeout:error.message==='WEBGPU'?aiText().gpu:aiText().failed);
      if(aiFeatures.enabled('portrait')&&error.name!=='AbortError')ui.note(`${aiText().failureStage}: ${progress.describe(error.stage||lastStage)}. ${String(error.message||error).slice(0,180)}`,'ai-error');
    } finally {
      // Export normally releases its encoder; cover cancellation/failure too.
      if(releaseSlot){releaseDecodeCache();releaseHevcEncoder();releaseRasterEncoder();releaseHeicProcessor();releaseSlot();}
      clearTimeout(deadline);removeCancel();candidate.controller=null;
      // Publish the normal fallback only after AI failed/cancelled. Never expose
      // it between Styles processing and the requested Portrait result.
      if(!candidate.aiFile||!aiFeatures.enabled('portrait'))ui.output(candidate.outputFile);
      // Re-enabling Portrait queues this row with its save controls locked.
      // End that lock for success, failure and cancellation; only a real
      // outstanding preview settings write should keep the result pending.
      ui.outputPending?.(Boolean(candidate.aiFile&&aiFeatures.enabled('portrait')&&ui.portraitPending));
      ui.progress?.(100);ui.aiBusy(false);
    }
  }

    return {tryAiPortrait,runAiCandidate};
}

