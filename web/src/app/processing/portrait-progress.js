import {formatBytes} from '../../ui/result-metadata.js';

// Work-weighted milestones, not a timer or an ETA. A single inference call
// has no measurable intermediate completion; never invent a ticking percent.
export function createPortraitProgress(ui,aiText,modelId){
  let resource='depth',percent=35;
  const phases={
    depth:modelId==='lite'?{start:35,loaded:53,inference:60,refining:85}:{start:35,loaded:43,inference:46,refining:55},
    segmentation:{start:56,loaded:62,inference:65,refining:69},
    segmentationRefinement:{start:70,loaded:76,inference:80,refining:85},
    geometry:{start:88,loaded:88,inference:88,refining:88},
  };
  const names={depth:'depthModel',segmentation:'segmentationModel',segmentationRefinement:'segmentationRefinementModel'};
  const work={depth:'inference',segmentation:'segmenting',segmentationRefinement:'refiningEdges',geometry:'optimizingDepth'};
  function advance(value){percent=Math.max(percent,value);ui.progress?.(percent);}
  function update(stage,progress={}){
    if(Object.hasOwn(phases,progress.resource))resource=progress.resource;
    // Defend against older callbacks that label every asset read as download.
    if(['download','modelDownload'].includes(stage)&&progress.source==='cache')stage='modelCache';
    if(['download','modelDownload'].includes(stage)&&progress.source==='cacheWarning')stage='modelCacheWarning';
    const text=aiText(),phase=phases[resource],model=text[names[resource]]||text.depthModel||'';
    const transfer=['download','modelDownload','modelCache'].includes(stage);
    if(transfer){
      const ratio=Number.isFinite(progress.total)&&progress.total>0?Math.max(0,Math.min(1,progress.loaded/progress.total)):0;
      advance(phase.start+(phase.loaded-phase.start)*ratio);
      const label=(text[stage==='modelCache'?'modelCache':'modelDownload']||'').replace('{model}',model);
      const detail=stage==='modelCache'?'':`${progress.total>0?` ${Math.round(ratio*100)}%`:''}${progress.loaded>0?` · ${formatBytes(progress.loaded)}`:''}`;
      ui.aiState(label+detail);return;
    }
    if(stage==='modelLoading'||stage==='modelCacheWarning'){
      advance(stage==='modelLoading'?phase.loaded:phase.start);
      ui.aiState((text[stage]||text.loading||'').replace('{model}',model));return;
    }
    if(['inference','inferenceCpu','subjectRefining'].includes(stage)){
      advance(stage==='subjectRefining'?phase.start:phase.inference);
      ui.aiState(text[work[resource]]||text.loading);return;
    }
    if(stage==='refining'){
      advance(phase.refining);ui.aiState(text[resource==='geometry'?'optimizingDepth':'refining']||text.loading);return;
    }
    if(stage==='encoding'){advance(92);ui.aiState(text.encoding);return;}
    if(stage==='preview'){advance(98);return;}
    advance(phase.start);ui.aiState(text[stage]||text.loading);
  }
  function describe(stage){
    const text=aiText(),key=['inference','inferenceCpu','subjectRefining'].includes(stage)?work[resource]:stage;
    return (text[key]||text.loading||'').replace('{model}',text[names[resource]]||text.depthModel||'');
  }
  return {update,describe,start:()=>{advance(35);ui.aiState(aiText().loading);}};
}
