import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
import {depthWorkerFailure} from './ai-inference.js';
import {subjectImageInput,subjectPrompts,subjectMasks} from './subject-mask.js';
import {stabilizeSubjectDepth} from './subject-depth-guidance.js';
const ASSETS=new URL('../../vendor/ai-portrait/',import.meta.url);

self.onmessage=async({data:{rgb,input,guidance,provider='webgpu'}})=>{
  let session,outputs,tensor,embeddingTensor,pointTensor,labelTensor,stage='modelLoading';
  try{
    if(!['webgpu','wasm'].includes(provider))throw Error('Unsupported subject provider');
    const {width,height}=input,{gray,orientation}=guidance;
    if(!(gray instanceof Uint8Array)||gray.length!==width*height)throw Error('Invalid subject depth');
    const ort=await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
    if(provider==='webgpu')ort.env.webgpu.powerPreference='high-performance';
    ort.env.wasm.wasmPaths=ASSETS.href;ort.env.wasm.numThreads=1;
    const manifest=await fetch(new URL('assets.json',ASSETS)).then(r=>{if(!r.ok)throw Error('Subject model assets unavailable');return r.json();});
    const load=async name=>{
      const asset=manifest.files[name];if(!asset)throw Error('Subject model assets unavailable');
      const url=new URL(name,ASSETS);url.searchParams.set('sha256',asset.sha256);
      stage='modelLoading';const bytes=await downloadModelBytes(url.href,{onProgress:progress=>self.postMessage({stage:'modelDownload',progress})});
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(bytes.length!==asset.bytes||hash!==asset.sha256){try{await(await caches.open(MODEL_CACHE_NAME)).delete(url.href);}catch{}throw Error('Subject model integrity check failed');}
      return bytes;
    };
    const image=subjectImageInput(rgb,width,height,orientation);
    session=await ort.InferenceSession.create(await load('subject-encoder.onnx'),{executionProviders:[provider]});
    stage='inference';self.postMessage({stage:'subjectRefining'});
    tensor=new ort.Tensor('float32',image.data,[1,3,1024,1024]);
    outputs=await session.run({image:tensor});tensor.dispose();tensor=null;
    const embedding=new Float32Array(await outputs.image_embeddings.getData());
    for(const value of Object.values(outputs))value.dispose();outputs=null;
    await session.release();session=null;
    // Never hold the encoder or the earlier depth session alongside the decoder.
    session=await ort.InferenceSession.create(await load('subject-decoder.onnx'),{executionProviders:[provider]});
    stage='inference';self.postMessage({stage:'subjectRefining'});
    embeddingTensor=new ort.Tensor('float32',embedding,[1,256,64,64]);
    labelTensor=new ort.Tensor('float32',Float32Array.of(1),[1,1]);
    let probes=0;
    for(const point of subjectPrompts(gray,width,height,orientation)){
      probes++;pointTensor=new ort.Tensor('float32',Float32Array.of(point.x*image.width,point.y*image.height),[1,1,2]);
      outputs=await session.run({image_embeddings:embeddingTensor,point_coords:pointTensor,point_labels:labelTensor});
      pointTensor.dispose();pointTensor=null;
      const masks=new Float32Array(await outputs.masks.getData()),scores=new Float32Array(await outputs.scores.getData()),mh=outputs.masks.dims.at(-2),mw=outputs.masks.dims.at(-1);
      for(const value of Object.values(outputs))value.dispose();outputs=null;
      const candidates=subjectMasks(masks,mw,mh,scores,width,height,orientation,point);
      if(!candidates.length)continue;
      // Choose the whole isolated object, not a smaller cap/label subdivision.
      // A distinct internal surface is a reason to retain depth, not to force
      // that object into a plane or try successively smaller masks until it fits.
      const chosen=candidates[0],result=stabilizeSubjectDepth(gray,chosen.mask,width,height);
      const subjectReport={...result.report,model:'EdgeSAM-3x',provider,score:chosen.score,pixels:chosen.pixels,probes};
      self.postMessage({result:{gray:result.gray,subjectReport}},[result.gray.buffer]);return;
    }
    self.postMessage({result:{gray,subjectReport:{applied:false,reason:'no-confident-isolated-subject',model:'EdgeSAM-3x',provider,probes}}},[gray.buffer]);
  }catch(error){self.postMessage(depthWorkerFailure(error,stage));}
  finally{
    for(const t of [tensor,embeddingTensor,pointTensor,labelTensor])t?.dispose();
    if(outputs)for(const value of Object.values(outputs))value.dispose();if(session)await session.release();
  }
};
