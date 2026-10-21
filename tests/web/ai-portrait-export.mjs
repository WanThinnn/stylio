import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAiPortrait,restoreNativePortrait} from '../../web/src/portrait/ai-portrait-export.js';
import {portraitEligibility,attachAiDepth,nativePortraitBaseState} from '../../web/src/portrait/ai-portrait-container.js';
import {buildRasterHeic,targetGeometry} from '../../web/src/raster/raster-import.js';
import {generateSyntheticHevc} from '../../web/src/raster/synthetic-hevc.js';
import {buildGeneratedProfile} from '../../web/src/raster/generated-profile.js';
import {discoverHeic,extractItemData,propertyBoxBytes,auxUriForItem,DEPTH_URI,dimensionsForItem,itemOrientation,appendIpcoProperty,setItemPropertyAssociations,removeItems,addItems,replaceItemPropertyWithSource} from '../../web/src/raster/heif.js';
import {hasTexture} from '../../web/src/raster/texture.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag,exifCameraModel,getMakerNoteBlob,listAppleMakerNoteTags} from '../../web/src/core/exif.js';
import {parseBplist,buildBplist,BplistReal} from '../../web/src/core/bplist.js';
import {rebuildHeic} from '../../web/src/styles/graft.js';
import {topBox,concat,be,box} from '../../web/src/core/box.js';
import {buildAppleStyleExif} from '../../web/src/raster/exif.js';
import {styleCapabilities} from '../../web/src/styles/style-capabilities.js';
import {photoContentIdentifier} from '../../web/src/media/live-photo.js';
import {patch} from '../../web/src/styles/port.js';
import {discoverHeic as discoverCoreHeic} from '../../web/src/core/heif.js';
import {describeHeic} from '../../web/src/ui/result-metadata.js';
import {tmapGainMap} from '../../web/src/core/gain-map.js';
import {encodeTmapMetadata,parseTmapMetadata} from '../../web/src/raster/jpeg-hdr.js';
import {registerTmapHdr,editableTmapHeadroom,normalizeAppleLegacyGainSamples,
  normalizeLegacyPortraitHdrGain,promoteLegacyPortraitHdr} from '../../web/src/styles/hdr-compatibility.js';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {appleDepthAuxc,readAppleDepthRange} from '../../web/src/portrait/apple-depth-metadata.js';
import {matchPortraitHdrCapacity,portraitSourceHeadroom} from '../../web/src/portrait/portrait-hdr-calibration.js';
import {describePortraitScene} from '../../web/src/portrait/portrait-scene-response.js';
const template=JSON.parse(fs.readFileSync(new URL('../../web/src/portrait/portrait-template.json',import.meta.url)));
const fixture=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url)));
const assets=await generateSyntheticHevc(null,async(_,o)=>{
  const a=o.pixelFormat!=='gray'?fixture.assets.delta:o.width===768?fixture.assets.textureMask:fixture.assets.mask;
  return {...a,hvcc:Uint8Array.from(a.hvcc),payload:Uint8Array.from(a.payload)};
});
// Graph reconstruction now requires a real encoded linear resource explicitly.
// These tests exercise graph/state preservation, so use a portable HEVC fixture
// instead of invoking the browser's HDR-aware image decoder/encoder.
const testLinearThumb={sample:Uint8Array.from(fixture.assets.delta.payload),
  hvcC:Uint8Array.from(fixture.assets.delta.hvcc),
  ispe:box('ispe',concat([new Uint8Array(4),be(fixture.assets.delta.width,4),be(fixture.assets.delta.height,4)])),
  pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
function photo(width,height,name='48-12'){
  const p=buildGeneratedProfile(name,assets),d=discoverHeic(p.meta),g=targetGeometry({width,height});
  const codec=propertyBoxBytes(p.meta,d.props,d.primaryTiles[0],'hvcC'),payload=Uint8Array.of(0,0,0,4,38,1,0,0);
  if(name==='45-15'){
    // Independent large native-layout fixture, not the raster 48/12 importer.
    const values=new Map(p.retained),chunks=[];
    for(const id of [...d.primaryTiles,...p.manifest.donor_hdr_tiles,d.thumbnail,d.linearThumb])values.set(id,payload);
    values.set(d.exifItem,buildAppleStyleExif(p.mn54));
    let cursor=p.ftyp.length+p.meta.length+8;
    for(const [id,item]of d.iloc.items){if(item.constructionMethod===1)continue;
      const value=values.get(id);p.meta.set(be(cursor,4),item.extents[0].offsetPos);p.meta.set(be(value.length,4),item.extents[0].lengthPos);
      cursor+=value.length;chunks.push(value);
    }
    return concat([p.ftyp,p.meta,box('mdat',concat(chunks))]);
  }
  return buildRasterHeic(p,{main:Array(g.primaryTiles).fill(payload),mainHvcc:codec,
    thumb:payload,thumbHvcc:codec,hdr:payload,hdrHvcc:codec},null,null,g);
}
const depth={payload:assets.mask.payload,hvcc:assets.mask.hvcc,width:64,height:64};

test('AI Portrait geometry follows its stored source grid instead of the reference camera lens',()=>{
  for(const [iw,ih]of [[900,600],[3024,4032],[1200,1200]]){
    const source=photo(iw,ih),before=discoverHeic(source),[w,h]=dimensionsForItem(before.props,before.primary);
    const output=buildAiPortrait(source,depth,template),d=discoverHeic(output.data);
    const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
    const side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)).from;
    const xmp=new TextDecoder().decode(extractItemData(output.data,d,side));
    assert.match(xmp,new RegExp('IntrinsicMatrixReferenceWidth>'+w+'<'));
    assert.match(xmp,new RegExp('IntrinsicMatrixReferenceHeight>'+h+'<'));
    const seq=name=>[...xmp.match(new RegExp('<depthData:'+name+'>([\\s\\S]+?)</depthData:'+name+'>'))[1].matchAll(/<rdf:li>([^<]+)</g)].map(m=>Number(m[1]));
    assert.deepEqual(seq('LensDistortionCoefficients'),Array(8).fill(0),'AI samples already align with decoded source pixels, not the donor lens');
    assert.deepEqual(seq('InverseLensDistortionCoefficients'),Array(8).fill(0));
    const matrix=seq('IntrinsicMatrix');
    assert.equal(matrix[6],(w-1)/2);assert.equal(matrix[7],(h-1)/2);
    assert.match(xmp,/<depthData:Quality>high<\/depthData:Quality>/,'keep the device-accepted Photos aperture eligibility declaration');
    assert.equal(output.report.referenceCalibration,false);
    assert.equal(output.report.geometry,'relative-image-grid');
  }
});

test('Portrait HDR metadata update preserves all renderer fields outside the native capacity vector',()=>{
  const source=template.depthXmp,changed=matchPortraitHdrCapacity(source,3.472317);
  const render=xmp=>Buffer.from(/<depthBlurEffect:RenderingParameters>([^<]+)/.exec(xmp)[1],'base64');
  const before=render(source),after=render(changed);
  assert.equal(source.replace(/(<depthBlurEffect:RenderingParameters>)[^<]+/,'$1'),changed.replace(/(<depthBlurEffect:RenderingParameters>)[^<]+/,'$1'));
  assert.deepEqual(before.subarray(0,16),after.subarray(0,16));
  for(let p=16;p<before.length;p+=8){
    const id=before.readUInt16LE(p);
    assert.deepEqual(before.subarray(p,p+4),after.subarray(p,p+4));
    if(![450,451,452,453].includes(id))assert.deepEqual(before.subarray(p,p+8),after.subarray(p,p+8),'unrelated renderer field '+id);
    if(id===453)assert.ok(Math.abs(after.readFloatLE(p+4)-3.472317)<1e-6);
  }
  assert.equal(matchPortraitHdrCapacity(changed,3.472317),changed);
  assert.equal(matchPortraitHdrCapacity(source,null),source);
  assert.throws(()=>matchPortraitHdrCapacity(source,NaN),/Invalid/);
  const corrupt=Buffer.from(before);corrupt.writeUInt32LE(99,4);
  assert.throws(()=>matchPortraitHdrCapacity(source.replace(before.toString('base64'),corrupt.toString('base64')),3),/Unsupported/);
});

const nativeBokehControl=new URL('../private-fixtures/bokeh-highlight-error/IMG_0953_native_org.HEIC',import.meta.url);
test('native camera Portrait capacity already matches its own HDR declaration and stays byte-identical',{
  skip:!fs.existsSync(nativeBokehControl),
},()=>{
  const b=new Uint8Array(fs.readFileSync(nativeBokehControl)),d=discoverHeic(b);
  const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
  const side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)).from;
  const xmp=new TextDecoder().decode(extractItemData(b,d,side));
  assert.equal(matchPortraitHdrCapacity(xmp,portraitSourceHeadroom(b,d)),xmp);
});

test('optional Portrait preserves source HDR capture calibration outside its feature flags',()=>{
  const base=withCamera(photo(900,600),'iPhone 16 Pro'),d=discoverHeic(base),ft=topBox(base,'ftyp');
  let exif=extractItemData(base,d,d.exifItem);
  exif=injectAppleMakerNoteTag(exif,be(17,4),1,9);
  const mn=getMakerNoteBlob(exif),view=new DataView(mn.buffer,mn.byteOffset,mn.byteLength),little=mn[12]===73;
  for(let n=0;n<view.getUint16(14,little);n++){const p=16+n*12;if(view.getUint16(p,little)===1)view.setUint32(p+4,1,little);}
  const calibration=new Map([[0x2,Uint8Array.of(71,91,23,12)],
    [0x4e,buildBplist(new Map([['capture-statistic',new BplistReal(.4123)]]))],
    [0x5a,buildBplist(new Map([['0',1],['1',new BplistReal(.034)],['4',new BplistReal(.79)]]))],
    [0x123,Uint8Array.of(19,17,11,3)]]);
  for(const [id,payload]of calibration)exif=injectAppleMakerNoteTag(exif,payload,id,7);
  const sourceHeadroom=3.472317;
  let meta=base.slice(d.meta.off,d.meta.off+d.meta.size),side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(d.hdrGrid)&&d.infos.get(r.from)?.type==='mime')?.from;
  if(side===undefined){let ids;[meta,ids]=addItems(meta,[{key:'hdr-source',itemType:'mime',contentType:'application/rdf+xml',refType:'cdsc',refTo:[d.hdrGrid]}]);side=ids.get('hdr-source');}
  const source=rebuildHeic(base,d,base.slice(0,ft.size),meta,new Map([[d.exifItem,exif],
    [side,new TextEncoder().encode(`<HDRGainMap:HDRGainMapHeadroom>${sourceHeadroom}</HDRGainMap:HDRGainMapHeadroom>`)]]));
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.equal(after.primary,d.primary,'native primary ID stays in its own graph');
  const before=discoverHeic(source);
  for(const id of before.infos.keys())if(id!==before.exifItem){
    assert.deepEqual(extractItemData(output,after,id),extractItemData(source,before,id),'native resource '+id);
    for(const type of ['ispe','hvcC','colr','auxC','irot','imir'])
      assert.deepEqual(propertyBoxBytes(output,after.props,id,type),propertyBoxBytes(source,before.props,id,type),'native property '+id+'/'+type);
    assert.deepEqual(after.refs.filter(r=>r.from===id),before.refs.filter(r=>r.from===id),'native references '+id);
  }
  const actual=extractItemData(output,after,after.exifItem);
  const depthId=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
  const depthSide=after.refs.find(r=>r.type==='cdsc'&&r.to.includes(depthId)).from;
  const xmp=new TextDecoder().decode(extractItemData(output,after,depthSide)),rend=Buffer.from(/<depthBlurEffect:RenderingParameters>([^<]+)/.exec(xmp)[1],'base64');
  let declared;
  for(let p=16;p<rend.length;p+=8)if(rend.readUInt16LE(p)===453)declared=rend.readFloatLE(p+4);
  assert.ok(Math.abs(declared-sourceHeadroom)<1e-6,'Portrait renderer must declare this photo HDR capacity, not template capacity');
  for(const [id,payload]of calibration)
    assert.deepEqual(extractAppleMakerNoteTag(actual,id).payload,payload,'capture calibration 0x'+id.toString(16));
  const flags=new Map(listAppleMakerNoteTags(actual).map(t=>[t.tag,t]));
  for(const [id,value]of [[0x14,12],[0x1f,1]]){
    assert.equal(flags.get(id).payload.length,4,'one LONG, not four LONGs');
    assert.equal(new DataView(flags.get(id).payload.buffer).getUint32(0,little),value);
  }
});

