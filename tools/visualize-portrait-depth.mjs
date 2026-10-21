// Offline diagnostic only: decode stored primary/depth, never a baked Photos preview.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readPortraitDepth} from './audit-portrait-depth.mjs';
import {discoverHeic,extractItemData,propertyBoxBytes,dimensionsForItem,itemOrientation,storedPointToDisplay} from '../web/src/raster/heif.js';
import {topBox,concat} from '../web/src/core/box.js';
const [out,...args]=process.argv.slice(2),primaryOnly=args.includes('--primary-only'),files=args.filter(arg=>arg!=='--primary-only');
if(!out||!files.length)throw Error('Usage: output-directory input.HEIC ...');
fs.mkdirSync(out,{recursive:true});
function annex(record,payload){
 const parts=[],start=Uint8Array.of(0,0,0,1);let at=23;
 for(let i=0;i<record[22];i++){at++;const n=record[at]*256+record[at+1];at+=2;for(let j=0;j<n;j++){const size=record[at]*256+record[at+1];at+=2;parts.push(start,record.subarray(at,at+size));at+=size;}}
 const sizeBytes=(record[21]&3)+1;
 for(let p=0;p<payload.length;){let n=0;for(let j=0;j<sizeBytes;j++)n=n*256+payload[p++];if(n<2||p+n>payload.length)throw Error('Invalid HEVC sample');parts.push(start,payload.subarray(p,p+n));p+=n;}
 return concat(parts);
}
function run(args,input){const p=spawnSync('ffmpeg',['-loglevel','error','-threads','1','-filter_threads','1',...args],{input,maxBuffer:256*1024*1024});if(p.status)throw Error(String(p.stderr));return p.stdout;}
function png(samples,width,height,format,orientation,file){
 const filters=[];
 if(orientation.mirror===0)filters.push('vflip');if(orientation.mirror===1)filters.push('hflip');
 if(orientation.angle===90)filters.push('transpose=cclock');else if(orientation.angle===270)filters.push('transpose=clock');else if(orientation.angle===180)filters.push('hflip','vflip');
 filters.push('scale=768:-2');
 run(['-y','-f','rawvideo','-pix_fmt',format,'-s',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-vf',filters.join(','),file],samples);
}
for(const file of files){
 const b=new Uint8Array(fs.readFileSync(file)),d=discoverHeic(b),r=primaryOnly?null:readPortraitDepth(file);
 const o=itemOrientation(b,d.props,d.primary),[w,h]=dimensionsForItem(d.props,d.primary);
 const tiles=d.primaryTiles.length?d.primaryTiles:[d.primary],cols=d.primaryTiles.length?extractItemData(b,d,d.primary)[3]+1:1;
 const [tw,th]=dimensionsForItem(d.props,tiles[0]);
 const chunks=tiles.map(id=>{const hv=propertyBoxBytes(b,d.props,id,'hvcC');return annex(hv.subarray(topBox(hv,'hvcC').hdr),extractItemData(b,d,id));});
 const raw=run(['-f','hevc','-i','pipe:0','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],concat(chunks));
 if(raw.length!==tw*th*3*tiles.length)throw Error('Primary tile decode mismatch');
 const rgb=new Uint8Array(w*h*3);
 for(let n=0;n<tiles.length;n++)for(let yy=0;yy<Math.min(th,h-Math.floor(n/cols)*th);yy++){
  const x=n%cols*tw,y=Math.floor(n/cols)*th+yy,len=Math.min(tw,w-x)*3;
  rgb.set(raw.subarray((n*tw*th+yy*tw)*3,(n*tw*th+yy*tw)*3+len),(y*w+x)*3);
 }
 const name=path.basename(file,path.extname(file));
 png(rgb,w,h,'rgb24',o,path.join(out,name+'-primary.png'));
 if(!r){console.log(JSON.stringify({name,orientation:o,primaryOnly:true}));continue;}
 png(r.gray,r.width,r.height,'gray',o,path.join(out,name+'-depth.png'));
 const delta=Uint8Array.from(r.gray,v=>Math.min(255,Math.abs(v-r.gray[Math.min(r.height-1,Math.floor(r.focusY*r.height))*r.width+Math.min(r.width-1,Math.floor(r.focusX*r.width))])*4));
 png(delta,r.width,r.height,'gray',o,path.join(out,name+'-focus-difference.png'));
 console.log(JSON.stringify({name,orientation:o,focus:storedPointToDisplay(r.focusX,r.focusY,o.angle,o.mirror),range:r.range}));
}
