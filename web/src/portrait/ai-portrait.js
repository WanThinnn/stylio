import {inferenceGeometry} from './ai-portrait-container.js';
import {refineDepth,shapeAiDisparity,AI_DISPARITY_MAX} from './ai-depth-refinement.js';
import {discoverHeic,dimensionsForItem} from '../core/heif.js';
import {itemOrientation,storedPointToDisplay} from '../raster/heif.js';
import {aiSourceCanvas,rgbSample} from './ai-portrait-source.js';
import {inferDepth,awaitAiSource,depthInputBudgets,canRetryDepth,canFallbackDepthToCpu} from './ai-inference.js';
import {readApplePortraitMatte,readAppleSkinMatte} from './person-depth-guidance.js';
import {depthModel} from './depth-models.js';
import {refinePortraitSubject} from './subject-inference.js';
import {inferForegroundMatte} from './foreground-matte-inference.js';
import {fuseForegroundMattes,foregroundFocusPoint,portraitFocusAnchor,selectGeneratedPortraitMatte} from './foreground-matte.js';
import {fusePortraitDepth} from './subject-depth-guidance.js';
import {describePortraitScene} from './portrait-scene-response.js';

export async function createAiPortrait(data,onProgress=()=>{},sourceFile=null,{signal,provider='webgpu',modelId='standard'}={}) {
  depthModel(modelId);
  if (provider==='webgpu'&&!navigator.gpu) throw Error('WEBGPU');
  if (!globalThis.crossOriginIsolated) throw Error('ISOLATION');
  let source;
  try {
    onProgress('loading');
    const d=discoverHeic(data),[w,h]=dimensionsForItem(d.props,d.primary);
    // Keep aspect ratio and a multiple of the network patch size. Bounding the
    // longest edge limits mobile GPU allocations without stretching the subject.
    const initialBudgets=depthInputBudgets(navigator,provider),input=inferenceGeometry(w,h,initialBudgets[0]);
    const orientation=itemOrientation(data,d.props,d.primary);
    const scale=Math.min(1,1024/Math.max(w,h)),width=Math.max(2,Math.round(w*scale/2)*2),height=Math.max(2,Math.round(h*scale/2)*2);
    // Decode real primary pixels at model resolution, rather than enlarging
    // the old preview and passing invented detail to the depth model.
    source=await awaitAiSource(()=>aiSourceCanvas(data,{width:Math.max(input.width,width),height:Math.max(input.height,height),...orientation},sourceFile),signal);
    signal?.throwIfAborted();
    const previewRgb=rgbSample(source,width,height);
    let inferred,used,appleMatte=null,skinMatte=null,usedProvider=provider,lastError;
    try{appleMatte=await readApplePortraitMatte(data,width,height);}
    catch(error){console.warn('Optional Apple Portrait Effects Matte unavailable',error);}
    try{skinMatte=await readAppleSkinMatte(data,width,height);}
    catch(error){console.warn('Optional Apple semantic skin matte unavailable',error);}
    signal?.throwIfAborted();
    const providers=provider==='webgpu'?['webgpu','wasm']:['wasm'];
    providerLoop: for(const candidateProvider of providers){
      const budgets=depthInputBudgets(navigator,candidateProvider);
      for(const edge of budgets){
        used=inferenceGeometry(w,h,edge);
        try{
          inferred=await inferDepth(rgbSample(source,used.width,used.height),used,{signal,provider:candidateProvider,modelId,
            onProgress:(stage,progress)=>onProgress(candidateProvider==='wasm'&&stage==='inference'?'inferenceCpu':stage,progress),
            guidance:{rgb:previewRgb,person:appleMatte?.confidence??null,width,height,orientation}});
          usedProvider=candidateProvider;break providerLoop;
        }catch(error){
          lastError=error;signal?.throwIfAborted();
          // Model/session allocation failures are not input-size dependent: leave
          // WebGPU immediately and retry the same model on WASM instead of making
          // Safari allocate the failed GPU backend again.
          if(candidateProvider==='webgpu'&&error.stage!=='inference'&&canFallbackDepthToCpu(error,candidateProvider))break;
          if(edge!==budgets.at(-1)&&canRetryDepth(error)){onProgress('qualityFallback');continue;}
          break;
        }
      }
      if(candidateProvider==='webgpu'&&canFallbackDepthToCpu(lastError,candidateProvider)){
        onProgress('inferenceCpu');continue;
      }
      if(!inferred)throw lastError||Error('AI depth inference failed');
    }
    if(!inferred)throw lastError||Error('AI depth inference failed');

    // The depth worker is terminated before any foreground model is created.
    let gray=shapeAiDisparity(inferred.gray||refineDepth(inferred.values,inferred.mw,inferred.mh,previewRgb,width,height));
    source.width=source.height=0;

    let generatedMatte=null,matte=null,subjectReport={applied:false,reason:'no-foreground-guidance'},foregroundReport={},suggestedFocus;
    if(modelId!=='lite'){
      try{
        onProgress('subjectRefining');
        // Standard and Pro share the accepted foreground/edge pipeline.
        // Their tier selects only the depth model above.
        generatedMatte=await inferForegroundMatte(previewRgb,width,height,orientation,{signal,provider:usedProvider,onProgress});
      }catch(error){
        signal?.throwIfAborted();onProgress('qualityFallback');
        console.warn('General foreground matte unavailable; continuing with Apple matte if present',error);
        foregroundReport.generatedError=String(error?.message||error);
      }
    }
    // Select the full PEM subject before consulting skin. The dominant PEM
    // group preserves held metal and occluded fingers while excluding detached
    // foreground detections on unrelated background objects.
    const focusAnchor=portraitFocusAnchor(appleMatte,skinMatte,width,height);
    const generatedSelection=focusAnchor?null:selectGeneratedPortraitMatte(generatedMatte,width,height);
    matte=fuseForegroundMattes(focusAnchor,focusAnchor?generatedMatte:generatedSelection?.matte,width,height);
    if(matte){
      foregroundReport={...foregroundReport,apple:appleMatte?.report??null,skin:skinMatte?.report??null,
        anchor:focusAnchor?.report??null,anchorSource:focusAnchor?.source??null,
        generated:generatedMatte?.report??null,generatedSelection:generatedSelection?.report??null,fused:matte.report??null};
      try{
        onProgress('subjectRefining');
        const subject=await refinePortraitSubject(matte,previewRgb,width,height,orientation,{signal,provider:usedProvider,onProgress});
        if(subject?.matte?.confidence?.length===gray.length){matte=subject.matte;foregroundReport.edge=subject.subjectReport;}
      }catch(error){
        signal?.throwIfAborted();onProgress('qualityFallback');
        console.warn('EdgeSAM matte refinement unavailable; retaining accepted matte',error);
        foregroundReport.edge={applied:false,reason:'unavailable',error:String(error?.message||error)};
      }
      // Keep every valid skin component. Protection still intersects the final
      // foreground, so skin alone cannot expand the accepted subject.
      const protectionMatte=skinMatte;
      // A generated foreground label does not establish shared focus distance.
      // Keep scene geometry unless an accepted Apple PEM/skin ownership anchor
      // supports the existing device-tested person/held-object focus fusion.
      const preserveGeometry=!focusAnchor;
      const fused=fusePortraitDepth(gray,matte,width,height,{protectionMatte,preserveGeometry,rgb:previewRgb});gray=fused.gray;
      foregroundReport.depth={...fused.report,protectionSource:protectionMatte?.source??null};
      subjectReport={...fused.report,foreground:true,edge:foregroundReport.edge??null};
      const focus=foregroundFocusPoint(matte,width,height,preserveGeometry?{gray}:{});
      if(focus){
        const display=storedPointToDisplay(focus.x,focus.y,orientation.angle,orientation.mirror);
        suggestedFocus={x:focus.x,y:focus.y,displayX:display.x,displayY:display.y,confidence:focus.confidence};
      }
    }else{
      foregroundReport={...foregroundReport,apple:appleMatte?.report??null,skin:skinMatte?.report??null,
        anchor:null,anchorSource:null,generated:generatedMatte?.report??null,
        generatedSelection:generatedSelection?.report??null,fused:null,reason:'no-foreground-guidance'};
    }

    const sceneProfile=describePortraitScene(gray,width,height,{focusX:suggestedFocus?.x??.5,focusY:suggestedFocus?.y??.5,matte});
    return {gray,subjectReport,foregroundReport,suggestedFocus,sceneProfile,disparityMax:AI_DISPARITY_MAX,width,height,previewRgb,orientation,
      sourceData:data,sourceFile,sourceWidth:w,sourceHeight:h,inferenceWidth:used.width,inferenceHeight:used.height,
      provider:usedProvider,modelId};
  } finally { if(source)source.width=source.height=0; }
}