test('modern native Portrait adds only the accepted viewer bit without losing unrelated processing flags',()=>{
  for(const flags of [0,0x222002,0x222022,0x80000040]){
    const base=withCamera(photo(900,600),'iPhone 16 Pro'),d=discoverHeic(base),ft=topBox(base,'ftyp');
    let exif=extractItemData(base,d,d.exifItem);
    for(const [id,value]of [[1,17],[0x19,flags]])exif=injectAppleMakerNoteTag(exif,be(value,4),id,9);
    const mn=getMakerNoteBlob(exif),v=new DataView(mn.buffer,mn.byteOffset,mn.byteLength),le=mn[12]===73;
    for(let n=0;n<v.getUint16(14,le);n++){
      const at=16+n*12;if([1,0x19].includes(v.getUint16(at,le)))v.setUint32(at+4,1,le);
    }
    const source=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
    const saved=source.slice(),output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
    const own=extractItemData(output,after,after.exifItem),actual=extractAppleMakerNoteTag(own,0x19);
    assert.equal(actual.payload.length,4);assert.equal(actual.type,9);
    assert.equal(new DataView(actual.payload.buffer,actual.payload.byteOffset,4).getUint32(0,le),(flags|0x20)>>>0);
    for(const tag of listAppleMakerNoteTags(exif))if(![0x14,0x1f,0x19].includes(tag.tag))
      assert.deepEqual(extractAppleMakerNoteTag(own,tag.tag),{type:tag.type,payload:tag.payload});
    assert.deepEqual(source,saved,'the input remains immutable');
  }
});

test('iPhone-model raster metadata without a camera MakerNote retains the accepted generated Portrait contract',()=>{
  const base=photo(900,600),tagged=withCamera(base,'iPhone 16 Pro');
  const maker=source=>{const d=discoverHeic(source);return getMakerNoteBlob(extractItemData(source,d,d.exifItem));};
  assert.deepEqual(maker(buildAiPortrait(tagged,depth,template).data),maker(buildAiPortrait(base,depth,template).data));
});

test('generated Portrait contract carries the accepted viewer toggle bit',()=>{
  const output=buildAiPortrait(photo(900,600),depth,template).data,d=discoverHeic(output);
  const exif=extractItemData(output,d,d.exifItem),tag=extractAppleMakerNoteTag(exif,0x19);
  const maker=getMakerNoteBlob(exif),little=maker[12]===73;
  assert.equal(new DataView(tag.payload.buffer,tag.payload.byteOffset,4).getUint32(0,little)&0x20,0x20);
});

test('legacy camera MakerNotes take the viewer-bit path instead of bypassing the template correction',()=>{
  for(const model of ['iPhone 7','iPhone 11','iPhone 14 Pro Max']){
    const base=withCamera(photo(900,600),model),d=discoverHeic(base),ft=topBox(base,'ftyp');
    let exif=extractItemData(base,d,d.exifItem);
    for(const [id,value]of [[1,17],[0x19,0x2002]])exif=injectAppleMakerNoteTag(exif,be(value,4),id,9);
    const maker=getMakerNoteBlob(exif),v=new DataView(maker.buffer,maker.byteOffset,maker.byteLength),le=maker[12]===73;
    for(let n=0;n<v.getUint16(14,le);n++){const at=16+n*12;if([1,0x19].includes(v.getUint16(at,le)))v.setUint32(at+4,1,le);}
    const source=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
    const out=buildAiPortrait(source,depth,template).data,after=discoverHeic(out);
    const flags=extractAppleMakerNoteTag(extractItemData(out,after,after.exifItem),0x19).payload;
    assert.equal(new DataView(flags.buffer,flags.byteOffset,4).getUint32(0,le),0x2022,model);
  }
});

const nativeHdrDirectory=new URL('../private-fixtures/native-hdr-2059/',import.meta.url);
for(const name of ['IMG_2059_native.HEIC','IMG_2061_native.HEIC'])test('reported '+name+' keeps every capture MakerNote field through Texture and Portrait',{
  skip:!fs.existsSync(new URL(name,nativeHdrDirectory)),
},async()=>{
  const original=new Uint8Array(fs.readFileSync(new URL(name,nativeHdrDirectory))),before=discoverHeic(original);
  const textured=(await executeJob({operation:'texture',data:original,opts:{preserveStyles:true}})).data;
  const built=buildAiPortrait(textured,depth,template),output=built.data,after=discoverHeic(output);
  assert.equal(built.report.nativeGraphPreserved,true);
  assert.equal(after.primary,before.primary);assert.equal(after.hdrGrid,before.hdrGrid);assert.equal(after.stylesItem,before.stylesItem);
  const ft=topBox(original,'ftyp');assert.deepEqual(output.slice(0,ft.size),original.slice(0,ft.size));
  for(const id of before.infos.keys())if(id!==before.exifItem){
    assert.deepEqual(extractItemData(output,after,id),extractItemData(original,before,id),'original item '+id);
    assert.deepEqual(after.refs.filter(r=>r.from===id),before.refs.filter(r=>r.from===id),'original refs '+id);
    const properties=(bytes,d)=>(d.props.associations.get(id)||[]).map(a=>{
      const p=d.props.properties[a.index-1];return [a.essential,bytes.slice(p.box.off,p.box.off+p.box.size)];
    });
    assert.deepEqual(properties(output,after),properties(original,before),'original properties '+id);
  }
  const expected=listAppleMakerNoteTags(extractItemData(original,before,before.exifItem));
  const actual=new Map(listAppleMakerNoteTags(extractItemData(output,after,after.exifItem)).map(t=>[t.tag,t]));
  for(const tag of expected){
    if([0x14,0x1f].includes(tag.tag))continue; // Portrait capability/capture class contract.
    if(tag.tag===0x19){
      const a=actual.get(tag.tag),le=getMakerNoteBlob(extractItemData(original,before,before.exifItem))[12]===73;
      assert.equal(a.type,tag.type);assert.equal(a.payload.length,4);
      const uint=t=>new DataView(t.payload.buffer,t.payload.byteOffset,4).getUint32(0,le);
      assert.equal(uint(a),(uint(tag)|0x20)>>>0);continue;
    }
    assert.deepEqual(actual.get(tag.tag),tag,'capture MakerNote 0x'+tag.tag.toString(16));
  }
});
test('generated F disparity range is consistent in auxC and XMP across focus/aperture updates',()=>{
  const source=photo(900,600),scaled={...depth,floatMax:.75};
  for(const settings of [{},{focusX:.2,focusY:.7,aperture:2.8}]){
    const output=buildAiPortrait(source,scaled,template,settings).data,d=discoverHeic(output);
    const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
    assert.deepEqual(propertyBoxBytes(output,d.props,id,'auxC'),appleDepthAuxc({floatMax:.75}));
    const side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)&&d.infos.get(r.from)?.type==='mime');
    assert.match(new TextDecoder().decode(extractItemData(output,d,side.from)),/<apdi:FloatMaxValue>0\.75<\/apdi:FloatMaxValue>/);
  }
  for(const floatMax of [0,-1,NaN,Infinity])assert.throws(()=>buildAiPortrait(source,{...depth,floatMax},template),/Invalid relative disparity range/);
});
function withoutThumbnail(source,items){
  const before=discoverHeic(source),ft=topBox(source,'ftyp'),ftyp=source.slice(ft.off,ft.off+ft.size);
  const meta=removeItems(source.slice(before.meta.off,before.meta.off+before.meta.size),items??[before.thumbnail]);
  const graph=discoverHeic(meta),chunks=[];let cursor=ftyp.length+meta.length+8;
  for(const [id,item]of graph.iloc.items){
    if(item.constructionMethod===1)continue;
    const payload=extractItemData(source,before,id),extent=item.extents[0];
    meta.set(be(cursor,graph.iloc.offsetSize),extent.offsetPos);meta.set(be(payload.length,graph.iloc.lengthSize),extent.lengthPos);
    chunks.push(payload);cursor+=payload.length;
  }
  return concat([ftyp,meta,box('mdat',concat(chunks))]);
}
function withMarker(source,marker){
  const d=discoverHeic(source),ft=topBox(source,'ftyp');
  const exif=injectAppleMakerNoteTag(extractItemData(source,d,d.exifItem),marker);
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
}
function selectedStyle(source){
  const d=discoverHeic(source);
  return extractAppleMakerNoteTag(extractItemData(source,d,d.exifItem));
}
function withStyles(source,blob){
  const d=discoverHeic(source),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.stylesItem,blob]]));
}

