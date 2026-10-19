import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {extractJpegHdr,parseTmapMetadata,encodedToLinear,decodeGainLog,bt709ToLinear} from '../web/src/raster/jpeg-hdr.js';
import {isoRgbToAppleFallbackRgb,isoRgbToAppleLogGain} from './lib/iso-apple-fallback.mjs';

const [jpegFile,nFile,...flags]=process.argv.slice(2);
if(!jpegFile||!nFile||flags.some(x=>x!=='--log20000'))throw Error('Usage: node tools/research-indigo-n-aux-decode.mjs <input.jpg> <file.heic> [--log20000]');
const log20000=flags.includes('--log20000');
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hvcc=(b,d,id)=>{const p=propertyBoxBytes(b,d.props,id,'hvcC'),x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);};
const annexB=(r,payload)=>{const s=Uint8Array.of(0,0,0,1),ps=[];let p=23;for(let i=0;i<r[22];i++){p++;const n=(r[p]<<8)|r[p+1];p+=2;for(let j=0;j<n;j++){const z=(r[p]<<8)|r[p+1];p+=2;ps.push(s,r.slice(p,p+z));p+=z;}}const ls=(r[21]&3)+1;for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;ps.push(s,payload.slice(p,p+z));p+=z;}const n=ps.reduce((q,x)=>q+x.length,0),o=new Uint8Array(n);let q=0;for(const x of ps){o.set(x,q);q+=x.length;}return o;};
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1',...args],{input,maxBuffer:128*1024*1024,windowsHide:true}));
const [jpeg,nBytes]=await Promise.all([jpegFile,nFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const hdr=extractJpegHdr(jpeg),d=discoverHeic(nBytes),tmap=[...d.infos].find(([,i])=>i.type==='tmap')?.[0];
if(!hdr||!tmap)throw Error('inputs');
const metadata=parseTmapMetadata(read(nBytes,d,tmap)),apple=d.hdrGrid,[gw,gh]=dimensionsForItem(d.props,apple),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),cols=Math.ceil(gw/tw);
const gainRgb=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.gain);
const baseRgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${gw}:${gh}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.base);
const linear=new Float32Array(baseRgb.length);for(let i=0;i<linear.length;i++)linear[i]=encodedToLinear(baseRgb[i]/255,'srgb');
const intended=(log20000?isoRgbToAppleLogGain(gainRgb,linear,metadata):isoRgbToAppleFallbackRgb(gainRgb,linear,metadata)).samples,decoded=new Uint8Array(intended.length);
for(let i=0;i<d.hdrTiles.length;i++){
 const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],annexB(hvcc(nBytes,d,id),read(nBytes,d,id)));
 const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),hh=Math.min(th,gh-row*th);
 for(let y=0;y<hh;y++)decoded.set(raw.subarray(y*tw*3,y*tw*3+cw*3),((row*th+y)*gw+col*tw)*3);
}
const weights=[.2289745641,.6917385218,.0792869141],headroom=2**metadata.alternateHeadroom;
let sampleMae=0,sampleMax=0,sceneSum=0,sceneBt=0,scenePow=0,sceneLog=0,sceneIntended=0;const regions=[.25,.5,1,2,4].map(t=>({t,n:0,s:0,bt:0,pow:0,log:0,intended:0}));
for(let p=0;p<intended.length;p+=3){
 let ys=0,yb=0,ybt=0,yp=0,yl=0,yi=0;
 for(let c=0;c<3;c++){
  const idx=p+c,ch=metadata.channels[c],base=linear[idx],source=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(gainRgb[idx]/255,ch)-ch.alternateOffset);
  const b=base,bt=b*(1+(headroom-1)*bt709ToLinear(decoded[idx]/255)),pow=b*(1+(headroom-1)*(decoded[idx]/255)**1.961),lg=b*2**((decoded[idx]/255)*Math.log2(headroom)),inte=log20000?b*2**((intended[idx]/255)*Math.log2(headroom)):b*(1+(headroom-1)*bt709ToLinear(intended[idx]/255));
  ys+=weights[c]*source;yb+=weights[c]*b;ybt+=weights[c]*bt;yp+=weights[c]*pow;yl+=weights[c]*lg;yi+=weights[c]*inte;
  const e=Math.abs(decoded[idx]-intended[idx])/255;sampleMae+=e;sampleMax=Math.max(sampleMax,e);
 }
 sceneSum+=ys;sceneBt+=ybt;scenePow+=yp;sceneLog+=yl;sceneIntended+=yi;
 for(const r of regions)if(ys>=r.t){r.n++;r.s+=ys;r.bt+=ybt;r.pow+=yp;r.log+=yl;r.intended+=yi;}
}
const comps=intended.length;
console.log(JSON.stringify({geometry:[gw,gh],components:comps,sampleMae:sampleMae/comps,sampleMax,integrated:{intendedRatio:sceneIntended/sceneSum,decodedBt709Ratio:sceneBt/sceneSum,decodedPower1961Ratio:scenePow/sceneSum,decodedLog20000Ratio:sceneLog/sceneSum},regions:regions.filter(r=>r.n).map(r=>({threshold:r.t,n:r.n,intendedRatio:r.intended/r.s,decodedBt709Ratio:r.bt/r.s,decodedPower1961Ratio:r.pow/r.s,decodedLog20000Ratio:r.log/r.s}))},null,2));
