import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {extractJpegHdr,encodedToLinear,decodeGainLog,bt709ToLinear} from '../web/src/raster/jpeg-hdr.js';

const file=process.argv[2]||'tests/private-fixtures/indigo-hdr/input.jpg';
const size=process.argv[3]||'378:504';
const run=(input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-f','image2pipe','-i','pipe:0','-vf','scale='+size+':flags=lanczos','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{input,maxBuffer:64*1024*1024,windowsHide:true}));
const bytes=new Uint8Array(await fs.readFile(file)),hdr=extractJpegHdr(bytes);
if(!hdr||hdr.metadata.channels.length!==3)throw Error('RGB HDR JPEG required');
const base=run(hdr.base),gain=run(hdr.gain);if(base.length!==gain.length)throw Error('geometry');
const weights=hdr.primaries==='smpte432'?[.2289745641,.6917385218,.0792869141]:[.2126,.7152,.0722];
const headroom=2**hdr.metadata.alternateHeadroom,clamp=x=>Math.max(0,Math.min(1,x));
const oetf=x=>x<.018?4.5*x:1.099*x**.45-.099;
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor((b.length-1)*p))];};
let n=0,sumBaseSat=0,sumSceneSat=0,sumScalarSat=0,sumRgbSat=0,sumChrom=0,sumScalarErr=0,sumRgbErr=0;
const ratios=[],chromas=[],scalarErrs=[],rgbErrs=[];
for(let p=0;p<base.length;p+=3){
  const b=[0,1,2].map(c=>encodedToLinear(base[p+c]/255,'srgb'));
  const s=[0,1,2].map(c=>{const ch=hdr.metadata.channels[c];return Math.max(0,(b[c]+ch.baseOffset)*2**decodeGainLog(gain[p+c]/255,ch)-ch.alternateOffset);});
  const yl=weights.reduce((a,w,c)=>a+w*b[c],0),ys=weights.reduce((a,w,c)=>a+w*s[c],0);
  if(ys<.01||Math.max(...s)<.02)continue;
  const m=yl>0?ys/yl:1;
  const code=oetf(clamp((m-1)/(headroom-1))),mr=1+(headroom-1)*bt709ToLinear(code);
  const scalar=b.map(x=>x*mr);
  const rgb=b.map((x,c)=>{const mc=x>0?s[c]/x:1,cc=oetf(clamp((mc-1)/(headroom-1))),mm=1+(headroom-1)*bt709ToLinear(cc);return x*mm;});
  const sat=v=>{const mx=Math.max(...v),mn=Math.min(...v);return mx>1e-6?(mx-mn)/mx:0;};
  const norm=v=>{const z=v[0]+v[1]+v[2];return z>1e-9?v.map(x=>x/z):[0,0,0];};
  const sn=norm(s),an=norm(scalar),chrom=Math.hypot(sn[0]-an[0],sn[1]-an[1],sn[2]-an[2]);
  const serr=(Math.abs(s[0]-scalar[0])+Math.abs(s[1]-scalar[1])+Math.abs(s[2]-scalar[2]))/3;
  const rerr=(Math.abs(s[0]-rgb[0])+Math.abs(s[1]-rgb[1])+Math.abs(s[2]-rgb[2]))/3;
  const bs=sat(b),ss=sat(s),as=sat(scalar),rs=sat(rgb);
  sumBaseSat+=bs;sumSceneSat+=ss;sumScalarSat+=as;sumRgbSat+=rs;sumChrom+=chrom;sumScalarErr+=serr;sumRgbErr+=rerr;n++;
  if(ss>.03)ratios.push(as/ss);chromas.push(chrom);scalarErrs.push(serr);rgbErrs.push(rerr);
}
const avg=x=>x/n;
console.log(JSON.stringify({file,samplePixels:n,headroom,mean:{baseSaturation:avg(sumBaseSat),sourceHdrSaturation:avg(sumSceneSat),scalarAppleSaturation:avg(sumScalarSat),rgbAppleSaturation:avg(sumRgbSat),scalarToSourceSaturation:sumSceneSat?sumScalarSat/sumSceneSat:null,rgbToSourceSaturation:sumSceneSat?sumRgbSat/sumSceneSat:null,chromaticityError:avg(sumChrom),scalarRgbMae:avg(sumScalarErr),rgbAppleMae:avg(sumRgbErr)},quantiles:{scalarToSourceSaturation:{p10:q(ratios,.1),p50:q(ratios,.5),p90:q(ratios,.9)},chromaticityError:{p50:q(chromas,.5),p90:q(chromas,.9),p99:q(chromas,.99)},scalarRgbMae:{p50:q(scalarErrs,.5),p90:q(scalarErrs,.9),p99:q(scalarErrs,.99)},rgbAppleMae:{p50:q(rgbErrs,.5),p90:q(rgbErrs,.9),p99:q(rgbErrs,.99)}}},null,2));