function capture(source,classification,enabled){
    const d=discoverHeic(source),ft=topBox(source,'ftyp');let exif=extractItemData(source,d,d.exifItem);
    const little=String.fromCharCode(...getMakerNoteBlob(exif).slice(12,14))==='II';
    for(const [id,value]of [[0x14,classification],[0x1f,enabled]]){
      let bytes=be(value,4);if(little)bytes=bytes.reverse();exif=injectAppleMakerNoteTag(exif,bytes,id,9);
      // The blob injector counts bytes; this test constructs an inline LONG.
      const mn=getMakerNoteBlob(exif),view=new DataView(mn.buffer,mn.byteOffset,mn.byteLength);
      for(let i=0;i<view.getUint16(14,little);i++){const at=16+12*i;
        if(view.getUint16(at,little)===id)view.setUint32(at+4,1,little);}
    }
    return rebuildHeic(source,d,source.slice(0,ft.size),source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
}

function withCamera(source,model){
  const d=discoverHeic(source),e=extractItemData(source,d,d.exifItem);
  const start=new DataView(e.buffer,e.byteOffset,4).getUint32(0)+4,t=e.subarray(start);
  const little=t[0]===73,v=new DataView(t.buffer,t.byteOffset,t.length),root=v.getUint32(4,little);
  const num=(value,size)=>little?be(value,size).reverse():be(value,size);
  const name=new TextEncoder().encode(model+'\0'),entries=[];
  for(let i=0;i<v.getUint16(root,little);i++)entries.push(t.slice(root+2+i*12,root+14+i*12));
  entries.push(concat([num(0x110,2),num(2,2),num(name.length,4),num(t.length,4)]));
  const exif=concat([e,name,num(entries.length,2),...entries,new Uint8Array(4)]);
  new DataView(exif.buffer).setUint32(start+4,t.length+name.length,little);
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(0,ft.size),source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
}

test('legacy native Photo depth restores editing independently of Photos feature flags; modern/blurred exports need confirmation',async()=>{
  for(const flags of [0,1,7]){
    const source=withCamera(capture(attachAiDepth(photo(900,600),depth),10,flags),'iPhone 13 Pro Max');
    assert.equal(nativePortraitBaseState(source),'legacy-photo-base');
    const out=await executeJob({operation:'native-portrait',data:source,opts:{template}});
    assert.equal(out.report.mode,'restored-native-portrait');
    assert.equal(out.report.modelInference,false);
    const before=discoverHeic(source),after=discoverHeic(out.data);
    assert.deepEqual(selectedStyle(out.data),selectedStyle(source));
    assert.deepEqual(extractItemData(out.data,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
    before.primaryTiles.forEach((id,i)=>assert.deepEqual(extractItemData(out.data,after,after.primaryTiles[i]),extractItemData(source,before,id)));
  }
  const iphone14=withCamera(capture(attachAiDepth(photo(900,600),
    {...depth,floatMin:.461914,floatMax:1.234375}),1,1),'iPhone 14 Pro Max');
  assert.equal(nativePortraitBaseState(iphone14),'legacy-photo-base');
  const restored14=await executeJob({operation:'native-portrait',data:iphone14,opts:{template}});
  assert.equal(restored14.report.mode,'restored-native-portrait');
  assert.equal(restored14.report.nativeDepthRangePreserved,true);
  for(const model of ['iPhone 13 Pro Max','iPhone 16 Pro']){
    const source=withCamera(capture(attachAiDepth(photo(900,600),depth),12,0),model);
    assert.equal(nativePortraitBaseState(source),'unknown-base');
    assert.equal((await executeJob({operation:'native-portrait',data:source,opts:{template}})).data,null);
    const confirmed=await executeJob({operation:'native-portrait',data:source,opts:{template,portraitOffConfirmed:true}});
    assert.equal(confirmed.report.mode,'restored-native-portrait');
  }
  const on=withCamera(capture(attachAiDepth(photo(900,600),depth),2,1),'iPhone 13 Pro');
  assert.equal(nativePortraitBaseState(on),'portrait-capture');
  assert.equal((await executeJob({operation:'native-portrait',data:on,opts:{template}})).data,null);
});
test('diagnostic native rebuild requires explicit verified unblurred pixels regardless of flags',async()=>{
  for(const [classification,enabled]of [[10,0],[11,1],[11,0]]){
    const source=capture(attachAiDepth(photo(900,600),depth),classification,enabled),before=discoverHeic(source),saved=source.slice();
    assert.equal(await restoreNativePortrait(source,template),null,'capture flags cannot prove a sharp base');
    const output=await restoreNativePortrait(source,template,{unblurredBase:true});assert.ok(output);assert.deepEqual(source,saved);
    const after=discoverHeic(output.data),id=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
    assert.equal(output.report.modelInference,false);assert.equal(output.report.mode,'restored-native-portrait');
    assert.deepEqual(extractItemData(output.data,after,id),depth.payload);
    assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
    assert.deepEqual(extractItemData(output.data,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
    before.primaryTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(output.data,after,after.primaryTiles[i])));
    assert.equal(await restoreNativePortrait(output.data,template),null,'accepted capture is not rebuilt twice');
  }
  assert.equal(await restoreNativePortrait(capture(attachAiDepth(photo(900,600),depth),11,99),template),null);
  assert.equal(await restoreNativePortrait(capture(attachAiDepth(photo(900,600),depth),99,1),template),null);
  assert.equal(await restoreNativePortrait(photo(900,600),template),null);
});

test('native restoration preserves camera disparity range and exact auxC, not the AI unit range',async()=>{
  // The actual Portrait-off 7094 and 5202 ranges. Their encoded pixels did not
  // change, but the old adapter incorrectly described both planes as 0..1.
  for(const [floatMin,floatMax]of [[.043335,1.615234],[.110901,.750488]]){
    const source=capture(attachAiDepth(photo(900,600),{...depth,floatMin,floatMax}),10,0);
    const saved=source.slice(),before=discoverHeic(source);
    const oldId=[...before.infos.keys()].find(id=>auxUriForItem(before.props,id)===DEPTH_URI);
    const output=await restoreNativePortrait(source,template,{unblurredBase:true});assert.ok(output);
    const after=discoverHeic(output.data),id=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
    assert.deepEqual(propertyBoxBytes(output.data,after.props,id,'auxC'),propertyBoxBytes(source,before.props,oldId,'auxC'));
    const side=after.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)&&after.infos.get(r.from)?.type==='mime');
    const xmp=new TextDecoder().decode(extractItemData(output.data,after,side.from));
    assert.deepEqual(readAppleDepthRange(xmp),{floatMin,floatMax});
    assert.deepEqual(extractItemData(output.data,after,id),extractItemData(source,before,oldId));
    assert.deepEqual(extractItemData(output.data,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
    before.primaryTiles.forEach((key,i)=>assert.deepEqual(extractItemData(output.data,after,after.primaryTiles[i]),extractItemData(source,before,key)));
    assert.deepEqual(source,saved);
  }
});

test('native restoration retains source camera calibration and unknown depth fields instead of the reference lens',async()=>{
  const base=capture(attachAiDepth(photo(900,600),{...depth,floatMin:.1,floatMax:2}),10,0),d=discoverHeic(base),ft=topBox(base,'ftyp');
  const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI),side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)).from;
  const camera='<depth:IntrinsicMatrixReferenceWidth>1800</depth:IntrinsicMatrixReferenceWidth><depth:IntrinsicMatrixReferenceHeight>1200</depth:IntrinsicMatrixReferenceHeight><depth:PixelSize>0.001</depth:PixelSize><depth:IntrinsicMatrix><rdf:Seq><rdf:li>2718.28</rdf:li><rdf:li>0</rdf:li><rdf:li>0</rdf:li><rdf:li>0</rdf:li><rdf:li>2718.28</rdf:li><rdf:li>0</rdf:li><rdf:li>900</rdf:li><rdf:li>600</rdf:li><rdf:li>1</rdf:li></rdf:Seq></depth:IntrinsicMatrix><depth:FutureCameraField>own-camera-calibration</depth:FutureCameraField>';
  const xmp=new TextDecoder().decode(extractItemData(base,d,side)).replace('</rdf:Description>',camera+'</rdf:Description>');
  const source=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[side,new TextEncoder().encode(xmp)]]));
  const output=await restoreNativePortrait(source,template,{unblurredBase:true}),after=discoverHeic(output.data);
  const nid=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI),ns=after.refs.find(r=>r.type==='cdsc'&&r.to.includes(nid)).from;
  const result=new TextDecoder().decode(extractItemData(output.data,after,ns));
  assert.ok(result.includes(camera));assert.ok(result.includes('depthBlurEffect:RenderingParameters'));
  assert.ok(result.includes('<depth:Quality>low</depth:Quality>'),'native source quality is retained independently of the AI editing profile');
  assert.equal(output.report.geometry,'native-depth-calibration');
  assert.ok(!result.includes('5676.125'),'no reference intrinsic matrix');
});

test('native depth without camera optics keeps the accepted restoration profile rather than incomplete calibration',async()=>{
  const source=capture(attachAiDepth(photo(900,600),{...depth,floatMin:.1,floatMax:2}),10,0);
  const output=await restoreNativePortrait(source,template,{unblurredBase:true}),d=discoverHeic(output.data);
  const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI),side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)).from;
  const xmp=new TextDecoder().decode(extractItemData(output.data,d,side));
  assert.equal(output.report.geometry,'reference-native-depth-fallback');assert.equal(output.report.referenceCalibration,true);
  assert.ok(xmp.includes('5676.125'));assert.deepEqual(readAppleDepthRange(xmp),{floatMin:.1,floatMax:2});
});

const acceptedJ4=new URL('../private-fixtures/native-portrait-strength-2082/J4_AI_Quality.HEIC',import.meta.url);
const acceptedJ4Source=new URL('../private-fixtures/native-portrait-strength-2082/IMG_2081.HEIC',import.meta.url);
const acceptedN1=new URL('../private-fixtures/native-portrait-strength-2082/N1_Viewer_Bit20.HEIC',import.meta.url);
test('generated response and viewer metadata reproduce the device-accepted N1 active graph',{
  skip:!fs.existsSync(acceptedN1)||!fs.existsSync(acceptedJ4Source),
},async()=>{
  const {addTexture}=await import('../../web/src/styles/texture.js');
  const reference=new Uint8Array(fs.readFileSync(acceptedN1)),d=discoverHeic(reference);
  const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI),[width,height]=dimensionsForItem(d.props,id);
  const source=addTexture(new Uint8Array(fs.readFileSync(acceptedJ4Source)),{preserveStyles:true}).data;
  const output=buildAiPortrait(source,{width,height,payload:extractItemData(reference,d,id),
    hvcc:propertyBoxBytes(reference,d.props,id,'hvcC'),floatMax:3,relativeResponse:'projection-v1'},template,{aperture:1.4});
  const after=discoverHeic(output.data);
  for(const item of d.infos.keys()){
    const actual=extractItemData(output.data,after,item),expected=extractItemData(reference,d,item);
    assert.equal(Buffer.compare(actual,expected),0,'device-accepted N1 resource '+item);
    const properties=(bytes,graph)=>(graph.props.associations.get(item)||[]).map(a=>{
      const p=graph.props.properties[a.index-1];return [a.essential,bytes.slice(p.box.off,p.box.off+p.box.size)];
    });
    assert.deepEqual(properties(output.data,after),properties(reference,d),'device-accepted N1 properties '+item);
  }
  assert.deepEqual(after.refs,d.refs);
  assert.ok(Math.abs(output.report.disparityMax-12.469766884405981)<1e-9);
});
test('real AI assembly retains J4 editing resources with only the accepted viewer-word addition',{
  skip:!fs.existsSync(acceptedJ4)||!fs.existsSync(acceptedJ4Source),
},async()=>{
  const {addTexture}=await import('../../web/src/styles/texture.js');
  const reference=new Uint8Array(fs.readFileSync(acceptedJ4)),d=discoverHeic(reference);
  const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI),[width,height]=dimensionsForItem(d.props,id);
  const source=addTexture(new Uint8Array(fs.readFileSync(acceptedJ4Source)),{preserveStyles:true}).data;
  const output=buildAiPortrait(source,{width,height,payload:extractItemData(reference,d,id),
    hvcc:propertyBoxBytes(reference,d.props,id,'hvcC'),floatMax:3},template,{aperture:1.4});
  const after=discoverHeic(output.data);
  for(const item of d.infos.keys()){
    const expected=extractItemData(reference,d,item).slice();
    if(item===d.exifItem){
      const mn=getMakerNoteBlob(expected),v=new DataView(mn.buffer,mn.byteOffset,mn.byteLength),le=mn[12]===73;
      for(let n=0;n<v.getUint16(14,le);n++){
        const at=16+n*12;if(v.getUint16(at,le)===0x19)v.setUint32(at+8,(v.getUint32(at+8,le)|0x20)>>>0,le);
      }
    }
    assert.deepEqual(extractItemData(output.data,after,item),expected,'active J4 item '+item);
  }
  assert.deepEqual(after.refs,d.refs);
  // J4's patched XMP left an unused old extent. Whole-file identity is neither
  // expected nor a substitute for the on-device observation recorded in facts.
});

