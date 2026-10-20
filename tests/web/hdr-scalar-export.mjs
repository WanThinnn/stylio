import test from 'node:test';
import assert from 'node:assert/strict';
import {rebaseRgbHdrPair,linearGrayColr} from '../../web/src/raster/hdr-scalar-pair.js';
import {srgbToLinear} from '../../web/src/raster/jpeg-hdr.js';
import fs from 'node:fs';
import {makeRgbHdrEditable} from '../../web/src/raster/hdr-scalar-export.js';
import {buildGeneratedProfile} from '../../web/src/raster/generated-profile.js';
import {generateSyntheticHevc} from '../../web/src/raster/synthetic-hevc.js';
import {buildRasterHeic,targetGeometry} from '../../web/src/raster/raster-import.js';
import {discoverHeic,extractItemData,propertyBoxBytes,dimensionsForItem} from '../../web/src/raster/heif.js';
import {parseTmapMetadata} from '../../web/src/raster/jpeg-hdr.js';
import {buildAiPortrait} from '../../web/src/portrait/ai-portrait-export.js';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {hasTexture} from '../../web/src/styles/texture.js';

test('scalar export keeps chromatic HDR by solving a new base, rather than just averaging gain',async()=>{
 const base=Uint8Array.of(40,80,120,60,90,130),gain=Uint8Array.of(240,110,20),saved=base.slice();
 const result=await rebaseRgbHdrPair(base,gain,{width:2,height:1,gainWidth:1,gainHeight:1,headroom:8});
 assert.notDeepEqual(result.base,base);assert.deepEqual(base,saved);assert.equal(result.gain.length,2);
 let wrong=0;
 for(let p=0;p<2;p++)for(let c=0;c<3;c++){
  const target=srgbToLinear(base[p*3+c]/255)*8**(gain[c]/255),factor=8**(result.gain[p]/255);
  const correct=srgbToLinear(result.base[p*3+c]/255)*factor;
  wrong+=Math.abs(srgbToLinear(base[p*3+c]/255)*factor-target);
  assert.ok(Math.abs(correct-target)<.015);
 }
 assert.ok(wrong>.05,'the old scalar-only substitution is a failing control');
 assert.equal(result.metadata.channels.length,1);assert.equal(result.metadata.channels[0].max,3);
 assert.equal(result.metrics.sdrPixelsChanged,true);
});
test('shared channel gain keeps neutral colour, black, dimensions and source gain immutable',async()=>{
 const base=Uint8Array.of(0,0,0,50,100,150),gain=Uint8Array.of(128,128,128),saved=gain.slice();
 const output=await rebaseRgbHdrPair(base,gain,{width:2,height:1,gainWidth:1,gainHeight:1,headroom:4});
 assert.deepEqual(output.base.slice(0,3),Uint8Array.of(0,0,0));
 for(let c=0;c<3;c++)assert.ok(Math.abs(output.base[3+c]-base[3+c])<=1);
 assert.deepEqual(gain,saved);assert.ok(output.metrics.maxFloatError<1e-12);
 await assert.rejects(rebaseRgbHdrPair(base,gain,{width:3,height:1,gainWidth:1,gainHeight:1,headroom:4}));
 await assert.rejects(rebaseRgbHdrPair(base,gain,{width:2,height:1,gainWidth:1,gainHeight:1,headroom:NaN}));
});
test('gain ICC declares a generated D50 linear gray transform, not a photo profile',()=>{
 const colr=linearGrayColr(),profile=colr.slice(12),view=new DataView(profile.buffer,profile.byteOffset,profile.length),s=(at,n)=>new TextDecoder().decode(profile.slice(at,at+n));
 assert.equal(s(16,4),'GRAY');assert.equal(s(36,4),'acsp');assert.equal(view.getUint32(0),profile.length);
 const tags=new Map();for(let i=0;i<view.getUint32(128);i++){const p=132+i*12;tags.set(s(p,4),view.getUint32(p+4));}
 const curve=tags.get('kTRC');assert.equal(s(curve,4),'para');assert.equal(view.getInt32(curve+12),65536);
 assert.equal(s(tags.get('wtpt'),4),'XYZ ');
});

const acceptedCache=new URL('../private-fixtures/indigo-color-2024/scalar-pair/',import.meta.url);
test('production solver reproduces the device-accepted Color 9 base and gain samples exactly',{
 skip:!fs.existsSync(new URL('new-base.rgb',acceptedCache)),
},async()=>{
 const read=name=>new Uint8Array(fs.readFileSync(new URL(name,acceptedCache)));
 const output=await rebaseRgbHdrPair(read('base.rgb'),read('gain.rgb'),{
  width:4032,height:3024,gainWidth:2016,gainHeight:1512,headroom:9.562501043,primaries:'smpte432'});
 assert.equal(Buffer.compare(output.base,read('new-base.rgb')),0,'every corrected base sample matches Color 9');
 assert.equal(Buffer.compare(output.gain,read('new-gain.gray')),0,'every full-resolution gray gain sample matches Color 9');
});

