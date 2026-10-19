import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeStyleExport} from './helpers/native-style-export.mjs';
import {patch} from '../../web/src/styles/port.js';
import {loadProfile} from '../../web/src/core/zip.js';
import {box} from '../../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,ispeBox,auxUriForItem,URI_HDR_GAIN,URI_LINEAR_THUMB,propertyBoxBytes} from '../../web/src/core/heif.js';
import {extractAppleMakerNoteTag,listExifMetadataEntries,listAppleMakerNoteTags} from '../../web/src/core/exif.js';
import {hasTexture} from '../../web/src/styles/texture.js';
import {editableTmapHeadroom,registerTmapHdr} from '../../web/src/styles/hdr-compatibility.js';

const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
const asset=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url))).assets.delta;
export const thumbnail={sample:Uint8Array.from(asset.payload),hvcC:Uint8Array.from(asset.hvcc),
  ispe:ispeBox(asset.width,asset.height),pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
const decode=async(_data,{width,height})=>new Uint8Array(width*height*3).fill(130);
// Reproduce experiment E. These assertions protect file data, not Apple's
// colour rendering: the user reports different colours at extreme adjustments.
const rebuild=async source=>{
  const result=await patch(source,profile,{experimental:true,linearThumb:thumbnail,
    decode,sceneStats:'target',lightMaps:'target',texture:true});
  result.data=registerTmapHdr(result.data,{headroom:true})||result.data;
  return result;
};

export function assertRebuilt(source,data){
  const a=discoverHeic(source),b=discoverHeic(data);
  assert.notEqual(b.stylesItem,null);assert.notEqual(b.linearThumb,null);assert.notEqual(b.deltaGrid,null);
  assert.equal(hasTexture(b.infos),true);assert.equal(b.primary,a.primary);assert.equal(b.hdrGrid,a.hdrGrid);
  const exif=(bytes,d)=>extractItem(bytes,d.iloc,d.exifItem);
  assert.deepEqual(extractAppleMakerNoteTag(exif(data,b)),extractAppleMakerNoteTag(exif(source,a)),'selected Style marker');
  assert.deepEqual(listExifMetadataEntries(exif(data,b)),listExifMetadataEntries(exif(source,a)),'capture metadata');
  assert.deepEqual(listAppleMakerNoteTags(exif(data,b)),listAppleMakerNoteTags(exif(source,a)),'MakerNotes');
  for(const [id,item]of a.iloc.items){
    if(id===a.exifItem)continue;
    const read=(bytes,d)=>item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
    assert.deepEqual(read(data,b),read(source,a),'source payload '+id);
    const properties=(bytes,d)=>(d.props.associations.get(id)||[]).map(ref=>{
      const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
    });
    const actual=properties(data,b),expected=properties(source,a);
    assert.deepEqual(id===a.hdrGrid?actual.slice(0,expected.length):actual,expected,'source properties '+id);
    const refs=d=>d.refs.filter(r=>r.from===id&&(id!==a.hdrGrid||r.type!=='auxl'));
    assert.deepEqual(refs(b),refs(a),'source references '+id);
  }
  assert.deepEqual(propertyBoxBytes(data,b.props,b.primary,'colr'),propertyBoxBytes(source,a.props,a.primary,'colr'));
  assert.equal(auxUriForItem(b.props,b.hdrGrid),URI_HDR_GAIN);
  assert.ok(b.refs.some(r=>r.type==='auxl'&&r.from===b.hdrGrid&&r.to.includes(b.primary)));
  const xmp=b.refs.filter(r=>r.type==='cdsc'&&r.to.includes(b.hdrGrid))
    .map(r=>new TextDecoder().decode(extractItem(data,b.iloc,r.from)))
    .filter(s=>s.includes('http://ns.apple.com/HDRGainMap/1.0/'));
  assert.equal(xmp.length,1,'one HDR rendering declaration');
  assert.ok(xmp[0].includes('<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>'));
  assert.ok(xmp[0].includes(`<HDRGainMap:HDRGainMapHeadroom>${editableTmapHeadroom(source,a).toFixed(9)}</HDRGainMap:HDRGainMapHeadroom>`),'source HDR headroom');
}

test('ISO HDR rebuild refuses an ordinary SDR thumbnail when linearThumb is missing',async()=>{
  const source=await nativeStyleExport({preset:4});
  const d=discoverHeic(source);
  assert.notEqual(d.thumbnail,null);assert.equal(d.linearThumb,null);
  await assert.rejects(
    patch(source,profile,{experimental:true,decode,sceneStats:'target',lightMaps:'target',texture:true})
  );
});

test('graft prefers a real source linearThumb over the ordinary SDR thumbnail',async()=>{
  const source=await nativeStyleExport({retainLinearThumb:true,preset:8,tone:.25,color:-.25});
  const before=discoverHeic(source);
  assert.notEqual(before.thumbnail,null);assert.notEqual(before.linearThumb,null);
  const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
    ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
  const sourceLinear=read(source,before,before.linearThumb),sourceThumb=read(source,before,before.thumbnail);
  assert.notDeepEqual(sourceLinear,sourceThumb,'fixture must distinguish linear and ordinary thumbnail payloads');
  const {data}=await patch(source,profile,{experimental:true,decode,sceneStats:'target',lightMaps:'target',texture:true});
  const after=discoverHeic(data);
  const linearIds=[...after.infos.keys()].filter(id=>auxUriForItem(after.props,id)===URI_LINEAR_THUMB);
  assert.ok(linearIds.length>=2,'source + grafted linear resources expected');
  const copied=linearIds.filter(id=>id!==before.linearThumb).map(id=>read(data,after,id));
  assert.ok(copied.some(bytes=>Buffer.from(bytes).equals(Buffer.from(sourceLinear))),
    'grafted linear resource must copy source linearThumb');
  assert.ok(!copied.some(bytes=>Buffer.from(bytes).equals(Buffer.from(sourceThumb))),
    'ordinary SDR thumbnail must not be used as Styles linear resource');
});

test('research E preserves selection/pixels and declares source HDR; colour parity remains unproven',async()=>{
  for(const preset of [1,4,8,16]){
    const source=await nativeStyleExport({preset,tone:.2,color:-.1,palette:.8}),saved=source.slice();
    const {data,report}=await rebuild(source);
    assertRebuilt(source,data);assert.deepEqual(source,saved);
    assert.equal(report.decoded,true);assert.ok(report.lightMaps);
  }
});