test('native restoration refuses missing, ambiguous or invalid disparity ranges instead of guessing 0..1',async()=>{
  const base=capture(attachAiDepth(photo(900,600),{...depth,floatMin:.043335,floatMax:1.615234}),10,0);
  const d=discoverHeic(base),id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
  const side=d.refs.find(r=>r.type==='cdsc'&&r.to.includes(id)&&d.infos.get(r.from)?.type==='mime').from;
  const original=new TextDecoder().decode(extractItemData(base,d,side)),ft=topBox(base,'ftyp');
  const changed=xmp=>rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),
    new Map([[side,new TextEncoder().encode(xmp)]]));
  for(const xmp of [
    original.replace(/<pixel:FloatMinValue>[^<]+<\/pixel:FloatMinValue>/,''),
    original.replace('>0.043335<','><'),
    original.replace('>0.043335<','>-0.043335<'),
    original.replace('>1.615234<','>0.01<'),
    original.replace('>1.615234<','>NaN<'),
    original.replace('>1.615234<','>Infinity<'),
    original.replace('>1.615234<','>2000000000<'),
    original.replace('</pixel:FloatMaxValue>','</pixel:FloatMaxValue><pixel:FloatMaxValue>2</pixel:FloatMaxValue>'),
    original.replace('http://ns.apple.com/pixeldatainfo/1.0/','https://example.invalid/depth/'),
  ])assert.equal(await restoreNativePortrait(changed(xmp),template,{unblurredBase:true}),null);
  // XMP prefixes are aliases; real camera exports use apdi, generated ones pixel.
  for(const xmp of [original.replaceAll('pixel:','apdi:').replace('xmlns:pixel=','xmlns:apdi='),
    original.replace('<pixel:FloatMinValue>0.043335</pixel:FloatMinValue>','')
      .replace('xmlns:pixel=', 'pixel:FloatMinValue="0.043335" xmlns:pixel=')]){
    assert.ok(await restoreNativePortrait(changed(xmp),template,{unblurredBase:true}));
  }
});

test('Texture routes preserve incomplete native Portrait without adding a second blur renderer',async()=>{
  const source=capture(attachAiDepth(photo(900,600),depth),11,0),before=discoverHeic(source);
  const saved=source.slice(),originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    throw Error(`Native Portrait must not fetch a capture template: ${url}`);
  };
  try{
    for(const operation of ['texture','repair-texture']){
      const texture=[...before.infos].find(([,info])=>info.uri==='tag:apple.com,2026:photo:metadata:texture_styles')[0];
      const input=operation==='texture'?withoutThumbnail(source,[texture]):source;
      const output=await executeJob({operation,data:input,opts:{preserveStyles:true}}),data=output.data||input,after=discoverHeic(data);
      assert.equal(output.report?.nativePortrait,undefined);
      assert.deepEqual(selectedStyle(data),selectedStyle(source));
      assert.deepEqual(extractItemData(data,after,after.exifItem),extractItemData(source,before,before.exifItem));
      assert.deepEqual(extractItemData(data,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
      before.primaryTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(data,after,after.primaryTiles[i])));
      before.hdrTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(data,after,after.hdrTiles[i])));
      const id=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
      assert.deepEqual(extractItemData(data,after,id),depth.payload);
      assert.equal(await restoreNativePortrait(data,template),null,'native capture must stay unchanged');
      assert.deepEqual(source,saved);
    }
    const unknown=withStyles(source,buildBplist(new Map([['0',999]])));
    assert.equal(await restoreNativePortrait(unknown,template),null,'unknown Styles keep their additive route');
  }finally{globalThis.fetch=originalFetch;}
});

test('Texture-only mode does not reconstruct missing native Styles or change capture resources',async()=>{
  const base=capture(attachAiDepth(photo(900,600),depth),11,1),graph=discoverHeic(base);
  const texture=[...graph.infos].find(([,info])=>info.uri==='tag:apple.com,2026:photo:metadata:texture_styles')[0];
  const source=withoutThumbnail(base,[texture,graph.stylesItem,graph.deltaGrid,graph.linearThumb]),a=discoverHeic(source);
  const out=await executeJob({operation:'texture',data:source,opts:{preserveStyles:true,allowMissingStyles:true}}),b=discoverHeic(out.data);
  assert.equal(b.stylesItem,null);assert.ok(hasTexture(b.infos));
  assert.equal(out.report.toneCurveAdded,false);
  for(const [id]of a.iloc.items)assert.deepEqual(extractItemData(out.data,b,id),extractItemData(source,a,id));
  for(const ref of a.refs)assert.ok(b.refs.some(r=>JSON.stringify(r)===JSON.stringify(ref)));
});

test('adding a missing Styles graph preserves a real iPhone 13-15 six-key Bright selection instead of Standard',async()=>{
  const base=photo(900,600),marker=buildBplist(new Map([['3',1],['1',-.5],['4',16],['2',.5],['0',1],['5',0]]));
  const graph=discoverHeic(base);
  const source=withCamera(withoutThumbnail(withMarker(base,marker),[graph.stylesItem,graph.deltaGrid,graph.linearThumb]),'iPhone 15 Pro');
  assert.equal(discoverHeic(source).stylesItem,null);
  const originalProfile=buildGeneratedProfile('48-12',assets),saved=originalProfile.mn54.slice();
  const output=await patch(source,originalProfile,{experimental:true,linearThumb:testLinearThumb});
  assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
  assert.deepEqual(originalProfile.mn54,saved,'cached neutral profile must not inherit another photo selection');
});

test('pre-Photographic-Styles iPhones ignore reused 0x54 blobs and receive the generated Standard marker',async()=>{
  const base=photo(900,600),legacy=buildBplist(new Map([['3',1],['1',.18],['4',16],['2',0],['0',1],['5',0]]));
  const graph=discoverHeic(base);
  const source=withCamera(withoutThumbnail(withMarker(base,legacy),[graph.stylesItem,graph.deltaGrid,graph.linearThumb]),'iPhone 7');
  const profile=buildGeneratedProfile('48-12',assets),output=await patch(source,profile,{experimental:true,linearThumb:testLinearThumb});
  const selected=parseBplist(selectedStyle(output.data).payload);
  assert.deepEqual([selected.get('0'),selected.get('1'),selected.get('2'),selected.get('3'),selected.get('4'),selected.get('5'),selected.get('6'),selected.get('7')],
    [1,0,0,1,1,1,4,0]);
});

test('Suggested Styles overrides legacy iPhone 15 selection but never mutates incomplete iPhone 16+ capture selection',async()=>{
  const marker=buildBplist(new Map([['0',1],['1',new BplistReal(-.5)],['2',new BplistReal(.5)],
    ['3',new BplistReal(.7)],['4',16],['5',1],['6',4],['7',0]]));
  const base=photo(900,600),graph=discoverHeic(base);
  const incomplete=withoutThumbnail(withMarker(base,marker),[graph.stylesItem,graph.deltaGrid,graph.linearThumb]);
  const recommendation={styleId:11,tone:-.42,color:.16,palette:.88,confidence:.82,level:'pro'};
  const profile15=buildGeneratedProfile('48-12',assets);
  const oldSource=withCamera(incomplete,'iPhone 15 Pro');
  const oldOut=await patch(oldSource,profile15,{experimental:true,linearThumb:testLinearThumb,styleRecommendation:recommendation});
  const oldSelected=parseBplist(selectedStyle(oldOut.data).payload);
  assert.deepEqual([oldSelected.get('4'),oldSelected.get('1'),oldSelected.get('2'),oldSelected.get('3')],
    [11,-.42,.16,.88]);
  assert.equal(oldOut.report.styleRecommendation.styleName,'Dramatic');
  const portrait=buildAiPortrait(oldOut.data,depth,template).data;
  assert.deepEqual(selectedStyle(portrait),selectedStyle(oldOut.data),'AI Portrait must preserve the suggested Style marker');

  const profile16=buildGeneratedProfile('48-12',assets);
  const modernSource=withCamera(incomplete,'iPhone 16 Pro');
  const modernOut=await patch(modernSource,profile16,{experimental:true,linearThumb:testLinearThumb,styleRecommendation:recommendation});
  assert.deepEqual(selectedStyle(modernOut.data),selectedStyle(modernSource));
  assert.equal(modernOut.report.styleRecommendation,undefined);
});

test('ISO-only tmap gain maps are reported and preserved as HDR when adding Portrait',async()=>{
  const base=photo(4032,3024,'45-15'),d=discoverHeic(base),ft=topBox(base,'ftyp');
  assert.ok(d.hdrGrid!==null);
  let meta=base.slice(d.meta.off,d.meta.off+d.meta.size);
  let assigned;[meta,assigned]=addItems(meta,[{key:'iso-hdr',itemType:'tmap',refType:'dimg',refTo:[d.primary,d.hdrGrid],
    reuse:d.props.associations.get(d.primary).filter(a=>d.props.properties[a.index-1].type==='ispe').map(a=>[a.index,a.essential])}]);
  const tmap=assigned.get('iso-hdr'),metadata=encodeTmapMetadata({baseHeadroom:0,alternateHeadroom:2,useBaseColorSpace:true,
    channels:[{min:0,max:2,gamma:1,baseOffset:0,alternateOffset:0}]});
  const keep=d.props.associations.get(d.hdrGrid).filter(a=>d.props.properties[a.index-1].type!=='auxC').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,d.hdrGrid,keep);
  const source=rebuildHeic(base,d,base.slice(0,ft.size),meta,new Map([[tmap,metadata]])),before=discoverHeic(source);
  assert.equal(auxUriForItem(before.props,before.hdrGrid),null);
  assert.equal(before.hdrGrid,d.hdrGrid);assert.equal(discoverCoreHeic(source).hdrGrid,d.hdrGrid);
  assert.equal(describeHeic(source).hdr,true);
  // A native edited export can retain its ISO gain map and selected preset,
  // without carrying any of the colour-editing resources. HDR registration
  // must work without inventing a Styles graph or a Texture renderer.
  const incomplete=withoutThumbnail(source,[before.stylesItem,before.deltaGrid,before.linearThumb]);
  const missing=discoverHeic(incomplete);
  assert.equal(missing.stylesItem,null);
  assert.equal(hasTexture(missing.infos),false);
  const preserved=await executeJob({operation:'repair-texture',data:incomplete,opts:{preserveStyles:true}});
  const pd=discoverHeic(preserved.data);
  assert.equal(pd.stylesItem,null);
  assert.equal(hasTexture(pd.infos),false);
  assert.equal(auxUriForItem(pd.props,pd.hdrGrid),'urn:com:apple:photo:2020:aux:hdrgainmap');
  for(const id of missing.infos.keys())
    assert.deepEqual(extractItemData(preserved.data,pd,id),extractItemData(incomplete,missing,id));
  assert.deepEqual(selectedStyle(preserved.data),selectedStyle(incomplete));
  assert.equal(registerTmapHdr(preserved.data),null);
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.equal(describeHeic(output).hdr,true);
  assert.equal(after.hdrTiles.length,before.hdrTiles.length);
  before.hdrTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(output,after,after.hdrTiles[i])));
  assert.deepEqual(propertyBoxBytes(output,after.props,after.hdrGrid,'colr'),propertyBoxBytes(source,before.props,before.hdrGrid,'colr'));
  const newTmap=[...after.infos.keys()].find(id=>after.infos.get(id).type==='tmap');
  assert.deepEqual(extractItemData(output,after,newTmap),extractItemData(source,before,tmap));
  assert.deepEqual(after.refs.find(r=>r.from===newTmap&&r.type==='dimg').to,[after.primary,after.hdrGrid]);
  const fixed=registerTmapHdr(output),final=discoverHeic(fixed);
  assert.equal(auxUriForItem(final.props,final.hdrGrid),'urn:com:apple:photo:2020:aux:hdrgainmap');
  assert.ok(final.refs.some(r=>r.type==='auxl'&&r.from===final.hdrGrid&&r.to.includes(final.primary)));
  assert.deepEqual(selectedStyle(fixed),selectedStyle(output));
  for(const id of after.infos.keys())assert.deepEqual(extractItemData(fixed,final,id),extractItemData(output,after,id));
  assert.equal(registerTmapHdr(fixed),null,'registration is additive and idempotent');
  const worker=await executeJob({operation:'texture',data:output});
  assert.equal(worker.report.hdrCompatibility,'registered-existing-tmap');
  const wd=discoverHeic(worker.data);
  assert.equal(auxUriForItem(wd.props,wd.hdrGrid),'urn:com:apple:photo:2020:aux:hdrgainmap');
  assert.deepEqual(selectedStyle(worker.data),selectedStyle(source));
  after.hdrTiles.forEach((id,i)=>assert.deepEqual(extractItemData(worker.data,wd,wd.hdrTiles[i]),extractItemData(output,after,id)));
});


