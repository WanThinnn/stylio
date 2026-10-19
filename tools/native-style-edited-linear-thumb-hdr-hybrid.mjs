import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {topBox} from '../web/src/core/box.js';
import {
  discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,irotAngleForItem,appendIpcoProperty,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,baseFile,editedFile]=process.argv.slice(2);
if(!output||!baseFile||!editedFile)throw Error('Usage: node tools/native-style-edited-linear-thumb-hdr-hybrid.mjs <out-dir> <CE.heic> <edited-source.heic>');
await fs.mkdir(output,{recursive:true});

const coeff=[
 [0.31822737205870044,-0.002130403822215854,0.07474497872823394,0.19730163944076548,0.293142548762723],
 [0.32478255161334724,0.0011569883469502162,0.07695989152188837,0.06361913078906917,0.2901836221273939],
 [0.33346967903731717,-0.00854419355412267,0.07013748067295772,0.21588147285505746,0.28190665477015264],
];

const readFile=async p=>new Uint8Array(await fs.readFile(p));
const [base,edited]=await Promise.all([readFile(baseFile),readFile(editedFile)]);
const a=discoverHeic(base),s=discoverHeic(edited);
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);assert.notEqual(a.hdrGrid,null);
const [lw,lh]=dimensionsForItem(a.props,a.linearThumb);
assert.deepEqual([lw,lh],[1024,768]);

const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const same=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
const sourceMarker=extractAppleMakerNoteTag(itemBytes(edited,s,s.exifItem),0x54).payload;
assert(same(sourceMarker,extractAppleMakerNoteTag(itemBytes(base,a,a.exifItem),0x54).payload));

const run=(args,input)=>Buffer.from(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:512*1024*1024}));
function hvcc(bytes,d,id){
 const p=propertyBoxBytes(bytes,d.props,id,'hvcC');if(!p)throw Error('hvcC missing '+id);
 const b=topBox(p,'hvcC');return p.slice(b.off+b.hdr,b.off+b.size);
}
function annexB(record,payload){
 const start=Uint8Array.of(0,0,0,1),parts=[];let p=23;
 for(let i=0;i<record[22];i++){p++;const count=(record[p]<<8)|record[p+1];p+=2;for(let j=0;j<count;j++){const n=(record[p]<<8)|record[p+1];p+=2;parts.push(start,record.slice(p,p+n));p+=n;}}
 const ls=(record[21]&3)+1;for(p=0;p<payload.length;){let n=0;for(let k=0;k<ls;k++)n=n*256+payload[p+k];p+=ls;parts.push(start,payload.slice(p,p+n));p+=n;}
 const n=parts.reduce((z,x)=>z+x.length,0),out=new Uint8Array(n);let o=0;for(const x of parts){out.set(x,o);o+=x.length;}return out;
}
async function decodeGain(){
 const [gw,gh]=dimensionsForItem(s.props,s.hdrGrid),[tw,th]=dimensionsForItem(s.props,s.hdrTiles[0]),cols=Math.ceil(gw/tw),out=new Uint8Array(gw*gh);
 for(let i=0;i<s.hdrTiles.length;i++){
  const id=s.hdrTiles[i],raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],annexB(hvcc(edited,s,id),itemBytes(edited,s,id)));
  const col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),ch=Math.min(th,gh-row*th);
  for(let y=0;y<ch;y++)out.set(raw.subarray(y*tw,y*tw+cw),(row*th+y)*gw+col*tw);
 }
 return {bytes:out,w:gw,h:gh};
}
function decodePrimary(w,h){
 const png=run(['-noautorotate','-i',editedFile,'-frames:v','1','-pix_fmt','rgb48be','-c:v','png','-f','image2pipe','pipe:1']);
 const irot=irotAngleForItem(edited,s.props,s.primary);let undo='';
 if(irot===270)undo='transpose=2,';else if(irot===90)undo='transpose=1,';else if(irot===180)undo='hflip,vflip,';else if(irot!==0)throw Error('unsupported irot '+irot);
 return run(['-f','image2pipe','-i','pipe:0','-vf',undo+'scale='+w+':'+h+':flags=lanczos','-frames:v','1','-pix_fmt','rgb48le','-f','rawvideo','pipe:1'],png);
}
const bilinear=(get,w,h,tx,ty,tw,th)=>{
 const sy=(ty+.5)*h/th-.5,y0=Math.max(0,Math.min(h-1,Math.floor(sy))),y1=Math.min(h-1,y0+1),fy=Math.max(0,Math.min(1,sy-y0));
 const sx=(tx+.5)*w/tw-.5,x0=Math.max(0,Math.min(w-1,Math.floor(sx))),x1=Math.min(w-1,x0+1),fx=Math.max(0,Math.min(1,sx-x0));
 const aa=get(x0,y0)*(1-fx)+get(x1,y0)*fx,bb=get(x0,y1)*(1-fx)+get(x1,y1)*fx;
 return aa*(1-fy)+bb*fy;
};

