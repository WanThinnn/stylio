import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {extractJpegHdr,encodedToLinear,decodeGainLog} from '../web/src/raster/jpeg-hdr.js';
const file=process.argv[2];if(!file)throw Error('input');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1',...args],{input,maxBuffer:128*1024*1024,windowsHide:true}));
const bytes=new Uint8Array(await fs.readFile(file)),hdr=extractJpegHdr(bytes);if(!hdr)throw Error('hdr');
const gain=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.gain);
const base=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${hdr.gainWidth}:${hdr.gainHeight}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.base);
const values=[[],[],[]],all=[];let low=0,high=0;
for(let i=0;i<gain.length;i++){const c=i%3,ch=hdr.metadata.channels[c],b=encodedToLinear(base[i]/255,'srgb'),s=Math.max(0,(b+ch.baseOffset)*2**decodeGainLog(gain[i]/255,ch)-ch.alternateOffset),m=b>1e-8?s/b:1;if(Number.isFinite(m)&&m>0){values[c].push(m);all.push(m);if(m<1)low++;if(m>2**hdr.metadata.alternateHeadroom)high++;}}
const qs=[.5,.9,.95,.98,.99,.995,.999,.9999,1],stat=a=>{a.sort((x,y)=>x-y);return Object.fromEntries(qs.map(q=>[q,a[Math.min(a.length-1,Math.floor((a.length-1)*q))]]));};
console.log(JSON.stringify({declaredHeadroom:2**hdr.metadata.alternateHeadroom,alternateHeadroomStops:hdr.metadata.alternateHeadroom,channels:hdr.metadata.channels,actual:{all:stat(all),r:stat(values[0]),g:stat(values[1]),b:stat(values[2])},belowOne:low,aboveDeclared:high,components:all.length},null,2));