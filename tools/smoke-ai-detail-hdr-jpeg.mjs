/**
 * Browser E2E smoke for Adaptive HDR JPEG -> AI Detail -> generated HEIC/Styles.
 * Uses the real local ONNX/WebGPU and FFmpeg.wasm path.
 *
 * node tools/smoke-ai-detail-hdr-jpeg.mjs [input] [--model=lite|standard|pro] [--no-detail] [--save=tests/private-fixtures/...HEIC]
 * --portrait-input=<Styles.heic> runs the actual Portrait controller on an
 * existing export, using input JPEG as its original source. --bitmap-fallback
 * exercises browsers whose ImageBitmap decoder rejects that JPEG.
 * --source-root=<snapshot-root> serves web/src from an isolated historical
 * snapshot while keeping large runtime assets and private inputs local.
 * --decode-fallback rejects browser JPEG decode to exercise the FFmpeg base path.
 * --allow-sdr --portrait [--aperture=16] tests a fresh ordinary JPEG through
 * raster import and the real Portrait controller, without a previous export.
 */
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,relative,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceRootArg=process.argv.find(arg=>arg.startsWith('--source-root='))?.slice(14)||null;
const sourceRoot=sourceRootArg?resolve(root,sourceRootArg):null;
const input=process.argv.find(arg=>/\.(jpe?g)$/i.test(arg))||'tests/private-fixtures/HDR_Input/IDG_20251020_121945_809.JPEG';
const inputFull=resolve(root,input);
const model=process.argv.find(arg=>arg.startsWith('--model='))?.slice(8)||'lite';
const detail=!process.argv.includes('--no-detail');
const portraitInput=process.argv.find(arg=>arg.startsWith('--portrait-input='))?.slice(17)||null;
const portraitInputFull=portraitInput?resolve(root,portraitInput):null;
const bitmapFallback=process.argv.includes('--bitmap-fallback');
const decodeFallback=process.argv.includes('--decode-fallback');
const allowSdr=process.argv.includes('--allow-sdr');
const portrait=Boolean(portraitInput)||process.argv.includes('--portrait');
const aperture=Number(process.argv.find(arg=>arg.startsWith('--aperture='))?.slice(11)||'4.5');
if(!Number.isFinite(aperture)||aperture<1||aperture>22)throw Error('Invalid --aperture');
if(!['lite','standard','pro'].includes(model))throw Error('Invalid --model');
const saveArg=process.argv.find(arg=>arg.startsWith('--save='))?.slice(7)||null;
const saveFull=saveArg?resolve(root,saveArg):null;
if(saveFull){
 const allowed=resolve(root,'tests/private-fixtures')+sep;
 if(!saveFull.startsWith(allowed))throw Error('--save must stay under tests/private-fixtures');
}
const browsers=[
 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browser=browsers.find(existsSync);if(!browser)throw Error('Edge/Chrome not installed');
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8',
 '.wasm':'application/wasm','.onnx':'application/octet-stream','.json':'application/json','.jpeg':'image/jpeg','.jpg':'image/jpeg','.zip':'application/zip'};
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
 'Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
