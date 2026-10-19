const {chromium}=require('C:/Users/WanThinnn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),http=require('http'),path=require('path');
const root=path.resolve('web');
const sample=path.resolve('tests/private-fixtures/indigo-hdr/input.jpg');
const output=path.resolve('tests/private-fixtures/indigo-hdr/Indigo_HEAD_Baseline.HEIC');
const types={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const special={'/source.jpg':sample,'/result.heic':output};
 const file=special[pathname]??path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!special[pathname]&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const report=await page.evaluate(async()=>{
   const {extractJpegHdr,yuv420Tile}=await import('/src/raster/jpeg-hdr.js');
   const {decodeJpegYuv,decodeHevcYuv,releaseHevcEncoder}=await import('/src/raster/ffmpeg-hevc.js');
   const {discoverHeic,extractItemData,propertyBoxBytes}=await import('/src/raster/heif.js');
   const source=extractJpegHdr(new Uint8Array(await(await fetch('/source.jpg')).arrayBuffer()));
   const data=new Uint8Array(await(await fetch('/result.heic')).arrayBuffer()),d=discoverHeic(data);
   const first=d.refs.find(r=>r.type==='dimg'&&r.from===d.hdrGrid).to[0];
   try{
    const raw=await decodeJpegYuv(source.gain,{width:source.gainWidth,height:source.gainHeight});
    const expected=yuv420Tile(raw.bytes,source.gainWidth,source.gainHeight,0,0);
    const actual=await decodeHevcYuv(propertyBoxBytes(data,d.props,first,'hvcC').subarray(8),extractItemData(data,d,first),{width:512,height:512});
    let mismatches=0,maxDelta=0,sum=0,firstMismatch=-1,emin=255,emax=0,amin=255,amax=0;
    for(let i=0;i<expected.length;i++){const delta=Math.abs(expected[i]-actual[i]);if(delta){mismatches++;if(firstMismatch<0)firstMismatch=i;}maxDelta=Math.max(maxDelta,delta);sum+=delta;emin=Math.min(emin,expected[i]);emax=Math.max(emax,expected[i]);amin=Math.min(amin,actual[i]);amax=Math.max(amax,actual[i]);}
    return {gainSize:[source.gainWidth,source.gainHeight],samples:expected.length,mismatches,firstMismatch,maxDelta,meanAbsDelta:sum/expected.length,
      expectedRange:[emin,emax],actualRange:[amin,amax]};
   }finally{releaseHevcEncoder();}
  });
  console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});