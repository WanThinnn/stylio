import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {topBox} from '../web/src/core/box.js';
import {
  discoverHeic,extractItem,idatItemBytes,dimensionsForItem,irotAngleForItem,
  appendIpcoProperty,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,baseFile,editedFile]=process.argv.slice(2);
if(!output||!baseFile||!editedFile)throw Error(
  'Usage: node tools/native-style-edited-linear-thumb-variants.mjs <output-dir> <E.heic> <edited-source.heic>'
);
await fs.mkdir(output,{recursive:true});
const sourceStem=path.basename(editedFile).replace(/\.heic$/i,'');

const readFile=async p=>new Uint8Array(await fs.readFile(p));
const [base,edited]=await Promise.all([readFile(baseFile),readFile(editedFile)]);
const a=discoverHeic(base),s=discoverHeic(edited);
assert.notEqual(a.stylesItem,null,'E base must contain reconstructed Styles graph');
assert.notEqual(a.linearThumb,null,'E base must contain linear thumbnail');
assert.notEqual(a.hdrGrid,null,'E base must retain HDR');
assert.equal(irotAngleForItem(edited,s.props,s.primary),0,
  'Current diagnostic is intentionally scoped to stored-orientation native-1 (irot=0)');
const [lw,lh]=dimensionsForItem(a.props,a.linearThumb);
assert.deepEqual([lw,lh],[1024,768],'expected Apple linear thumbnail geometry');

const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const same=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
const sourceMarker=extractAppleMakerNoteTag(itemBytes(edited,s,s.exifItem),0x54).payload;
const baseMarker=extractAppleMakerNoteTag(itemBytes(base,a,a.exifItem),0x54).payload;
assert(same(sourceMarker,baseMarker),'E base must preserve edited six-key selected Style marker');

const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',
  ['-hide_banner','-loglevel','error',...args],{input,maxBuffer:128*1024*1024}));

// Decode the edited current rendition, then resize. The HEIF grid decoder constructs
// its own filtergraph, so scale in a second invocation.
const png=run(['-noautorotate','-i',editedFile,'-frames:v','1','-pix_fmt','rgb24',
  '-c:v','png','-f','image2pipe','pipe:1']);
const rgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${lw}:${lh}:flags=lanczos`,
  '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],png);
assert.equal(rgb.length,lw*lh*3);

const variants=[
  {
    id:'BY',label:'CorpusMedian',
    coeff:[[0.3648269218340524,0.2704564273138258],
           [0.3702646507997045,0.2775283842352311],
           [0.37063449033358337,0.26886356786411303]],
    generic:true,
  },
  {
    id:'BZ',label:'NeutralScalar',
    coeff:[[0.37,0.27],[0.37,0.27],[0.37,0.27]],
    generic:true,
  },
  {
    id:'CA',label:'CaptureFit1729',
    coeff:[[0.3958286474463609,0.2506569254211693],
           [0.39896807046980753,0.25019950692217563],
           [0.3942329991599476,0.25288729152056394]],
    generic:false,
  },
];

function transformRgb(coeff){
  const out=new Uint8Array(rgb.length);
  for(let i=0;i<rgb.length;i++){
    const c=i%3,[gain,bias]=coeff[c];
    out[i]=Math.max(0,Math.min(255,Math.round((gain*(rgb[i]/255)+bias)*255)));
  }
  return out;
}
function encodeLinear(bytes,label){
  const mp4=path.join(output,`linear-${label}.mp4`);
  execFileSync('ffmpeg',[
    '-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
    '-f','rawvideo','-pix_fmt','rgb24','-s',`${lw}x${lh}`,'-r','1','-i','pipe:0',
    '-frames:v','1','-an',
    '-vf','scale=in_range=full:out_range=full,format=yuv420p10le',
    '-c:v','libx265','-preset','ultrafast','-crf','18','-profile:v','main10','-tag:v','hvc1',
    '-color_range','pc',
    '-x265-params','info=0:pools=none:frame-threads=1:log-level=error:range=full:colorprim=2:transfer=2:colormatrix=2',
    '-movflags','+faststart',mp4,
  ],{input:bytes,maxBuffer:128*1024*1024});
  return fs.readFile(mp4).then(b=>extractEncodedHevc(new Uint8Array(b)));
}
function replaceLinear(encoded){
  let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
  let newHvcc;
  [meta,newHvcc]=appendIpcoProperty(meta,encoded.hvcc);
  const associations=[];
  let replaced=false;
  for(const ref of a.props.associations.get(a.linearThumb)||[]){
    const p=a.props.properties[ref.index-1];
    if(p?.type==='hvcC'){
      associations.push([newHvcc,ref.essential]);replaced=true;
    }else associations.push([ref.index,ref.essential]);
  }
  assert(replaced,'linear thumbnail hvcC association missing');
  meta=setItemPropertyAssociations(meta,a.linearThumb,associations);
  const ft=topBox(base,'ftyp');
  return rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),meta,
    new Map([[a.linearThumb,encoded.payload]]));
}
function verifyOutput(data){
  const d=discoverHeic(data);
  assert.equal(d.stylesItem,a.stylesItem);
  assert.equal(d.linearThumb,a.linearThumb);
  assert.equal(d.hdrGrid,a.hdrGrid);
  assert(same(extractAppleMakerNoteTag(itemBytes(data,d,d.exifItem),0x54).payload,sourceMarker),
    'edited selected Style marker changed');
  assert.deepEqual(d.refs,a.refs,'editor/HDR graph relationships changed');
  for(const [id] of a.iloc.items){
    if(id===a.linearThumb)continue;
    assert(same(itemBytes(data,d,id),itemBytes(base,a,id)),'base payload changed '+id);
  }
  return d;
}

const report=[];
for(const variant of variants){
  const transformed=transformRgb(variant.coeff);
  const encoded=await encodeLinear(transformed,variant.id);
  const sps=hevcSpsColor(encoded.record);
  assert.equal(sps.luma,10);assert.equal(sps.chromaDepth,10);assert.equal(sps.chroma,1);
  assert.equal(sps.fullRange,true,'generated linear thumbnail must be full range');
  assert.equal(sps.primaries,2,'expected native unspecified primaries code 2');
  assert.equal(sps.transfer,2,'expected native unspecified transfer code 2');
  assert.equal(sps.matrix,2,'expected native unspecified matrix code 2');
  const data=replaceLinear(encoded),d=verifyOutput(data);
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);
  assert.equal(checked.compatibilityError,null);
  const name=`${sourceStem}_${variant.id}_${variant.label}.HEIC`;
  await fs.writeFile(path.join(output,name),data);
  report.push({
    file:name,bytes:data.length,coefficients:variant.coeff,genericCandidate:variant.generic,
    editedPrimaryExact:true,editedHdrExact:true,selectedStyleMarkerExact:true,
    stylesGraphRetained:true,textureGraphRetained:true,hdrHeadroomBase:'E',
    linearThumbnail:{width:lw,height:lh,sps},
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    originalCapturePayloadCopied:false,productionRepair:false,
  });
}
for(const variant of variants)await fs.rm(path.join(output,`linear-${variant.id}.mp4`),{force:true});
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
