import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {
  discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,
} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {yuv420ToRgba,parseTmapMetadata} from '../web/src/raster/jpeg-hdr.js';
import {bilinearGridSampleAxes} from '../web/src/raster/heic-grid-sample.js';
import {synthesizeHdrLinearThumbnailRgb} from '../web/src/raster/hdr-linear-thumbnail.js';

const [sourceFile,nativeFile]=process.argv.slice(2);
if(!sourceFile||!nativeFile)throw Error('Usage: node tools/research-production-hybrid-emulation.mjs <edited-source.heic> <native-full.heic>');
const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024}));
const item=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
function hvcc(b,d,id){const p=propertyBoxBytes(b,d.props,id,'hvcC');if(!p)throw Error('hvcC');const x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);}
function annexB(r,payload){const s=Uint8Array.of(0,0,0,1),ps=[];let p=23;for(let i=0;i<r[22];i++){p++;const n=(r[p]<<8)|r[p+1];p+=2;for(let j=0;j<n;j++){const z=(r[p]<<8)|r[p+1];p+=2;ps.push(s,r.slice(p,p+z));p+=z;}}const ls=(r[21]&3)+1;for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;ps.push(s,payload.slice(p,p+z));p+=z;}const n=ps.reduce((q,x)=>q+x.length,0),o=new Uint8Array(n);let q=0;for(const x of ps){o.set(x,q);q+=x.length;}return o;}
function tileContributionAxes(width,height,tileWidth,tileHeight,targetWidth,targetHeight,tileIndex){
  const columns=Math.ceil(width/tileWidth),col=tileIndex%columns,row=Math.floor(tileIndex/columns);
  const xStart=col*tileWidth,yStart=row*tileHeight,axes=bilinearGridSampleAxes(width,height,targetWidth,targetHeight);
  const xs=[],ys=[];
  for(let x=0;x<targetWidth;x++){const q=axes.x[x],parts=[];if(q.a>=xStart&&q.a<xStart+tileWidth&&q.wa)parts.push([q.a-xStart,q.wa]);if(q.b>=xStart&&q.b<xStart+tileWidth&&q.wb)parts.push([q.b-xStart,q.wb]);if(parts.length)xs.push([x,parts]);}
  for(let y=0;y<targetHeight;y++){const q=axes.y[y],parts=[];if(q.a>=yStart&&q.a<yStart+tileHeight&&q.wa)parts.push([q.a-yStart,q.wa]);if(q.b>=yStart&&q.b<yStart+tileHeight&&q.wb)parts.push([q.b-yStart,q.wb]);if(parts.length)ys.push([y,parts]);}
  return {xs,ys};
}
function samplePrimary(bytes,d,w,h){
  const [sw,sh]=dimensionsForItem(d.props,d.primary),[tw,th]=dimensionsForItem(d.props,d.primaryTiles[0]),acc=new Float32Array(w*h*3);
  for(let i=0;i<d.primaryTiles.length;i++){
    const id=d.primaryTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','yuvj420p','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));
    const rgba=yuv420ToRgba(raw,tw,th,{matrix:'smpte170m',fullRange:true}),{xs,ys}=tileContributionAxes(sw,sh,tw,th,w,h,i);
    for(const [y,yp] of ys)for(const [x,xp] of xs){const to=(y*w+x)*3;for(const [yy,wy] of yp)for(const [xx,wx] of xp){const from=(yy*tw+xx)*4,ww=wy*wx;acc[to]+=rgba[from]*ww;acc[to+1]+=rgba[from+1]*ww;acc[to+2]+=rgba[from+2]*ww;}}
  }
  const out=new Uint8Array(acc.length);for(let i=0;i<acc.length;i++)out[i]=Math.max(0,Math.min(255,Math.round(acc[i])));return out;
}
function sampleGain(bytes,d,w,h){
  const [sw,sh]=dimensionsForItem(d.props,d.hdrGrid),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),acc=new Float32Array(w*h);
  for(let i=0;i<d.hdrTiles.length;i++){
    const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-vf','extractplanes=y','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id))),{xs,ys}=tileContributionAxes(sw,sh,tw,th,w,h,i);
    for(const [y,yp] of ys)for(const [x,xp] of xs){let v=0;for(const [yy,wy] of yp)for(const [xx,wx] of xp)v+=raw[yy*tw+xx]*wy*wx;acc[y*w+x]+=v;}
  }
  const out=new Uint8Array(acc.length);for(let i=0;i<acc.length;i++)out[i]=Math.max(0,Math.min(255,Math.round(acc[i])));return out;
}
function decodeNativeLinear(bytes,d){
 const id=d.linearThumb,[w,h]=dimensionsForItem(d.props,id),raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),item(bytes,d,id)));return {raw,w,h};
}
const source=new Uint8Array(await fs.readFile(sourceFile)),sd=discoverHeic(source),native=new Uint8Array(await fs.readFile(nativeFile)),nd=discoverHeic(native);
const [pw,ph]=dimensionsForItem(sd.props,sd.primary),[w,h]=pw>=ph?[1024,768]:[768,1024];
const primary=samplePrimary(source,sd,w,h),gain=sampleGain(source,sd,w,h);
const tmapId=[...sd.infos].find(([,x])=>x.type==='tmap')?.[0],metadata=parseTmapMetadata(item(source,sd,tmapId));
const rgb=synthesizeHdrLinearThumbnailRgb(primary,gain,metadata,{transfer:'srgb'});
const truth=decodeNativeLinear(native,nd);if(truth.w!==w||truth.h!==h)throw Error('geometry');
let ae=0,se=0,max=0;const pred=[[],[],[]],nat=[[],[],[]],n=w*h*3;
for(let i=0;i<w*h;i++)for(let c=0;c<3;c++){const a=rgb[i*3+c]/255,b=truth.raw.readUInt16LE((i*3+c)*2)/65535,e=Math.abs(a-b);ae+=e;se+=e*e;if(e>max)max=e;pred[c].push(a);nat[c].push(b);}
const qs=[.5,.9,.98,.99,.995,.999,.9999,1],stat=a=>{a.sort((x,y)=>x-y);return Object.fromEntries(qs.map(q=>[q,a[Math.min(a.length-1,Math.floor((a.length-1)*q))]]));};
console.log(JSON.stringify({sourceFile,nativeFile,width:w,height:h,mae:ae/n,rmse:Math.sqrt(se/n),max,channels:['r','g','b'].map((name,c)=>({name,predicted:stat(pred[c]),native:stat(nat[c])}))},null,2));