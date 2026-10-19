// Diagnostic only: isolate Photos' HDR handoff, tiled Apple RGB gain decoding,
// and a Photos-rendered copy. No production export policy changes here.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {box,concat,metaChildren,topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItemData,propertyBoxBytes,dimensionsForItem,
  addItems,setItemReference,setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [sourceFile,renderFile,outputDir]=process.argv.slice(2);
if(!sourceFile||!renderFile||!outputDir)throw Error('Usage: node tools/indigo-zoom-hdr-candidates.mjs <Portrait.heic> <Photos-render.heic | -> <new-output-directory>');
const source=new Uint8Array(await fs.readFile(sourceFile)),s=discoverHeic(source);
// A fresh scene has no Photos-rendered copy yet: include the actual app export
// as D, then E/F isolate the same two variables on that exact baseline.
const fresh=renderFile==='-';
const rendered=fresh?null:new Uint8Array(await fs.readFile(renderFile));
const r=rendered?discoverHeic(rendered):null;
assert.ok(s.hdrGrid!==null&&s.hdrTiles.length&&s.stylesItem!==null);
assert.ok([...s.infos].some(([,info])=>info.type==='tmap'));
if(r)assert.ok(r.hdrGrid!==null);
await fs.mkdir(outputDir); // Refuse to overwrite an existing experiment.
const hash=b=>createHash('sha256').update(b).digest('hex');
const ftyp=source.slice(0,topBox(source,'ftyp').size);
const sourceMeta=source.slice(s.meta.off,s.meta.off+s.meta.size);
const read=(b,d,id)=>extractItemData(b,d,id);
const property=(b,d,id,type)=>propertyBoxBytes(b,d.props,id,type);
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',[
  '-hide_banner','-loglevel','error','-threads','1','-filter_threads','1',...args,
],{input,maxBuffer:128*1024*1024,windowsHide:true}));

function annexB(codec,payload){
  const b=topBox(codec,'hvcC'),record=codec.slice(b.off+b.hdr,b.off+b.size);
  const start=Uint8Array.of(0,0,0,1),parts=[];let p=23;
  for(let i=0;i<record[22];i++){
    p++;const count=record[p]*256+record[p+1];p+=2;
    for(let j=0;j<count;j++){
      const length=record[p]*256+record[p+1];p+=2;
      parts.push(start,record.slice(p,p+length));p+=length;
    }
  }
  const lengthSize=(record[21]&3)+1;
  for(p=0;p<payload.length;){
    let length=0;for(let k=0;k<lengthSize;k++)length=length*256+payload[p+k];p+=lengthSize;
    assert.ok(length>0&&p+length<=payload.length);
    parts.push(start,payload.slice(p,p+length));p+=length;
  }
  return concat(parts);
}
function decode(codec,payload){
  return run(['-f','hevc','-i','pipe:0','-frames:v','1',
    '-vf','scale=in_range=full:out_range=full','-color_range','pc',
    '-pix_fmt','yuv420p','-f','rawvideo','pipe:1'],annexB(codec,payload));
}
function equalSamples(actual,expected,message){
  assert.equal(actual.length,expected.length,message+' length');
  // Do not ask assert to format millions of raw samples on a failed comparison.
  assert.equal(Buffer.compare(actual,expected),0,message);
}
function payloadsExact(output,graph){
  for(const id of s.infos.keys())assert.deepEqual(read(output,graph,id),read(source,s,id),'source payload '+id);
}
function propertiesExact(output,graph,except=new Set()){
  for(const id of s.infos.keys()){
    const before=(s.props.associations.get(id)||[]).map(a=>{
      const p=s.props.properties[a.index-1];return {type:p.type,essential:a.essential,bytes:source.slice(p.box.off,p.box.off+p.box.size)};
    }).filter(p=>!except.has(id+':'+p.type));
    const after=(graph.props.associations.get(id)||[]).map(a=>{
      const p=graph.props.properties[a.index-1];return {type:p.type,essential:a.essential,bytes:output.slice(p.box.off,p.box.off+p.box.size)};
    }).filter(p=>!except.has(id+':'+p.type));
    assert.deepEqual(after,before,'source properties '+id);
  }
}
const manifest={source:{file:path.basename(sourceFile),sha256:hash(source)},
  rendered:rendered?{file:path.basename(renderFile),sha256:hash(rendered)}:null,
  deviceZoomValidation:'pending',variants:[]};
async function save(name,data,details){
  const check=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(check.discoveryError,null);assert.equal(check.compatibilityError,null);
  await fs.writeFile(path.join(outputDir,name),data,{flag:'wx'});
  const variant={name,bytes:data.length,sha256:hash(data),...details};
  manifest.variants.push(variant);console.log(JSON.stringify(variant));
}

// A: exact Photos-rendered file, imported as a fresh asset. No pixel/metadata edits.
if(rendered)await save('Zoom_A_Photos_Render.HEIC',rendered,{kind:'Photos-rendered control, exact file',styles:false,depth:false});
else await save('Zoom_D_App_Baseline.HEIC',source,{kind:'actual app export, exact file',allSourcePayloadsExact:true});

// B: remove only the preferred-alternative group. Both HDR resources, their
// equations, all pixels and editable Styles/Texture/Portrait remain unchanged.
const m=topBox(sourceMeta,'meta');
assert.ok(metaChildren(sourceMeta,m).some(b=>b.type==='grpl'));
const withoutGroup=box('meta',concat([sourceMeta.slice(m.off+m.hdr,m.off+m.hdr+4),
  ...metaChildren(sourceMeta,m).filter(b=>b.type!=='grpl').map(b=>sourceMeta.slice(b.off,b.off+b.size))]));
