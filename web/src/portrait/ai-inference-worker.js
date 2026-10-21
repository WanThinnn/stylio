const ASSETS = new URL('../../vendor/ai-portrait/', import.meta.url);
import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
import {refineDepth} from './ai-depth-refinement.js';
import {depthWorkerFailure} from './ai-inference.js';
import {protectPersonDepth} from './person-depth-guidance.js';
import {depthModel,asDisparity} from './depth-models.js';
import {depthImageInput,depthOutputToStored} from './depth-orientation.js';
self.onmessage = async ({data: {rgb, input, guidance,provider='webgpu',modelId='standard'}}) => {
  let session, outputs, inputTensor,stage='modelLoading';
  try {
    if(!['webgpu','wasm'].includes(provider))throw Error('Unsupported depth provider');
    const selected=depthModel(modelId);
    if (provider==='webgpu'&&!self.navigator.gpu) throw Error('WEBGPU');
    const ort = await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
    if(provider==='webgpu')ort.env.webgpu.powerPreference = 'high-performance';
    ort.env.wasm.wasmPaths = ASSETS.href; ort.env.wasm.numThreads = 1;
    const manifest=await fetch(new URL('assets.json',ASSETS)).then(r=>{if(!r.ok)throw Error('AI assets unavailable');return r.json();});
    stage='modelLoading';
    // Download only the selection, sequentially to bound transient buffers.
    const files=[];
    for(const name of selected.files){
      const asset=manifest.files[name];if(!asset)throw Error('AI assets unavailable');
      const url=new URL(name,ASSETS);url.searchParams.set('sha256',asset.sha256);
      const bytes=await downloadModelBytes(url.href,{onProgress:progress=>{
        stage=progress.source==='cache'?'modelCache':progress.source==='cacheWarning'?'modelCacheWarning':'modelDownload';
        self.postMessage({stage,progress});
      }});
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      if(bytes.length!==asset.bytes||hash!==asset.sha256){try{await(await caches.open(MODEL_CACHE_NAME)).delete(url.href);}catch{}throw Error('AI model integrity check failed');}
      files.push(bytes);
    }
    stage='modelLoading';self.postMessage({stage});
    session = await ort.InferenceSession.create(files[0], {executionProviders:[provider],
      ...(selected.rank===5?{externalData:[{path:'model.onnx_data',data:files[1]}]}:{})});files.length=0;
    const image=depthImageInput(rgb,input.width,input.height,guidance?.orientation);
    const count = image.width * image.height, tensor = new Float32Array(3 * count);
    const mean = [.485,.456,.406], std = [.229,.224,.225];
    for(let p=0;p<count;p++)for(let c=0;c<3;c++)tensor[c*count+p]=(image.rgb[p*3+c]/255-mean[c])/std[c];
    stage='inference';self.postMessage({stage});
    inputTensor=new ort.Tensor('float32',tensor,selected.rank===5?[1,1,3,image.height,image.width]:[1,3,image.height,image.width]);
    outputs = await session.run({[session.inputNames[0]]:inputTensor},['predicted_depth']);
    inputTensor.dispose();inputTensor=null;
    const output = outputs.predicted_depth;
    const {values,mw,mh}=depthOutputToStored(asDisparity(new Float32Array(await output.getData()),selected.kind),
      output.dims.at(-1),output.dims.at(-2),guidance?.orientation);
    for(const value of Object.values(outputs))value.dispose();outputs=null;await session.release();session=null;
    if(guidance){
      stage='refining';self.postMessage({stage});
      let gray=refineDepth(values,mw,mh,guidance.rgb,guidance.width,guidance.height);
      if(guidance.person)gray=protectPersonDepth(gray,guidance.person,guidance.width,guidance.height);
      self.postMessage({result:{gray,mh,mw}},[gray.buffer]);
    }else self.postMessage({result:{values,mh,mw}}, [values.buffer]);
  } catch(error) { self.postMessage(depthWorkerFailure(error,stage)); }
  finally { inputTensor?.dispose();if(outputs)for(const value of Object.values(outputs))value.dispose();if(session)await session.release(); }
};
