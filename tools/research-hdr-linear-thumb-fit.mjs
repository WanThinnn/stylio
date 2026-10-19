import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,irotAngleForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';

const [sourceFile,nativeFile]=process.argv.slice(2);
if(!sourceFile||!nativeFile)throw Error('Usage: node tools/research-hdr-linear-thumb-fit.mjs <source.heic> <native-full.heic>');
const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:512*1024*1024}));
const item=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
function hvcc(b,d,id){const p=propertyBoxBytes(b,d.props,id,'hvcC');if(!p)throw Error('hvcC');const x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);}
function annexB(record,payload){const s=Uint8Array.of(0,0,0,1),parts=[];let p=23;for(let i=0;i<record[22];i++){p++;const n=(record[p]<<8)|record[p+1];p+=2;for(let j=0;j<n;j++){const z=(record[p]<<8)|record[p+1];p+=2;parts.push(s,record.slice(p,p+z));p+=z;}}const ls=(record[21]&3)+1;for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;parts.push(s,payload.slice(p,p+z));p+=z;}const n=parts.reduce((a,x)=>a+x.length,0),o=new Uint8Array(n);let q=0;for(const x of parts){o.set(x,q);q+=x.length;}return o;}
async function decodeGain(bytes,d){
 const [gw,gh]=dimensionsForItem(d.props,d.hdrGrid),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),cols=Math.ceil(gw/tw);
 const out=new Uint8Array(gw*gh);
 for(let i=0;i<d.hdrTiles.length;i++){const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);for(let y=0;y<ch;y++)out.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);}
 return {bytes:out,w:gw,h:gh};
}
function decodePrimary(file,w,h,irot){
 // FFmpeg's HEIF grid path applies irot even with -noautorotate. Undo it so the
 // decoded primary returns to stored orientation used by gain-map/linearThumb.
 const png=run(['-noautorotate','-i',file,'-frames:v','1','-pix_fmt','rgb48be','-c:v','png','-f','image2pipe','pipe:1']);
 let undo='';
 if(irot===270)undo='transpose=2,';
 else if(irot===90)undo='transpose=1,';
 else if(irot===180)undo='hflip,vflip,';
 else if(irot!==0)throw Error('unsupported irot '+irot);
 return {raw:run(['-f','image2pipe','-i','pipe:0','-vf',undo+'scale='+w+':'+h+':flags=lanczos','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],png)};
}
function decodeLinear(bytes,d){
 const id=d.linearThumb,[w,h]=dimensionsForItem(d.props,id);
 const raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));
 return {raw,w,h};
}
const src=new Uint8Array(await fs.readFile(sourceFile)),sd=discoverHeic(src),nat=new Uint8Array(await fs.readFile(nativeFile)),nd=discoverHeic(nat);
const gain=await decodeGain(src,sd),prim=decodePrimary(sourceFile,gain.w,gain.h,irotAngleForItem(src,sd.props,sd.primary)),lin=decodeLinear(nat,nd);
const tmapId=[...sd.infos].find(([,x])=>x.type==='tmap')?.[0],meta=parseTmapMetadata(item(src,sd,tmapId)),ch=meta.channels[0];
// Reconstruct linear alternate RGB at gain-map resolution into planar gbrpf32le.
const sourceN=gain.w*gain.h,scene=Buffer.alloc(sourceN*3*4);
const sourceOff=[2*sourceN*4,0,sourceN*4]; // RGB -> gbrpf32le plane offsets.
for(let i=0;i<sourceN;i++){
 const g=gain.bytes[i]/255,lg=ch.min+(g**(1/ch.gamma))*(ch.max-ch.min);
 for(let c=0;c<3;c++){
   const e=prim.raw.readUInt16LE((i*3+c)*2)/65535,s=encodedToLinear(e,'srgb');
   const v=Math.max(0,(s+ch.baseOffset)*(2**lg)-ch.alternateOffset);
   scene.writeFloatLE(v,sourceOff[c]+i*4);
 }
}
// Bilinear downsample in JS so values above 1 survive (ffmpeg scale clamps float RGB).
const N=lin.w*lin.h,pairs=[[],[],[]];
const readScene=(c,x,y)=>scene.readFloatLE(sourceOff[c]+(y*gain.w+x)*4);
for(let ty=0;ty<lin.h;ty++){
 const sy=(ty+.5)*gain.h/lin.h-.5,y0=Math.max(0,Math.min(gain.h-1,Math.floor(sy))),y1=Math.min(gain.h-1,y0+1),fy=Math.max(0,Math.min(1,sy-y0));
 for(let tx=0;tx<lin.w;tx++){
  const sx=(tx+.5)*gain.w/lin.w-.5,x0=Math.max(0,Math.min(gain.w-1,Math.floor(sx))),x1=Math.min(gain.w-1,x0+1),fx=Math.max(0,Math.min(1,sx-x0));
  const i=ty*lin.w+tx;
  for(let c=0;c<3;c++){
   const a=readScene(c,x0,y0)*(1-fx)+readScene(c,x1,y0)*fx;
   const b=readScene(c,x0,y1)*(1-fx)+readScene(c,x1,y1)*fx;
   const x=a*(1-fy)+b*fy,y=lin.raw.readUInt16LE((i*3+c)*2)/65535;
   if(Number.isFinite(x))pairs[c].push([x,y]);
  }
 }
}
function fit(arr){
 let sx=0,sy=0,sxx=0,sxy=0;for(const [x,y] of arr){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}const n=arr.length,a=(n*sxy-sx*sy)/(n*sxx-sx*sx),b=(sy-a*sx)/n;
 let mae=0,rm=0;for(const [x,y] of arr){const e=a*x+b-y;mae+=Math.abs(e);rm+=e*e;}return {gain:a,bias:b,mae:mae/n,rmse:Math.sqrt(rm/n)};
}
function q(arr,key,p){const a=arr.map(z=>z[key]).sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))];}
const qs=[.5,.9,.98,.99,.995,.999,.9999,1],names=['r','g','b'],result={sourceFile,nativeFile,sceneDims:[gain.w,gain.h],thumbDims:[lin.w,lin.h],tmap:ch,channels:{}};
for(let c=0;c<3;c++){const arr=pairs[c],stats={};for(const p of qs)stats[p]={scene:q(arr,0,p),native:q(arr,1,p)};result.channels[names[c]]={fit:fit(arr),stats};}
console.log(JSON.stringify(result,null,2));