test('legacy Apple gain-map HDR is normalized before Portrait/Styles target the HDR rendition',async()=>{
  const headroom=3.0177927017211914,enc=new TextEncoder();
  let source=attachAiDepth(photo(900,600),depth),d=discoverHeic(source);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),ids,p3;
  for(const id of d.hdrTiles.length?d.hdrTiles:[d.hdrGrid])meta=replaceItemPropertyWithSource(meta,id,'hvcC',assets.mask.hvcc);
  const p3Colr=box('colr',concat([new TextEncoder().encode('nclx'),be(12,2),be(1,2),be(1,2),new Uint8Array([128])]));
  [meta,p3]=appendIpcoProperty(meta,p3Colr);
  const primaryProps=d.props.associations.get(d.primary).filter(a=>d.props.properties[a.index-1].type!=='colr').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,d.primary,[...primaryProps,[p3,false]]);
  [meta,ids]=addItems(meta,[{key:'legacy-hdr-xmp',itemType:'mime',contentType:'application/rdf+xml',
    refType:'cdsc',refTo:[d.hdrGrid]}]);
  const sideId=ids.get('legacy-hdr-xmp');
  const xmp=enc.encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapHeadroom>${headroom}</HDRGainMap:HDRGainMapHeadroom><HDRGainMap:HDRGainMapVersion>65536</HDRGainMap:HDRGainMapVersion></rdf:Description></rdf:RDF></x:xmpmeta>`);
  const ft=topBox(source,'ftyp');
  source=rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map([[ids.get('legacy-hdr-xmp'),xmp]]));
  d=discoverHeic(source);
  const originals=new Map([...d.infos.keys()].map(id=>[id,extractItemData(source,d,id)]));

  assert.equal(promoteLegacyPortraitHdr(source),null,'raw Apple samples must never receive metadata-only ISO promotion');
  assert.equal(promoteLegacyPortraitHdr(source,{normalizedGain:true}),null,
    'a caller flag cannot override a legacy 0x10000 sidecar');
  const gainItems=d.hdrTiles.length?d.hdrTiles:[d.hdrGrid];
  const firstHvcc=propertyBoxBytes(source,d.props,gainItems[0],'hvcC');let encodedIndex=0;
  const normalized=await normalizeLegacyPortraitHdrGain(source,{codec:{
    decodeHevcLuma:async(_record,_payload,{width,height})=>({bytes:new Uint8Array(width*height).map((_,i)=>i%256),width,height}),
    encodeHevcPixels:async(samples)=>({payload:new Uint8Array([++encodedIndex,samples[1],samples[255]]),hvcc:firstHvcc,
      sps:{chroma:0,luma:8,chromaDepth:8,fullRange:true}}),
  }});
  assert.ok(normalized);assert.equal(normalized.changedItems.length,gainItems.length);
  assert.ok(normalized.maxError<.006);
  const normalizedGraph=discoverHeic(normalized.data);
  const normalizedXmp=new TextDecoder().decode(extractItemData(normalized.data,normalizedGraph,sideId));
  assert.match(normalizedXmp,/<HDRGainMap:HDRGainMapVersion>131072<\//);
  assert.match(normalizedXmp,/<HDRGainMap:HDRGainMapHeadroom>3\.017792702<\//);
  const again=await normalizeLegacyPortraitHdrGain(normalized.data,{codec:{
    decodeHevcLuma:async()=>{throw Error('already normalized gain must not decode again');},
    encodeHevcPixels:async()=>{throw Error('already normalized gain must not encode again');},
  }});
  assert.equal(again.alreadyNormalized,true);assert.equal(again.data,normalized.data);
  const promoted=promoteLegacyPortraitHdr(normalized.data,{normalizedGain:true});
  assert.ok(promoted);const after=discoverHeic(promoted.data);
  const tmap=[...after.infos].find(([,info])=>info.type==='tmap')?.[0];
  assert.ok(tmap);
  assert.deepEqual(after.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to,[after.primary,after.hdrGrid]);
  const params=parseTmapMetadata(extractItemData(promoted.data,after,tmap));
  assert.ok(Math.abs(params.alternateHeadroom-Math.log2(headroom))<1e-6);
  assert.equal(params.channels.length,1);assert.equal(params.channels[0].gamma,1);
  assert.equal(params.channels[0].baseOffset,0);assert.equal(params.channels[0].alternateOffset,0);
  assert.equal(params.useBaseColorSpace,true);
  assert.ok(Math.abs(editableTmapHeadroom(promoted.data)-headroom)<1e-5);

  const depthId=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
  assert.deepEqual(after.refs.find(r=>r.type==='auxl'&&r.from===depthId)?.to,[after.primary,tmap]);
  assert.deepEqual(after.refs.find(r=>r.type==='auxl'&&r.from===after.hdrGrid)?.to,[after.primary]);
  for(const [id,type] of [[after.linearThumb,'auxl'],[after.deltaGrid,'auxl'],[after.stylesItem,'cdsc']])
    assert.deepEqual(after.refs.find(r=>r.type===type&&r.from===id)?.to,[after.primary,tmap]);
  for(const [id,payload] of originals)if(!gainItems.includes(id)&&id!==sideId)
    assert.deepEqual(extractItemData(promoted.data,after,id),payload);
  assert.equal(promoteLegacyPortraitHdr(promoted.data),null,'promotion must be idempotent');
});

test('Apple legacy Rec.709 gain samples are converted to the equivalent ISO logarithmic gain',()=>{
  const headroom=3.0177927017211914,input=Uint8Array.from({length:256},(_,i)=>i);
  const output=normalizeAppleLegacyGainSamples(input,headroom),stops=Math.log2(headroom);
  assert.equal(output[0],0);assert.equal(output[255],255);
  for(let i=1;i<output.length;i++)assert.ok(output[i]>=output[i-1]);
  const linear=x=>x<.081?x/4.5:((x+.099)/1.099)**(1/.45);
  let maxError=0;
  for(let i=0;i<256;i++)maxError=Math.max(maxError,Math.abs(
    1+(headroom-1)*linear(i/255)-2**((output[i]/255)*stops)));
  assert.ok(maxError<.006,`legacy-to-ISO gain error ${maxError}`);
});

function maker33LegacyHdr({numerator=28718,denominator=31509,maker48=null,withMaker33=true,
  captureClass=10,model='iPhone 13 Pro Max'}={}){
  let source=withCamera(capture(attachAiDepth(photo(900,600),depth),captureClass,0),model);
  const d=discoverHeic(source),ft=topBox(source,'ftyp');
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),index,ids;
  for(const id of d.hdrTiles.length?d.hdrTiles:[d.hdrGrid])
    meta=replaceItemPropertyWithSource(meta,id,'hvcC',assets.mask.hvcc);
  [meta,index]=appendIpcoProperty(meta,box('colr',concat([new TextEncoder().encode('nclx'),be(12,2),be(1,2),be(1,2),Uint8Array.of(128)])));
  const kept=d.props.associations.get(d.primary).filter(a=>d.props.properties[a.index-1].type!=='colr');
  meta=setItemPropertyAssociations(meta,d.primary,[...kept.map(a=>[a.index,a.essential]),[index,false]]);
  [meta,ids]=addItems(meta,[{key:'legacy-hdr-xmp',itemType:'mime',contentType:'application/rdf+xml',refType:'cdsc',refTo:[d.hdrGrid]}]);
  let exif=extractItemData(source,d,d.exifItem);
  const little=getMakerNoteBlob(exif)[12]===73;
  const scalar=(id,payload,type)=>{
    if(little)payload=concat([payload.slice(0,4).reverse(),payload.slice(4,8).reverse()]);
    exif=injectAppleMakerNoteTag(exif,payload,id,type);
    const mn=getMakerNoteBlob(exif),view=new DataView(mn.buffer,mn.byteOffset,mn.byteLength);
    for(let i=0;i<view.getUint16(14,little);i++){
      const pos=16+12*i;if(view.getUint16(pos,little)===id)view.setUint32(pos+4,1,little);
    }
  };
  if(withMaker33)scalar(0x21,concat([be(numerator,4),be(denominator,4)]),10);
  if(maker48)scalar(0x30,maker48.payload,maker48.type);
  const xml=new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>65536</HDRGainMap:HDRGainMapVersion></rdf:Description></rdf:RDF></x:xmpmeta>');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map([[d.exifItem,exif],[ids.get('legacy-hdr-xmp'),xml]]));
}

test('native Portrait-off restores camera depth with normalized HDR even without Maker48',async()=>{
  // Actual reported captures: IMG_5202/1412 and IMG_7094/1415, Maker48 absent.
  for(const [numerator,denominator,stops,captureClass,model]of [
    [28718,31509,1.8,10,'iPhone 13 Pro Max'],
    [39391,27267,3,1,'iPhone 14 Pro Max'],
  ]){
    const source=maker33LegacyHdr({numerator,denominator,captureClass,model}),saved=source.slice(),before=discoverHeic(source);
    const oldDepth=[...before.infos.keys()].find(id=>auxUriForItem(before.props,id)===DEPTH_URI);
    let decodes=0,encodes=0;
    const codec={
      decodeHevcLuma:async(_record,_payload,{width,height})=>{
        decodes++;return {bytes:Uint8Array.from({length:width*height},(_,i)=>i%256),width,height};
      },
      encodeHevcPixels:async samples=>{
        encodes++;
        assert.deepEqual(samples.slice(0,256),normalizeAppleLegacyGainSamples(Uint8Array.from({length:256},(_,i)=>i),2**stops));
        return {payload:Uint8Array.of(encodes,samples[64],samples[128],samples[255]),hvcc:assets.mask.hvcc,
          sps:{chroma:0,luma:8,chromaDepth:8,fullRange:true}};
      },
    };
    const output=await restoreNativePortrait(source,template,{unblurredBase:true,hdrCodec:codec});
    assert.deepEqual(source,saved);
    assert.equal(output.report.mode,'restored-native-portrait');
    assert.equal(output.report.modelInference,false);
    assert.equal(output.report.legacyHdrCompatibility,'normalized-portrait-tmap');
    assert.equal(decodes,before.hdrTiles.length);assert.equal(encodes,decodes);
    const after=discoverHeic(output.data),tmap=[...after.infos].find(([,info])=>info.type==='tmap')?.[0];
    const newDepth=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
    assert.deepEqual(extractItemData(output.data,after,newDepth),extractItemData(source,before,oldDepth));
    before.primaryTiles.forEach((id,i)=>assert.deepEqual(extractItemData(output.data,after,after.primaryTiles[i]),extractItemData(source,before,id)));
    assert.deepEqual(extractItemData(output.data,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
    assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
    assert.deepEqual(after.refs.find(r=>r.type==='auxl'&&r.from===newDepth).to,[after.primary,tmap]);
    const parameters=parseTmapMetadata(extractItemData(output.data,after,tmap));
    assert.ok(Math.abs(parameters.alternateHeadroom-stops)<1e-6);
    const side=after.refs.find(r=>r.type==='cdsc'&&r.to.includes(after.hdrGrid));
    const xml=new TextDecoder().decode(extractItemData(output.data,after,side.from));
    assert.match(xml,/<HDRGainMap:HDRGainMapVersion>131072</);
    assert.ok(xml.includes((2**stops).toFixed(9)));
    assert.throws(()=>extractAppleMakerNoteTag(extractItemData(output.data,after,after.exifItem),0x30),/not found/);
    assert.equal(await restoreNativePortrait(output.data,template,{unblurredBase:true,hdrCodec:codec}),null);
    assert.equal(encodes,decodes,'a complete native renderer must not normalize twice');
  }
});

test('missing Maker48 default never masks malformed HDR metadata or a missing Maker33',async()=>{
  const codec={decodeHevcLuma:async()=>{throw Error('invalid metadata must not allocate codec');}};
  for(const options of [{withMaker33:false},{denominator:0},{denominator:0xffffffff},
    {maker48:{type:9,payload:be(1,4)}},{maker48:{type:10,payload:concat([be(1,4),be(0,4)])}},
    {maker48:{type:10,payload:concat([be(1,4),be(0xffffffff,4)])}}]){
    assert.equal(await normalizeLegacyPortraitHdrGain(maker33LegacyHdr(options),{codec}),null);
  }
});

test('legacy gain normalization preserves highlight multipliers for the reported 33-only headrooms',()=>{
  const samples=Uint8Array.from({length:256},(_,i)=>i);
  const linear=x=>x<.081?x/4.5:((x+.099)/1.099)**(1/.45);
  for(const stops of [1.8,3]){
    const headroom=2**stops,normalized=normalizeAppleLegacyGainSamples(samples,headroom);
    for(let i=0;i<256;i++){
      const original=1+(headroom-1)*linear(i/255),reconstructed=2**(normalized[i]/255*stops);
      assert.ok(Math.abs(reconstructed-original)/original<.005,'must not introduce a highlight boost');
    }
  }
});

test('AI Portrait promotes prepared ISO HDR after depth exists using the migrated legacy headroom',()=>{
  let source=photo(900,600),d=discoverHeic(source);
  assert.equal([...d.infos.keys()].some(id=>auxUriForItem(d.props,id)===DEPTH_URI),false);
  const gainBefore=extractItemData(source,d,d.hdrGrid);
  let exif=extractItemData(source,d,d.exifItem);
  const rational=(num,den)=>{
    const mn=getMakerNoteBlob(exif),little=String.fromCharCode(mn[12],mn[13])==='II';
    const out=new Uint8Array(8),v=new DataView(out.buffer);
    v.setInt32(0,num,little);v.setUint32(4,den,little);return out;
  };
  const fixCount=(bytes,id)=>{
    const mn=getMakerNoteBlob(bytes),little=String.fromCharCode(mn[12],mn[13])==='II',v=new DataView(mn.buffer,mn.byteOffset,mn.byteLength);
    for(let i=0;i<v.getUint16(14,little);i++){const p=16+12*i;if(v.getUint16(p,little)===id){v.setUint32(p+4,1,little);return bytes;}}
    throw Error('MakerNote tag missing');
  };
  exif=fixCount(injectAppleMakerNoteTag(exif,rational(52489,79007),0x21,10),0x21);
  exif=fixCount(injectAppleMakerNoteTag(exif,rational(11443,153779),0x30,10),0x30);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),ids,p3;
  // Legacy Apple HEICs can carry an ICC profile whose desc payload is ASCII "Display P3".
  const p3Colr=box('colr',concat([new TextEncoder().encode('prof'),new TextEncoder().encode('Display P3')]));
  [meta,p3]=appendIpcoProperty(meta,p3Colr);
  const primaryProps=d.props.associations.get(d.primary).filter(a=>d.props.properties[a.index-1].type!=='colr').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,d.primary,[...primaryProps,[p3,false]]);
  [meta,ids]=addItems(meta,[{key:'legacy-65536-xmp',itemType:'mime',contentType:'application/rdf+xml',refType:'cdsc',refTo:[d.hdrGrid]}]);
  const maker48=11443/153779,expectedStops=-0.101*maker48+1.601;
  const xmp=new TextEncoder().encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>${2**expectedStops}</HDRGainMap:HDRGainMapHeadroom></rdf:Description></rdf:RDF></x:xmpmeta>`);
  const ft=topBox(source,'ftyp');
  source=rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map([[ids.get('legacy-65536-xmp'),xmp],[d.exifItem,exif]]));
  d=discoverHeic(source);
  const result=buildAiPortrait(source,depth,template,{legacyHdrNormalized:true}),after=discoverHeic(result.data);
  assert.equal(result.report.legacyHdrCompatibility,'normalized-portrait-tmap');
  const tmap=[...after.infos].find(([,info])=>info.type==='tmap')?.[0];
  assert.ok(tmap);
  const params=parseTmapMetadata(extractItemData(result.data,after,tmap));
  assert.ok(Math.abs(params.alternateHeadroom-expectedStops)<1e-6);
  assert.equal(params.useBaseColorSpace,true);
  assert.equal(params.channels[0].baseOffset,0);
  const depthId=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
  assert.deepEqual(after.refs.find(r=>r.type==='auxl'&&r.from===depthId)?.to,[after.primary,tmap]);
  assert.deepEqual(extractItemData(result.data,after,after.hdrGrid),gainBefore,'HDR gain map must remain byte-exact');
});

