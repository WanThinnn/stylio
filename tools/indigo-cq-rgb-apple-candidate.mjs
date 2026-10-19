// Candidate N: keep M's device-proven CQ topology, replace only the mono Apple
// editor auxiliary with a per-channel RGB Apple gain map derived from the source.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,auxUriForItem,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {appendIpcoProperty,setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {topBox} from '../web/src/core/box.js';
import {extractJpegHdr,parseTmapMetadata,encodedToLinear} from '../web/src/raster/jpeg-hdr.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {isoRgbToAppleFallbackRgb,isoRgbToAppleLogGain} from './lib/iso-apple-fallback.mjs';

const [jpegFile,baseFile,outputFile,...flags]=process.argv.slice(2);
if(!jpegFile||!baseFile||!outputFile||flags.some(x=>x!=='--log20000'))throw Error('Usage: node tools/indigo-cq-rgb-apple-candidate.mjs <input.jpg> <M.heic> <output.heic> [--log20000]');
const log20000=flags.includes('--log20000');
assert.notEqual(path.resolve(baseFile).toLowerCase(),path.resolve(outputFile).toLowerCase());
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{input,maxBuffer:128*1024*1024,windowsHide:true}));

const [jpegBytes,base]=await Promise.all([jpegFile,baseFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const hdr=extractJpegHdr(jpegBytes);assert.ok(hdr);assert.equal(hdr.metadata.channels.length,3);
const a=discoverHeic(base),tmap=[...a.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.ok(tmap!==undefined);assert.equal(a.infos.get(a.primary)?.type,'grid');
const tmapInputs=a.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to;assert.deepEqual(tmapInputs?.slice(0,1),[a.primary]);
const iso=tmapInputs[1],apple=a.hdrGrid;assert.ok(iso&&apple&&iso!==apple);
assert.equal(auxUriForItem(a.props,iso),null);assert.equal(auxUriForItem(a.props,apple),URI_HDR_GAIN);
assert.deepEqual(a.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to,[a.primary]);
const appleTiles=a.refs.find(r=>r.type==='dimg'&&r.from===apple)?.to||[];assert.ok(appleTiles.length);
const metadata=parseTmapMetadata(read(base,a,tmap));assert.equal(metadata.channels.length,3);
const [gw,gh]=dimensionsForItem(a.props,apple),[tw,th]=dimensionsForItem(a.props,appleTiles[0]),cols=Math.ceil(gw/tw);
assert.deepEqual([gw,gh],[hdr.gainWidth,hdr.gainHeight]);

const gainRgb=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.gain);
const baseRgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${gw}:${gh}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.base);
assert.equal(baseRgb.length,gainRgb.length);
const linearRgb=new Float32Array(baseRgb.length);for(let i=0;i<baseRgb.length;i++)linearRgb[i]=encodedToLinear(baseRgb[i]/255,'srgb');
const converted=log20000?isoRgbToAppleLogGain(gainRgb,linearRgb,metadata):isoRgbToAppleFallbackRgb(gainRgb,linearRgb,metadata);

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size),payloads=new Map();
const pixi=propertyBoxBytes(base,a.props,iso,'pixi'),colr=propertyBoxBytes(base,a.props,iso,'colr');
assert.ok(pixi&&colr);let pixiIndex,colrIndex;[meta,pixiIndex]=appendIpcoProperty(meta,pixi);[meta,colrIndex]=appendIpcoProperty(meta,colr);
const replaceTypes=(id,replacements)=>{
  const props=discoverHeic(meta).props,drop=new Set(Object.keys(replacements));
  const kept=(props.associations.get(id)||[]).filter(x=>!drop.has(props.properties[x.index-1]?.type)).map(x=>[x.index,x.essential]);
  const added=Object.entries(replacements).map(([type,index])=>[index,type==='hvcC'||type==='auxC']);
  meta=setItemPropertyAssociations(meta,id,[...kept,...added]);
};
replaceTypes(apple,{pixi:pixiIndex,colr:colrIndex});

const work=path.join(path.dirname(path.resolve(outputFile)),'indigo-n-rgb-apple-tile.mp4');
for(let i=0;i<appleTiles.length;i++){
  const tile=new Uint8Array(tw*th*3),col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),hh=Math.min(th,gh-row*th);
  for(let y=0;y<hh;y++){
    const from=((row*th+y)*gw+col*tw)*3,to=y*tw*3;
    tile.set(converted.samples.subarray(from,from+cw*3),to);
  }
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
    '-f','rawvideo','-pix_fmt','rgb24','-s',`${tw}x${th}`,'-r','1','-i','pipe:0','-frames:v','1','-an',
    '-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p','-color_primaries','smpte432','-color_trc','iec61966-2-1',
    '-colorspace','smpte170m','-color_range','pc','-tag:v','hvc1','-map_metadata','-1',
    '-x265-params','lossless=1:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1:log-level=error',work],
    {input:tile,maxBuffer:32*1024*1024,windowsHide:true});
  const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(work)));let hvccIndex;
  [meta,hvccIndex]=appendIpcoProperty(meta,encoded.hvcc);
  replaceTypes(appleTiles[i],{pixi:pixiIndex,colr:colrIndex,hvcC:hvccIndex});
  payloads.set(appleTiles[i],encoded.payload);
}
await fs.rm(work,{force:true});
const output=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),meta,payloads),d=discoverHeic(output);
assert.equal(d.primary,a.primary);assert.equal(d.hdrGrid,apple);assert.equal(auxUriForItem(d.props,apple),URI_HDR_GAIN);
assert.deepEqual(d.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to,[a.primary]);
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to,[a.primary,iso]);
assert.equal(auxUriForItem(d.props,iso),null);
for(const id of a.infos.keys())if(!appleTiles.includes(id))assert.deepEqual(read(output,d,id),read(base,a,id),'unchanged payload '+id);
const checked=await executeJob({operation:'read',file:new Blob([output])});assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outputFile,output,{flag:'wx'});
console.log(JSON.stringify({file:path.resolve(outputFile),bytes:output.length,sha256:hash(output),base:path.basename(baseFile),primary:d.primary,tmap,isoRgbGain:iso,appleAuxiliary:apple,appleChannels:3,appleRepresentation:log20000?'log2-0x20000':'legacy-linear',appleTargets:d.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to||[],headroom:converted.headroom,metrics:{meanAbsoluteSceneError:converted.meanAbsoluteSceneError,maxAbsoluteSceneError:converted.maxAbsoluteSceneError,clippedLow:converted.clippedLow,clippedHigh:converted.clippedHigh,unrepresentableBlack:converted.unrepresentableBlack},allNonAppleTilePayloadsExact:true,deviceValidation:'pending'},null,2));
