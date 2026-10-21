import {detailModel,validateDetailAsset} from './detail-models.js';
import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
const ASSETS=new URL('../../vendor/ai-portrait/',import.meta.url);
const {min,max}=Math;
const clamp=n=>max(0,min(255,Math.round(n)));

let runtime=null,busy=false;
async function releaseRuntime(){
  if(runtime?.session)await runtime.session.release();
  runtime=null;
}
async function ensureRuntime({modelId,provider,assetRoot,wasmThreads=1}){
  const key=`${modelId}:${provider}:${provider==='wasm'?wasmThreads:1}`;
  if(runtime?.key===key)return runtime;
  await releaseRuntime();
  const model=detailModel(modelId),root=new URL(assetRoot);
  const response=await fetch(new URL('assets.json',root),{cache:'no-store'});
  if(!response.ok)throw Error('AI detail model assets are not installed; run the model packaging tool');
  const manifest=await response.json(),entry=validateDetailAsset(manifest.models?.[modelId]);
  if(manifest.schema!==1||entry.family!==model.assetFamily)
    throw Error('AI detail model selection does not match pinned weights');
  const url=new URL(entry.file,root);url.searchParams.set('sha256',entry.sha256);
  const bytes=await downloadModelBytes(url.href,{expectedBytes:entry.bytes,onProgress:progress=>self.postMessage({
    stage:progress.source==='cache'?'modelCache':progress.source==='cacheWarning'?'modelCacheWarning':'modelDownload',progress,
  })});
  if(bytes.length!==entry.bytes)throw Error('AI detail model size mismatch');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==entry.sha256){try{await(await caches.open(MODEL_CACHE_NAME)).delete(url.href);}catch{}
    throw Error('AI detail model SHA-256 mismatch');}
  const ort=await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths=ASSETS.href;
  ort.env.wasm.numThreads=provider==='wasm'?Math.max(1,Math.min(4,wasmThreads|0)):1;
  if(provider==='webgpu'&&!self.navigator.gpu)throw Error('WebGPU is unavailable');
  self.postMessage({stage:'modelLoading'});
  const session=await ort.InferenceSession.create(bytes,{executionProviders:[provider]});
  runtime={key,model,entry,ort,session,inputName:session.inputNames[0],outputName:session.outputNames[0]};
  return runtime;
}

async function run(data){
  if(busy)throw Error('AI detail worker is already processing an image');
  busy=true;
  let inputs,outputs;
  try{
    const {modelId,provider,width,height,rgba,assetRoot,sharedInput,sharedOutput,tileIndices,wasmThreads=1}=data;
    const {model,entry,ort,session,inputName,outputName}=await ensureRuntime({modelId,provider,assetRoot,wasmThreads});
    const tile=model.tile,pad=model.overlap,step=tile-2*pad,mix=model.mix??1,keep=1-mix;
    if(width>8000||height>8000)throw Error('Image is too large for detail inference');
    const source=sharedInput?new Uint8ClampedArray(sharedInput):rgba;
    if(!source||source.length!==width*height*4)throw Error('Invalid shared detail input');
    const result=sharedOutput?new Uint8ClampedArray(sharedOutput):new Uint8ClampedArray(source.length);
    if(result.length!==source.length)throw Error('Invalid shared detail output');
    const nx=Math.ceil(width/step),ny=Math.ceil(height/step),total=nx*ny;
    const assigned=Array.isArray(tileIndices)?tileIndices:Array.from({length:total},(_,i)=>i);
    const plane=tile*tile,tensorData=new Float32Array(entry.channels*plane);
    let done=0;
    for(const index of assigned){
      if(!Number.isInteger(index)||index<0||index>=total)throw Error('Invalid AI detail tile assignment');
      const yi=Math.floor(index/nx),xi=index%nx,left=xi*step-pad,top=yi*step-pad;
      for(let y=0;y<tile;y++){
        const sy=max(0,min(height-1,top+y)),row=sy*width;
        for(let x=0;x<tile;x++){
          const sx=max(0,min(width-1,left+x)),p=(row+sx)*4,q=y*tile+x;
          tensorData[q]=source[p]/255;
          tensorData[plane+q]=source[p+1]/255;
          tensorData[2*plane+q]=source[p+2]/255;
        }
      }
      inputs=new ort.Tensor('float32',tensorData,[1,entry.channels,tile,tile]);
      outputs=await session.run({[inputName]:inputs});
      const out=outputs[outputName];
      if(!out||out.dims.length!==4||out.dims[1]!==3||out.dims[2]!==tile||out.dims[3]!==tile)
        throw Error('Unexpected AI detail output shape');
      const rgb=await out.getData();
      for(let y=pad;y<tile-pad;y++)for(let x=pad;x<tile-pad;x++){
        const sy=top+y,sx=left+x;
        if(sy<0||sx<0||sy>=height||sx>=width)continue;
        const p=(sy*width+sx)*4,q=y*tile+x;
        result[p]=clamp(source[p]*keep+255*rgb[q]*mix);
        result[p+1]=clamp(source[p+1]*keep+255*rgb[plane+q]*mix);
        result[p+2]=clamp(source[p+2]*keep+255*rgb[2*plane+q]*mix);
        result[p+3]=source[p+3];
      }
      for(const output of Object.values(outputs))output.dispose?.();
      outputs=null;inputs.dispose?.();inputs=null;
      self.postMessage({stage:'inference',progress:{done:++done,total:assigned.length}});
    }
    if(sharedOutput)self.postMessage({complete:true});
    else self.postMessage({result:{data:result,width,height}},[result.buffer]);
  }finally{
    inputs?.dispose?.();
    if(outputs)for(const output of Object.values(outputs))output.dispose?.();
    busy=false;
  }
}

self.onmessage=async({data})=>{
  try{
    if(data?.command==='release'){await releaseRuntime();self.postMessage({released:true});return;}
    await run(data);
  }catch(error){self.postMessage({error:String(error?.message||error)});}
};
