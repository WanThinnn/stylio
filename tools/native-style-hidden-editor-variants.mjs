// Same-capture diagnostic: keep the exact native Standard primary/HDR/tmap for
// display, add an exact hidden Bright grid, and route the editable Styles graph
// to that Bright grid. AC uses only the hidden base; AD also keeps the displayed
// Standard pair as secondary targets so Photos can still discover the controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {
  addItems,
  appendIpcoProperty,
  auxUriForItem,
  dimensionsForItem,
  discoverHeic,
  extractItem,
  idatItemBytes,
} from '../web/src/core/heif.js';
import {setItemReference} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,standardGraphFile,brightOriginalFile]=process.argv.slice(2);
if(!output||!standardGraphFile||!brightOriginalFile)
  throw Error('Usage: node tools/native-style-hidden-editor-variants.mjs <output-directory> <X.heic> <original-bright.heic>');

const [base,bright]=await Promise.all([standardGraphFile,brightOriginalFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(bright);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tmaps=d=>[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);assert.notEqual(a.deltaGrid,null);
assert.equal(tmaps(a).length,1);assert.equal(tmaps(b).length,1);
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary));
assert.deepEqual(
  extractAppleMakerNoteTag(read(base,a,a.exifItem),0x2b),
  extractAppleMakerNoteTag(read(bright,b,b.exifItem),0x2b),
  'same capture UUID',
);

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const targetPropertyByBytes=new Map();
for(const property of a.props.properties){
  const bytes=base.slice(property.box.off,property.box.off+property.box.size);
  targetPropertyByBytes.set(Buffer.from(bytes).toString('hex'),property.index);
}
const importedProperty=new Map();
function cloneAssociations(sourceId){
  const result=[];
  for(const association of b.props.associations.get(sourceId)||[]){
    let index=importedProperty.get(association.index);
    if(index===undefined){
      const property=b.props.properties[association.index-1];
      const bytes=bright.slice(property.box.off,property.box.off+property.box.size);
      const key=Buffer.from(bytes).toString('hex');
      index=targetPropertyByBytes.get(key);
      if(index===undefined){[meta,index]=appendIpcoProperty(meta,bytes);targetPropertyByBytes.set(key,index);}
      importedProperty.set(association.index,index);
    }
    result.push([index,association.essential]);
  }
  return result;
}

const sourceIds=[b.primary,...b.primaryTiles];
const specs=sourceIds.map(id=>{
  const info=b.infos.get(id);
  return {key:`bright-${id}`,itemType:info.type,itemName:info.name,reuse:cloneAssociations(id)};
});
let assigned;[meta,assigned]=addItems(meta,specs);
const mapped=new Map(sourceIds.map(id=>[id,assigned.get(`bright-${id}`)]));
const hiddenBright=mapped.get(b.primary);
meta=setItemReference(meta,'dimg',hiddenBright,b.primaryTiles.map(id=>mapped.get(id)));
const payloads=new Map(sourceIds.map(id=>[mapped.get(id),read(bright,b,id)]));
const [displayTmap]=tmaps(a);
const textureDescriptor=[...a.infos].find(([,info])=>info.type==='uri '
  &&info.uri==='tag:apple.com,2026:photo:metadata:texture_styles')?.[0];
assert.notEqual(textureDescriptor,undefined,'Texture descriptor');
const descriptors=new Set([a.stylesItem,textureDescriptor]);
const core=new Set([...descriptors,a.linearThumb,a.deltaGrid]);
const exifOnly=new Set([a.exifItem]);
const exifDescriptors=new Set([...descriptors,a.exifItem]);
const exifCore=new Set([...core,a.exifItem]);
const allShared=new Set(a.refs.filter(ref=>['auxl','cdsc'].includes(ref.type)
  &&ref.to.includes(a.primary)&&ref.to.includes(displayTmap)).map(ref=>ref.from));
