import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {
  discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,irotAngleForItem
} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';

const argv=process.argv.slice(2);
const split=argv.indexOf('--holdout');
if(split<1||split+2>=argv.length)throw Error('Usage: node tools/research-linear-thumb-hybrid-model.mjs <train.heic> [...] --holdout <source.heic> <native.heic>');
const trainFiles=argv.slice(0,split),holdSource=argv[split+1],holdNative=argv[split+2];
const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:512*1024*1024}));
const item=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);

function hvcc(b,d,id){
  const p=propertyBoxBytes(b,d.props,id,'hvcC');if(!p)throw Error('hvcC');
  const x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);
}
function annexB(record,payload){
  const s=Uint8Array.of(0,0,0,1),parts=[];let p=23;
  for(let i=0;i<record[22];i++){p++;const n=(record[p]<<8)|record[p+1];p+=2;for(let j=0;j<n;j++){const z=(record[p]<<8)|record[p+1];p+=2;parts.push(s,record.slice(p,p+z));p+=z;}}
  const ls=(record[21]&3)+1;
  for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;parts.push(s,payload.slice(p,p+z));p+=z;}
  const n=parts.reduce((a,x)=>a+x.length,0),o=new Uint8Array(n);let q=0;for(const x of parts){o.set(x,q);q+=x.length;}return o;
}
async function decodeGain(bytes,d){
  const [gw,gh]=dimensionsForItem(d.props,d.hdrGrid),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),cols=Math.ceil(gw/tw);
  const out=new Uint8Array(gw*gh);
  for(let i=0;i<d.hdrTiles.length;i++){
    const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));
    const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);
    for(let y=0;y<ch;y++)out.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);
  }
  return {bytes:out,w:gw,h:gh};
}
function decodePrimary(file,w,h,irot){
  const png=run(['-noautorotate','-i',file,'-frames:v','1','-pix_fmt','rgb48be','-c:v','png','-f','image2pipe','pipe:1']);
  let undo='';
  if(irot===270)undo='transpose=2,';
  else if(irot===90)undo='transpose=1,';
  else if(irot===180)undo='hflip,vflip,';
  else if(irot!==0)throw Error('unsupported irot '+irot);
  return run(['-f','image2pipe','-i','pipe:0','-vf',undo+'scale='+w+':'+h+':flags=lanczos','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],png);
}
function decodeLinear(bytes,d){
  const id=d.linearThumb,[w,h]=dimensionsForItem(d.props,id);
  return {raw:run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id))),w,h};
}
const bilinear=(get,w,h,tx,ty,tw,th)=>{
  const sy=(ty+.5)*h/th-.5,y0=Math.max(0,Math.min(h-1,Math.floor(sy))),y1=Math.min(h-1,y0+1),fy=Math.max(0,Math.min(1,sy-y0));
  const sx=(tx+.5)*w/tw-.5,x0=Math.max(0,Math.min(w-1,Math.floor(sx))),x1=Math.min(w-1,x0+1),fx=Math.max(0,Math.min(1,sx-x0));
  const a=get(x0,y0)*(1-fx)+get(x1,y0)*fx,b=get(x0,y1)*(1-fx)+get(x1,y1)*fx;
  return a*(1-fy)+b*fy;
};
async function makeSamples(sourceFile,nativeFile,stride=1){
  const src=new Uint8Array(await fs.readFile(sourceFile)),sd=discoverHeic(src),nat=new Uint8Array(await fs.readFile(nativeFile)),nd=discoverHeic(nat);
  const gain=await decodeGain(src,sd),primary=decodePrimary(sourceFile,gain.w,gain.h,irotAngleForItem(src,sd.props,sd.primary)),lin=decodeLinear(nat,nd);
  const tmapId=[...sd.infos].find(([,x])=>x.type==='tmap')?.[0],meta=parseTmapMetadata(item(src,sd,tmapId)),ch=meta.channels[0];
  const scene=[new Float32Array(gain.w*gain.h),new Float32Array(gain.w*gain.h),new Float32Array(gain.w*gain.h)];
  for(let i=0;i<gain.w*gain.h;i++){
    const g=gain.bytes[i]/255,lg=ch.min+(g**(1/ch.gamma))*(ch.max-ch.min);
    for(let c=0;c<3;c++){
      const e=primary.readUInt16LE((i*3+c)*2)/65535,s=encodedToLinear(e,'srgb');
      scene[c][i]=Math.max(0,(s+ch.baseOffset)*(2**lg)-ch.alternateOffset);
    }
  }
  const out=[[],[],[]];
  for(let ty=0;ty<lin.h;ty+=stride)for(let tx=0;tx<lin.w;tx+=stride){
    const ni=ty*lin.w+tx;
    for(let c=0;c<3;c++){
      const p=bilinear((x,y)=>primary.readUInt16LE(((y*gain.w+x)*3+c)*2)/65535,gain.w,gain.h,tx,ty,lin.w,lin.h);
      const s=bilinear((x,y)=>scene[c][y*gain.w+x],gain.w,gain.h,tx,ty,lin.w,lin.h);
      const y=lin.raw.readUInt16LE((ni*3+c)*2)/65535;
      out[c].push({p,s,y});
    }
  }
  return {samples:out,w:lin.w,h:lin.h,tmap:ch};
}
function solve(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;
    [M[i],M[p]]=[M[p],M[i]];
    const d=M[i][i];if(Math.abs(d)<1e-12)throw Error('singular');
    for(let k=i;k<=n;k++)M[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=M[j][i];for(let k=i;k<=n;k++)M[j][k]-=f*M[i][k];}
  }
  return M.map(r=>r[n]);
}
const sat=x=>x<=0?0:x/(1+x);
const featureSets={
  primary: z=>[z.p,1],
  hybrid1: z=>[z.p,Math.max(0,z.s-1),1],
  hybrid2: z=>[z.p,Math.max(0,z.s-1),Math.max(0,z.s-2),1],
  hybrid3: z=>[z.p,Math.max(0,z.s-0.75),Math.max(0,z.s-1.5),Math.max(0,z.s-2.5),1],
  log3: z=>[z.p,Math.log1p(Math.max(0,z.s-0.75)),Math.log1p(Math.max(0,z.s-1.5)),Math.log1p(Math.max(0,z.s-2.5)),1],
  sat3: z=>[z.p,sat(z.s-0.75),sat(z.s-1.5),sat(z.s-2.5),1],
  sat2: z=>[z.p,sat(z.s-1),sat(z.s-2),1],
};
function fit(samples,feature){
  const m=feature(samples[0]).length,ATA=Array.from({length:m},()=>Array(m).fill(0)),ATy=Array(m).fill(0);
  for(const z of samples){const x=feature(z);for(let i=0;i<m;i++){ATy[i]+=x[i]*z.y;for(let j=0;j<m;j++)ATA[i][j]+=x[i]*x[j];}}
  return solve(ATA,ATy);
}
function metrics(samples,feature,coef){
  let ae=0,se=0,max=0;const pred=[],truth=[];
  for(const z of samples){const x=feature(z);let y=0;for(let i=0;i<x.length;i++)y+=x[i]*coef[i];y=Math.max(0,Math.min(1,y));const e=Math.abs(y-z.y);ae+=e;se+=e*e;if(e>max)max=e;pred.push(y);truth.push(z.y);}
  pred.sort((a,b)=>a-b);truth.sort((a,b)=>a-b);
  const q=(a,p)=>a[Math.min(a.length-1,Math.floor((a.length-1)*p))];
  return {mae:ae/samples.length,rmse:Math.sqrt(se/samples.length),max,p99:q(pred,.99),p999:q(pred,.999),maxPred:pred.at(-1),truthP99:q(truth,.99),truthP999:q(truth,.999),truthMax:truth.at(-1)};
}

const train=[[],[],[]];
for(const f of trainFiles){
  const d=await makeSamples(f,f,4);
  for(let c=0;c<3;c++)train[c].push(...d.samples[c]);
  console.error('trained-samples',f,d.samples[0].length);
}
const models={};
for(const [name,feature] of Object.entries(featureSets)){
  models[name]=[];
  for(let c=0;c<3;c++)models[name].push(fit(train[c],feature));
}
const hold=await makeSamples(holdSource,holdNative,1),report={trainFiles,holdSource,holdNative,models:{},holdout:{}};
for(const [name,feature] of Object.entries(featureSets)){
  report.models[name]=models[name];
  report.holdout[name]=models[name].map((coef,c)=>metrics(hold.samples[c],feature,coef));
}
console.log(JSON.stringify(report,null,2));