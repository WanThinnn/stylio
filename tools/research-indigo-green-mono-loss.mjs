import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {extractJpegHdr,encodedToLinear,decodeGainLog} from '../web/src/raster/jpeg-hdr.js';
const f=process.argv[2];if(!f)throw Error('input');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1',...args],{input,maxBuffer:128*1024*1024,windowsHide:true}));
const b=new Uint8Array(await fs.readFile(f)),h=extractJpegHdr(b);if(!h)throw Error('hdr');
const g=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],h.gain);
const base=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${h.gainWidth}:${h.gainHeight}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],h.base);
const w=[.2289745641,.6917385218,.0792869141],H=2**h.metadata.alternateHeadroom;
let n=0,srcSat=0,monoSat=0,srcG=0,monoG=0,allN=0,allSrcSat=0,allMonoSat=0;
const sat=x=>{const mx=Math.max(...x),mn=Math.min(...x);return mx>1e-9?(mx-mn)/mx:0;};
for(let i=0;i<g.length;i+=3){
 const B=[],S=[];for(let c=0;c<3;c++){const ch=h.metadata.channels[c],x=encodedToLinear(base[i+c]/255,'srgb');B[c]=x;S[c]=Math.max(0,(x+ch.baseOffset)*2**decodeGainLog(g[i+c]/255,ch)-ch.alternateOffset);}
 const bl=w[0]*B[0]+w[1]*B[1]+w[2]*B[2],sl=w[0]*S[0]+w[1]*S[1]+w[2]*S[2],m=Math.max(1,Math.min(H,bl>1e-9?sl/bl:1)),M=B.map(x=>x*m);
 const ss=sat(S),ms=sat(M);allN++;allSrcSat+=ss;allMonoSat+=ms;
 const greenDominant=S[1]>S[0]*1.08&&S[1]>S[2]*1.08&&S[1]>.08;
 if(greenDominant){n++;srcSat+=ss;monoSat+=ms;srcG+=S[1];monoG+=M[1];}
}
console.log(JSON.stringify({headroom:H,all:{n:allN,sourceSat:allSrcSat/allN,monoSat:allMonoSat/allN,ratio:allMonoSat/allSrcSat},greenDominant:{n,sourceSat:srcSat/n,monoSat:monoSat/n,saturationRatio:monoSat/srcSat,sourceGreen:srcG/n,monoGreen:monoG/n,greenLinearRatio:monoG/srcG}},null,2));