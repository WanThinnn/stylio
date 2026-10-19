// Device diagnostic for third-party RGB ISO gain maps.
// Keep the source RGB ISO tmap intact for the viewer and add a separate scalar
// Apple HDR auxiliary for Photos' legacy/editor path.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  discoverHeic,extractItem,idatItemBytes,dimensionsForItem,ispeBox,URI_HDR_GAIN,
  auxUriForItem,auxcBox
} from '../web/src/core/heif.js';
import {addItems,internIpcoProperty,setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {topBox,box,concat,be} from '../web/src/core/box.js';
import {extractJpegHdr,parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {isoRgbToAppleFallback} from './lib/iso-apple-fallback.mjs';

const [jpegFile,baseFile,outputFile,...flags]=process.argv.slice(2);
if(!jpegFile||!baseFile||!outputFile||flags.some(x=>x!=='--also-link-base'))
  throw Error('Usage: node tools/indigo-rgb-apple-fallback-candidate.mjs <input.jpg> <E.heic> <output.heic> [--also-link-base]');
assert.notEqual(path.resolve(baseFile).toLowerCase(),path.resolve(outputFile).toLowerCase());
const alsoLinkBase=flags.includes('--also-link-base');
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:256*1024*1024,windowsHide:true}));

const [jpegBytes,base]=await Promise.all([jpegFile,baseFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const hdr=extractJpegHdr(jpegBytes);assert.ok(hdr);assert.equal(hdr.metadata.channels.length,3,'RGB ISO input required');
const a=discoverHeic(base);assert.equal(a.infos.get(a.primary)?.type,'tmap','E HDR-primary base required');
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);
const inputs=a.refs.find(r=>r.type==='dimg'&&r.from===a.primary)?.to;
assert.equal(inputs?.length,2);const [sdr,iso]=inputs;
const isoTiles=a.refs.find(r=>r.type==='dimg'&&r.from===iso)?.to||[];
assert.ok(isoTiles.length>0,'ISO gain tiles required');
assert.equal(auxUriForItem(a.props,iso),null,'source RGB ISO plane must not already be Apple aux');
const metadata=parseTmapMetadata(read(base,a,a.primary));assert.equal(metadata.channels.length,3);
assert.ok(Math.abs(metadata.alternateHeadroom-hdr.metadata.alternateHeadroom)<1e-6);
assert.deepEqual(dimensionsForItem(a.props,iso),[hdr.gainWidth,hdr.gainHeight]);
const [tw,th]=dimensionsForItem(a.props,isoTiles[0]),cols=Math.ceil(hdr.gainWidth/tw);

const gainRgb=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.gain);
assert.equal(gainRgb.length,hdr.gainWidth*hdr.gainHeight*3);
const baseRgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${hdr.gainWidth}:${hdr.gainHeight}:flags=lanczos`,
  '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.base);
assert.equal(baseRgb.length,gainRgb.length);
const linearRgb=new Float32Array(baseRgb.length);
for(let i=0;i<baseRgb.length;i++)linearRgb[i]=encodedToLinear(baseRgb[i]/255,'srgb');
const converted=isoRgbToAppleFallback(gainRgb,linearRgb,metadata);

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const specs=[{key:'apple-grid',itemType:'grid'},{key:'apple-xmp',itemType:'mime',contentType:'application/rdf+xml'},
  ...isoTiles.map((_,i)=>({key:'apple-tile-'+i,itemType:'hvc1'}))];
let ids;[meta,ids]=addItems(meta,specs);
const apple=ids.get('apple-grid'),side=ids.get('apple-xmp'),tiles=isoTiles.map((_,i)=>ids.get('apple-tile-'+i));
meta=setItemReference(meta,'dimg',apple,tiles);
meta=setItemReference(meta,'auxl',apple,alsoLinkBase?[sdr,a.primary]:[a.primary]);
meta=setItemReference(meta,'cdsc',side,[apple]);
const payloads=new Map([[apple,read(base,a,iso)],[side,new TextEncoder().encode(
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>65536</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>${converted.headroom.toFixed(9)}</HDRGainMap:HDRGainMapHeadroom></rdf:Description></rdf:RDF></x:xmpmeta>`)]]);

