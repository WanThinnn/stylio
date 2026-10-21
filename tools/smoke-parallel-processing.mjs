// Real app + real models on loopback. An iPhone UA exercises the mobile memory
// policy in Chromium; this is NOT a substitute for actual Safari device tests.
// STYLIO_PLAYWRIGHT_MODULE may point at an existing Playwright installation.
import {createServer} from 'node:http';
import {createReadStream,existsSync} from 'node:fs';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {FFMPEG_ASSETS} from '../web/src/codecs/ffmpeg-assets.js';
import {ORT_ASSETS} from '../web/src/vision/ort-assets.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.STYLIO_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../web/',import.meta.url)),input=process.argv[2];
if(!input||!existsSync(input))throw Error('Usage: node tools/smoke-parallel-processing.mjs INPUT.HEIC');
const output=resolve('tests/private-fixtures/parallel-v253-browser');await mkdir(output,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const requests=new Map();let transfers=0,peakTransfers=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(resolve(root)+sep))throw Error('outside web root');
  const info=await stat(path);if(!info.isFile())throw Error('not a file');
  if(/\.onnx(?:_data)?$/.test(path)){
   requests.set(url.pathname,(requests.get(url.pathname)||0)+1);transfers++;peakTransfers=Math.max(peakTransfers,transfers);
   res.once('close',()=>transfers--);
  }
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Content-Length':info.size,
   'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-store'});
  createReadStream(path).pipe(res);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath,args:['--enable-unsafe-webgpu']});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'});
 const dependencies=new Set(['https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif/libheif.js',...FFMPEG_ASSETS.map(a=>a.url),...ORT_ASSETS.map(a=>a.url)]);
 await context.route('**/*',route=>route.request().url().startsWith(origin)||dependencies.has(route.request().url())?route.continue():route.abort());
 await context.addInitScript(()=>{
  localStorage.setItem('stylio-parallel-v1','on');localStorage.setItem('stylio-has-processed','1');
  localStorage.setItem('stylio-ai-settings-hint-v2','1');
  if(window===window.top)window.__parallelAudit={active:0,peak:0,workers:[],doubleProcessing:false};
  const Base=window.Worker;
  window.Worker=class extends Base{
   constructor(url,options){
    super(url,options);this.tracked=/\/(?:ai-inference|foreground-matte|subject-inference)-worker\.js/.test(String(url));
    if(this.tracked){const audit=window.top.__parallelAudit;audit.active++;audit.peak=Math.max(audit.peak,audit.active);audit.workers.push(String(url));}
   }
   terminate(){if(this.tracked){this.tracked=false;window.top.__parallelAudit.active--;}super.terminate();}
  };
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('renderer crashed'));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.getElementById('file').disabled,null,{timeout:30000});
 assert.equal(await page.locator('#parallel-processing').isEnabled(),true);
 await page.evaluate(()=>{
  for(const [id,checked]of [['enhance-ai',true],['ai-portrait',true],['ai-detail',false],['ai-style-suggest',false]]){
   const control=document.getElementById(id);control.checked=checked;control.dispatchEvent(new Event('change',{bubbles:true}));
  }
  new MutationObserver(()=>{
   if(document.querySelectorAll('#history-items .task-card[data-state="processing"]').length===2)window.__parallelAudit.doubleProcessing=true;
  }).observe(document.getElementById('history-items'),{subtree:true,childList:true,attributes:true});
 });
 const buffer=await readFile(input);
 await page.locator('#file').setInputFiles([1,2].map(i=>({name:'parallel-'+i+'.HEIC',mimeType:'image/heic',buffer})));
 await page.waitForFunction(()=>document.querySelectorAll('#history-items .task-card[data-state="ready"]').length===2,
  null,{timeout:600000});
 const audit=await page.evaluate(()=>({...window.__parallelAudit,cards:[...document.querySelectorAll('#history-items .task-card')].map(el=>el.textContent),frames:document.querySelectorAll('iframe.processing-lane').length,
  details:document.getElementById('list').innerText,isolated:crossOriginIsolated,
  outputs:[...document.querySelectorAll('#list a[download]')].map(a=>a.download)}));
 assert.equal(audit.outputs.filter(name=>name.endsWith('_Portrait.HEIC')).length,2,JSON.stringify(audit));
 assert.equal(audit.doubleProcessing,true,'both jobs must enter the actual application pipeline');
 assert.equal(audit.frames,1,'second job must use its isolated runtime');
 assert.equal(audit.peak,1,'mobile AI workers must not overlap across realms');
 assert.equal(audit.active,0,'all model workers must terminate');
 assert.ok(audit.workers.length>=6,'both Standard photos must actually run depth and foreground refinement');
 assert.equal(peakTransfers,1,'model transfers must not overlap');
 assert.ok([...requests.values()].every(count=>count===1),'second lane must reuse cached weights instead of fetching again');
 assert.deepEqual(errors,[]);
 const report={engine:'Chromium with iPhone UA (not Safari)',audit,modelRequests:Object.fromEntries(requests),peakTransfers,errors};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 await page.screenshot({path:resolve(output,'history.png')});
 console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
