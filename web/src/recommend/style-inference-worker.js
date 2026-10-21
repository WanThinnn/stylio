import {downloadModelBytes,MODEL_CACHE_NAME} from '../core/model-download.js';
import {styleModel} from './style-model.js';
import {preprocessClipView} from './style-preprocess.js';

const ORT_ROOT=new URL('../../vendor/ai-portrait/',import.meta.url);
const ASSET_ROOT=new URL('../../vendor/ai-style/',import.meta.url);
let runtime=null,busy=false;

async function sha256(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
async function releaseRuntime(){
  await runtime?.session?.release?.();runtime=null;
}
async function ensureRuntime(level,provider){
  if(runtime?.provider===provider&&runtime?.level===level)return runtime;
  if(provider==='webgpu'&&!self.navigator.gpu)throw Error('WebGPU is unavailable');
  await releaseRuntime();
  const response=await fetch(new URL('assets.json',ASSET_ROOT),{cache:'no-store'});
  if(!response.ok)throw Error('Suggested Styles image-only assets are not packaged');
  const manifest=await response.json(),asset=styleModel(level,provider,manifest),modelUrl=new URL(asset.file,ASSET_ROOT);
  modelUrl.searchParams.set('sha256',asset.sha256);const url=modelUrl.href;
  const bytes=await downloadModelBytes(url,{expectedBytes:asset.bytes,onProgress:progress=>self.postMessage({
    stage:progress.source==='cache'?'modelCache':progress.source==='cacheWarning'?'modelCacheWarning':'modelDownload',progress,
  })});
  if(bytes.byteLength!==asset.bytes)throw Error('Suggested Styles model size mismatch');
  if(await sha256(bytes)!==asset.sha256){
    try{await(await caches.open(MODEL_CACHE_NAME)).delete(url);}catch{}
    throw Error('Suggested Styles model SHA-256 mismatch');
  }
  const ort=await import('../../vendor/ai-portrait/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths=ORT_ROOT.href;
  ort.env.wasm.numThreads=provider==='wasm'?Math.max(1,Math.min(4,(self.navigator.hardwareConcurrency||2)-1)):1;
  self.postMessage({stage:'modelLoading'});
  const sessionOptions={executionProviders:[provider]};
  if(provider==='webgpu')sessionOptions.graphOptimizationLevel='basic';
  const session=await ort.InferenceSession.create(bytes,sessionOptions);
  if(session.inputNames.length!==1||session.inputNames[0]!==asset.inputName
    ||!session.outputNames.includes(asset.outputName)){
    await session.release?.();
    throw Error('Suggested Styles packaged ONNX I/O contract mismatch');
  }
  runtime={level,provider,asset,ort,session};return runtime;
}
function normalized(values,dimensions){
  if(values.length!==dimensions)throw Error('Unexpected Suggested Styles embedding dimensions');
  const out=Float32Array.from(values);let norm2=0;
  for(const value of out){if(!Number.isFinite(value))throw Error('Suggested Styles produced non-finite embedding');norm2+=value*value;}
  if(!(norm2>1e-12))throw Error('Suggested Styles produced a zero embedding');
  const inv=1/Math.sqrt(norm2);for(let i=0;i<out.length;i++)out[i]*=inv;return out;
}
async function inferOne(rt,image,rect){
  const pixelValues=preprocessClipView(image,rect,{input:rt.asset.input}),input=new rt.ort.Tensor('float32',pixelValues,rt.asset.inputShape);
  let outputs;
  try{
    outputs=await rt.session.run({[rt.asset.inputName]:input},[rt.asset.outputName]);
    const output=outputs[rt.asset.outputName];
    if(!output||output.dims?.length!==2||output.dims[0]!==1||output.dims[1]!==rt.asset.input.embeddingDimensions)
      throw Error('Unexpected Suggested Styles image embedding output shape');
    return normalized(await output.getData(),rt.asset.input.embeddingDimensions);
  }finally{
    input.dispose?.();
    if(outputs)for(const tensor of Object.values(outputs))tensor.dispose?.();
  }
}
async function run(message){
  if(busy)throw Error('Suggested Styles worker is busy');busy=true;
  try{
    const {level='standard',provider='wasm',width,height,rgb,views}=message;
    if(!['lite','standard','pro'].includes(level)||!['wasm','webgpu'].includes(provider)||!Number.isInteger(width)||!Number.isInteger(height)||!rgb||!Array.isArray(views)||!views.length)
      throw Error('Invalid Suggested Styles inference request');
    const channels=rgb.length===width*height*3?3:rgb.length===width*height*4?4:0;
    if(!channels)throw Error('Invalid Suggested Styles pixel buffer');
    const rt=await ensureRuntime(level,provider),image={data:rgb,width,height},embeddings=[];
    for(let i=0;i<views.length;i++){
      embeddings.push(await inferOne(rt,image,views[i]));
      self.postMessage({stage:'inference',progress:{done:i+1,total:views.length}});
    }
    const transfer=embeddings.map(value=>value.buffer);
    self.postMessage({result:{embeddings}},transfer);
  }finally{busy=false;}
}
self.onmessage=async({data})=>{
  try{
    if(data?.command==='release'){await releaseRuntime();self.postMessage({released:true});return;}
    await run(data);
  }catch(error){self.postMessage({error:String(error?.message||error)});}
};