test('actual raster assembly -> scalar export -> Portrait/Texture shares a full-resolution HDR gain without losing controls',async()=>{
 const f=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url)));
 const assets=await generateSyntheticHevc(null,async(_,o)=>{const a=o.pixelFormat!=='gray'?f.assets.delta:o.width===768?f.assets.textureMask:f.assets.mask;
  return {...a,hvcc:Uint8Array.from(a.hvcc),payload:Uint8Array.from(a.payload)};});
 const profile=buildGeneratedProfile('48-12',assets),pd=discoverHeic(profile.meta),geometry={...targetGeometry({width:900,height:600}),exifOrientation:1};
 const codec=propertyBoxBytes(profile.meta,pd.props,pd.primaryTiles[0],'hvcC'),count=geometry.hdrColumns*geometry.hdrRows;
 const source=buildRasterHeic(profile,{main:Array.from({length:geometry.primaryTiles},()=>Uint8Array.of(1)),mainHvcc:codec,
  thumb:Uint8Array.of(2),thumbHvcc:codec,hdrChunks:Array.from({length:count},()=>Uint8Array.of(3)),hdrHvcc:codec,
  hdrXmp:new TextEncoder().encode('<original-gain/>'),hdrMetadata:{baseHeadroom:0,alternateHeadroom:2,useBaseColorSpace:true,
   channels:Array.from({length:3},()=>({min:0,max:2,gamma:1,baseOffset:0,alternateOffset:0}))},
  hdrAlternateColr:propertyBoxBytes(profile.meta,pd.props,pd.primary,'colr'),
  appleHdrChunks:Array.from({length:count},()=>Uint8Array.of(4)),appleHdrHvcc:codec,appleHdrHeadroom:4,texture:false},null,null,geometry);
 const saved=source.slice(),before=discoverHeic(source);let encoded=0,released=0;
 const media={
  releaseHevcEncoder(){released++;},
  async decodeHevcYuv(record,payload,{width,height}){const y=new Uint8Array(width*height*1.5);y.fill(128);y.fill(payload[0]===1?70:150,0,width*height);return y;},
  async convertHdrPixels(p,{width,height,from,to,outWidth=width,outHeight=height}){
   const n=outWidth*outHeight;if(to==='yuv420p'){const y=new Uint8Array(n*1.5);y.fill(128);y.fill(p[0],0,n);return y;}
   const channels=to==='rgba'?4:3,out=new Uint8Array(n*channels);out.fill(p[0]);if(channels===4)for(let i=3;i<out.length;i+=4)out[i]=255;return out;
  },
  async encodeHevcPixels(){encoded++;return {hvcc:codec,payload:Uint8Array.of(5,encoded)};},
 };
 const out=await makeRgbHdrEditable(source,{headroom:4,primaries:'smpte432'},null,media),d=discoverHeic(out.data);
 assert.ok(released>=3,'codec heap is released between decoding, paired encoding and thumbnails');
 assert.deepEqual(source,saved);assert.equal(d.primary,before.primary);assert.equal(d.stylesItem,before.stylesItem);
 const t=[...d.infos].find(([,i])=>i.type==='tmap')[0];
 assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===t).to,[d.primary,d.hdrGrid]);
 assert.deepEqual(dimensionsForItem(d.props,d.hdrGrid),dimensionsForItem(d.props,d.primary));
 assert.equal(d.hdrTiles.length,d.primaryTiles.length);assert.equal(parseTmapMetadata(extractItemData(out.data,d,t)).channels.length,1);
 assert.deepEqual(extractItemData(out.data,d,d.stylesItem),extractItemData(source,before,before.stylesItem));
 const repeat=await makeRgbHdrEditable(out.data,{headroom:4,primaries:'smpte432'},null,{...media,encodeHevcPixels(){throw Error('must not repeat');}});
 assert.equal(repeat.data,out.data);assert.equal(repeat.metrics.alreadyScalar,true);
 const template=JSON.parse(fs.readFileSync(new URL('../../web/src/portrait/portrait-template.json',import.meta.url)));
 const portrait=buildAiPortrait(out.data,{payload:assets.mask.payload,hvcc:assets.mask.hvcc,width:64,height:64},template).data;
 for(const b of [out.data,portrait]){
  const result=await executeJob({operation:hasTexture(discoverHeic(b).infos)?'repair-texture':'texture',data:b,opts:{preserveStyles:true}}),bytes=result.data||b,g=discoverHeic(bytes);
  const map=[...g.infos].find(([,i])=>i.type==='tmap')[0];assert.equal(g.refs.find(r=>r.type==='dimg'&&r.from===map).to[1],g.hdrGrid);
  assert.ok(g.stylesItem!==null&&g.linearThumb!==null&&g.deltaGrid!==null);
  g.hdrTiles.forEach((id,i)=>assert.deepEqual(extractItemData(bytes,g,id),extractItemData(out.data,d,d.hdrTiles[i])));
 }
});
