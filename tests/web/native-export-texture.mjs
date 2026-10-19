import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeStyleExport} from './helpers/native-style-export.mjs';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,ispeBox} from '../../web/src/core/heif.js';
import {box} from '../../web/src/core/box.js';
import {hasTexture,MATTE_2026_URIS} from '../../web/src/styles/texture.js';
import {nativeStyleExportTextureCandidate,preserveNativeStyles,useTextureOnlyNativeStylePath} from '../../web/src/styles/style-preservation.js';
import {processNativeFile} from './helpers/file-processor-harness.mjs';
import {loadProfile} from '../../web/src/core/zip.js';
import {addTexture} from '../../web/src/styles/texture.js';

function assertSourcePreserved(source,data){
  const a=discoverHeic(source),b=discoverHeic(data);
  for(const [id,item]of a.iloc.items){
    const read=(bytes,d)=>item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
    assert.deepEqual(read(data,b),read(source,a),'source payload '+id);
    const properties=(bytes,d)=>(d.props.associations.get(id)||[]).map(ref=>{
      const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
    });
    assert.deepEqual(properties(data,b),properties(source,a),'source properties '+id);
    assert.deepEqual(b.refs.filter(r=>r.from===id),a.refs.filter(r=>r.from===id),'source references '+id);
  }
  assert.equal(b.primary,a.primary);assert.equal(b.stylesItem,a.stylesItem);
}

test('experimental Texture writer preserves preset/pixels/HDR; this does not establish Photos controls',async()=>{
  for(const preset of [1,4,8,16]){
    const source=await nativeStyleExport({preset,tone:.2,color:-.1,palette:.8}),saved=source.slice();
    const {data}=await executeJob({operation:'texture',data:source,opts:{preserveStyles:true,allowMissingStyles:true}});
    const d=discoverHeic(data);
    assert.equal(hasTexture(d.infos),true);
    assert.equal([...d.infos.keys()].filter(id=>MATTE_2026_URIS.includes(auxUriForItem(d.props,id))).length,12);
    assertSourcePreserved(source,data);assert.deepEqual(source,saved);
  }
});

test('no-op repair does not register a second HDR role on native exports',async()=>{
  for(const modernMarker of [false,true]){
    const source=await nativeStyleExport({modernMarker});
    const result=await executeJob({operation:'repair-texture',data:source,opts:{preserveStyles:true}});
    assert.deepEqual(result.data||source,source);
  }
});

test('diagnostic detection recognizes six-key presets without claiming Photos compatibility',async()=>{
  for(const preset of Array.from({length:16},(_,i)=>i+1))
    assert.equal(nativeStyleExportTextureCandidate(await nativeStyleExport({preset})),true);
  for(const options of [{model:'iPhone 15 Pro'},{model:'iPhone 18 Pro'},{model:'Android'},
    {modernMarker:true},{iso:false},{preset:0},{preset:17},{tone:2},{color:NaN},{palette:2}])
    assert.equal(nativeStyleExportTextureCandidate(await nativeStyleExport(options)),false,JSON.stringify(options));
});

test('six-key Current exports bypass Texture-only and route to graph reconstruction',async()=>{
  for(const preset of [1,4,8,16]){
    const source=await nativeStyleExport({preset}),d=discoverHeic(source);
    const textureOnly=preserveNativeStyles(source,d);
    const editedStyleExportCandidate=nativeStyleExportTextureCandidate(source,d);
    assert.equal(textureOnly,true);assert.equal(editedStyleExportCandidate,true);
    assert.equal(useTextureOnlyNativeStylePath({textureOnly,rebuildNativePortrait:false,
      editedStyleExportCandidate,stylesItem:d.stylesItem}),false);
  }
  assert.equal(useTextureOnlyNativeStylePath({textureOnly:true,rebuildNativePortrait:false,
    editedStyleExportCandidate:false,stylesItem:119}),true,'complete native graph stays Texture-only');
  assert.equal(useTextureOnlyNativeStylePath({textureOnly:true,rebuildNativePortrait:true,
    editedStyleExportCandidate:false,stylesItem:null}),false,'native Portrait rebuild must reconstruct');
});