const intern=raw=>{let index;[meta,index]=internIpcoProperty(meta,raw);return index;};
const gridProps=(a.props.associations.get(iso)||[])
  .filter(ref=>!['colr','pixi','auxC'].includes(a.props.properties[ref.index-1].type))
  .map(ref=>[ref.index,ref.essential]);
const nclx=box('colr',concat([new TextEncoder().encode('nclx'),be(2,2),be(2,2),be(2,2),Uint8Array.of(128)]));
const gridPixel=intern(box('pixi',Uint8Array.of(0,0,0,0,1,8))),gridColor=intern(nclx),gridAux=intern(auxcBox(URI_HDR_GAIN));
meta=setItemPropertyAssociations(meta,apple,[...gridProps,[gridPixel,false],[gridColor,false],[gridAux,true]]);
const pixel=intern(box('pixi',Uint8Array.of(0,0,0,0,1,8))),geometry=intern(ispeBox(tw,th));
const work=path.join(path.dirname(path.resolve(outputFile)),'indigo-apple-fallback-tile.mp4');
for(let i=0;i<tiles.length;i++){
  const pixels=new Uint8Array(tw*th),col=i%cols,row=Math.floor(i/cols);
  const cw=Math.min(tw,hdr.gainWidth-col*tw),hh=Math.min(th,hdr.gainHeight-row*th);
  for(let y=0;y<hh;y++)pixels.set(converted.samples.subarray((row*th+y)*hdr.gainWidth+col*tw,(row*th+y)*hdr.gainWidth+col*tw+cw),y*tw);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
    '-f','rawvideo','-pix_fmt','gray','-s',`${tw}x${th}`,'-r','1','-i','pipe:0','-frames:v','1','-an',
    '-c:v','libx265','-preset','ultrafast','-pix_fmt','gray','-color_primaries','unspecified','-color_trc','unspecified',
    '-colorspace','unspecified','-color_range','pc','-tag:v','hvc1','-map_metadata','-1',
    '-x265-params','lossless=1:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1:log-level=error',work],
    {input:pixels,maxBuffer:32*1024*1024,windowsHide:true});
  const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(work))),sps=hevcSpsColor(encoded.record);
  assert.equal(sps.chroma,0);assert.equal(sps.luma,8);assert.equal(sps.fullRange,true);
  const hvcc=intern(encoded.hvcc);
  meta=setItemPropertyAssociations(meta,tiles[i],[[geometry,false],[pixel,false],[hvcc,true]]);
  payloads.set(tiles[i],encoded.payload);
}
await fs.rm(work,{force:true});
const output=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),meta,payloads),d=discoverHeic(output);
assert.equal(d.primary,a.primary);const appleUri=auxUriForItem(d.props,apple);if(appleUri!==URI_HDR_GAIN)throw Error(JSON.stringify({apple,appleUri,associations:d.props.associations.get(apple),properties:(d.props.associations.get(apple)||[]).map(x=>d.props.properties[x.index-1]?.type)}));assert.equal(d.hdrGrid,apple);
assert.equal(auxUriForItem(d.props,iso),null);
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===a.primary).to,[sdr,iso],'source RGB tmap relation exact');
for(const id of a.infos.keys())assert.deepEqual(read(output,d,id),read(base,a,id),'all E payloads exact '+id);
const checked=await executeJob({operation:'read',file:new Blob([output])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outputFile,output,{flag:'wx'});
const report={file:path.resolve(outputFile),bytes:output.length,sha256:hash(output),base:path.basename(baseFile),
  isoRgbGain:iso,appleAuxiliary:apple,appleTargets:d.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to||[],
  sourceHeadroom:converted.headroom,metrics:{meanAbsoluteSceneError:converted.meanAbsoluteSceneError,
    maxAbsoluteSceneError:converted.maxAbsoluteSceneError,clippedLow:converted.clippedLow,
    clippedHigh:converted.clippedHigh,unrepresentableBlack:converted.unrepresentableBlack},
  sourceRgbIsoPayloadsExact:true,sourceTmapExact:true,stylesExact:true,productionEnabled:false,deviceValidation:'pending',
  hypothesis:'Photos can keep E tmap for display while using a separate scalar Apple auxiliary in the editor.'};
await fs.writeFile(outputFile+'.json',JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report,null,2));
