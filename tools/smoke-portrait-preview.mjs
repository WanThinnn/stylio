// Real WebGL readback regression: affine relative depth must not alter blur.
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const browser=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browser)throw Error('Edge/Chrome unavailable');
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/'){res.end('<title>Portrait GPU regression</title>');return;}
 const file=resolve(root,'.'+url.pathname);
 if(!file.startsWith(resolve(root,'web/src/portrait')+sep)){res.writeHead(404);res.end();return;}
 try{const body=await readFile(file);res.writeHead(200,{'Content-Type':'text/javascript'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(join(tmpdir(),'portrait-preview-'));
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--remote-allow-origins=*','--no-first-run','--disable-extensions','--user-data-dir='+profile,base],{stdio:'ignore'});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));let socket;
try{
 let port;
 for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await sleep(100);}
 if(!port)throw Error('CDP unavailable');
 const pages=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
 socket=new WebSocket(pages.find(p=>p.type==='page'&&p.url.startsWith(base)).webSocketDebuggerUrl);
 await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
 let next=0;const pending=new Map();
 socket.addEventListener('message',e=>{const r=JSON.parse(String(e.data));if(!r.id)return;const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);});
 const cdp=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('CDP timeout')),30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 for(let i=0;i<100;i++){const r=await cdp('Runtime.evaluate',{expression:'location.href',returnByValue:true});if(r.result?.value?.startsWith(base))break;if(i===99)throw Error('Preview page did not load');await sleep(100);}
 const result=await cdp('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
  const {createBokehRenderer}=await import('/web/src/portrait/ai-bokeh.js');
  const source=document.createElement('canvas');source.width=source.height=96;
  const ctx=source.getContext('2d'),pixels=ctx.createImageData(96,96);
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){const p=(y*96+x)*4,v=((x>>2)+(y>>2))%2?235:20;pixels.data.set([v,80,255-v,255],p);}
  ctx.putImageData(pixels,0,0);
  const read=(depth,blur)=>{
   const renderer=createBokehRenderer(source,new Uint8Array(96*96).fill(depth),96,96);
   try{renderer.draw({focus:160,blur});const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const c=canvas.getContext('2d');c.drawImage(renderer.canvas,0,0);return c.getImageData(0,0,96,96).data;}finally{renderer.close();}
  };
  const difference=(a,b)=>{let sum=0,max=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);sum+=delta;max=Math.max(max,delta);}return {mean:sum/a.length,max};};
  const far=difference(read(60,100),read(110,200));
  const near=difference(read(240,200),read(200,400));
  if(far.max>2||near.max>2)throw Error('Affine depth changes preview blur: '+JSON.stringify({far,near}));
  const off=difference(read(60,0),read(60,100));
  if(off.mean<1)throw Error('Nonzero blur did not affect the image');
  return {far,near,offDifference:off.mean};
 })()`});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 console.log('PASS real GPU response '+JSON.stringify(result.result.value));
}finally{
 socket?.close();child.kill();server.closeAllConnections();await new Promise(ok=>server.close(ok));
 if(!resolve(profile).startsWith(resolve(tmpdir())+sep+'portrait-preview-'))throw Error('Unsafe temporary profile path');
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