test('opaque native marker stays on exact preservation rather than experimental Texture',async()=>{
  const source=await nativeStyleExport({modernMarker:true}),result=await processNativeFile(source);
  assert.match(result.output.name,/_Preserved\.HEIC$/);assert.deepEqual(result.data,source);
  assert.ok(result.events.some(e=>e[0]==='advice'&&e[1]==='warn.nativeeditmissing'));
});

test('complete native originals stay on the existing Texture route for every tested Style and remain idempotent',async()=>{
  const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
  const asset=JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url))).assets.delta;
  const linearThumb={sample:Uint8Array.from(asset.payload),hvcC:Uint8Array.from(asset.hvcc),
    ispe:ispeBox(asset.width,asset.height),pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10))};
  for(const preset of [1,4,8,16]){
    // Build a portable complete native graph. The file processor must not call
    // its decoder/profile/reconstruction branches for this source shape.
    const capture=await nativeStyleExport({preset,tone:-.5,color:.5,modernMarker:true});
    const {data:source}=await executeJob({operation:'patch',data:capture,profile,opts:{experimental:true,texture:false,linearThumb}});
    const saved=source.slice(),before=discoverHeic(source);
    assert.notEqual(before.stylesItem,null);assert.equal(hasTexture(before.infos),false);
    const result=await processNativeFile(source);
    assert.ok(result.output);assert.match(result.output.name,/_TextureGrain\.HEIC$/);
    assert.deepEqual(result.data,addTexture(source,{preserveStyles:true}).data,'existing Texture writer remains byte-identical');
    assertSourcePreserved(source,result.data);assert.deepEqual(source,saved,'input remains immutable');
    const repeated=await processNativeFile(result.data);
    assert.deepEqual(repeated.data,result.data,'reprocessing adds no duplicate Texture or HDR resources');
  }
});

const directory=process.env.STYLIO_COMPARISON_DIR||'C:/Users/WanThinnn/Downloads/comparision';
const brightOriginal=process.env.STYLIO_BRIGHT_ORIGINAL||'C:/Users/WanThinnn/Downloads/IMG_1729.HEIC';
test('same-capture unedited Bright only gains Texture and matches the original Stylio control',{
  skip:!fs.existsSync(brightOriginal)||!fs.existsSync(directory+'/stylio-1.HEIC'),
},async()=>{
  const source=new Uint8Array(fs.readFileSync(brightOriginal)),result=await processNativeFile(source);
  assert.match(result.output.name,/_TextureGrain\.HEIC$/);
  assert.deepEqual(result.data,new Uint8Array(fs.readFileSync(directory+'/stylio-1.HEIC')));
  assertSourcePreserved(source,result.data);
});
for(const name of ['native-1.HEIC','native-2.HEIC'])test('reported '+name+' is recognized for edited graph reconstruction',{
  skip:!fs.existsSync(directory+'/'+name),
},()=>{
  const source=new Uint8Array(fs.readFileSync(directory+'/'+name)),d=discoverHeic(source);
  const textureOnly=preserveNativeStyles(source,d),editedStyleExportCandidate=nativeStyleExportTextureCandidate(source,d);
  assert.equal(editedStyleExportCandidate,true);assert.equal(textureOnly,true);
  assert.equal(useTextureOnlyNativeStylePath({textureOnly,rebuildNativePortrait:false,
    editedStyleExportCandidate,stylesItem:d.stylesItem}),false);
});

test('complete HDR-native fixture keeps the existing successful Texture output',{
  skip:!fs.existsSync(directory+'/HDR-native.HEIC')||!fs.existsSync(directory+'/HDR-stylio.HEIC'),
},async()=>{
  const source=new Uint8Array(fs.readFileSync(directory+'/HDR-native.HEIC'));
  const result=await processNativeFile(source);
  assert.deepEqual(result.data,new Uint8Array(fs.readFileSync(directory+'/HDR-stylio.HEIC')));
  assertSourcePreserved(source,result.data);
});
