// Temporary static preview: web/ only, no photo inputs, uploads or directory
// listing. Loopback by default; put an explicitly approved HTTPS tunnel in front.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';

const root=resolve(fileURLToPath(new URL('../web/',import.meta.url)));
const port=Number(process.env.STYLIO_TEST_PORT||8790),ttl=Number(process.env.STYLIO_TEST_TTL_MS||7200000);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isFinite(ttl)||ttl<=0||ttl>14400000)throw Error('Invalid preview limits');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png',
 '.webmanifest':'application/manifest+json','.zip':'application/zip','.onnx':'application/octet-stream','.onnx_data':'application/octet-stream',
 '.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep)||!Object.hasOwn(types,extname(path)))throw Error('not a public asset');
  const info=await stat(path);if(!info.isFile())throw Error('not a file');
  res.writeHead(200,{'Content-Type':types[extname(path)],'Content-Length':info.size,'Cache-Control':'no-store',
   'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin',
   'X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(path);res.once('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
console.log('Static test app on http://127.0.0.1:'+port+'; expires '+new Date(Date.now()+ttl).toISOString());
const stop=()=>{server.closeAllConnections();server.close();};
setTimeout(stop,ttl).unref();process.once('SIGINT',stop);process.once('SIGTERM',stop);
