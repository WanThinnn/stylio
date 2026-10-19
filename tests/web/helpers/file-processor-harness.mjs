import fs from 'node:fs';
const origin=new URL('../../../web/src/app/processing/file-processor.js',import.meta.url);
const worker=new URL('../../../web/src/media/heic-worker.js',import.meta.url).href;
const adapter=`import {executeJob} from ${JSON.stringify(worker)};
export const readImageFile=file=>executeJob({operation:'read',file});
export const addTextureInWorker=(data,opts)=>executeJob({operation:'texture',data,opts});
export const repairTextureInWorker=(data,opts)=>executeJob({operation:'repair-texture',data,opts});
export const restoreNativePortraitInWorker=()=>{throw Error('Unexpected Portrait operation')};
export const legacyCompatibilityInWorker=()=>{throw Error('Unexpected compatibility operation')};
export const patchInWorker=()=>{throw Error('Unexpected reconstruction operation')};
export const releaseHeicProcessor=()=>{};`;
const adapterUrl='data:text/javascript,'+encodeURIComponent(adapter);
const source=fs.readFileSync(origin,'utf8').replace(/(['"])(\.\.?\/[^'"\n]+)\1/g,(_all,q,value)=>
  JSON.stringify(value==='../../media/heic-processing.js'?adapterUrl:new URL(value,origin).href));
const {createFileProcessor}=await import('data:text/javascript,'+encodeURIComponent(source));

// Keep the real classifier, worker and file-processing branches. Only transport,
// presentation and disabled AI are substituted; no browser or picture decoder is used.
export async function processNativeFile(data,name='native.HEIC'){
  const events=[];let output,softSkinCalls=0;
  const ui={set:(...args)=>events.push(['set',...args]),note:(...args)=>events.push(['note',...args]),
    progress:()=>{},aiBusy:()=>{},metadata:async()=>{},portraitAdvice:(...args)=>events.push(['advice',...args]),
    output:file=>{output=file;},cleanup:()=>{}};
  const unexpected=()=>{throw Error('Unexpected image-processing branch');};
  const processor=createFileProcessor({row:()=>ui,T:key=>key,getLanguage:()=> 'en',aiText:()=>({}),
    aiFeatures:{enabled:()=>false},gpuAcceleration:{checked:false},selectedAiLevel:()=> 'standard',
    handleMovie:unexpected,liveMovies:new Map(),livePhotos:[],attachMovie:()=>{},
    ensureProfileIndex:unexpected,getProfile:unexpected,
    tryAiPortrait:async(_bytes,file,resultUi)=>resultUi.output(file),
    analysis:{addMissingSoftSkin:async bytes=>{softSkinCalls++;return bytes;},ensureDecode:unexpected,
      stagePercent:()=>{},modelDownloadStatus:()=>{},styleProgress:()=>{},styleResultNote:()=>{},
      adaptiveStyleCompletionNotice:()=>{},recommendHeicStyle:unexpected}});
  await processor.handleFile(new File([data],name,{type:'image/heic'}));
  return {output,data:output?new Uint8Array(await output.arrayBuffer()):null,events,softSkinCalls,readyNotice:ui.readyNotice};
}
