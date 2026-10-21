/**
 * Browser E2E smoke for an existing HEIC -> AI Portrait.
 *
 * Usage:
 *   node tools/smoke-ai-portrait-heic.mjs <input.heic>
 *     --native=<matching-native.heic> --save=<output.heic>
 *     [--model=lite|standard|pro] [--provider=webgpu|wasm] [--aperture=1.4]
 */
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverHeic,extractItemData} from '../web/src/raster/heif.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const argv=process.argv.slice(2),inputArg=argv.find(x=>/\.hei[cf]$/i.test(x)&&!x.startsWith('--'));
if(!inputArg)throw Error('Missing input HEIC');
const input=resolve(inputArg),nativeArg=argv.find(x=>x.startsWith('--native='))?.slice(9),native=nativeArg?resolve(nativeArg):null;
const saveArg=argv.find(x=>x.startsWith('--save='))?.slice(7),save=saveArg?resolve(saveArg):null;
const debugArg=argv.find(x=>x.startsWith('--debug-depth='))?.slice(14),debugDepth=debugArg?resolve(debugArg):null;
const model=argv.find(x=>x.startsWith('--model='))?.slice(8)||'standard';
const provider=argv.find(x=>x.startsWith('--provider='))?.slice(11)||'webgpu';
const aperture=Number(argv.find(x=>x.startsWith('--aperture='))?.slice(11)||'1.4');
const texture=argv.includes('--texture');
if(!['lite','standard','pro'].includes(model)||!['webgpu','wasm'].includes(provider)||!Number.isFinite(aperture)||aperture<1||aperture>22)throw Error('Invalid arguments');
if(!existsSync(input))throw Error('Input does not exist');
if(native&&!existsSync(native))throw Error('Native reference does not exist');
if(save||debugDepth){
  const allowed=[dirname(input)+sep,resolve(root,'tests/private-fixtures')+sep];
  for(const target of [save,debugDepth].filter(Boolean))if(!allowed.some(base=>target.startsWith(base)))throw Error('outputs must stay beside the input or under tests/private-fixtures');
}

