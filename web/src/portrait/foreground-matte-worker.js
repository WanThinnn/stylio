import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
import {depthWorkerFailure} from './ai-inference.js';
import {foregroundImageInput,foregroundOutputMatte} from './foreground-matte-model.js';
import {analyzeForegroundMatte} from './foreground-matte.js';

const ASSETS=new URL('../../vendor/ai-portrait/',import.meta.url);

self.onmessage=async({data:{rgb,input,guidance,provider='webgpu'}})=>{
  let session,tensor,outputs,stage='modelLoading';
  try{
    if(!['webgpu','wasm'].includes(provider))throw Error('Unsupported foreground provider');
    const {width,height}=input,orientation=guidance?.orientation||{},size=guidance?.size??1024;
    if(![768,1024].includes(size))throw Error('Unsupported foreground model size');
    if(!(rgb instanceof Uint8Array)||rgb.length!==width*height*3)throw Error('Invalid foreground RGB');
    const ort=await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
    if(provider==='webgpu')ort.env.webgpu.powerPreference='high-performance';
    ort.env.wasm.wasmPaths=ASSETS.href;ort.env.wasm.numThreads=1;

    const manifest=await fetch(new URL('foreground-assets.json',ASSETS)).then(r=>{
      if(!r.ok)throw Error('Foreground model manifest unavailable');return r.json();
    });
    const asset=manifest.files?.['isnet-general-use-fp16.onnx'];
    if(!asset?.url||!Number.isInteger(asset.bytes)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid foreground model manifest');
    const url=new URL('isnet-general-use-fp16.onnx',ASSETS);url.searchParams.set('sha256',asset.sha256);
    stage='modelLoading';
    const bytes=await downloadModelBytes(url.href,{onProgress:progress=>self.postMessage({stage:'download',progress})});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==asset.bytes||hash!==asset.sha256){
      try{await(await caches.open(MODEL_CACHE_NAME)).delete(url.href);}catch{}
      throw Error('Foreground model integrity check failed');
    }

    const image=foregroundImageInput(rgb,width,height,orientation,size);
    session=await ort.InferenceSession.create(bytes,{executionProviders:[provider]});
    stage='inference';self.postMessage({stage:'subjectRefining'});
    tensor=new ort.Tensor('float32',image.data,[1,3,size,size]);
    outputs=await session.run({input_image:tensor});
    const output=outputs.output_image;if(!output)throw Error('Foreground model output missing');
    const dims=output.dims;
    if(dims.length!==4||dims[0]!==1||dims[1]!==1||dims[2]!==size||dims[3]!==size)throw Error('Unexpected foreground model output shape');
    const values=new Float32Array(await output.getData());
    const normalized=foregroundOutputMatte(values,size,size,width,height,orientation);
    const report=analyzeForegroundMatte(normalized.confidence,width,height);
    const confidence=normalized.confidence;
    self.postMessage({result:{matte:{confidence,width,height,source:'isnet',
      report:{...report,model:manifest.model,provider,inputSize:size,range:normalized.range,min:normalized.min,max:normalized.max}}}},[confidence.buffer]);
  }catch(error){self.postMessage(depthWorkerFailure(error,stage));}
  finally{
    tensor?.dispose();
    if(outputs)for(const value of Object.values(outputs))value.dispose();
    if(session)await session.release();
  }
};