const B=rebuildHeic(source,s,ftyp,withoutGroup,new Map()),bd=discoverHeic(B);
assert.deepEqual(bd.refs,s.refs);payloadsExact(B,bd);propertiesExact(B,bd);
await save(fresh?'Zoom_E_Primary_HDR.HEIC':'Zoom_B_Primary_HDR.HEIC',B,{kind:'remove preferred HDR alternative group only',
  allSourcePayloadsExact:true,allReferencesExact:true,allPropertiesExact:true});

// C: keep the preferred rendition and RGB equations. Store the exact decoded
// Apple gain samples as one lossless image instead of a grid of twelve images.
const [width,height]=dimensionsForItem(s.props,s.hdrGrid);
assert.equal(width%2,0);assert.equal(height%2,0);
const [tw,th]=dimensionsForItem(s.props,s.hdrTiles[0]),cols=Math.ceil(width/tw);
const frame=new Uint8Array(width*height*1.5);
for(let i=0;i<s.hdrTiles.length;i++){
  const id=s.hdrTiles[i],tile=decode(property(source,s,id,'hvcC'),read(source,s,id));
  assert.equal(tile.length,tw*th*1.5);
  let fromOffset=0,toOffset=0;
  for(let plane=0;plane<3;plane++){
    const scale=plane?2:1,w=width/scale,h=height/scale,tileW=tw/scale,tileH=th/scale;
    const x=(i%cols)*tileW,y=Math.floor(i/cols)*tileH,n=Math.min(tileW,w-x);
    for(let line=0;line<Math.min(tileH,h-y);line++)
      frame.set(tile.subarray(fromOffset+line*tileW,fromOffset+line*tileW+n),toOffset+(y+line)*w+x);
    fromOffset+=tileW*tileH;toOffset+=w*h;
  }
}
const work=path.join(outputDir,'apple-gain.mp4');
try{
  run(['-y','-f','rawvideo','-pix_fmt','yuv420p','-color_range','pc','-s',`${width}x${height}`,'-r','1','-i','pipe:0',
    '-frames:v','1','-an','-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p',
    '-color_range','pc','-color_primaries','unspecified','-color_trc','unspecified','-colorspace','smpte170m',
    '-tag:v','hvc1','-map_metadata','-1','-x265-params',
    'lossless=1:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1:range=full:colorprim=2:transfer=2:colormatrix=6:log-level=error',work],frame);
  const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(work)));
  equalSamples(decode(encoded.hvcc,encoded.payload),frame,'single-image gain samples must be exact');
  const cb=topBox(encoded.hvcc,'hvcC'),sps=hevcSpsColor(encoded.hvcc.slice(cb.off+cb.hdr,cb.off+cb.size));
  assert.equal(sps.chroma,1);assert.equal(sps.luma,8);assert.equal(sps.fullRange,true);
  assert.equal(sps.primaries,2);assert.equal(sps.transfer,2);assert.equal(sps.matrix,6);
  const apple=s.hdrGrid;
  const kept=(s.props.associations.get(apple)||[]).filter(a=>s.props.properties[a.index-1].type!=='auxC').map(a=>[a.index,a.essential]);
  let meta=setItemPropertyAssociations(sourceMeta,apple,kept);
  meta=setItemReference(meta,'auxl',apple,[]);
  const sidecars=s.refs.filter(ref=>ref.type==='cdsc'&&ref.to.includes(apple));
  const props=['ispe','pixi','colr','auxC','irot','imir'].map(type=>property(source,s,apple,type)).filter(Boolean);
  let ids;[meta,ids]=addItems(meta,[{key:'single-apple-gain',itemType:'hvc1',refType:'auxl',refTo:[s.primary],boxes:[...props,encoded.hvcc]}]);
  const newGain=ids.get('single-apple-gain');
  for(const side of sidecars)meta=setItemReference(meta,'cdsc',side.from,side.to.map(id=>id===apple?newGain:id));
  const C=rebuildHeic(source,s,ftyp,meta,new Map([[newGain,encoded.payload]])),cd=discoverHeic(C);
  assert.equal(cd.primary,s.primary);assert.equal(cd.hdrGrid,newGain);assert.equal(cd.infos.get(newGain).type,'hvc1');
  payloadsExact(C,cd);propertiesExact(C,cd,new Set([apple+':auxC']));
  const changed=ref=>ref.from===apple&&ref.type==='auxl'||sidecars.some(side=>side.from===ref.from&&ref.type==='cdsc');
  assert.deepEqual(cd.refs.filter(ref=>ref.from!==newGain&&!changed(ref)),s.refs.filter(ref=>!changed(ref)));
  equalSamples(decode(property(C,cd,newGain,'hvcC'),read(C,cd,newGain)),frame,'assembled gain samples');
  await save(fresh?'Zoom_F_Single_RGB_Gain.HEIC':'Zoom_C_Single_RGB_Gain.HEIC',C,{kind:'exact Apple RGB gain samples in a single image',
    gainSize:[width,height],gainSampleHash:hash(frame),allOriginalPayloadsExact:true,
    primaryIsoStylesTextureDepthAndColoursExact:true,sourceGainSamplesExact:true});
}finally{await fs.rm(work,{force:true});}
await fs.writeFile(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