test('unrelated or ambiguous tmap dependencies do not invent an HDR role',()=>{
  const infos=new Map([[1,{type:'grid'}],[2,{type:'hvc1'}],[3,{type:'tmap'}],[4,{type:'tmap'}],[5,{type:'hvc1'}]]);
  assert.equal(tmapGainMap(infos,new Map([[3,[1,2]]]),1),2);
  assert.equal(tmapGainMap(infos,new Map([[3,[2,1]]]),1),null);
  assert.equal(tmapGainMap(infos,new Map([[3,[1,1]]]),1),null);
  assert.equal(tmapGainMap(infos,new Map([[3,[1,99]]]),1),null);
  assert.equal(tmapGainMap(infos,new Map([[3,[1,2]],[4,[1,5]]]),1),null);
});

function incompleteBrightIso({model='iPhone 16 Pro',preset=16,complete=false,parameters={},mutate}={}){
  let base=withCamera(withMarker(photo(4032,3024,'45-15'),
    buildBplist(new Map([['3',1],['1',-.5],['4',preset],['2',.5],['0',1],['5',0]]))),model);
  let d=discoverHeic(base);
  const hdrSides=d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(d.hdrGrid)).map(r=>r.from);
  if(hdrSides.length)base=withoutThumbnail(base,hdrSides);
  d=discoverHeic(base);
  let meta=base.slice(d.meta.off,d.meta.off+d.meta.size),ids;
  [meta,ids]=addItems(meta,[{key:'iso-hdr',itemType:'tmap',refType:'dimg',refTo:[d.primary,d.hdrGrid]}]);
  const metadata=encodeTmapMetadata({baseHeadroom:0,alternateHeadroom:2,useBaseColorSpace:false,
    channels:[{min:0,max:2,gamma:1,baseOffset:.005,alternateOffset:.005}],...parameters});
  mutate?.(metadata);
  const keep=d.props.associations.get(d.hdrGrid).filter(a=>d.props.properties[a.index-1].type!=='auxC').map(a=>[a.index,a.essential]);
  meta=setItemPropertyAssociations(meta,d.hdrGrid,keep);
  const ft=topBox(base,'ftyp');
  base=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),meta,new Map([[ids.get('iso-hdr'),metadata]]));
  if(complete)return base;
  d=discoverHeic(base);
  return withoutThumbnail(base,[d.stylesItem,d.deltaGrid,d.linearThumb]);
}

test('opt-in Bright reconstruction matches K and carries own HDR headroom without replacing samples',async()=>{
  const source=incompleteBrightIso(),before=discoverHeic(source),profile=buildGeneratedProfile('48-12',assets);
  const saved=profile.mn54.slice();
  assert.equal(editableTmapHeadroom(source),4);
  const output=await executeJob({operation:'patch',data:source,profile,opts:{reconstructedBright:true,experimental:true,linearThumb:testLinearThumb}});
  const after=discoverHeic(output.data),marker=parseBplist(selectedStyle(output.data).payload);
  assert.equal(output.report.styleSelectionCompatibility,'bright-palette70');
  assert.deepEqual([marker.get('4'),marker.get('1'),marker.get('2'),marker.get('3')],[16,0,0,.7]);
  assert.deepEqual(profile.mn54,saved);
  const sides=after.refs.filter(r=>r.type==='cdsc'&&r.to.includes(after.hdrGrid));
  const own=sides.map(r=>new TextDecoder().decode(extractItemData(output.data,after,r.from))).find(s=>s.includes('HDRGainMapHeadroom'));
  assert.ok(own.includes('<HDRGainMap:HDRGainMapHeadroom>4.000000000</'));
  for(const ids of ['primaryTiles','hdrTiles'])before[ids].forEach((id,i)=>
    assert.deepEqual(extractItemData(output.data,after,after[ids][i]),extractItemData(source,before,id)));
  const oldMap=[...before.infos].find(([,info])=>info.type==='tmap')[0];
  const newMap=[...after.infos].find(([,info])=>info.type==='tmap')[0];
  assert.deepEqual(extractItemData(output.data,after,newMap),extractItemData(source,before,oldMap));
  assert.equal(registerTmapHdr(output.data,{headroom:true}),null);
  const portrait=buildAiPortrait(output.data,depth,template).data,pd=discoverHeic(portrait);
  const portraitSide=pd.refs.find(r=>r.type==='cdsc'&&r.to.includes(pd.hdrGrid));
  assert.equal(new TextDecoder().decode(extractItemData(portrait,pd,portraitSide.from)),own);
  assert.deepEqual(selectedStyle(portrait),selectedStyle(output.data));
});

test('automatic incomplete native Portrait gains Styles/Texture while preserving the real source selection',async()=>{
  const source=capture(attachAiDepth(incompleteBrightIso(),depth),12,0),before=discoverHeic(source);
  const profile=buildGeneratedProfile('48-12',assets),saved=profile.mn54.slice();
  const output=await executeJob({operation:'patch',data:source,profile,opts:{portraitStyleRebuild:true,experimental:true,linearThumb:testLinearThumb}});
  const after=discoverHeic(output.data);
  assert.equal(output.report.styleSelectionCompatibility,'portrait-source-selection');
  assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
  assert.ok(after.stylesItem!==null&&hasTexture(after.infos));
  assert.equal((await executeJob({operation:'native-portrait',data:output.data})).data,null);
  for(const role of ['primaryTiles','hdrTiles'])before[role].forEach((id,i)=>
    assert.deepEqual(extractItemData(output.data,after,after[role][i]),extractItemData(source,before,id)));
  const id=[...before.infos.keys()].find(id=>auxUriForItem(before.props,id)===DEPTH_URI);
  assert.deepEqual(extractItemData(output.data,after,id),extractItemData(source,before,id));
  assert.ok(after.refs.filter(r=>r.type==='cdsc'&&r.to.includes(after.hdrGrid)).some(r=>
    new TextDecoder().decode(extractItemData(output.data,after,r.from)).includes('HDRGainMapHeadroom>4.000000000')));
  assert.deepEqual(profile.mn54,saved);
});

