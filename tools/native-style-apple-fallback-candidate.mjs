// Device diagnostic only: keep the uploaded ISO HDR intact, and give the Apple
// auxiliary reader an independently encoded map under its documented equation.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,ispeBox,URI_HDR_GAIN,auxUriForItem} from '../web/src/core/heif.js';
import {addItems,internIpcoProperty,setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {topBox,box,concat,be} from '../web/src/core/box.js';
import {parseTmapMetadata,decodeGainLog,encodedToLinear,bt709ToLinear} from '../web/src/raster/jpeg-hdr.js';
import {extractEncodedHevc} from '../web/src/codecs/ffmpeg-hevc.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {isoToAppleFallback} from './lib/iso-apple-fallback.mjs';

const [sourceFile,baseFile,outputFile,...flags]=process.argv.slice(2);
if(!sourceFile||!baseFile||!outputFile)throw Error('Usage: node tools/native-style-apple-fallback-candidate.mjs <Current.heic> <CQ.heic> <output.heic> [--measure] [--apple-power-1961]');
if(flags.some(flag=>!['--measure','--apple-power-1961'].includes(flag)))throw Error('Unknown diagnostic option');
const transfer=flags.includes('--apple-power-1961')?'power-1.961':'bt709';
const decodeApple=transfer==='bt709'?bt709ToLinear:(x=>x**1.961);
assert.notEqual(path.resolve(baseFile),path.resolve(outputFile));
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const [source,base]=await Promise.all([sourceFile,baseFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const s=discoverHeic(source),a=discoverHeic(base),iso=a.hdrGrid;
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);assert.notEqual(iso,null);
for(const id of [s.primary,...s.primaryTiles,s.hdrGrid,...s.hdrTiles])assert.deepEqual(read(source,s,id),read(base,a,id),'source image data '+id);
assert.deepEqual(propertyBoxBytes(base,a.props,a.primary,'colr'),propertyBoxBytes(source,s.props,s.primary,'colr'));
assert.deepEqual(extractAppleMakerNoteTag(read(base,a,a.exifItem),0x54),extractAppleMakerNoteTag(read(source,s,s.exifItem),0x54),'selected source Style and controls');
const tmap=[...a.infos].find(([,info])=>info.type==='tmap')[0];
assert.deepEqual(a.refs.find(r=>r.type==='dimg'&&r.from===tmap).to,[a.primary,iso]);
const metadata=parseTmapMetadata(read(base,a,tmap));
assert.equal(metadata.channels.length,1);assert.equal(metadata.channels[0].baseOffset,metadata.channels[0].alternateOffset);
assert.equal(metadata.baseHeadroom,0);assert.equal(metadata.channels[0].min,0);
assert.equal(metadata.channels[0].gamma,1);
assert.equal(metadata.channels[0].max,metadata.alternateHeadroom);
const [w,h]=dimensionsForItem(s.props,s.hdrGrid),[tw,th]=dimensionsForItem(s.props,s.hdrTiles[0]),cols=Math.ceil(w/tw);
const sourceHash=hash(source),cache=path.resolve('artifact/build/hdr-1921/decoded');
// The comparison harness writes these only after checking geometry and reversing
// the HEIF display transform. Cache keys include the complete source hash.
const [gain,primary]=await Promise.all([fs.readFile(path.join(cache,sourceHash+'.gain')),fs.readFile(path.join(cache,sourceHash+'.stored.primary48'))]);
assert.equal(gain.length,w*h);assert.equal(primary.length,w*h*6);
const weights=[.2289745641,.6917385218,.0792869141],luma=new Float32Array(w*h);
for(let i=0;i<w*h;i++)for(let c=0;c<3;c++)luma[i]+=weights[c]*encodedToLinear(primary.readUInt16LE((i*3+c)*2)/65535,'srgb');
const converted=isoToAppleFallback(gain,luma,metadata,{transfer}),bt709Reference=transfer==='bt709'?converted:isoToAppleFallback(gain,luma,metadata),ch=metadata.channels[0];
let beforeError=0,afterError=0,bt709CurveError=0,sumScene=0;
const regions=[0,.5,1,2,3].map(threshold=>({threshold,n:0,source:0,oldApple:0,newApple:0,bt709Curve:0}));
for(let i=0;i<gain.length;i++){
  const scene=Math.max(0,(luma[i]+ch.baseOffset)*2**decodeGainLog(gain[i]/255,ch)-ch.alternateOffset);
  const before=luma[i]*(1+(converted.headroom-1)*decodeApple(gain[i]/255));
  const after=luma[i]*(1+(converted.headroom-1)*decodeApple(converted.samples[i]/255));
  const bt709Curve=luma[i]*(1+(converted.headroom-1)*decodeApple(bt709Reference.samples[i]/255));
  bt709CurveError+=Math.abs(bt709Curve-scene);
  beforeError+=Math.abs(before-scene);afterError+=Math.abs(after-scene);sumScene+=scene;
  for(const region of regions)if(scene>=region.threshold){region.n++;region.source+=scene;region.oldApple+=before;region.newApple+=after;region.bt709Curve+=bt709Curve;}
}
const metrics={transfer,headroom:converted.headroom,pixels:gain.length,clippedLow:converted.clippedLow,clippedHigh:converted.clippedHigh,
  unrepresentableBlack:converted.unrepresentableBlack,
  oldAppleMeanAbsoluteSceneError:beforeError/gain.length,newAppleMeanAbsoluteSceneError:afterError/gain.length,
  relativeIntegratedAbsoluteError:afterError/sumScene,
  bt709CodesUnderSelectedReaderAbsoluteError:bt709CurveError/sumScene,
  regions:regions.filter(r=>r.n).map(({threshold,n,source,oldApple,newApple,bt709Curve})=>({threshold,n,oldRatio:oldApple/source,newRatio:newApple/source,bt709CodesRatio:bt709Curve/source}))};
console.log(JSON.stringify(metrics,null,2));
assert.ok(afterError<beforeError*.2,'separate Apple interpretation materially improves the scene signal');
assert.ok(afterError/sumScene<.01,'fallback average absolute signal error below one percent');
if(flags.includes('--measure'))process.exit(0);

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const sides=a.refs.filter(r=>r.type==='cdsc'&&r.to.includes(iso)&&a.infos.get(r.from)?.type==='mime')
  .filter(r=>new TextDecoder().decode(read(base,a,r.from)).includes('http://ns.apple.com/HDRGainMap/1.0/'));
assert.equal(sides.length,1);const side=sides[0].from;
meta=setItemPropertyAssociations(meta,iso,(a.props.associations.get(iso)||[])
  .filter(ref=>a.props.properties[ref.index-1].type!=='auxC').map(ref=>[ref.index,ref.essential]));
meta=setItemReference(meta,'auxl',iso,[]);
const specs=[{key:'apple-grid',itemType:'grid'},...a.hdrTiles.map((_,i)=>({key:'apple-tile-'+i,itemType:'hvc1'}))];
let ids;[meta,ids]=addItems(meta,specs);
const apple=ids.get('apple-grid'),tiles=a.hdrTiles.map((_,i)=>ids.get('apple-tile-'+i));
meta=setItemReference(meta,'dimg',apple,tiles);meta=setItemReference(meta,'auxl',apple,[a.primary]);
meta=setItemReference(meta,'cdsc',side,[apple]);
const payloads=new Map([[apple,read(base,a,iso)],
  [side,new TextEncoder().encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>65536</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>${converted.headroom.toFixed(9)}</HDRGainMap:HDRGainMapHeadroom></rdf:Description></rdf:RDF></x:xmpmeta>`)] ]);
const intern=raw=>{let index;[meta,index]=internIpcoProperty(meta,raw);return index;};
const gridProps=(a.props.associations.get(iso)||[]).filter(ref=>a.props.properties[ref.index-1].type!=='colr').map(ref=>[ref.index,ref.essential]);
const nclx=box('colr',concat([new TextEncoder().encode('nclx'),be(2,2),be(2,2),be(2,2),Uint8Array.of(128)]));
meta=setItemPropertyAssociations(meta,apple,[...gridProps,[intern(nclx),false]]);
const pixel=intern(box('pixi',Uint8Array.of(0,0,0,0,1,8))),geometry=intern(ispeBox(tw,th));
const directory=path.dirname(path.resolve(outputFile));await fs.mkdir(directory,{recursive:true});
const work=path.join(directory,'apple-fallback-tile.mp4');
for(let i=0;i<tiles.length;i++){
  const pixels=new Uint8Array(tw*th),col=i%cols,row=Math.floor(i/cols),cw=Math.min(tw,w-col*tw),hh=Math.min(th,h-row*th);
  for(let y=0;y<hh;y++)pixels.set(converted.samples.subarray((row*th+y)*w+col*tw,(row*th+y)*w+col*tw+cw),y*tw);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1',
    '-f','rawvideo','-pix_fmt','gray','-s',`${tw}x${th}`,'-r','1','-i','pipe:0','-frames:v','1','-an',
    '-c:v','libx265','-preset','ultrafast','-pix_fmt','gray','-color_primaries','unspecified','-color_trc','unspecified',
    '-colorspace','unspecified','-color_range','pc','-tag:v','hvc1','-map_metadata','-1',
    '-x265-params','lossless=1:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1:log-level=error',work],
    {input:pixels,maxBuffer:32*1024*1024,windowsHide:true});
  const encoded=extractEncodedHevc(new Uint8Array(await fs.readFile(work))),sps=hevcSpsColor(encoded.record);
  assert.equal(sps.chroma,0);assert.equal(sps.luma,8);assert.equal(sps.fullRange,true);
  const hvcc=intern(encoded.hvcc);meta=setItemPropertyAssociations(meta,tiles[i],[[geometry,false],[pixel,false],[hvcc,true]]);
  payloads.set(tiles[i],encoded.payload);
  if((i+1)%10===0)console.error('Apple fallback tiles',i+1+'/'+tiles.length);
}
await fs.rm(work);
const output=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),meta,payloads),d=discoverHeic(output);
assert.equal(d.hdrGrid,apple);assert.equal(auxUriForItem(d.props,iso),null);assert.equal(auxUriForItem(d.props,apple),URI_HDR_GAIN);
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===tmap).to,[a.primary,iso]);
for(const id of a.infos.keys())if(id!==side)assert.deepEqual(read(output,d,id),read(base,a,id),'every accepted original payload exact '+id);
const checked=await executeJob({operation:'read',file:new Blob([output])});assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outputFile,output,{flag:'wx'});
const report={file:path.resolve(outputFile),bytes:output.length,sha256:hash(output),source:path.basename(sourceFile),base:path.basename(baseFile),
  numericalMetrics:metrics,isoInput:iso,appleAuxiliary:apple,appleVersion:65536,tmap,allPriorNonHdrXmpPayloadsExact:true,
  sourceIsoEquationAndPixelsExact:true,styleAndTextureResourcesExact:true,primaryProfileExact:true,
  compatibility:checked.compatibility?.status,productionEnabled:false,deviceValidation:'pending',
  limitation:'Diagnostic only. Photos may select another reader. A one-channel Apple map cannot exactly reproduce RGB ISO offsets; clipping and numeric error are reported. Two HDR planes need explicit production support before adoption.'};
await fs.writeFile(outputFile+'.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
