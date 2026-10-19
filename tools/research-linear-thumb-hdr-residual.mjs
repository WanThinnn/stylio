import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';

const [sourceFile,nativeFile]=process.argv.slice(2);
if(!sourceFile||!nativeFile)throw Error('Usage: node tools/research-linear-thumb-hdr-residual.mjs <source.heic> <native-full.heic>');
const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024}));
const item=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
function hvcc(b,d,id){const p=propertyBoxBytes(b,d.props,id,'hvcC');if(!p)throw Error('hvcC missing');const x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);}
function annexB(record,payload){const start=Uint8Array.of(0,0,0,1),parts=[];let p=23;for(let i=0;i<record[22];i++){p++;const n=(record[p]<<8)|record[p+1];p+=2;for(let j=0;j<n;j++){const z=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+z));p+=z;}}const ls=(record[21]&3)+1;for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+z));p+=z;}const n=parts.reduce((s,x)=>s+x.length,0),out=new Uint8Array(n);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;}
function decodePrimary(file,w,h){
 const png=run(['-noautorotate','-i',file,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
 return run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${w}:${h}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
}
async function decodeGain(bytes,d){
 const [gw,gh]=dimensionsForItem(d.props,d.hdrGrid),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),cols=Math.ceil(gw/tw),out=new Uint8Array(gw*gh);
 for(let i=0;i<d.hdrTiles.length;i++){const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);for(let y=0;y<ch;y++)out.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);}
 return {bytes:out,w:gw,h:gh};
}
function decodeLinear(bytes,d){const id=d.linearThumb,[w,h]=dimensionsForItem(d.props,id);return {w,h,raw:run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)))};}
function bilinear(arr,w,h,x,y){const x0=Math.max(0,Math.min(w-1,Math.floor(x))),x1=Math.min(w-1,x0+1),y0=Math.max(0,Math.min(h-1,Math.floor(y))),y1=Math.min(h-1,y0+1),fx=Math.max(0,Math.min(1,x-x0)),fy=Math.max(0,Math.min(1,y-y0));const a=arr[y0*w+x0]*(1-fx)+arr[y0*w+x1]*fx,b=arr[y1*w+x0]*(1-fx)+arr[y1*w+x1]*fx;return a*(1-fy)+b*fy;}
const src=new Uint8Array(await fs.readFile(sourceFile)),sd=discoverHeic(src),nat=new Uint8Array(await fs.readFile(nativeFile)),nd=discoverHeic(nat),lin=decodeLinear(nat,nd),gain=await decodeGain(src,sd),rgb=decodePrimary(sourceFile,lin.w,lin.h);
const tmapId=[...sd.infos].find(([,x])=>x.type==='tmap')?.[0],meta=parseTmapMetadata(item(src,sd,tmapId)),ch=meta.channels[0];
const coeff=[[0.3958286474463609,0.2506569254211693],[0.39896807046980753,0.25019950692217563],[0.3942329991599476,0.25288729152056394]];
const gainBins=Array.from({length:10},()=>({n:0,sumAbs:0,sumSigned:0,maxAbs:0,highResidual:0,sumScene:0}));
const sceneEdges=[0,.25,.5,.75,1,1.5,2,3,4,6],sceneBins=Array.from({length:sceneEdges.length-1},()=>({n:0,sumAbs:0,sumSigned:0,highResidual:0,sumGain:0}));
const residuals=[],high=[],highFit=[];
for(let y=0;y<lin.h;y++)for(let x=0;x<lin.w;x++){
 const i=y*lin.w+x,g=bilinear(gain.bytes,gain.w,gain.h,(x+.5)*gain.w/lin.w-.5,(y+.5)*gain.h/lin.h-.5)/255,lg=ch.min+(g**(1/ch.gamma))*(ch.max-ch.min);
 let sceneY=0,resY=0,baseY=0,nativeY=0;
 for(let c=0;c<3;c++){
   const p=rgb[i*3+c]/255,[a,b]=coeff[c],base=Math.max(0,Math.min(1,a*p+b)),native=lin.raw.readUInt16LE((i*3+c)*2)/65535;
   const s=encodedToLinear(p,'srgb'),scene=Math.max(0,(s+ch.baseOffset)*(2**lg)-ch.alternateOffset),w=[.2126,.7152,.0722][c];
   sceneY+=w*scene;baseY+=w*base;nativeY+=w*native;
 }
 resY=nativeY-baseY;const ar=Math.abs(resY);residuals.push(resY);
 const bi=Math.min(9,Math.floor(g*10)),gb=gainBins[bi];gb.n++;gb.sumAbs+=ar;gb.sumSigned+=resY;gb.maxAbs=Math.max(gb.maxAbs,ar);gb.sumScene+=sceneY;if(ar>.08)gb.highResidual++;
 let si=sceneEdges.length-2;for(let k=0;k<sceneEdges.length-1;k++)if(sceneY>=sceneEdges[k]&&sceneY<sceneEdges[k+1]){si=k;break;}
 const sb=sceneBins[si];sb.n++;sb.sumAbs+=ar;sb.sumSigned+=resY;sb.sumGain+=g;if(ar>.08)sb.highResidual++;
 if(g>=.55)highFit.push([g,resY]);
 if(ar>.08)high.push({g,lg,sceneY,resY,baseY,nativeY});
}
const summarize=b=>b.map((x,i)=>({bin:i,n:x.n,mae:x.n?x.sumAbs/x.n:0,meanResidual:x.n?x.sumSigned/x.n:0,maxAbs:x.maxAbs??null,highResidualFraction:x.n?x.highResidual/x.n:0,meanScene:x.sumScene?x.sumScene/x.n:undefined,meanGain:x.sumGain?x.sumGain/x.n:undefined}));
high.sort((a,b)=>b.resY-a.resY);
const linearFit=a=>{let sx=0,sy=0,sxx=0,sxy=0;for(const [x,y] of a){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}const n=a.length,m=(n*sxy-sx*sy)/(n*sxx-sx*sx),b=(sy-m*sx)/n;let mae=0;for(const [x,y] of a)mae+=Math.abs(m*x+b-y);return {n,slope:m,intercept:b,zeroAt:-b/m,mae:mae/n};};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor((b.length-1)*p)];};
console.log(JSON.stringify({
 file:sourceFile,native:nativeFile,tmap:ch,
 overall:{mae:residuals.reduce((s,x)=>s+Math.abs(x),0)/residuals.length,mean:residuals.reduce((s,x)=>s+x,0)/residuals.length,p99Abs:q(residuals.map(Math.abs),.99),p999Abs:q(residuals.map(Math.abs),.999)},
 highGainLinearFit:linearFit(highFit),
 gainBins:summarize(gainBins),
 sceneBins:sceneBins.map((x,i)=>({range:[sceneEdges[i],sceneEdges[i+1]],n:x.n,mae:x.n?x.sumAbs/x.n:0,meanResidual:x.n?x.sumSigned/x.n:0,highResidualFraction:x.n?x.highResidual/x.n:0,meanGain:x.n?x.sumGain/x.n:0})),
 topPositiveResidual:high.slice(0,20)
},null,2));