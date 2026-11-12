import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {box,boxes,concat,be,u} from '../../web/src/core/box.js';
import {photoContentIdentifier,moviePairingMetadata,movieStyleTracks,validateLivePair,livePhotoPackage,createLivePhotoExport} from '../../web/src/media/live-photo.js';
import {addMovieTexture} from '../../web/src/media/native-movie-texture.js';
import {createNativeEngine,livePhotoDisposition} from '../../web/src/app/native-engine.js';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {readZip} from '../../web/src/core/zip.js';
import {addTexture} from '../../web/src/styles/texture.js';
import {discoverHeic, extractItem} from '../../web/src/core/heif.js';
import {injectAppleMakerNoteTag} from '../../web/src/core/exif.js';
import {buildAppleStyleExif} from '../../web/src/raster/exif.js';
import {buildGeneratedProfile} from '../../web/src/raster/generated-profile.js';
import {generateSyntheticHevc} from '../../web/src/raster/synthetic-hevc.js';
const txt=s=>new TextEncoder().encode(s);
const root='C:/Users/WanThinnn/Downloads/iCloud Photos (1)/iCloud Photos/';
const codecFixture=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url)));
const assets=await generateSyntheticHevc(null,async(_,options)=>{
  const asset=options.pixelFormat!=='gray'?codecFixture.assets.delta:options.width===768?codecFixture.assets.textureMask:codecFixture.assets.mask;
  return {...asset,hvcc:Uint8Array.from(asset.hvcc),payload:Uint8Array.from(asset.payload)};
});
function pairedPhoto(identifier,pixel=1){
  const profile=buildGeneratedProfile('48-12',assets),graph=discoverHeic(profile.meta),chunks=[];
  const exif=injectAppleMakerNoteTag(buildAppleStyleExif(profile.mn54),txt(identifier+'\0'),0x11,2);
  let offset=profile.ftyp.length+profile.meta.length+8;
  for(const [id,item]of graph.iloc.items){
    if(item.constructionMethod===1)continue;
    const payload=id===graph.exifItem?exif:graph.primaryTiles.includes(id)?Uint8Array.of(pixel):profile.retained.get(id)||Uint8Array.of(0);
    profile.meta.set(be(offset,graph.iloc.offsetSize),item.extents[0].offsetPos);
    profile.meta.set(be(payload.length,graph.iloc.lengthSize),item.extents[0].lengthPos);
    offset+=payload.length;chunks.push(payload);
  }
  return concat([profile.ftyp,profile.meta,box('mdat',concat(chunks))]);
}
function movie(id,fullBox=true) {
  const key=box('mdta',txt('com.apple.quicktime.content.identifier'));
  const keys=box('keys',concat([be(0,4),be(1,4),key]));
  const entry=concat([be(8+8+8+id.length,4),be(1,4),box('data',concat([be(1,4),be(0,4),txt(id)]))]);
  const meta=box('meta',concat([...(fullBox?[be(0,4)]:[]),keys,box('ilst',entry)]));
  return box('moov',concat([meta,box('trak',box('free',txt('com.apple.quicktime.still-image-time')))]));
}
test('MOV parser reads ISO and QuickTime metadata; rejects malformed box sizes',()=>{
  for(const fullBox of [true,false])assert.deepEqual(moviePairingMetadata(movie('test-identifier',fullBox)),
    {contentIdentifier:'test-identifier',hasStillImageTimeKey:true});
  assert.throws(()=>moviePairingMetadata(new Uint8Array([0,0,0,99,109,111,111,118])),/Invalid MOV/);
  assert.throws(()=>moviePairingMetadata(box('mdat',txt('com.apple.quicktime.content.identifier'))),/no movie metadata/);
});

