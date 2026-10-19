import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,auxUriForItem,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {replaceItemPropertyWithSource,setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {extractJpegHdr,parseTmapMetadata,encodedToLinear,decodeGainLog} from '../web/src/raster/jpeg-hdr.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [jpegFile,pFile,cqFile,outFile]=process.argv.slice(2);
if(!jpegFile||!pFile||!cqFile||!outFile)throw Error('Usage: node tools/indigo-p-native-mono-editor-candidate.mjs <input.jpg> <P.heic> <CQ.heic> <S.heic>');
assert.notEqual(path.resolve(pFile).toLowerCase(),path.resolve(outFile).toLowerCase());
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(args,input)=>new Uint8Array(execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1',...args],{input,maxBuffer:128*1024*1024,windowsHide:true}));
const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);

const [jpeg,P,CQ]=await Promise.all([jpegFile,pFile,cqFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const hdr=extractJpegHdr(jpeg);assert.ok(hdr);assert.equal(hdr.metadata.channels.length,3);
const p=discoverHeic(P),cq=discoverHeic(CQ),apple=p.hdrGrid,cqApple=cq.hdrGrid;
assert.equal(auxUriForItem(p.props,apple),URI_HDR_GAIN);
assert.equal(auxUriForItem(cq.props,cqApple),URI_HDR_GAIN);
assert.deepEqual(p.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to,[p.primary]);

const tmap=[...p.infos].find(([,info])=>info.type==='tmap')?.[0];assert.ok(tmap!==undefined);
const metadata=parseTmapMetadata(read(P,p,tmap));assert.equal(metadata.channels.length,3);
const [gw,gh]=dimensionsForItem(p.props,apple),tiles=p.hdrTiles||[];
assert.deepEqual([gw,gh],[hdr.gainWidth,hdr.gainHeight]);assert.ok(tiles.length);
const [tw,th]=dimensionsForItem(p.props,tiles[0]),cols=Math.ceil(gw/tw);

const gainRgb=run(['-f','image2pipe','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.gain);
const baseRgb=run(['-f','image2pipe','-i','pipe:0','-vf',`scale=${gw}:${gh}:flags=lanczos`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],hdr.base);
assert.equal(baseRgb.length,gainRgb.length);
const weights=[.2289745641,.6917385218,.0792869141],headroom=2**metadata.alternateHeadroom,stops=Math.log2(headroom);
const samples=new Uint8Array(gw*gh);
let clippedLow=0,clippedHigh=0,unrepresentableBlack=0,sumError=0,maxError=0;
for(let i=0,pix=0;i<gainRgb.length;i+=3,pix++){
  let baseLuma=0,hdrLuma=0;
  for(let c=0;c<3;c++){
    const ch=metadata.channels[c],base=encodedToLinear(baseRgb[i+c]/255,'srgb');
    const scene=Math.max(0,(base+ch.baseOffset)*2**decodeGainLog(gainRgb[i+c]/255,ch)-ch.alternateOffset);
    baseLuma+=weights[c]*base;hdrLuma+=weights[c]*scene;
  }
  const multiplier=baseLuma>0?hdrLuma/baseLuma:1;
  if(multiplier<1)clippedLow++;if(multiplier>headroom)clippedHigh++;if(baseLuma===0&&hdrLuma>0)unrepresentableBlack++;
  const clamped=Math.max(1,Math.min(headroom,multiplier));
  const code=Math.round(255*Math.log2(clamped)/stops);samples[pix]=code;
  const rebuilt=baseLuma*2**((code/255)*stops),err=Math.abs(rebuilt-hdrLuma);sumError+=err;maxError=Math.max(maxError,err);
}

const cqGridPixi=propertyBoxBytes(CQ,cq.props,cqApple,'pixi'),cqGridColr=propertyBoxBytes(CQ,cq.props,cqApple,'colr');
const cqTileColr=propertyBoxBytes(CQ,cq.props,cq.hdrTiles[0],'colr');
assert.ok(cqGridPixi&&cqGridColr&&cqTileColr);
let meta=P.slice(p.meta.off,p.meta.off+p.meta.size),payloads=new Map();
meta=replaceItemPropertyWithSource(meta,apple,'pixi',cqGridPixi);
meta=replaceItemPropertyWithSource(meta,apple,'colr',cqGridColr);

const work=path.join(path.dirname(path.resolve(outFile)),'indigo-s-mono-tile.mp4');
for(let i=0;i<tiles.length;i++){
  const id=tiles[i],tile=new Uint8Array(tw*th),col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,gw-col*tw),hh=Math.min(th,gh-row*th);
  for(let y=0;y<hh;y++)tile.set(samples.subarray((row*th+y)*gw+col*tw,(row*th+y)*gw+col*tw+cw),y*tw);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
    '-f','rawvideo','-pix_fmt','gray','-s',`${tw}x${th}`,'-r','1','-i','pipe:0','-frames:v','1','-an',
    '-c:v','libx265','-preset','ultrafast','-pix_fmt','gray','-color_range','pc','-color_primaries','unspecified',
    '-color_trc','unspecified','-colorspace','unspecified','-tag:v','hvc1','-map_metadata','-1',
    '-x265-params','lossless=1:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1:range=full:colorprim=2:transfer=2:colormatrix=2:log-level=error',work],
    {input:tile,maxBuffer:32*1024*1024,windowsHide:true});
  const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(work)));
  meta=replaceItemPropertyWithSource(meta,id,'colr',cqTileColr);
  meta=replaceItemPropertyWithSource(meta,id,'hvcC',encoded.hvcc);
  const props=discoverHeic(meta).props;
  const assoc=(props.associations.get(id)||[]).filter(a=>props.properties[a.index-1]?.type!=='pixi').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,id,assoc);
  payloads.set(id,encoded.payload);
}
await fs.rm(work,{force:true});

const out=rebuildHeic(P,p,P.slice(0,topBox(P,'ftyp').size),meta,payloads),d=discoverHeic(out);
assert.equal(d.primary,p.primary);assert.equal(d.hdrGrid,apple);assert.deepEqual(d.refs,p.refs);
assert.equal(auxUriForItem(d.props,apple),URI_HDR_GAIN);assert.deepEqual(d.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to,[p.primary]);
for(const [id] of p.infos){
  if(tiles.includes(id))continue;
  assert.deepEqual(read(out,d,id),read(P,p,id),'non-Apple-tile payload '+id);
}
for(const id of p.infos.keys()){
  if(id===apple||tiles.includes(id))continue;
  for(const type of ['ispe','pixi','hvcC','colr','auxC']){
    const a=propertyBoxBytes(P,p.props,id,type),b=propertyBoxBytes(out,d.props,id,type);
    if(Boolean(a)!==Boolean(b)||(a&&!same(a,b)))throw Error('non-Apple property changed '+id+' '+type);
  }
}
const checked=await executeJob({operation:'read',file:new Blob([out])});assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({
  file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(pFile),
  primary:d.primary,tmap,appleAux:apple,appleTiles:tiles.length,appleShape:'mono 8-bit + Linear Gray ICC + VUI 2/2/2',
  version:131072,headroom,metrics:{meanAbsoluteSceneError:sumError/samples.length,maxAbsoluteSceneError:maxError,clippedLow,clippedHigh,unrepresentableBlack},
  refsExact:true,allNonAppleTilePayloadsExact:true,allNonApplePropertiesExact:true,deviceValidation:'pending'
},null,2));