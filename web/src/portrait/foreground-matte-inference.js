import {inferDepth,canFallbackDepthToCpu} from './ai-inference.js';

export async function inferForegroundMatte(rgb,width,height,orientation,{signal,provider='webgpu',onProgress=()=>{},workerFactory}={}){
  const size=1024;
  const run=chosen=>inferDepth(rgb.slice(),{width,height},{signal,provider:chosen,timeoutMs:chosen==='wasm'?300000:180000,
    guidance:{orientation,size},
    onProgress,
    ...(workerFactory?{workerFactory}:{workerFactory:()=>new Worker(new URL('./foreground-matte-worker.js',import.meta.url),{type:'module'})})});
  try{
    const result=await run(provider);
    if(!result?.matte?.confidence||result.matte.confidence.length!==width*height)throw Error('Invalid foreground matte result');
    return result.matte;
  }catch(error){
    signal?.throwIfAborted();
    if(provider==='webgpu'&&(canFallbackDepthToCpu(error,provider)||/shader-f16|webgpu|unsupported.*(operator|kernel)/i.test(error.message))){
      console.warn('Foreground matte WebGPU unavailable; retrying WASM',error);
      onProgress('qualityFallback');
      const result=await run('wasm');
      if(!result?.matte?.confidence||result.matte.confidence.length!==width*height)throw Error('Invalid foreground matte result');
      result.matte.report={...result.matte.report,fallbackFrom:'webgpu',fallbackReason:String(error?.message||error)};
      return result.matte;
    }
    throw error;
  }
}