test('measured sharp native background restores aperture without altering reconstructed Bright or HDR',async()=>{
  const source=capture(attachAiDepth(incompleteBrightIso(),depth),12,0),profile=buildGeneratedProfile('48-12',assets);
  const sharpBackgroundEvidence={method:'native-background-detail-v1',detailedTiles:3,farTiles:16};
  const output=await executeJob({operation:'patch',data:source,profile,
    opts:{portraitStyleRebuild:true,sharpBackgroundEvidence,experimental:true,linearThumb:testLinearThumb}});
  const marker=parseBplist(selectedStyle(output.data).payload);
  assert.equal(output.report.styleSelectionCompatibility,'portrait-source-selection');
  assert.deepEqual([marker.get('4'),marker.get('1'),marker.get('2'),marker.get('3')],[16,-.5,.5,1]);
  assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
  const restored=await executeJob({operation:'native-portrait',data:output.data,opts:{template,sharpBackgroundEvidence}});
  assert.equal(restored.report.mode,'restored-native-portrait');
  assert.deepEqual(selectedStyle(restored.data),selectedStyle(output.data));
  const before=discoverHeic(output.data),after=discoverHeic(restored.data);
  for(const role of ['primaryTiles','hdrTiles'])before[role].forEach((id,i)=>
    assert.deepEqual(extractItemData(restored.data,after,after[role][i]),extractItemData(output.data,before,id)));
  for(const evidence of [true,{}, {...sharpBackgroundEvidence,detailedTiles:2}])
    assert.equal((await executeJob({operation:'native-portrait',data:output.data,opts:{template,sharpBackgroundEvidence:evidence}})).data,null);
});

test('native Portrait reconstruction does not reset complete native Styles or an unrelated photo',async()=>{
  const profile=buildGeneratedProfile('48-12',assets);
  for(const source of [incompleteBrightIso(),capture(attachAiDepth(incompleteBrightIso({complete:true}),depth),12,0)]){
    const out=await executeJob({operation:'patch',data:source,profile,opts:{portraitStyleRebuild:true,experimental:true,linearThumb:testLinearThumb}});
    assert.equal(out.report.styleSelectionCompatibility,undefined);
    assert.deepEqual(selectedStyle(out.data),selectedStyle(source));
  }
});

test('Bright compatibility is never implicit or applied to complete native Styles or other cameras/presets',async()=>{
  const profile=buildGeneratedProfile('48-12',assets);
  for(const settings of [{},{model:'iPhone 13 Pro'},{model:'iPhone 17 Pro'},{preset:1},{complete:true}]){
    const source=incompleteBrightIso(settings);
    const output=await executeJob({operation:'patch',data:source,profile,
      opts:{reconstructedBright:Object.keys(settings).length>0,experimental:true,linearThumb:testLinearThumb}});
    assert.equal(output.report.styleSelectionCompatibility,undefined);
    assert.deepEqual(selectedStyle(output.data),selectedStyle(source));
  }
});

test('HDR headroom compatibility rejects unknown ISO headers and unsupported gain equations',()=>{
  const rejected=[
    {mutate:bytes=>bytes[0]=1},
    {mutate:bytes=>bytes[2]=1},
    {mutate:bytes=>bytes[4]=1},
    {mutate:bytes=>bytes[5]=32},
    {mutate:bytes=>bytes.fill(0,18,22)},
    {parameters:{baseHeadroom:1}},
    {parameters:{alternateHeadroom:17}},
    {parameters:{channels:[{min:-1,max:2,gamma:1,baseOffset:.005,alternateOffset:.005}]}},
    {parameters:{channels:[{min:0,max:2,gamma:2,baseOffset:.005,alternateOffset:.005}]}},
    {parameters:{channels:[{min:0,max:2,gamma:1,baseOffset:.005,alternateOffset:.01}]}},
  ];
  for(const options of rejected){
    const source=incompleteBrightIso(options);
    assert.equal(editableTmapHeadroom(source),null);
    const registered=registerTmapHdr(source,{headroom:true}),after=discoverHeic(registered);
    assert.ok(![...after.infos].some(([id,info])=>info.type==='mime'
      &&new TextDecoder().decode(extractItemData(registered,after,id)).includes('HDRGainMapHeadroom')));
  }
});

test('headroom-only registration keeps all existing payloads and refuses to replace existing HDR metadata',()=>{
  const source=incompleteBrightIso(),registered=registerTmapHdr(source),before=discoverHeic(registered);
  assert.equal(registerTmapHdr(registered),null);
  const output=registerTmapHdr(registered,{headroom:true}),after=discoverHeic(output);
  for(const id of before.infos.keys())assert.deepEqual(extractItemData(output,after,id),extractItemData(registered,before,id));
  assert.equal(registerTmapHdr(output,{headroom:true}),null);
});

test('unknown Styles contracts are preserved instead of silently downgraded into Portrait',()=>{
  const base=photo(900,600),d=discoverHeic(base),plist=parseBplist(extractItemData(base,d,d.stylesItem),{preserveReals:true});
  plist.set('0',999);plist.set('future-resource',new Uint8Array([9,3,42]));
  const source=withStyles(base,buildBplist(plist)),saved=source.slice();
  assert.deepEqual(styleCapabilities(source),{native:true,schema:999,editable:false});
  assert.equal(portraitEligibility(source),'unverified-styles');
  assert.throws(()=>buildAiPortrait(source,depth,template),/Unsupported Styles schema/);assert.deepEqual(source,saved);
  plist.set('0',14);
  const known=withStyles(base,buildBplist(plist)),output=buildAiPortrait(known,depth,template).data,after=discoverHeic(output);
  assert.deepEqual(extractItemData(output,after,after.stylesItem),extractItemData(known,discoverHeic(known),discoverHeic(known).stylesItem),'unknown keys in a supported opaque payload survive byte-exactly');
});

test('flag-bearing native v16 Styles remain eligible for still Portrait without a MOV',()=>{
  const base=photo(900,600),d=discoverHeic(base),plist=parseBplist(extractItemData(base,d,d.stylesItem),{preserveReals:true});
  plist.set('0',131088);
  const source=withStyles(base,buildBplist(plist)),before=discoverHeic(source);
  assert.deepEqual(styleCapabilities(source),{native:true,schema:131088,editable:true});
  assert.equal(portraitEligibility(source),null);
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.deepEqual(extractItemData(output,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
  assert.equal(parseBplist(extractItemData(output,after,after.stylesItem)).get('0'),131088);
});

const liveFixture=new URL('../private-fixtures/LivePhoto_0471/IMG_0471.HEIC',import.meta.url);
test('reported iPhone 16 Pro Live Photo builds editable still Portrait with native colour and HDR intact',{
  skip:!fs.existsSync(liveFixture),
},()=>{
  const source=new Uint8Array(fs.readFileSync(liveFixture)),saved=source.slice(),before=discoverHeic(source);
  assert.ok(photoContentIdentifier(source));assert.equal(portraitEligibility(source),null);
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.equal(photoContentIdentifier(output),photoContentIdentifier(source));
  assert.deepEqual(source,saved);
  assert.deepEqual(extractItemData(output,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
  assert.deepEqual(selectedStyle(output),selectedStyle(source));
  for(const [a,b]of[[before.primary,after.primary],[before.deltaGrid,after.deltaGrid],[before.hdrGrid,after.hdrGrid]]){
    const aa=before.refs.find(r=>r.type==='dimg'&&r.from===a).to,bb=after.refs.find(r=>r.type==='dimg'&&r.from===b).to;
    assert.equal(aa.length,bb.length);
    aa.forEach((id,i)=>assert.deepEqual(extractItemData(output,after,bb[i]),extractItemData(source,before,id)));
  }
  assert.ok([...after.infos.keys()].some(id=>auxUriForItem(after.props,id)===DEPTH_URI));
});
test('Portrait and revised focus retain the source Live Photo identifier without inventing one',()=>{
  const base=photo(900,600),d=discoverHeic(base),ft=topBox(base,'ftyp'),id=new TextEncoder().encode('live-photo-portable-identifier\0');
  const exif=injectAppleMakerNoteTag(extractItemData(base,d,d.exifItem),id,0x11,2);
  const source=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
  for(const settings of [{},{focusX:.2,focusY:.7,aperture:8}]){
    const output=buildAiPortrait(source,depth,template,settings).data,after=discoverHeic(output);
    assert.equal(photoContentIdentifier(output),'live-photo-portable-identifier');
    assert.deepEqual(extractAppleMakerNoteTag(extractItemData(output,after,after.exifItem),0x11).payload,id);
  }
  assert.equal(photoContentIdentifier(buildAiPortrait(base,depth,template).data),null);
});
test('editable Portrait keeps own primary, HDR, delta, thumbnails and Texture across geometries',()=>{
  for(const[w,h]of[[900,600],[3024,4032],[1200,1200],[8000,1000]]){
    const source=photo(w,h),before=discoverHeic(source);
    const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
    for(const[oldId,newId]of[[before.primary,after.primary],[before.hdrGrid,after.hdrGrid],
      [before.deltaGrid,after.deltaGrid],[before.thumbnail,after.thumbnail],[before.linearThumb,after.linearThumb]]){
      assert.deepEqual(extractItemData(output,after,newId),extractItemData(source,before,oldId));
      for(const type of ['ispe','hvcC','colr','irot','imir'])
        assert.deepEqual(propertyBoxBytes(output,after.props,newId,type),propertyBoxBytes(source,before.props,oldId,type));
    }
    before.primaryTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(output,after,after.primaryTiles[i])));
    assert.ok(hasTexture(after.infos));
    const id=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
    assert.deepEqual(dimensionsForItem(after.props,id),[64,64]);
    assert.deepEqual(extractItemData(output,after,id),depth.payload);
    assert.equal(portraitEligibility(output),'existing-depth');
    const flag=extractAppleMakerNoteTag(extractItemData(output,after,after.exifItem),0x1f);
    const marker=parseBplist(extractAppleMakerNoteTag(extractItemData(output,after,after.exifItem)).payload);
    assert.equal(marker.get('4'),1);assert.equal(marker.get('1'),0);assert.equal(marker.get('2'),0);
    assert.deepEqual(flag.payload,Uint8Array.of(0,0,0,1));
    assert.equal(exifCameraModel(extractItemData(output,after,after.exifItem)),null,'no reference camera attribution');
    assert.throws(()=>buildAiPortrait(output,depth,template),/Existing depth/);
  }
});

test('edited Styles images without ordinary thumbnails retain their own images in Portrait',()=>{
  const source=withoutThumbnail(photo(4032,3024)),saved=source.slice(),before=discoverHeic(source);
  assert.equal(before.thumbnail,null);
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.deepEqual(source,saved);assert.equal(after.thumbnail,null);
  assert.ok(!after.refs.some(ref=>ref.type==='thmb'),'no borrowed or dangling thumbnail');
  for(const [from,to]of [[before.primary,after.primary],[before.hdrGrid,after.hdrGrid],[before.deltaGrid,after.deltaGrid],[before.linearThumb,after.linearThumb],[before.stylesItem,after.stylesItem]]){
    assert.deepEqual(extractItemData(output,after,to),extractItemData(source,before,from));
    const oldTiles=before.refs.find(ref=>ref.type==='dimg'&&ref.from===from)?.to||[];
    const newTiles=after.refs.find(ref=>ref.type==='dimg'&&ref.from===to)?.to||[];
    oldTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(output,after,newTiles[i])));
  }
  assert.deepEqual(selectedStyle(output),selectedStyle(source));assert.equal(portraitEligibility(output),'existing-depth');
});