test('native export can add the donor Texture track while keeping the paired video and still-image-time intact',()=>{
  const donor=new Uint8Array(fs.readFileSync(new URL('../../app/engine/live-photo-video/template.mov',import.meta.url)));
  const id='native-live-identifier',source=pairedPhoto(id),output=addTexture(source).data;
  const pair=movie(id,false).subarray(8);
  const prefix=concat([box('ftyp',txt('qt  ')),box('mdat',Uint8Array.of(91,92,93))]);
  const fields=(...values)=>concat(values.map(value=>be(value,4)));
  const tracks=['video-map.smart-style-linear-thumbnail','video-map.sky','video-map.person','video-map.skin','smartstyle-info'];
  const track=(trackID,handler,payload)=>box('trak',concat([
    box('tkhd',fields(0,0,0,trackID,0,3000)),
    box('mdia',concat([box('hdlr',concat([fields(0,0),txt(handler)])),...payload])),
  ]));
  const video=track(1,'vide',[box('mdhd',fields(0,0,0,1000,3000)),
    box('minf',box('stbl',box('stts',fields(0,1,3,1000))))]);
  // Give the synthetic still-image-time track a header so every track has an ID.
  const [meta,timed]=[...boxes(pair,0,pair.length)];
  const timedTrack=track(2,'meta',[box('free',pair.subarray(timed.off+8,timed.off+timed.size))]);
  const original=concat([prefix,box('moov',concat([
    box('mvhd',fields(0,8)),video,timedTrack,pair.subarray(meta.off,meta.off+meta.size),
    ...tracks.map((tag,i)=>track(i+3,'auxv',[box('free',txt('com.apple.quicktime.'+tag))])),
  ]))]);
  assert.equal(livePhotoDisposition(source,source,original),'compatible');
  assert.equal(livePhotoDisposition(source,output,movie(id)),'needs-tracks');
  assert.equal(livePhotoDisposition(source,output,movie('different-identifier')),'mismatch');
  assert.equal(livePhotoDisposition(source,output,original),'needs-texture');
  const patched=addMovieTexture(original,donor);
  assert.deepEqual(patched.subarray(0,prefix.length),prefix);
  assert.deepEqual(moviePairingMetadata(patched),moviePairingMetadata(original));
  assert.deepEqual(movieStyleTracks(patched),{styles:true,texture:true});
  assert.equal(livePhotoDisposition(source,output,patched),'compatible');
  const [, ,moov,newMedia]=[...boxes(patched,0,patched.length)];
  const members=[...boxes(patched,moov.off+moov.hdr,moov.off+moov.size)];
  assert.deepEqual(patched.subarray(members[1].off,members[1].off+members[1].size),video);
  assert.deepEqual(patched.subarray(members[2].off,members[2].off+members[2].size),timedTrack);
  const trackOffset=members.at(-1).off;
  const textureTrack=Buffer.from(patched.subarray(trackOffset,newMedia.off));
  const offset=trackOffset+textureTrack.indexOf('stco');
  assert.equal(u(patched,offset+12,4),newMedia.off+newMedia.hdr);
  assert.throws(()=>addMovieTexture(concat([original,box('free',new Uint8Array(0))]),donor),/layout/);
});

test('native engine inspects a shared still for its Live Photo identifier',async t=>{
  const source=pairedPhoto('shortcut-live-identifier');
  const graph=discoverHeic(source);
  const exif=extractItem(source,graph.iloc,graph.exifItem).subarray(4);
  const jpeg=concat([Uint8Array.of(255,216,255,225),be(exif.length+2,2),exif,Uint8Array.of(255,217)]);
  const photos=new Map([['/probes/paired',source],['/probes/converted',jpeg]]);
  t.mock.method(globalThis,'fetch',async route=>new Response(photos.get(route)??Uint8Array.of(255,216,255,217)));
  const engine=createNativeEngine(()=>{});
  for(const [route,format] of [['/probes/paired','heic'],['/probes/converted','jpeg']]){
    const info=await engine.inspectSharedPhoto(route);
    assert.equal(info.identifier,'shortcut-live-identifier');
    assert.equal(info.format,format);
  }
  assert.deepEqual(await engine.inspectSharedPhoto('/probes/unpaired'),{
    identifier:null,format:'jpeg',date:null,timestamp:null,
  });
});

test('native engine publishes the shared HEIC result through the file bridge',async t=>{
  const source=pairedPhoto('native-engine-identifier'),updates=[];
  let output;
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    if(path==='/jobs/test/input')return new Response(source);
    if(path==='/jobs/test/output'){
      assert.equal(options.method,'POST');
      assert.equal(options.headers['X-Stylio-Result'],'1');
      output=new Uint8Array(await options.body.arrayBuffer());
      return new Response();
    }
    throw Error(`Unexpected fetch ${path}`);
  });
  const originalWorker=globalThis.Worker;
  t.after(()=>{if(originalWorker)globalThis.Worker=originalWorker;else delete globalThis.Worker;});
  globalThis.Worker=class {
    postMessage({id,...job}){
      executeJob(job).then(result=>this.onmessage({data:{id,result}}),error=>this.onmessage({data:{id,error:error.message}}));
    }
    terminate(){}
  };
  const result=await createNativeEngine(event=>updates.push(event)).process({
    route:'/jobs/test',name:'original.HEIC',paired:false,
  });
  assert.match(result.name,/\.heic$/i);
  assert.equal(result.movie,'none');
  assert.equal(photoContentIdentifier(output),'native-engine-identifier');
  assert.ok(updates.some(event=>event.progress===100));
});

