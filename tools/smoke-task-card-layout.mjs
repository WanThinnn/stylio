// Real shell/card DOM and production styles; no AI, photos or external network.
// node tools/smoke-task-card-layout.mjs
// STYLIO_PLAYWRIGHT_MODULE may point at an existing Playwright installation.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url),{chromium}=require(process.env.STYLIO_PLAYWRIGHT_MODULE||'playwright');
const root=resolve(fileURLToPath(new URL('../web/',import.meta.url)));
const output=resolve('tests/private-fixtures/task-card-v256');await mkdir(output,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const fixture=`import {getAppShell} from '/src/ui/shell/app-shell.js';
 clearTimeout(window.stylioBootTimer);document.getElementById('app-launch').hidden=true;
 document.getElementById('app-styles').media='all';document.getElementById('boot').hidden=true;
 const shell=getAppShell(),list=document.getElementById('list');
 const second=document.createElement('article');second.innerHTML='<div class="act"></div>';list.append(second);
 window.nextCard=shell.register(second,'Next photo.heic',null);nextCard.update('queued','Waiting');
 const row=document.createElement('article');row.innerHTML='<div class="act"></div>';list.append(row);
 window.cardFixture=shell.register(row,'IMG_2327.heic',null);
 cardFixture.update('processing','Separating the subject…');cardFixture.progress(65);
 document.querySelector('[data-screen="history"]').click();`;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fixture);return;}
  const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!path.startsWith(root+sep))throw Error('outside web root');
  let body=await readFile(path);
  if(url.pathname==='/')body=body.toString().replace('src="src/ui/page-bootstrap.js"','src="/fixture.js"');
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>Boolean(window.cardFixture));
 await page.locator('#history-items .task-card').first().waitFor({state:'visible'});
 const statuses=['Separating the subject…','Initializing the Segmentation Refinement Model…',
  'Downloading the Segmentation Refinement Model… 99% · 105.5 MB',
  'Đang chờ lượt tài nguyên để tiếp tục xử lý…',
  '正在读取已保存的分割优化模型，正在准备继续处理照片。',
  'X'.repeat(150),'','Separating the subject…'];
 const results=[];
 for(const width of [320,390,430,768,1280])for(const fontScale of [1,2])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:844});
  await page.evaluate(({fontScale,theme})=>{document.documentElement.style.fontSize=fontScale*100+'%';document.documentElement.dataset.theme=theme;}, {fontScale,theme});
  const samples=[];
  for(const status of statuses){
   samples.push(await page.evaluate(status=>{
    cardFixture.update('processing',status);
    const card=document.querySelector('#history-items .task-card'),text=card.querySelector('.task-copy>span'),title=card.querySelector('.task-copy>strong');
    const rect=card.getBoundingClientRect(),next=document.querySelectorAll('#history-items .task-card')[1].getBoundingClientRect();
    const copy=card.querySelector('.task-copy').getBoundingClientRect(),icon=card.querySelector('.task-symbol').getBoundingClientRect();
    return {width:rect.width,height:rect.height,nextTop:next.top,textHeight:text.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(text).lineHeight),
     copyCenter:copy.y+copy.height/2,iconCenter:icon.y+icon.height/2,textScrollHeight:text.scrollHeight,textClientHeight:text.clientHeight,
     text:text.textContent,titleHeight:title.getBoundingClientRect().height,titleLineHeight:parseFloat(getComputedStyle(title).lineHeight),
     right:rect.right,viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};
   },status));
  }
  const reference=samples[0];
  assert.ok(samples.every(s=>Math.abs(s.width-reference.width)<.1&&Math.abs((s.nextTop-reference.nextTop)-(s.height-reference.height))<.1),
   JSON.stringify({width,fontScale,theme,samples}));
  assert.ok(samples.every(s=>Math.abs(s.copyCenter-s.iconCenter)<.1),'natural text group stays centered beside the progress icon');
  assert.ok(samples.every(s=>s.textScrollHeight<=s.textClientHeight+1),'long diagnostics must wrap rather than clip');
  assert.ok(samples.every((s,i)=>!statuses[i]||s.text===statuses[i]),'clamping must not remove diagnostic text from the DOM');
  assert.ok(samples.every(s=>s.right<=s.viewport+.1&&s.scrollWidth<=s.viewport),'text cannot enlarge the page');
  if(fontScale===1){
   assert.ok(reference.height<=90,'short text keeps the original compact card');
   assert.ok(Math.abs(reference.textHeight-reference.lineHeight)<.1,'short status occupies one line without a reserved blank line');
   if(width===320)assert.ok(Math.abs(samples[1].textHeight-2*samples[1].lineHeight)<.1,'normal long model status wraps naturally onto two lines when space requires it');
  }
  const longTitle=await page.evaluate(()=>{
   document.querySelector('#history-items .task-copy>strong').textContent='Very_long_original_photo_name_from_the_camera_export_2327.heic';
   const card=document.querySelector('#history-items .task-card'),title=card.querySelector('strong');
   return {height:card.getBoundingClientRect().height,titleHeight:title.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(title).lineHeight),scrollHeight:title.scrollHeight,clientHeight:title.clientHeight};
  });
  assert.ok(longTitle.height>=reference.height&&longTitle.titleHeight>=longTitle.lineHeight-.1&&longTitle.scrollHeight<=longTitle.clientHeight+1,'original filename wrapping remains readable');
  results.push({width,fontScale,theme,cardHeight:reference.height,statusHeight:reference.textHeight});
  if(width===390&&fontScale===1){
   await page.evaluate(()=>cardFixture.update('processing','Downloading the Segmentation Refinement Model… 99% · 105.5 MB'));
   await page.locator('#history-items .task-card').first().screenshot({path:resolve(output,'card-'+theme+'.png')});
  }
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({passed:results.length,normalHeight:results.find(r=>r.width===390&&r.fontScale===1).cardHeight,output}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