const gain=await decodeGain(),primary=decodePrimary(gain.w,gain.h);
const tmapId=[...s.infos].find(([,x])=>x.type==='tmap')?.[0],meta=parseTmapMetadata(itemBytes(edited,s,tmapId)),ch=meta.channels[0];
const scene=[new Float32Array(gain.w*gain.h),new Float32Array(gain.w*gain.h),new Float32Array(gain.w*gain.h)];
for(let i=0;i<gain.w*gain.h;i++){
 const g=gain.bytes[i]/255,lg=ch.min+(g**(1/ch.gamma))*(ch.max-ch.min);
 for(let c=0;c<3;c++){
  const p=primary.readUInt16LE((i*3+c)*2)/65535,lin=encodedToLinear(p,'srgb');
  scene[c][i]=Math.max(0,(lin+ch.baseOffset)*(2**lg)-ch.alternateOffset);
 }
}
const rgb=new Uint8Array(lw*lh*3);
for(let y=0;y<lh;y++)for(let x=0;x<lw;x++)for(let c=0;c<3;c++){
 const p=bilinear((xx,yy)=>primary.readUInt16LE(((yy*gain.w+xx)*3+c)*2)/65535,gain.w,gain.h,x,y,lw,lh);
 const sc=bilinear((xx,yy)=>scene[c][yy*gain.w+xx],gain.w,gain.h,x,y,lw,lh);
 const f=[p,Math.max(0,sc-.75),Math.max(0,sc-1.5),Math.max(0,sc-2.5),1],k=coeff[c];
 let v=0;for(let i=0;i<5;i++)v+=f[i]*k[i];
 rgb[(y*lw+x)*3+c]=Math.max(0,Math.min(255,Math.round(v*255)));
}

const mp4=path.join(output,'linear-hybrid.mp4');
execFileSync('ffmpeg',[
 '-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
 '-f','rawvideo','-pix_fmt','rgb24','-s',lw+'x'+lh,'-r','1','-i','pipe:0',
 '-frames:v','1','-an','-vf','scale=in_range=full:out_range=full,format=yuv420p10le',
 '-c:v','libx265','-preset','ultrafast','-crf','18','-profile:v','main10','-tag:v','hvc1','-color_range','pc',
 '-x265-params','info=0:pools=none:frame-threads=1:log-level=error:range=full:colorprim=2:transfer=2:colormatrix=2',
 '-movflags','+faststart',mp4,
],{input:rgb,maxBuffer:128*1024*1024});
const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(mp4)));
await fs.rm(mp4,{force:true});
const sps=hevcSpsColor(encoded.record);
assert.equal(sps.luma,10);assert.equal(sps.chromaDepth,10);assert.equal(sps.chroma,1);assert.equal(sps.fullRange,true);
assert.equal(sps.primaries,2);assert.equal(sps.transfer,2);assert.equal(sps.matrix,2);

let newMeta=base.slice(a.meta.off,a.meta.off+a.meta.size),newHvcc;
[newMeta,newHvcc]=appendIpcoProperty(newMeta,encoded.hvcc);
const assocs=[];let replaced=false;
for(const ref of a.props.associations.get(a.linearThumb)||[]){
 const p=a.props.properties[ref.index-1];
 if(p?.type==='hvcC'){assocs.push([newHvcc,ref.essential]);replaced=true;}else assocs.push([ref.index,ref.essential]);
}
assert(replaced);newMeta=setItemPropertyAssociations(newMeta,a.linearThumb,assocs);
const ft=topBox(base,'ftyp');
const data=rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),newMeta,new Map([[a.linearThumb,encoded.payload]]));
const d=discoverHeic(data);
assert.deepEqual(d.refs,a.refs);
assert(same(extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x54).payload,sourceMarker));
for(const [id] of a.iloc.items)if(id!==a.linearThumb)assert(same(itemBytes(data,d,id),itemBytes(base,a,id)),'base payload changed '+id);
const checked=await executeJob({operation:'read',file:new Blob([data])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
const outName='local-hdr-hybrid-linear.HEIC';
await fs.writeFile(path.join(output,outName),data);
await fs.writeFile(path.join(output,'report.json'),JSON.stringify({
 file:outName,coefficients:coeff,sourceOnly:true,trainedWithout1729:true,
 allNonLinearPayloadsExact:true,graphExact:true,styleMarkerExact:true,
 linearThumb:{width:lw,height:lh,sps},compatibility:checked.compatibility?.status??null,
 productionEnabled:false,
},null,2));
console.log(JSON.stringify({file:path.join(output,outName),bytes:data.length,sps,compatibility:checked.compatibility?.status??null},null,2));