import {inferenceGeometry} from './ai-portrait-container.js';
import {refineDepth,shapeAiDisparity,AI_DISPARITY_MAX} from './ai-depth-refinement.js';
import {discoverHeic,dimensionsForItem} from '../core/heif.js';
import {itemOrientation} from '../raster/heif.js';
import {aiSourceCanvas,rgbSample} from './ai-portrait-source.js';
import {inferDepth,awaitAiSource,depthInputBudgets,canRetryDepth,canFallbackDepthToCpu} from './ai-inference.js';
import {readPersonGuidance} from './person-depth-guidance.js';
import {depthModel} from './depth-models.js';
import {refinePortraitSubject} from './subject-inference.js';

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
    const previewRgb=rgbSample(source,width,height);let inferred,used,person=null,usedProvider=provider,lastError;
    try{person=await readPersonGuidance(data,width,height);}catch(error){console.warn('Optional person guidance unavailable',error);}
    signal?.throwIfAborted();
    const providers=provider==='webgpu'?['webgpu','wasm']:['wasm'];
    providerLoop: for(const candidateProvider of providers){
      const budgets=depthInputBudgets(navigator,candidateProvider);
      for(const edge of budgets){
        used=inferenceGeometry(w,h,edge);
        try{
          inferred=await inferDepth(rgbSample(source,used.width,used.height),used,{signal,provider:candidateProvider,modelId,
            onProgress:(stage,progress)=>onProgress(candidateProvider==='wasm'&&stage==='inference'?'inferenceCpu':stage,progress),
            guidance:{rgb:previewRgb,person,width,height}});
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
    // Custom providers may return float values. The production worker refines
    // the map off the UI thread and quantizes only after guided resampling.
    let gray=shapeAiDisparity(inferred.gray||refineDepth(inferred.values,inferred.mw,inferred.mh,previewRgb,width,height)),subjectReport;
    // The depth worker has finished and been terminated. Release the decode
    // surface before the separate subject encoder/decoder allocation.
    source.width=source.height=0;
    try{
      onProgress('subjectRefining');
      const subject=await refinePortraitSubject(gray,previewRgb,width,height,orientation,{signal,provider:usedProvider,onProgress});
      if(!(subject.gray instanceof Uint8Array)||subject.gray.length!==gray.length)throw Error('Invalid refined subject depth');
      gray=subject.gray;subjectReport=subject.subjectReport;
    }catch(error){
      signal?.throwIfAborted();if(['AbortError','TimeoutError'].includes(error.name))throw error;
      console.warn('Subject refinement unavailable; retaining generated depth',error);
      subjectReport={applied:false,reason:'unavailable'};
    }
    return {gray,subjectReport,disparityMax:AI_DISPARITY_MAX,width,height,previewRgb,orientation,sourceData:data,sourceFile,sourceWidth:w,sourceHeight:h,inferenceWidth:used.width,inferenceHeight:used.height,provider:usedProvider,modelId};
  } finally { if(source)source.width=source.height=0; }
}
