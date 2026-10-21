import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
import {depthWorkerFailure} from './ai-inference.js';
import {subjectImageInput,subjectDecoderPrompts,refineSubjectMatte} from './subject-mask.js';

const ASSETS=new URL('../../vendor/ai-portrait/',import.meta.url);

self.onmessage=async({data:{rgb,input,guidance,provider='webgpu'}})=>{
  let session,outputs,tensor,embeddingTensor,pointTensor,labelTensor,stage='modelLoading';
  try{
    if(!['webgpu','wasm'].includes(provider))throw Error('Unsupported subject provider');
    const {width,height}=input,{matte,orientation}=guidance||{};
    if(!(rgb instanceof Uint8Array)||rgb.length!==width*height*3)throw Error('Invalid subject RGB');
    if(!(matte?.confidence instanceof Uint8Array)||matte.confidence.length!==width*height)throw Error('Invalid subject matte');

    const ort=await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
    if(provider==='webgpu')ort.env.webgpu.powerPreference='high-performance';
    ort.env.wasm.wasmPaths=ASSETS.href;ort.env.wasm.numThreads=1;
    const manifest=await fetch(new URL('assets.json',ASSETS)).then(r=>{if(!r.ok)throw Error('Subject model assets unavailable');return r.json();});
    const load=async name=>{
      const asset=manifest.files[name];if(!asset)throw Error('Subject model assets unavailable');
      const url=new URL(name,ASSETS);url.searchParams.set('sha256',asset.sha256);
      stage='modelLoading';const bytes=await downloadModelBytes(url.href,{expectedBytes:asset.bytes,onProgress:progress=>{
        stage=progress.source==='cache'?'modelCache':progress.source==='cacheWarning'?'modelCacheWarning':'modelDownload';
        self.postMessage({stage,progress:{...progress,resource:'segmentationRefinement'}});
      }});
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(bytes.length!==asset.bytes||hash!==asset.sha256){
        try{await(await caches.open(MODEL_CACHE_NAME)).delete(url.href);}catch{}
        throw Error('Subject model integrity check failed');
      }
      stage='modelLoading';self.postMessage({stage,progress:{resource:'segmentationRefinement'}});return bytes;
    };

    const image=subjectImageInput(rgb,width,height,orientation);
    session=await ort.InferenceSession.create(await load('subject-encoder.onnx'),{executionProviders:[provider]});
    stage='inference';self.postMessage({stage,progress:{resource:'segmentationRefinement'}});
    tensor=new ort.Tensor('float32',image.data,[1,3,1024,1024]);
    outputs=await session.run({image:tensor});tensor.dispose();tensor=null;
    const embedding=new Float32Array(await outputs.image_embeddings.getData());
    for(const value of Object.values(outputs))value.dispose();outputs=null;
    await session.release();session=null;

    const prompts=subjectDecoderPrompts(matte,width,height,orientation,{positiveCount:6,negativeCount:6});
    if(!prompts.some(p=>p.label===1)){
      const confidence=matte.confidence.slice();
      self.postMessage({result:{matte:{...matte,confidence},subjectReport:{applied:false,reason:'no-confident-matte-prompts',
        model:'EdgeSAM-3x',provider,prompts:prompts.length}}},[confidence.buffer]);return;
    }

    session=await ort.InferenceSession.create(await load('subject-decoder.onnx'),{executionProviders:[provider]});
    stage='inference';self.postMessage({stage,progress:{resource:'segmentationRefinement'}});
    embeddingTensor=new ort.Tensor('float32',embedding,[1,256,64,64]);
    const coords=new Float32Array(prompts.length*2),labels=new Float32Array(prompts.length);
    prompts.forEach((point,i)=>{coords[i*2]=point.x*image.width;coords[i*2+1]=point.y*image.height;labels[i]=point.label;});
    pointTensor=new ort.Tensor('float32',coords,[1,prompts.length,2]);
    labelTensor=new ort.Tensor('float32',labels,[1,prompts.length]);
    outputs=await session.run({image_embeddings:embeddingTensor,point_coords:pointTensor,point_labels:labelTensor});
    const masks=new Float32Array(await outputs.masks.getData()),scores=new Float32Array(await outputs.scores.getData()),
      mh=outputs.masks.dims.at(-2),mw=outputs.masks.dims.at(-1);
    const refined=refineSubjectMatte(masks,mw,mh,scores,matte,width,height,orientation);
    const confidence=refined.matte.confidence,transfers=[confidence.buffer];
    if(refined.matte.refinementConfidence)transfers.push(refined.matte.refinementConfidence.buffer);
    self.postMessage({result:{matte:{...refined.matte,confidence},subjectReport:{...refined.report,provider,prompts:prompts.length,
      positivePrompts:prompts.filter(p=>p.label===1).length,negativePrompts:prompts.filter(p=>p.label===0).length}}},transfers);
  }catch(error){self.postMessage(depthWorkerFailure(error,stage));}
  finally{
    for(const t of [tensor,embeddingTensor,pointTensor,labelTensor])t?.dispose();
    if(outputs)for(const value of Object.values(outputs))value.dispose();
    if(session)await session.release();
  }
};