const sky=[...a.infos.keys()].find(id=>auxUriForItem(a.props,id)==='urn:com:apple:photo:2020:aux:semanticskymatte');
assert.notEqual(sky,undefined,'Sky matte');
const textureMattes=[...a.infos.keys()].filter(id=>auxUriForItem(a.props,id)?.startsWith('tag:apple.com,2026:photo:aux:'));
assert.equal(textureMattes.length,12,'Texture matte count');
const withIds=(baseSet,ids)=>new Set([...baseSet,...ids]);

function build(displayMode='none',selected=new Set()){
  let variantMeta=meta;
  const graph=discoverHeic(variantMeta);
  for(const ref of graph.refs){
    if(!['auxl','cdsc'].includes(ref.type)||!ref.to.includes(a.primary)||!ref.to.includes(displayTmap))continue;
    const display=selected.has(ref.from)
      ?displayMode==='primary'?[a.primary]:displayMode==='both'?[a.primary,displayTmap]:[]
      :[];
    variantMeta=setItemReference(variantMeta,ref.type,ref.from,
      [hiddenBright,...display]);
  }
  return rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),variantMeta,payloads);
}

await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,data,displayTargets]of [
  ['AC_StandardPrimary_HiddenBrightEditor',build(), 'none'],
  ['AD_StandardPrimary_BrightFirstEditor',build('both',allShared), 'all-both'],
  ['AE_Descriptors_StandardPrimary',build('primary',descriptors), 'descriptors-primary'],
  ['AF_Descriptors_StandardPair',build('both',descriptors), 'descriptors-both'],
  ['AG_Core_StandardPrimary',build('primary',core), 'core-primary'],
  ['AH_Core_StandardPair',build('both',core), 'core-both'],
  ['AI_Exif_StandardPrimary',build('primary',exifOnly), 'exif-primary'],
  ['AJ_ExifDescriptors_StandardPrimary',build('primary',exifDescriptors), 'exif-descriptors-primary'],
  ['AK_ExifCore_StandardPrimary',build('primary',exifCore), 'exif-core-primary'],
  ['AL_All_StandardPrimary',build('primary',allShared), 'all-primary'],
  ['AM_ExifCoreSky_StandardPrimary',build('primary',withIds(exifCore,[sky])), 'exif-core-sky-primary'],
  ['AN_ExifCoreTextureFirstHalf_StandardPrimary',build('primary',withIds(exifCore,textureMattes.slice(0,6))), 'exif-core-texture-first-half-primary'],
  ['AO_ExifCoreTextureSecondHalf_StandardPrimary',build('primary',withIds(exifCore,textureMattes.slice(6))), 'exif-core-texture-second-half-primary'],
  ['AP_ExifCoreAllTexture_StandardPrimary',build('primary',withIds(exifCore,textureMattes)), 'exif-core-all-texture-primary'],
]){
  const d=discoverHeic(data),[tmap]=tmaps(d);
  assert.equal(d.primary,a.primary,'exact Standard primary stays pitm');
  assert.deepEqual(read(data,d,d.primary),read(base,a,a.primary),'Standard display grid');
  assert.deepEqual(read(data,d,d.hdrGrid),read(base,a,a.hdrGrid),'Standard HDR grid');
  assert.deepEqual(read(data,d,tmap),read(base,a,displayTmap),'Standard tmap');
  assert.deepEqual(read(data,d,hiddenBright),read(bright,b,b.primary),'hidden Bright grid');
  assert.deepEqual(read(data,d,d.stylesItem),read(base,a,a.stylesItem),'native Styles metadata');
  assert.deepEqual(read(data,d,d.linearThumb),read(base,a,a.linearThumb),'native linear thumbnail');
  assert.deepEqual(read(data,d,d.deltaGrid),read(base,a,a.deltaGrid),'native StyleDelta grid');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
  const name=`native-1_${label}.HEIC`;await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,preview:'exact native Standard primary/HDR/tmap',
    editorBase:'exact hidden original Bright primary',displayTargets,
    styles:true,texture:true,hdr:true,compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-AC-AP.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
