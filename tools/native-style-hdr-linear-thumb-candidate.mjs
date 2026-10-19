import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {topBox} from '../web/src/core/box.js';
import {
  discoverHeic,extractItem,idatItemBytes,dimensionsForItem,propertyBoxBytes,appendIpcoProperty,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,baseFile,editedFile]=process.argv.slice(2);
if(!output||!baseFile||!editedFile)throw Error('Usage: node tools/native-style-hdr-linear-thumb-candidate.mjs <output-dir> <CE.heic> <edited-source.heic>');
await fs.mkdir(output,{recursive:true});
const readFile=async p=>new Uint8Array(await fs.readFile(p));
const [base,edited]=await Promise.all([readFile(baseFile),readFile(editedFile)]);
const a=discoverHeic(base),s=discoverHeic(edited);
assert.notEqual(a.linearThumb,null);assert.notEqual(s.hdrGrid,null);assert.ok(s.hdrTiles.length);
const [lw,lh]=dimensionsForItem(a.props,a.linearThumb);
assert.deepEqual([lw,lh],[1024,768]);

const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const same=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024}));
function hvccRecord(bytes,d,id){
  const p=propertyBoxBytes(bytes,d.props,id,'hvcC');if(!p)throw Error('hvcC missing');
  const b=topBox(p,'hvcC');return p.slice(b.off+b.hdr,b.off+b.size);
}
function annexB(record,payload){
  const parts=[],start=Uint8Array.of(0,0,0,1);let p=23;
  for(let i=0;i<record[22];i++){p++;const count=(record[p]<<8)|record[p+1];p+=2;for(let j=0;j<count;j++){const n=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+n));p+=n;}}
  const ls=(record[21]&3)+1;for(p=0;p<payload.length;){let n=0;for(let k=0;k<ls;k++)n=n*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+n));p+=n;}
  const n=parts.reduce((sum,x)=>sum+x.length,0),out=new Uint8Array(n);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;
}

// Decode edited current rendition to the exact 1024x768 geometry used by CA.
const png=run(['-noautorotate','-i',editedFile,'-frames:v','1','-pix_fmt','rgb24','-c:v','png','-f','image2pipe','pipe:1']);
const rgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${lw}:${lh}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
assert.equal(rgb.length,lw*lh*3);

// Decode source gain map and bilinearly sample it at linear-thumb resolution.
const [gw,gh]=dimensionsForItem(s.props,s.hdrGrid),[tw,th]=dimensionsForItem(s.props,s.hdrTiles[0]),cols=Math.ceil(gw/tw);
const gain=new Uint8Array(gw*gh);
for(let i=0;i<s.hdrTiles.length;i++){
  const id=s.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvccRecord(edited,s,id),itemBytes(edited,s,id)));
  const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);
  for(let y=0;y<ch;y++)gain.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);
}
const bilinear=(arr,w,h,x,y)=>{const x0=Math.max(0,Math.min(w-1,Math.floor(x))),x1=Math.min(w-1,x0+1),y0=Math.max(0,Math.min(h-1,Math.floor(y))),y1=Math.min(h-1,y0+1),fx=Math.max(0,Math.min(1,x-x0)),fy=Math.max(0,Math.min(1,y-y0));const p0=arr[y0*w+x0]*(1-fx)+arr[y0*w+x1]*fx,p1=arr[y1*w+x0]*(1-fx)+arr[y1*w+x1]*fx;return p0*(1-fy)+p1*fy;};

const coeff=[[0.3958286474463609,0.2506569254211693],[0.39896807046980753,0.25019950692217563],[0.3942329991599476,0.25288729152056394]];
const hdrSlope=0.691501599425141,hdrIntercept=-0.3595678538273698;
const transformed=new Uint8Array(rgb.length);
let corrected=0,maxDelta=0;
for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){
  const i=y*lw+x,g=bilinear(gain,gw,gh,(x+.5)*gw/lw-.5,(y+.5)*gh/lh-.5)/255;
  const delta=Math.max(0,hdrSlope*g+hdrIntercept);if(delta>0){corrected++;maxDelta=Math.max(maxDelta,delta);}
  for(let c=0;c<3;c++){
    const [m,b]=coeff[c],base=m*(rgb[i*3+c]/255)+b;
    transformed[i*3+c]=Math.max(0,Math.min(255,Math.round(255*Math.min(1,base+delta))));
  }
}

const mp4=path.join(output,'linear-CP.mp4');
execFileSync('ffmpeg',[
  '-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
  '-f','rawvideo','-pix_fmt','rgb24','-s',`${lw}x${lh}`,'-r','1','-i','pipe:0',
  '-frames:v','1','-an','-vf','scale=in_range=full:out_range=full,format=yuv420p10le',
  '-c:v','libx265','-preset','ultrafast','-crf','18','-profile:v','main10','-tag:v','hvc1',
  '-color_range','pc','-x265-params','info=0:pools=none:frame-threads=1:log-level=error:range=full:colorprim=2:transfer=2:colormatrix=2',
  '-movflags','+faststart',mp4,
],{input:transformed,maxBuffer:128*1024*1024});
const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(mp4)));await fs.rm(mp4,{force:true});
const sps=hevcSpsColor(encoded.record);
assert.equal(sps.luma,10);assert.equal(sps.chromaDepth,10);assert.equal(sps.chroma,1);assert.equal(sps.fullRange,true);

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size),newHvcc;
[meta,newHvcc]=appendIpcoProperty(meta,encoded.hvcc);
const associations=[];let replaced=false;
for(const ref of a.props.associations.get(a.linearThumb)||[]){
  const p=a.props.properties[ref.index-1];
  if(p?.type==='hvcC'){associations.push([newHvcc,ref.essential]);replaced=true;}else associations.push([ref.index,ref.essential]);
}
assert(replaced);meta=setItemPropertyAssociations(meta,a.linearThumb,associations);
const ft=topBox(base,'ftyp');
const data=rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),meta,new Map([[a.linearThumb,encoded.payload]]));
const d=discoverHeic(data);
assert.deepEqual(d.refs,a.refs);
for(const [id] of a.iloc.items)if(id!==a.linearThumb)assert(same(itemBytes(data,d,id),itemBytes(base,a,id)),'payload changed '+id);
assert(same(extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x54).payload,extractAppleMakerNoteTag(itemBytes(base,a,a.exifItem),0x54).payload));
const checked=await executeJob({operation:'read',file:new Blob([data])});assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
const outPath=path.join(output,'CP_HDRLinearThumb.HEIC');await fs.writeFile(outPath,data);
console.log(JSON.stringify({file:outPath,bytes:data.length,correctedPixels:corrected,totalPixels:lw*lh,correctedFraction:corrected/(lw*lh),maxDelta,hdrSlope,hdrIntercept,sps,compatibility:checked.compatibility?.status??null,production:false},null,2));