function nativeFocus(path){
  if(!path)return {x:.5,y:.5,source:'default'};
  const data=new Uint8Array(readFileSync(path)),d=discoverHeic(data),decoder=new TextDecoder();
  for(const ref of d.refs){
    if(ref.type!=='cdsc'||!ref.to.includes(d.primary)||d.infos.get(ref.from)?.type!=='mime')continue;
    const text=decoder.decode(extractItemData(data,d,ref.from));
    if(!/<mwg-rs:Type>Focus<\/mwg-rs:Type>/.test(text))continue;
    const m=/<mwg-rs:Area[^>]*stArea:x="([^"]+)"[^>]*stArea:y="([^"]+)"/.exec(text);
    if(m){const x=Number(m[1]),y=Number(m[2]);if([x,y].every(Number.isFinite)&&x>=0&&x<=1&&y>=0&&y<=1)return {x,y,source:'native-xmp'};}
  }
  return {x:.5,y:.5,source:'default'};
}
const focus=nativeFocus(native);
const browsers=[
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browser=browsers.find(existsSync);if(!browser)throw Error('Edge/Chrome not installed');

const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8',
  '.wasm':'application/wasm','.onnx':'application/octet-stream','.json':'application/json','.heic':'image/heic','.heif':'image/heif'};
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
  'Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local'),path=decodeURIComponent(url.pathname);
  if(path==='/__input__'){
    const body=await readFile(input);res.writeHead(200,{...headers,'Content-Type':'image/heic','Content-Length':body.length});res.end(body);return;
  }
  if(path==='/__save__'&&req.method==='POST'){
    if(!save){res.writeHead(403,headers);res.end('save disabled');return;}
    const chunks=[];let total=0;
    for await(const chunk of req){total+=chunk.length;if(total>100*1024*1024){res.writeHead(413,headers);res.end();return;}chunks.push(chunk);}
    await writeFile(save,Buffer.concat(chunks));res.writeHead(200,{...headers,'Content-Type':'text/plain'});res.end(String(total));return;
  }
  if(path==='/__debug_depth__'&&req.method==='POST'){
    if(!debugDepth){res.writeHead(403,headers);res.end('debug disabled');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    await writeFile(debugDepth,Buffer.concat(chunks));res.writeHead(200,{...headers,'Content-Type':'text/plain'});res.end('ok');return;
  }
  if(path==='/__smoke__'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<title>HEIC AI Portrait Smoke</title>');return;}
  const full=resolve(root,'.'+path);
  if(!full.startsWith(root)){res.writeHead(404,headers);res.end();return;}
  try{const body=await readFile(full);res.writeHead(200,{...headers,'Content-Type':mime[extname(full).toLowerCase()]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404,headers);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;

const profile=await mkdtemp(join(tmpdir(),'portrait-heic-'));
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--remote-allow-origins=*','--no-first-run',
  '--disable-extensions','--disable-background-networking','--enable-unsafe-webgpu','--user-data-dir='+profile,
  'http://127.0.0.1:'+port+'/__smoke__'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
  let debugPort;
  for(let i=0;i<300;i++){try{debugPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);if(debugPort)break;}catch{}await sleep(100);}
  if(!debugPort)throw Error('CDP port unavailable');
  let endpoint;
  for(let i=0;i<100;i++){try{const tabs=await fetch('http://127.0.0.1:'+debugPort+'/json').then(r=>r.json());endpoint=tabs.find(x=>x.type==='page'&&x.url.includes('__smoke__'))?.webSocketDebuggerUrl;if(endpoint)break;}catch{}await sleep(100);}
  if(!endpoint)throw Error('CDP tab unavailable');
  socket=new WebSocket(endpoint);await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
  let seq=0;const pending=new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data));
    if(message.method==='Runtime.consoleAPICalled')console.log('[browser]',...message.params.args.map(a=>a.value).filter(v=>v!==undefined));
    if(!message.id)return;const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);
    message.error?call.reject(Error(JSON.stringify(message.error))):call.resolve(message.result);
  });
  const cdp=(method,params={},timeout=1200000)=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},timeout);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  await cdp('Runtime.enable');await cdp('Page.enable');await sleep(600);
  const cfg={base:'http://127.0.0.1:'+port,model,provider,aperture,texture,focus,save:Boolean(save),debugDepth:Boolean(debugDepth)};
  const expression='(async cfg=>{'+
    "let data=new Uint8Array(await fetch(cfg.base+'/__input__').then(r=>{if(!r.ok)throw Error('input '+r.status);return r.arrayBuffer()}));"+
    "const file=new File([data],'input.HEIC',{type:'image/heic'});"+
    "if(cfg.texture){const {addTexture}=await import(cfg.base+'/web/src/styles/texture.js');data=addTexture(data,{preserveStyles:true}).data;}"+
    "const [{createAiPortrait},{exportAiPortrait}]=await Promise.all(["+
      "import(cfg.base+'/web/src/portrait/ai-portrait.js'),import(cfg.base+'/web/src/portrait/ai-portrait-export.js')]);"+
    "const events=[],started=performance.now();"+
    "const result=await createAiPortrait(data,(stage,progress)=>{if(!events.length||events.at(-1)!==stage)events.push(stage);if(progress?.loaded)console.info(stage,progress.loaded,progress.total||0)},file,{provider:cfg.provider,modelId:cfg.model});"+
    "if(cfg.debugDepth){const c=document.createElement('canvas');c.width=result.width;c.height=result.height;const x=c.getContext('2d'),im=x.createImageData(result.width,result.height);for(let i=0;i<result.gray.length;i++){const v=result.gray[i],p=i*4;im.data[p]=im.data[p+1]=im.data[p+2]=v;im.data[p+3]=255}x.putImageData(im,0,0);const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));const saved=await fetch(cfg.base+'/__debug_depth__',{method:'POST',body:blob});if(!saved.ok)throw Error('debug '+saved.status);c.width=c.height=0;}"+
    "if(!cfg.save)return {ms:Math.round(performance.now()-started),subjectReport:result.subjectReport,foregroundReport:result.foregroundReport,suggestedFocus:result.suggestedFocus};"+
    "const output=await exportAiPortrait(result,stage=>{if(stage&&!events.includes(stage))events.push(stage)});"+
    "const chosenFocus=cfg.focus.source==='native-xmp'?cfg.focus:(result.suggestedFocus||cfg.focus);"+
    "const updated=await output.withSettings({focusX:chosenFocus.x,focusY:chosenFocus.y,aperture:cfg.aperture});"+
    "if(cfg.save){const saved=await fetch(cfg.base+'/__save__',{method:'POST',body:updated.data});if(!saved.ok)throw Error('save '+saved.status);}"+
    "const report={bytes:updated.data.length,ms:Math.round(performance.now()-started),subjectReport:result.subjectReport,foregroundReport:result.foregroundReport,suggestedFocus:result.suggestedFocus,sceneProfile:result.sceneProfile,exportReport:updated.report,focus:chosenFocus,events,model:cfg.model,provider:cfg.provider,aperture:cfg.aperture};"+
    "output.dispose();return report;"+
    '})('+JSON.stringify(cfg)+')';
  const out=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},1200000);
  if(out.exceptionDetails)throw Error(JSON.stringify(out.exceptionDetails));
  if(!out.result?.value)throw Error('No smoke result');
  console.log('PASS '+JSON.stringify(out.result.value,null,2));
  if(save)console.log('Saved '+save);
}finally{
  try{socket?.close();}catch{}
  child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
  if(!resolve(profile).startsWith(resolve(tmpdir())+sep+'portrait-heic-'))throw Error('Unsafe temporary browser profile path');
  try{await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});}catch{}
}
