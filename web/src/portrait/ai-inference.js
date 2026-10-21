// Termination releases the worker and its GPU session, including hung inference.
// A WebKit process termination bypasses catch/fallback entirely. Start within
// a moderate mobile budget instead of probing 1036/770 allocations on Safari.
export function depthInputBudgets({userAgent='',platform='',maxTouchPoints=0}=globalThis.navigator||{},provider='webgpu'){
  if(provider==='wasm')return [630,518];
  const ios=/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1);
  const safari=/Safari/i.test(userAgent)&&!/Chrome|Chromium|Edg\/|OPR\/|Android|Firefox/i.test(userAgent);
  return ios||safari?[630,518]:[1036,770,518];
}
// Runtime/WASM failures can be numbers or strings, not only Error objects.
export function depthWorkerFailure(error,stage){
  return {error:String(error?.message??error??'AI worker failed')||'AI worker failed',errorName:error?.name||'Error',errorStage:stage};
}
export function canRetryDepth(error){
  if(['AbortError','TimeoutError'].includes(error.name)||error.message==='WEBGPU')return false;
  return error.stage==='inference'||/(out.of.memory|memory allocation failed|no available backend|backend.*found|allocat|buffer.*(size|limit|failed)|device.*lost|AI worker failed)/i.test(error.message);
}
export function canFallbackDepthToCpu(error,provider='webgpu'){
  return provider==='webgpu'&&canRetryDepth(error);
}
export function awaitAiSource(create, signal) {
  if (!signal) return create();
  return new Promise((resolve,reject) => {
    if(signal.aborted){reject(signal.reason);return;}
    let cancelled=false;
    const abort=()=>{cancelled=true;reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(create).then(canvas=>{
      signal.removeEventListener('abort',abort);
      if(cancelled)canvas.width=canvas.height=0;else resolve(canvas);
    },error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
export function inferDepth(rgb, input, {signal, guidance,provider='webgpu',modelId='standard',timeoutMs = provider==='wasm'?240000:120000, onProgress = () => {}, workerFactory = () => new Worker(new URL('./ai-inference-worker.js',import.meta.url),{type:'module'})} = {}) {
  return new Promise((resolve,reject) => {
    if(!['webgpu','wasm'].includes(provider)){reject(Error('Unsupported depth provider'));return;}
    if(signal?.aborted){reject(signal.reason || new DOMException('Cancelled','AbortError'));return;}
    const worker = workerFactory();let settled=false,stage='modelLoading';
    const finish = (error,result) => { if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result); };
    const abort = () => finish(signal.reason || new DOMException('Cancelled','AbortError'));
    let timer;
    const arm=()=>{clearTimeout(timer);timer=setTimeout(() => finish(new DOMException('AI timed out','TimeoutError')),timeoutMs);};arm();
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror = () => finish(Object.assign(Error('AI worker failed'),{stage}));
    worker.onmessage = ({data}) => {
      if(data.stage){stage=data.stage;if(['download','modelDownload','modelCache'].includes(stage))clearTimeout(timer);else arm();onProgress(stage,data.progress);}
      else if('error' in data)finish(Object.assign(Error(String(data.error??'AI worker failed')||'AI worker failed'),{name:data.errorName||'Error',stage:data.errorStage||stage}));
      else if(data.result)finish(null,data.result);
      else finish(Object.assign(Error('AI worker returned no depth'),{stage}));
    };
    try { worker.postMessage({rgb,input,guidance,provider,modelId},[rgb.buffer]); } catch(error) {finish(error);}
  });
}
