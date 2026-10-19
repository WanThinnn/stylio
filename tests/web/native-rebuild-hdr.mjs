import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeStyleExport} from './helpers/native-style-export.mjs';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {loadProfile} from '../../web/src/core/zip.js';
import {box} from '../../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,ispeBox} from '../../web/src/core/heif.js';
import {extractAppleMakerNoteTag} from '../../web/src/core/exif.js';
import {editableTmapHeadroom,registerTmapHdr} from '../../web/src/styles/hdr-compatibility.js';

const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
const asset=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url))).assets.delta;
const linearThumb={sample:Uint8Array.from(asset.payload),hvcC:Uint8Array.from(asset.hvcc),
  ispe:ispeBox(asset.width,asset.height),pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const hdrDescriptions=(bytes,d)=>d.refs.filter(ref=>ref.type==='cdsc'&&ref.to.includes(d.hdrGrid)
  &&d.infos.get(ref.from)?.type==='mime').map(ref=>new TextDecoder().decode(read(bytes,d,ref.from)))
  .filter(xml=>xml.includes('http://ns.apple.com/HDRGainMap/1.0/'));

test('actual patch worker declares source headroom after Current-export graph reconstruction for every selected Style',async()=>{
  for(const preset of [1,4,8,16]){
    const source=await nativeStyleExport({preset,tone:.2,color:-.1,palette:.8}),a=discoverHeic(source);
    const result=await executeJob({operation:'patch',data:source,profile,opts:{
      experimental:true,linearThumb,sceneStats:'donor',lightMaps:'donor',texture:true,
    }});
    const data=result.data,d=discoverHeic(data),xml=hdrDescriptions(data,d);
    assert.equal(xml.length,1,'one HDR editor declaration for preset '+preset);
    assert.ok(xml[0].includes(`<HDRGainMap:HDRGainMapHeadroom>${editableTmapHeadroom(source,a).toFixed(9)}</HDRGainMap:HDRGainMapHeadroom>`));
    for(const id of [a.primary,...a.primaryTiles,a.hdrGrid,...a.hdrTiles,
      ...[...a.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id)])
      assert.deepEqual(read(data,d,id),read(source,a,id),'source image/HDR payload '+id);
    assert.deepEqual(extractAppleMakerNoteTag(read(data,d,d.exifItem)),
      extractAppleMakerNoteTag(read(source,a,a.exifItem)),'Style controls preserved');
    assert.equal(registerTmapHdr(data,{headroom:true}),null,'editor declaration is idempotent');
  }
});

test('HDR editor declaration is added even when a prior output already has the gain-map aux role',async()=>{
  const source=await nativeStyleExport(),a=discoverHeic(source);
  const routed=registerTmapHdr(source),b=discoverHeic(routed);
  assert.equal(hdrDescriptions(routed,b).length,0);
  const data=registerTmapHdr(routed,{headroom:true}),d=discoverHeic(data);
  assert.equal(hdrDescriptions(data,d).length,1);
  for(const id of b.infos.keys())assert.deepEqual(read(data,d,id),read(routed,b,id));
  assert.equal(editableTmapHeadroom(data,d),editableTmapHeadroom(source,a));
  assert.equal(registerTmapHdr(data,{headroom:true}),null);
});

test('native Portrait rebuild with the real source selection receives the editor HDR declaration',async()=>{
  const source=await nativeStyleExport({preset:16,tone:-.5,color:.5,modernMarker:true});
  const a=discoverHeic(source);
  const {data}=await executeJob({operation:'patch',data:source,profile,opts:{
    experimental:true,linearThumb,texture:true,portraitStyleRebuild:true,
  }});
  const d=discoverHeic(data);
  assert.equal(hdrDescriptions(data,d).length,1);
  assert.deepEqual(extractAppleMakerNoteTag(read(data,d,d.exifItem)),
    extractAppleMakerNoteTag(read(source,a,a.exifItem)));
});