test('Live Photo ZIP follows final Portrait, focus updates and toggle restoration; late MOV also pairs',async()=>{
  const source=pairedPhoto('live-test-identifier'),mov=movie('live-test-identifier'),published=[];
  const exporter=createLivePhotoExport(source,{onReady:result=>published.push(result),onError:assert.fail});
  const normal=new File([source],'photo_Styles.HEIC');
  const portrait=new File([pairedPhoto('live-test-identifier',2)],'photo_Portrait.HEIC');
  const focus=new File([pairedPhoto('live-test-identifier',3)],'photo_Portrait.HEIC');
  await exporter.setOutput(portrait);assert.equal(published.length,0);
  await exporter.setMovie(mov);
  for(const file of [focus,normal,focus]){
    await exporter.setOutput(file);
    const latest=published.at(-1),files=await readZip(latest.data),manifest=JSON.parse(new TextDecoder().decode(files.get('pair.json')));
    assert.equal(latest.file,file);assert.equal(latest.name,file.name.replace(/\.[^.]+$/,'')+'_LivePhoto.zip');
    assert.deepEqual(files.get(manifest.photo),new Uint8Array(await file.arrayBuffer()));
    assert.deepEqual(files.get(manifest.movie),mov);assert.equal(manifest.contentIdentifier,'live-test-identifier');
  }
  assert.equal(published.length,4);exporter.dispose();
});

test('slow old output cannot replace a newer Live Photo ZIP or recreate a removed row',async()=>{
  const source=pairedPhoto('live-test-identifier'),published=[],errors=[];
  const exporter=createLivePhotoExport(source,{onReady:r=>published.push(r),onError:e=>errors.push(e)});
  await exporter.setMovie(movie('live-test-identifier'));
  let resolveOld;
  const old={name:'old.HEIC',arrayBuffer:()=>new Promise(resolve=>{resolveOld=resolve;})};
  const pending=exporter.setOutput(old),latest=new File([source],'latest.HEIC');
  await exporter.setOutput(latest);resolveOld(source.buffer);await pending;
  assert.equal(published.length,1);assert.equal(published[0].file,latest);
  const removed=exporter.setOutput(old);exporter.dispose();resolveOld(source.buffer);await removed;
  await exporter.setOutput(latest);assert.equal(published.length,1);assert.deepEqual(errors,[]);
});

test('changed Live Photo identifier fails closed and stale read failures are ignored',async()=>{
  const source=pairedPhoto('live-test-identifier'),errors=[];
  const exporter=createLivePhotoExport(source,{onReady:()=>assert.fail('invalid pair published'),onError:e=>errors.push(e)});
  await exporter.setMovie(movie('live-test-identifier'));
  let rejectOld;
  const pending=exporter.setOutput({name:'old.HEIC',arrayBuffer:()=>new Promise((_,reject)=>{rejectOld=reject;})});
  await exporter.setOutput(new File([pairedPhoto('different-identifier')],'changed.HEIC'));
  rejectOld(Error('stale failure'));await pending;
  assert.equal(errors.length,1);assert.match(errors[0].message,/changed/);exporter.dispose();
});

test('native processing preserves a real Live Photo identifier and all original external payloads',
  {skip:!fs.existsSync(root+'IMG_0487.HEIC')||!fs.existsSync(root+'IMG_0487.MOV')},async()=>{
    const photo=new Uint8Array(fs.readFileSync(root+'IMG_0487.HEIC'));
    const mov=new Uint8Array(fs.readFileSync(root+'IMG_0487.MOV'));
    const {data:output}=addTexture(photo);
    assert.equal(photoContentIdentifier(output),photoContentIdentifier(photo));
    const before=discoverHeic(photo),after=discoverHeic(output);
    for(const [id,item] of before.iloc.items)
      if(item.constructionMethod===0)
        assert.deepEqual(extractItem(output,after.iloc,id),extractItem(photo,before.iloc,id),`item ${id}`);
    const files=await readZip(livePhotoPackage(photo,output,mov,'Processed.HEIC'));
    assert.deepEqual(files.get('Processed.MOV'),mov);
    assert.deepEqual(files.get('Processed.HEIC'),output);
    const manifest=JSON.parse(new TextDecoder().decode(files.get('pair.json')));
    assert.equal(manifest.movieUnmodified,true);
    const other=new Uint8Array(fs.readFileSync(root+'IMG_0269.MOV'));
    assert.throws(()=>validateLivePair(photo,other),/do not match/);
  });
for(const name of ['IMG_0269','IMG_0487'])test(`real ${name} Live Photo metadata and lossless pair package`,
  {skip:!fs.existsSync(root+name+'.MOV')||!fs.existsSync(root+name+'.HEIC')},async()=>{
    const photo=new Uint8Array(fs.readFileSync(root+name+'.HEIC')),mov=new Uint8Array(fs.readFileSync(root+name+'.MOV'));
    const pairing=validateLivePair(photo,mov);assert.equal(photoContentIdentifier(photo),pairing.contentIdentifier);
    const zip=await readZip(livePhotoPackage(photo,photo,mov,name+'.HEIC'));
    assert.deepEqual(zip.get(name+'.MOV'),mov);assert.deepEqual(zip.get(name+'.HEIC'),photo);
    assert.equal(JSON.parse(new TextDecoder().decode(zip.get('pair.json'))).contentIdentifier,pairing.identifier);
    assert.throws(()=>validateLivePair(photo,movie('wrong-identifier')),/do not match/);
    assert.throws(()=>livePhotoPackage(photo,new Uint8Array(0),mov),/changed/);
  });
