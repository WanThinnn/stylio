import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
const [aFile,bFile]=process.argv.slice(2);if(!aFile||!bFile)throw Error('Usage: node tools/research-linear-thumb-compare.mjs <a> <b>');
const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:128*1024*1024}));
const item=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
function hvcc(b,d,id){const p=propertyBoxBytes(b,d.props,id,'hvcC'),x=topBox(p,'hvcC');return p.slice(x.off+x.hdr,x.off+x.size);}
function annexB(r,payload){const s=Uint8Array.of(0,0,0,1),ps=[];let p=23;for(let i=0;i<r[22];i++){p++;const n=(r[p]<<8)|r[p+1];p+=2;for(let j=0;j<n;j++){const z=(r[p]<<8)|r[p+1];p+=2;ps.push(s,r.slice(p,p+z));p+=z;}}const ls=(r[21]&3)+1;for(p=0;p<payload.length;){let z=0;for(let k=0;k<ls;k++)z=z*256+payload[p+k];p+=ls;ps.push(s,payload.slice(p,p+z));p+=z;}const n=ps.reduce((q,x)=>q+x.length,0),o=new Uint8Array(n);let q=0;for(const x of ps){o.set(x,q);q+=x.length;}return o;}
async function dec(file){const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b),id=d.linearThumb,[w,h]=dimensionsForItem(d.props,id);const raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],annexB(hvcc(b,d,id),item(b,d,id)));return {raw,w,h};}
const [a,b]=await Promise.all([dec(aFile),dec(bFile)]);if(a.w!==b.w||a.h!==b.h)throw Error('geometry');
let mae=0,rmse=0,max=0;const per=[0,0,0],n=a.w*a.h*3;for(let i=0;i<n;i++){const av=a.raw.readUInt16LE(i*2)/65535,bv=b.raw.readUInt16LE(i*2)/65535,e=Math.abs(av-bv);mae+=e;rmse+=e*e;per[i%3]+=e;if(e>max)max=e;}console.log(JSON.stringify({a:aFile,b:bFile,width:a.w,height:a.h,mae:mae/n,rmse:Math.sqrt(rmse/n),max,perChannel:per.map(x=>x/(n/3))},null,2));