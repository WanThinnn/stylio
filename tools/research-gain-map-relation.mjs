import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,decodeGainLog,encodeGainLog} from '../web/src/raster/jpeg-hdr.js';

const [aFile,bFile]=process.argv.slice(2);
if(!aFile||!bFile)throw Error('Usage: node tools/research-gain-map-relation.mjs <native-full.heic> <flattened.heic>');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024}));
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
function hvcc(bytes,d,id){
 const p=propertyBoxBytes(bytes,d.props,id,'hvcC');if(!p)throw Error('hvcC missing');
 const bb=topBox(p,'hvcC');return p.slice(bb.off+bb.hdr,bb.off+bb.size);
}
function annexB(record,payload){
 const parts=[],start=Uint8Array.of(0,0,0,1);let p=23;
 for(let i=0;i<record[22];i++){
  p++;const count=(record[p]<<8)|record[p+1];p+=2;
  for(let j=0;j<count;j++){const n=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+n));p+=n;}
 }
 const ls=(record[21]&3)+1;
 for(p=0;p<payload.length;){let n=0;for(let k=0;k<ls;k++)n=n*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+n));p+=n;}
 const total=parts.reduce((s,x)=>s+x.length,0),out=new Uint8Array(total);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;
}
async function gain(file){
 const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes),[gw,gh]=dimensionsForItem(d.props,d.hdrGrid);
 const [tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]),cols=Math.ceil(gw/tw),rows=Math.ceil(gh/th);
 if(cols*rows!==d.hdrTiles.length)throw Error('grid mismatch');
 const out=new Uint8Array(gw*gh);
 for(let i=0;i<d.hdrTiles.length;i++){
  const id=d.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(bytes,d,id),read(bytes,d,id)));
  const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);
  for(let y=0;y<ch;y++)out.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);
 }
 const tmapId=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
 if(tmapId===undefined)throw Error('tmap missing');
 return {file:path.basename(file),w:gw,h:gh,pixels:out,tmap:parseTmapMetadata(read(bytes,d,tmapId))};
}
const [A,B]=await Promise.all([gain(aFile),gain(bFile)]);
if(A.w!==B.w||A.h!==B.h)throw Error('geometry mismatch');
const n=A.pixels.length;
let sx=0,sy=0,sxx=0,syy=0,sxy=0,mae=0,maxDiff=0,predMae=0,predRmse=0,predMax=0,logMae=0,logRmse=0,logMax=0;
const histA=new Array(256).fill(0),histB=new Array(256).fill(0),pairs=new Map();
for(let i=0;i<n;i++){
 const x=B.pixels[i]/255,y=A.pixels[i]/255,d=Math.abs(x-y);
 const src=B.tmap.channels[0],dst=A.tmap.channels[0];
 const srcLog=decodeGainLog(x,src),dstLog=decodeGainLog(y,dst);
 const predicted=encodeGainLog(srcLog,dst),pd=Math.abs(predicted-y),ld=Math.abs(srcLog-dstLog);
 sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;mae+=d;if(d>maxDiff)maxDiff=d;
 predMae+=pd;predRmse+=pd*pd;if(pd>predMax)predMax=pd;
 logMae+=ld;logRmse+=ld*ld;if(ld>logMax)logMax=ld;
 histA[A.pixels[i]]++;histB[B.pixels[i]]++;
 const key=(B.pixels[i]<<8)|A.pixels[i];pairs.set(key,(pairs.get(key)||0)+1);
}
const denom=n*sxx-sx*sx,slope=(n*sxy-sx*sy)/denom,intercept=(sy-slope*sx)/n;
const corr=(n*sxy-sx*sy)/Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy));
const q=(hist,p)=>{
 let target=n*p,sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=target)return i/255;}return 1;
};
const quantiles={};
for(const p of [.001,.01,.02,.1,.25,.5,.75,.9,.98,.99,.999]){
 quantiles[p]={native:q(histA,p),flat:q(histB,p)};
}
const topPairs=[...pairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,count])=>({flat:(k>>8)/255,native:(k&255)/255,count}));
console.log(JSON.stringify({
 geometry:[A.w,A.h],pixels:n,mae:mae/n,maxDiff,correlation:corr,
 curvePairPrediction:{mae:predMae/n,rmse:Math.sqrt(predRmse/n),maxDiff:predMax,source:B.tmap.channels[0],target:A.tmap.channels[0]},
 logGainAgreement:{maeEV:logMae/n,rmseEV:Math.sqrt(logRmse/n),maxEV:logMax},
 affineFlatToNative:{slope,intercept},quantiles,topPairs
},null,2));
