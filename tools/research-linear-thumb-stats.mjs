import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';

const files=process.argv.slice(2);
if(!files.length)throw Error('Usage: node tools/research-linear-thumb-stats.mjs <file> [...]');
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
function hvcc(bytes,d,id){
  for(const a of d.props.associations.get(id)||[]){
    const p=d.props.properties[a.index-1]; if(p?.type!=='hvcC')continue;
    return bytes.slice(p.box.off+p.box.hdr,p.box.off+p.box.size);
  }
  throw Error('hvcC missing');
}
function annexB(record,payload){
  const start=Uint8Array.of(0,0,0,1),parts=[]; let p=23;
  for(let i=0;i<record[22];i++){
    p++; const count=(record[p]<<8)|record[p+1]; p+=2;
    for(let j=0;j<count;j++){const n=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+n));p+=n;}
  }
  const ls=(record[21]&3)+1;
  for(p=0;p<payload.length;){let n=0;for(let k=0;k<ls;k++)n=n*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+n));p+=n;}
  const n=parts.reduce((s,x)=>s+x.length,0),out=new Uint8Array(n);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;
}
const qs=[.5,.9,.95,.98,.99,.995,.999,.9999,1];
for(const file of files){
  const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes),id=d.linearThumb;
  if(id==null){console.log(JSON.stringify({file,error:'no-linear-thumb'}));continue;}
  const [w,h]=dimensionsForItem(d.props,id),bs=annexB(hvcc(bytes,d,id),read(bytes,d,id));
  const raw=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],{input:Buffer.from(bs),maxBuffer:128*1024*1024});
  const vals=[[],[],[]],lum=[];
  for(let i=0;i<raw.length;i+=6){
    const r=raw.readUInt16LE(i)/65535,g=raw.readUInt16LE(i+2)/65535,b=raw.readUInt16LE(i+4)/65535;
    vals[0].push(r);vals[1].push(g);vals[2].push(b);lum.push(.2126*r+.7152*g+.0722*b);
  }
  const stat=a=>{a.sort((x,y)=>x-y);const o={};for(const q of qs){const idx=Math.min(a.length-1,Math.floor(q*(a.length-1)));o[q]=a[idx];}return o;};
  console.log(JSON.stringify({file,width:w,height:h,item:id,channels:{r:stat(vals[0]),g:stat(vals[1]),b:stat(vals[2]),luma:stat(lum)}},null,2));
}