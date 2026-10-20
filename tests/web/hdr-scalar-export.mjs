import test from 'node:test';
import assert from 'node:assert/strict';
import {rebaseRgbHdrPair,linearGrayColr} from '../../web/src/raster/hdr-scalar-pair.js';
import {srgbToLinear} from '../../web/src/raster/jpeg-hdr.js';
import fs from 'node:fs';
import {makeRgbHdrEditable,compactRgbHdrMdat} from '../../web/src/raster/hdr-scalar-export.js';
import {buildGeneratedProfile} from '../../web/src/raster/generated-profile.js';
import {generateSyntheticHevc} from '../../web/src/raster/synthetic-hevc.js';
import {buildRasterHeic,targetGeometry} from '../../web/src/raster/raster-import.js';
import {discoverHeic,extractItemData,propertyBoxBytes,dimensionsForItem} from '../../web/src/raster/heif.js';
import {parseTmapMetadata} from '../../web/src/raster/jpeg-hdr.js';
import {buildAiPortrait} from '../../web/src/portrait/ai-portrait-export.js';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {hasTexture} from '../../web/src/styles/texture.js';
import {boxes,box,concat,be,topBox} from '../../web/src/core/box.js';
import {parseIloc} from '../../web/src/core/heif.js';

function unusedMdat(bytes,d=discoverHeic(bytes)){
 const ranges=[...d.iloc.items.values()].filter(i=>i.constructionMethod===0)
  .flatMap(i=>i.extents.map(e=>[i.baseOffset+e.offset,i.baseOffset+e.offset+e.length])).sort((a,b)=>a[0]-b[0]);
 let used=0,end=-1;
 for(const [a,b]of ranges){used+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 return [...boxes(bytes,0,bytes.length)].filter(b=>b.type==='mdat').reduce((n,b)=>n+b.size-b.hdr,0)-used;
}

test('mdat packing preserves shared/overlapping/multiple extents and idat while removing only gaps',()=>{
 const ftyp=box('ftyp',new Uint8Array(8)),first=box('mdat',Uint8Array.of(90,1,2,3,4,91)),second=box('mdat',Uint8Array.of(92,5,6,93));
 const item=(id,method,extents)=>concat([be(id,2),be(method,2),be(0,2),be(extents.length,2),
  ...extents.map(([offset,length])=>concat([be(offset,4),be(length,4)]))]);
 const makeMeta=(a,b)=>box('meta',concat([be(0,4),box('iloc',concat([Uint8Array.of(1,0,0,0,0x44,0),be(4,2),
  item(1,0,[[a,3],[b,2]]),item(2,0,[[a+1,3]]),item(3,0,[[a,3]]),item(4,1,[[1,2]])])),
  box('idat',Uint8Array.of(9,8,7,6)),box('free',Uint8Array.of(55,66))]));
 const meta=makeMeta(0,0),a=ftyp.length+meta.length+9,b=ftyp.length+meta.length+first.length+9;
 const source=concat([ftyp,makeMeta(a,b),first,second]),saved=source.slice(),out=compactRgbHdrMdat(source);
 const old=parseIloc(source,topBox(source,'meta')),packed=parseIloc(out,topBox(out,'meta'));
 assert.deepEqual(source,saved);assert.equal(source.length-out.length,12); // four gap bytes + one mdat header
 assert.deepEqual([...boxes(out,0,out.length)].map(b=>b.type),['ftyp','meta','mdat']);
 for(const [id,it]of old.items){
  const now=packed.items.get(id);assert.equal(now.constructionMethod,it.constructionMethod);
  if(it.constructionMethod===1)assert.deepEqual(now.extents,it.extents);
  else for(let n=0;n<it.extents.length;n++){
   const e=it.extents[n],p=now.extents[n];assert.equal(p.length,e.length);
   assert.deepEqual(out.slice(p.offset,p.offset+p.length),source.slice(e.offset,e.offset+e.length));
  }
 }
 assert.equal(packed.items.get(1).extents[0].offset,packed.items.get(3).extents[0].offset,'shared storage stays shared');
 const oldMeta=source.slice(ftyp.length,ftyp.length+meta.length),newMeta=out.slice(ftyp.length,ftyp.length+meta.length);
 for(const it of old.items.values())if(it.constructionMethod===0)for(const e of it.extents){
  oldMeta.fill(0,e.offsetPos-ftyp.length,e.offsetPos-ftyp.length+4);
  newMeta.fill(0,e.offsetPos-ftyp.length,e.offsetPos-ftyp.length+4);
 }
 assert.deepEqual(newMeta,oldMeta,'every metadata byte except relocated offsets stays identical');
 assert.deepEqual(compactRgbHdrMdat(out),out,'packing is byte-idempotent');
 const invalid=source.slice();invalid.set(be(1,4),old.items.get(1).extents[0].offsetPos);
 assert.throws(()=>compactRgbHdrMdat(invalid),/not local mdat/);
 assert.throws(()=>compactRgbHdrMdat(concat([source,box('free',new Uint8Array())])),/layout/);
 const external=source.slice();external[old.items.get(1).extents[0].offsetPos-3]=1;
 assert.throws(()=>compactRgbHdrMdat(external),/not local mdat/);
});

const acceptedExport=new URL('../private-fixtures/indigo-color-2024/Production_Scalar_Styles.HEIC',import.meta.url);
test('accepted app export loses only orphan bytes; all active and inactive items and metadata remain identical',{
 skip:!fs.existsSync(acceptedExport),
},()=>{
 const source=new Uint8Array(fs.readFileSync(acceptedExport)),d=discoverHeic(source),out=compactRgbHdrMdat(source),packed=discoverHeic(out);
 assert.equal(unusedMdat(out,packed),0);assert.ok(out.length<source.length);
 assert.deepEqual(packed.refs,d.refs);assert.deepEqual(packed.infos,d.infos);
 for(const id of d.iloc.items.keys())assert.deepEqual(extractItemData(out,packed,id),extractItemData(source,d,id),`item ${id}`);
 const oldMeta=source.slice(d.meta.off,d.meta.off+d.meta.size),newMeta=out.slice(packed.meta.off,packed.meta.off+packed.meta.size);
 for(const it of d.iloc.items.values())if(it.constructionMethod===0)for(const e of it.extents){
  oldMeta.fill(0,e.offsetPos-d.meta.off,e.offsetPos-d.meta.off+4);
  newMeta.fill(0,e.offsetPos-d.meta.off,e.offsetPos-d.meta.off+4);
 }
 assert.deepEqual(newMeta,oldMeta,'including ICC, tmap, Styles and unknown private metadata');
 assert.equal(source.length-out.length,unusedMdat(source,d)+8*([...boxes(source,0,source.length)].filter(b=>b.type==='mdat').length-1));
 assert.deepEqual(compactRgbHdrMdat(out),out);
});

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
 assert.equal(unusedMdat(out.data,d),0,'fresh scalar export must not retain replaced image/thumbnail bytes');
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
