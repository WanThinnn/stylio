import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';
import {percentile} from '../web/src/styles/styles.js';

const [file]=process.argv.slice(2);
if(!file)throw Error('Usage: node tools/research-hdr-scene-stats.mjs <source.heic>');
const bytes=new Uint8Array(await fs.readFile(file)),d=discoverHeic(bytes);
if(d.hdrGrid==null||!d.hdrTiles.length)throw Error('HDR grid required');
const read=(id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const hvccRecord=id=>{
 const prop=propertyBoxBytes(bytes,d.props,id,'hvcC');if(!prop)throw Error('hvcC missing '+id);
 const b=topBox(prop,'hvcC');return prop.slice(b.off+b.hdr,b.off+b.size);
};
function annexB(record,payload){
 if(record.length<23||record[0]!==1)throw Error('bad hvcC');
 const parts=[],start=Uint8Array.of(0,0,0,1);let p=23;
 for(let i=0;i<record[22];i++){
  p++;const count=(record[p]<<8)|record[p+1];p+=2;
  for(let j=0;j<count;j++){const n=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+n));p+=n;}
 }
 const ls=(record[21]&3)+1;
 for(p=0;p<payload.length;){let n=0;for(let k=0;k<ls;k++)n=n*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+n));p+=n;}
 const n=parts.reduce((s,x)=>s+x.length,0),out=new Uint8Array(n);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;
}
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024}));
const [gw,gh]=dimensionsForItem(d.props,d.hdrGrid),[tw,th]=dimensionsForItem(d.props,d.hdrTiles[0]);
const cols=Math.ceil(gw/tw),rows=Math.ceil(gh/th);
if(cols*rows!==d.hdrTiles.length)throw Error('gain grid mismatch');
const gain=new Uint8Array(gw*gh);
for(let i=0;i<d.hdrTiles.length;i++){
 const id=d.hdrTiles[i],bs=annexB(hvccRecord(id),read(id));
 const raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],bs);
 if(raw.length!==tw*th)throw Error('decoded gain tile geometry mismatch');
 const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);
 for(let y=0;y<ch;y++)gain.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);
}
// Two-step primary decode because HEIF grids cause ffmpeg to own the first filtergraph.
const png=run(['-noautorotate','-i',file,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
const rgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${gw}:${gh}:flags=lanczos`,
 '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
if(rgb.length!==gw*gh*3)throw Error('primary geometry mismatch');
const tmapId=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
const meta=parseTmapMetadata(read(tmapId));
const tone=[],scene=[],gainLog=[];
for(let i=0;i<gw*gh;i++){
 let yl=0,yh=0;
 const g=Math.max(0,Math.min(1,gain[i]/255));
 for(let c=0;c<3;c++){
  const s=encodedToLinear(rgb[i*3+c]/255,'srgb');
  const channel=meta.channels.length===1?meta.channels[0]:meta.channels[c];
  const lo=channel.min,hi=channel.max,gamma=channel.gamma;
  const lg=lo+(g**(1/gamma))*(hi-lo);
  const h=(s+channel.baseOffset)*(2**lg)-channel.alternateOffset;
  const w=[.2126,.7152,.0722][c];yl+=w*s;yh+=w*Math.max(0,h);
  if(c===1)gainLog.push(lg);
 }
 tone.push(yl);scene.push(yh);
}
tone.sort((a,b)=>a-b);scene.sort((a,b)=>a-b);gainLog.sort((a,b)=>a-b);
const qs=[.001,.02,.10,.25,.50,.75,.98,.999];
const stats=arr=>Object.fromEntries(qs.map(q=>['p'+String(q).replace('.','_'),percentile(arr,q)]));
console.log(JSON.stringify({
 file:path.basename(file),gainGrid:{width:gw,height:gh,tileWidth:tw,tileHeight:th,tiles:d.hdrTiles.length},
 tmap:meta,tone:stats(tone),scene:stats(scene),gainLog:stats(gainLog),
 maxScene:scene[scene.length-1],meanScene:scene.reduce((a,b)=>a+b,0)/scene.length
},null,2));