const server=createServer(async(req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(path==='/__input__'){
  try{const data=await readFile(inputFull);res.writeHead(200,{...headers,'Content-Type':'image/jpeg'});res.end(data);}
  catch{res.writeHead(404,headers);res.end();}return;
 }
 if(path==='/__portrait_input__'&&portraitInputFull){
  try{const data=await readFile(portraitInputFull);res.writeHead(200,{...headers,'Content-Type':'image/heic'});res.end(data);}
  catch{res.writeHead(404,headers);res.end();}return;
 }
 if(path==='/__save__'&&req.method==='POST'){
  if(!saveFull){res.writeHead(403,headers);res.end('save disabled');return;}
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>100*1024*1024){res.writeHead(413,headers);res.end();return;}chunks.push(chunk);}
  await mkdir(resolve(saveFull,'..'),{recursive:true});await writeFile(saveFull,Buffer.concat(chunks));
  res.writeHead(200,{...headers,'Content-Type':'text/plain'});res.end(String(total));return;
 }
 if(path==='/__smoke__'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<title>HDR JPEG Detail Smoke</title>');return;}
 const servingRoot=sourceRoot&&path.startsWith('/web/src/')?sourceRoot:root;
 const full=resolve(servingRoot,'.'+path),rel=relative(servingRoot,full);
 if(rel.startsWith('..')||rel.startsWith(sep)||rel===''){res.writeHead(404,headers);res.end();return;}
 try{const data=await readFile(full);res.writeHead(200,{...headers,'Content-Type':mime[extname(full).toLowerCase()]||'application/octet-stream'});res.end(data);}
 catch{res.writeHead(404,headers);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'hdr-jpeg-ai-'));
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--remote-allow-origins=*','--no-first-run',
 '--disable-extensions','--disable-background-networking','--enable-unsafe-webgpu','--user-data-dir='+profile,
 'http://127.0.0.1:'+port+'/__smoke__'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let debugPort;
 for(let i=0;i<300;i++){
  try{debugPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);if(debugPort)break;}catch{}
  await sleep(100);
 }
 if(!debugPort)throw Error('CDP port unavailable');
 let endpoint;
 for(let i=0;i<100;i++){
  try{
   const tabs=await fetch('http://127.0.0.1:'+debugPort+'/json').then(r=>r.json());
   endpoint=tabs.find(x=>x.type==='page'&&x.url.includes('__smoke__'))?.webSocketDebuggerUrl;
   if(endpoint)break;
  }catch{}
  await sleep(100);
 }
 if(!endpoint)throw Error('CDP tab unavailable');
 socket=new WebSocket(endpoint);
 await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener('message',e=>{
  const m=JSON.parse(String(e.data));
  if(m.method==='Runtime.consoleAPICalled'&&m.params.args?.[0]?.value==='[portrait-smoke]')
   console.log(m.params.args.slice(1).map(a=>a.value).join(' '));
  if(!m.id)return;const c=pending.get(m.id);if(!c)return;
  pending.delete(m.id);clearTimeout(c.timer);m.error?c.reject(Error(JSON.stringify(m.error))):c.resolve(m.result);
 });
 const cdp=(method,params={},timeout=1200000)=>new Promise((ok,no)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timeout'));},timeout);
  pending.set(id,{resolve:ok,reject:no,timer});socket.send(JSON.stringify({id,method,params}));
 });
 await cdp('Runtime.enable');await cdp('Page.enable');await sleep(1000);
 const base='http://127.0.0.1:'+port;
 const cfg={base,input:'/__input__',inputName:inputFull.split(/[\\/]/).at(-1),model,detail,
   portraitInput:portraitInput?'/__portrait_input__':null,portrait,aperture,allowSdr,bitmapFallback,decodeFallback,save:Boolean(saveFull)};
 const expression='(async cfg=>{'+
   "const [{importRaster},{discoverHeic,extractItemData},{parseTmapMetadata}]=await Promise.all(["+
   "import(cfg.base+'/web/src/raster/raster-import.js'),"+
   "import(cfg.base+'/web/src/raster/heif.js'),"+
   "import(cfg.base+'/web/src/raster/jpeg-hdr.js')]);"+
   "const source=new Uint8Array(await fetch(cfg.base+cfg.input).then(r=>{if(!r.ok)throw Error('input '+r.status);return r.arrayBuffer();}));"+
   "const events=[],started=performance.now();"+
   "const name=cfg.inputName;"+
   "const sourceFile=new File([source],name,{type:'image/jpeg'});"+
   "if(cfg.decodeFallback){globalThis.createImageBitmap=()=>Promise.reject(Error('forced JPEG decoder failure'));globalThis.Image=class{set src(value){}decode(){return Promise.reject(Error('forced JPEG element failure'));}};}"+
   "const result=cfg.portraitInput?{hdr:true,data:new Uint8Array(await fetch(cfg.base+cfg.portraitInput).then(r=>r.arrayBuffer()))}:await importRaster(sourceFile,null,"+
   "progress=>{if(progress.stage&&(!events.length||events.at(-1)!==progress.stage))events.push(progress.stage);},"+
   "{analyze:true,detail:cfg.detail?{modelId:cfg.model,provider:'webgpu'}:null});"+
   "if(!result.hdr&&!cfg.allowSdr)throw Error('Result is not HDR');"+
   "if(cfg.detail&&!result.detailApplied)throw Error('AI detail was not applied: '+String(result.detailSkipped||'unknown'));"+
   "if(cfg.portrait){"+
   "if(cfg.bitmapFallback){const bitmap=globalThis.createImageBitmap;globalThis.createImageBitmap=(b,...args)=>b.type==='image/jpeg'?Promise.reject(Error('JPEG ImageBitmap unavailable')):bitmap(b,...args);}"+
   "const {createPortraitController}=await import(cfg.base+'/web/src/app/processing/portrait-controller.js');"+
   "const candidates=[],cleanup=[],notes=[];let published,stage;"+
   "const ui={progress(){},aiState(next){if(stage!==next){stage=next;console.info('[portrait-smoke]',next);}},note(message){if(message)notes.push(message);},aiBusy(){},cancelAi(){return()=>{};},cleanup(fn){cleanup.push(fn);},output(file){published=file;},async portraitPreview(result,update){await update({focusX:result.suggestedFocus?.x??.5,focusY:result.suggestedFocus?.y??.5,aperture:cfg.aperture},()=>true);},aiView(){}};"+
   "const controller=createPortraitController({aiFeatures:{enabled:id=>id==='portrait'},aiCandidates:candidates,aiText:()=>new Proxy({},{get:(_,k)=>String(k)}),gpuAcceleration:{checked:true},selectedAiLevel:()=>cfg.model});"+
   "await controller.tryAiPortrait(null,new File([result.data],'styles.HEIC',{type:'image/heic'}),ui,name,sourceFile);"+
   "if(candidates[0]?.state!=='done')throw Error('Portrait controller failed: '+JSON.stringify(notes));"+
   "result.data=new Uint8Array(await published.arrayBuffer());cleanup.forEach(fn=>fn());"+
   "const graph=discoverHeic(result.data);if(![...graph.infos].some(([id])=>graph.props.associations.get(id)?.some(a=>graph.props.properties[a.index-1].auxUri==='urn:mpeg:hevc:2015:auxid:2')))throw Error('Portrait output has no depth auxiliary');}"+
   "const d=discoverHeic(result.data);"+
   "if(d.hdrGrid===null||!d.hdrTiles.length)throw Error('Output HDR gain map missing');"+
   "if(d.stylesItem===null)throw Error('Generated Styles item missing');"+
   "if(!result.hdr){if(cfg.save){const saved=await fetch(cfg.base+'/__save__',{method:'POST',body:result.data});if(!saved.ok)throw Error('save '+saved.status);}return {model:cfg.model,inputBytes:source.length,outputBytes:result.data.length,ms:Math.round(performance.now()-started),geometry:result.geometry,portrait:cfg.portrait,aperture:cfg.aperture,hdr:false,events};}"+
   "const pair=[...d.infos].find(([id,info])=>info.type==='tmap'&&d.refs.some(r=>r.type==='dimg'&&r.from===id&&r.to[0]===d.primary&&r.to.length>=2));"+
   "if(!pair)throw Error('ISO tmap metadata missing');"+
   "const tmapInputs=d.refs.find(r=>r.type==='dimg'&&r.from===pair[0]).to,isoGain=tmapInputs[1];"+
   "const metadata=parseTmapMetadata(extractItemData(result.data,d,pair[0]));"+
   "if(cfg.save){const saved=await fetch(cfg.base+'/__save__',{method:'POST',body:result.data});if(!saved.ok)throw Error('save '+saved.status);}"+
   "return {model:cfg.model,inputBytes:source.length,outputBytes:result.data.length,ms:Math.round(performance.now()-started),"+
   "geometry:result.geometry,hdr:result.hdr,detailApplied:result.detailApplied,detailSkipped:result.detailSkipped||null,"+
   "hdrDetail:result.hdrDetail||null,primary:d.primary,primaryTiles:d.primaryTiles.length,isoGain,hdrGrid:d.hdrGrid,hdrTiles:d.hdrTiles.length,"+
   "stylesItem:d.stylesItem,tmap:{baseHeadroom:metadata.baseHeadroom,alternateHeadroom:metadata.alternateHeadroom,channels:metadata.channels,useBaseColorSpace:metadata.useBaseColorSpace},events};"+
   '})('+JSON.stringify(cfg)+')';
 console.log('Running '+(detail?model+' AI Detail':'HDR import')+' JPEG smoke on '+input+' ...');
 const out=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},1200000);
 if(out.exceptionDetails)throw Error(JSON.stringify(out.exceptionDetails));
 const value=out.result?.value;if(!value)throw Error('No smoke result');
 console.log('PASS '+JSON.stringify(value,null,2));
 if(saveArg)console.log('Saved '+saveArg);
}finally{
 try{socket?.close();}catch{}
 child.kill();
 server.closeAllConnections();await new Promise(r=>server.close(r));
 try{await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});}catch{}
}