const editedFixture=new URL('../private-fixtures/IMG_1015.HEIC',import.meta.url);
test('reported edited IMG_1015 without thumbnail accepts Portrait and preserves Styles',{skip:!fs.existsSync(editedFixture)},()=>{
  const source=new Uint8Array(fs.readFileSync(editedFixture)),before=discoverHeic(source);
  assert.equal(before.thumbnail,null);
  const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
  assert.equal(after.thumbnail,null);assert.equal(portraitEligibility(output),'existing-depth');
  assert.deepEqual(selectedStyle(output),selectedStyle(source));
  assert.deepEqual(extractItemData(output,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
  for(const [from,to]of [[before.primary,after.primary],[before.deltaGrid,after.deltaGrid]]){
    const oldTiles=before.refs.find(ref=>ref.type==='dimg'&&ref.from===from).to,newTiles=after.refs.find(ref=>ref.type==='dimg'&&ref.from===to).to;
    oldTiles.forEach((id,i)=>assert.deepEqual(extractItemData(source,before,id),extractItemData(output,after,newTiles[i])));
  }
});

test('larger native delta/HDR grids extend the Portrait graph without losing tiles',()=>{
  const source=photo(900,600,'45-15'),a=discoverHeic(source);
  assert.equal(a.deltaTiles.length,48);
  const output=buildAiPortrait(source,depth,template,{nativeStyles:true}).data,b=discoverHeic(output);
  for(const [before,after]of [[a.primary,b.primary],[a.deltaGrid,b.deltaGrid],[a.hdrGrid,b.hdrGrid]]){
    const old=a.refs.find(r=>r.type==='dimg'&&r.from===before).to,newTiles=b.refs.find(r=>r.type==='dimg'&&r.from===after).to;
    assert.equal(newTiles.length,old.length);
    old.forEach((id,i)=>{
      assert.deepEqual(extractItemData(output,b,newTiles[i]),extractItemData(source,a,id));
      for(const type of ['ispe','hvcC','colr'])assert.deepEqual(propertyBoxBytes(output,b.props,newTiles[i],type),propertyBoxBytes(source,a.props,id,type));
    });
  }
  assert.equal(b.refs.find(r=>r.type==='dimg'&&r.from===b.hdrGrid).to.length,15);
  assert.deepEqual(extractItemData(output,b,b.stylesItem),extractItemData(source,a,a.stylesItem));
});
test('Portrait retains complete generated and native Styles, including per-photo skin statistics',()=>{
  const base=photo(900,600),bd=discoverHeic(base);
  for(const blob of [extractItemData(base,bd,bd.stylesItem),Uint8Array.from(Buffer.from(template.styles,'base64'))]){
    const styles=parseBplist(blob,{preserveReals:true});
    // A detected face's measured statistics must not be exchanged for the
    // capture template's empty person/skin blocks while retaining its masks.
    styles.get('6').set('ToneMappedImageSkinBased',new Map([['p50',new BplistReal(.4123)],['highKey',new BplistReal(1)]]));
    const source=withStyles(base,buildBplist(styles)),saved=source.slice(),before=discoverHeic(source);
    for(const settings of [{},{focusX:.2,focusY:.8,aperture:2}]){
      const out=buildAiPortrait(source,depth,template,settings).data,after=discoverHeic(out);
      assert.deepEqual(source,saved);
      assert.deepEqual(extractItemData(out,after,after.stylesItem),extractItemData(source,before,before.stylesItem));
      assert.deepEqual(selectedStyle(out),selectedStyle(source),'selected Style marker retained');
    }
  }
});

test('one-step generated Styles plus Portrait matches the successful re-upload route',()=>{
  const source=photo(900,600),d=discoverHeic(source);
  // Previously false replaced the completed Styles with reference camera
  // coefficients, while true preserved them after download/re-upload.
  const direct=buildAiPortrait(source,depth,template,{nativeStyles:false}).data;
  const reuploaded=buildAiPortrait(source.slice(),depth,template,{nativeStyles:true}).data;
  assert.deepEqual(direct,reuploaded);
  const after=discoverHeic(direct);
  assert.deepEqual(extractItemData(direct,after,after.stylesItem),extractItemData(source,d,d.stylesItem));
});

test('AI Portrait preserves original HDR tag presence instead of inventing a newer HDRGain',()=>{
  const base=photo(900,600),d=discoverHeic(base),ft=topBox(base,'ftyp');
  let exif=injectAppleMakerNoteTag(extractItemData(base,d,d.exifItem),concat([be(63809,4),be(37837,4)]),0x21,10);
  const mn=getMakerNoteBlob(exif),little=mn[12]===73,v=new DataView(mn.buffer,mn.byteOffset,mn.byteLength);
  for(let i=0;i<v.getUint16(14,little);i++){const p=16+12*i;if(v.getUint16(p,little)===0x21)v.setUint32(p+4,1,little);}
  const source=rebuildHeic(base,d,base.slice(0,ft.size),base.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
  const out=buildAiPortrait(source,depth,template).data,a=discoverHeic(out),outExif=extractItemData(out,a,a.exifItem);
  assert.deepEqual(extractAppleMakerNoteTag(outExif,0x21).payload,extractAppleMakerNoteTag(exif,0x21).payload);
  assert.throws(()=>extractAppleMakerNoteTag(outExif,0x30),/not found/,'absent HDRGain must stay absent');
  const plain=buildAiPortrait(base,depth,template).data,b=discoverHeic(plain);
  for(const id of [0x21,0x30])assert.throws(()=>extractAppleMakerNoteTag(extractItemData(plain,b,b.exifItem),id),/not found/);
});

test('exported depth uses the same ordered rotation/mirror transform as the primary',()=>{
  const base=photo(900,600),d=discoverHeic(base),ft=topBox(base,'ftyp');
  for(const order of [['irot','imir'],['imir','irot']]){
    let meta=base.slice(d.meta.off,d.meta.off+d.meta.size);const indices=[];
    for(const type of order){let index;[meta,index]=appendIpcoProperty(meta,box(type,Uint8Array.of(type==='irot'?1:0)));indices.push([index,true]);}
    const own=(d.props.associations.get(d.primary)||[]).filter(a=>!['irot','imir'].includes(d.props.properties[a.index-1].type));
    meta=setItemPropertyAssociations(meta,d.primary,[...own.map(a=>[a.index,a.essential]),...indices]);
    const source=rebuildHeic(base,d,base.slice(ft.off,ft.off+ft.size),meta,new Map());
    const output=buildAiPortrait(source,depth,template).data,after=discoverHeic(output);
    const id=[...after.infos.keys()].find(id=>auxUriForItem(after.props,id)===DEPTH_URI);
    assert.deepEqual(itemOrientation(output,after.props,id),itemOrientation(output,after.props,after.primary));
    const types=i=>(after.props.associations.get(i)||[]).map(a=>after.props.properties[a.index-1].type).filter(t=>['irot','imir'].includes(t));
    assert.deepEqual(types(id),order);assert.deepEqual(types(after.primary),order);
  }
});

test('Bright preset and non-neutral Tone/Colour survive both AI routes and focus changes',()=>{
  const base=photo(900,600),marker=parseBplist(selectedStyle(base).payload,{preserveReals:true});
  // Captured selection from the reported IMG_0932 (Bright, adjusted pad).
  marker.set('1',new BplistReal(-.5));marker.set('2',new BplistReal(.5));marker.set('4',16);
  const source=withMarker(base,buildBplist(marker)),expected=selectedStyle(source),saved=source.slice();
  for(const nativeStyles of [false,true])for(const settings of [{},{focusX:.1,focusY:.8,aperture:2}]){
    const output=buildAiPortrait(source,depth,template,{nativeStyles,...settings}).data;
    assert.deepEqual(selectedStyle(output),expected,'selected preset/pad must not come from the neutral capture template');
    if(nativeStyles){
      const a=discoverHeic(source),b=discoverHeic(output);
      assert.deepEqual(extractItemData(output,b,b.stylesItem),extractItemData(source,a,a.stylesItem));
    }
  }
  assert.deepEqual(source,saved);
});

test('a corrupt input selection cannot silently fall back to Standard',()=>{
  const source=photo(900,600),broken=selectedStyle(source).payload.subarray(0,40);
  assert.throws(()=>buildAiPortrait(withMarker(source,broken),depth,template),/Invalid binary plist/);
});
test('public reference contains metadata only, without photographic payloads or attribution',()=>{
  assert.deepEqual(Object.keys(template).sort(),['depthXmp','description','ftyp','maker','makerLittle','meta','styles','version'].sort());
  assert.ok(!template.maker.some(t=>[3,0x17,0x20,0x25,0x2b].includes(t.id)||t.type===2));
  const sizes={1:1,3:2,4:4,5:8,7:1,9:4,10:8,16:8,17:8,18:8};
  for(const t of template.maker)assert.equal(t.count*sizes[t.type],Buffer.from(t.payload,'base64').length,'MakerNote count must describe the rebuilt payload');
  const meta=Uint8Array.from(Buffer.from(template.meta,'base64')),d=discoverHeic(meta);
  for(const item of d.iloc.items.values())if(item.constructionMethod===0)
    for(const e of item.extents){assert.equal(e.offset,0);assert.equal(e.length,0);}
  assert.doesNotMatch(JSON.stringify(template),/2026-02-11|IMG_5129|WanThinnn|CreateDate/);
});
test('truncated Styles marker is rejected instead of allocating from a corrupt trailer',()=>{
  const marker=Uint8Array.from(Buffer.from(template.maker.find(t=>t.id===84).payload,'base64'));
  assert.throws(()=>parseBplist(marker.subarray(0,115)),/Invalid binary plist/);
  assert.equal(parseBplist(marker).get('4'),1);
});
test('focus/aperture changes reuse every encoded image and depth payload',()=>{
  const source=photo(900,600),a=buildAiPortrait(source,depth,template).data;
  const b=buildAiPortrait(source,depth,template,{focusX:.2,focusY:.7,aperture:2.8}).data;
  const ad=discoverHeic(a),bd=discoverHeic(b);
  for(const[id,info]of ad.infos)if(['hvc1','grid'].includes(info.type))
    assert.deepEqual(extractItemData(a,ad,id),extractItemData(b,bd,id));
  const did=[...bd.infos.keys()].find(id=>auxUriForItem(bd.props,id)===DEPTH_URI),side=bd.refs.find(r=>r.type==='cdsc'&&r.to.includes(did)).from;
  assert.match(new TextDecoder().decode(extractItemData(b,bd,side)),/SimulatedAperture>2.800000/);
});

test('scene calibration is fixed per capture while refocusing and changing aperture only update editing metadata',{
  skip:!fs.existsSync(acceptedJ4Source),
},async()=>{
  const {addTexture}=await import('../../web/src/styles/texture.js');
  const source=addTexture(new Uint8Array(fs.readFileSync(acceptedJ4Source)),{preserveStyles:true}).data;
  const gray=new Uint8Array(depth.width*depth.height).fill(40);
  for(let y=24;y<40;y++)for(let x=24;x<40;x++)gray[y*depth.width+x]=200;
  const sceneProfile=describePortraitScene(gray,depth.width,depth.height);
  const calibrated={...depth,floatMax:3,relativeResponse:'scene-v3',sceneProfile};
  const a=buildAiPortrait(source,calibrated,template,{aperture:1.4});
  const b=buildAiPortrait(source,calibrated,template,{focusX:.2,focusY:.7,aperture:16});
  assert.equal(a.report.sceneResponseApplied,true);assert.equal(b.report.sceneResponseApplied,true);
  assert.equal(a.report.disparityMax,b.report.disparityMax);
  assert.equal(a.report.previewDisparityMax,b.report.previewDisparityMax);
  const ad=discoverHeic(a.data),bd=discoverHeic(b.data);
  for(const[id,info]of ad.infos)if(['hvc1','grid'].includes(info.type))
    assert.deepEqual(extractItemData(a.data,ad,id),extractItemData(b.data,bd,id));
});
