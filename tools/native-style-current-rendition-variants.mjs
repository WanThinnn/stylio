// Same-capture experiment: transplant Photos' corrected Current rendition into Q
// while retaining Q's native Styles/Texture editing graph. V keeps Q's modern
// selection marker; W uses the six-key marker written by Photos after Save.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {
  appendIpcoProperty,
  dimensionsForItem,
  discoverHeic,
  extractItem,
  idatItemBytes,
  replaceIdatItem,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {
  extractAppleMakerNoteTag,
  injectAppleMakerNoteTag,
  listAppleMakerNoteTags,
  listExifMetadataEntries,
} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,baseFile,currentFile,mode='current']=process.argv.slice(2);
if(!output||!baseFile||!currentFile)
  throw Error('Usage: node tools/native-style-current-rendition-variants.mjs <output-directory> <Q.heic> <Photos-current.heic> [current|native]');
if(!['current','native'].includes(mode))throw Error(`Unknown mode ${mode}`);

const [base,current]=await Promise.all([baseFile,currentFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(current);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const exif=(bytes,d)=>read(bytes,d,d.exifItem);
const tmaps=d=>[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);

assert.notEqual(a.stylesItem,null,'Q Styles graph required');
assert.notEqual(a.linearThumb,null,'Q linear thumbnail required');
assert.notEqual(a.deltaGrid,null,'Q StyleDelta graph required');
assert.notEqual(a.hdrGrid,null,'Q HDR required');
assert.equal(b.stylesItem,null,'Photos Current control must not carry an explicit Styles graph');
assert.notEqual(b.hdrGrid,null,'Photos Current HDR required');
assert.deepEqual(
  extractAppleMakerNoteTag(exif(base,a),0x2b),
  extractAppleMakerNoteTag(exif(current,b),0x2b),
  'same capture UUID required',
);
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary));
assert.equal(a.primaryTiles.length,b.primaryTiles.length,'primary tile count');
assert.equal(a.hdrTiles.length,b.hdrTiles.length,'HDR tile count');
assert.equal(tmaps(a).length,1,'Q tmap');
assert.equal(tmaps(b).length,1,'Current tmap');

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const replacements=new Map();
const copiedProperties=new Map();

function clonedAssociations(sourceId){
  const refs=[];
  for(const ref of b.props.associations.get(sourceId)||[]){
    let index=copiedProperties.get(ref.index);
    if(index===undefined){
      const property=b.props.properties[ref.index-1];
      [meta,index]=appendIpcoProperty(meta,current.slice(property.box.off,property.box.off+property.box.size));
      copiedProperties.set(ref.index,index);
    }
    refs.push([index,ref.essential]);
  }
  return refs;
}

function replaceRole(targetIds,sourceIds){
  assert.equal(targetIds.length,sourceIds.length);
  for(let i=0;i<targetIds.length;i++){
    const target=targetIds[i],source=sourceIds[i];
    assert.deepEqual(dimensionsForItem(a.props,target),dimensionsForItem(b.props,source),`dimensions ${target}`);
    replacements.set(target,read(current,b,source));
    const associations=clonedAssociations(source);
    meta=setItemPropertyAssociations(meta,target,associations);
  }
}

replaceRole(a.primaryTiles,b.primaryTiles);
replaceRole(a.hdrTiles,b.hdrTiles);

// Grid payloads carry only the tiling layout and are byte-identical. They live in
// idat in Q, so retain them while replacing their tile samples and decoder props.
assert.deepEqual(read(base,a,a.primary),read(current,b,b.primary),'primary grid layout');
assert.deepEqual(read(base,a,a.hdrGrid),read(current,b,b.hdrGrid),'HDR grid layout');
const currentPrimaryRefs=clonedAssociations(b.primary);
meta=setItemPropertyAssociations(meta,a.primary,currentPrimaryRefs);

const currentHdrRefs=clonedAssociations(b.hdrGrid);
for(const ref of a.props.associations.get(a.hdrGrid)||[]){
  const property=a.props.properties[ref.index-1];
  if(property.type==='auxC')currentHdrRefs.push([ref.index,ref.essential]);
}
meta=setItemPropertyAssociations(meta,a.hdrGrid,currentHdrRefs);

const [atmap]=tmaps(a),[btmap]=tmaps(b);
const currentTmap=read(current,b,btmap);
if(a.iloc.items.get(atmap).constructionMethod===1)meta=replaceIdatItem(meta,atmap,currentTmap);
else replacements.set(atmap,currentTmap);
const currentTmapRefs=clonedAssociations(btmap);
meta=setItemPropertyAssociations(meta,atmap,currentTmapRefs);

const ftyp=base.slice(0,topBox(base,'ftyp').size);
const v=rebuildHeic(base,a,ftyp,meta,replacements);
const vd=discoverHeic(v);
const currentMarker=extractAppleMakerNoteTag(exif(current,b),0x54);
const savedSelection=parseBplist(currentMarker.payload);
assert.deepEqual([...savedSelection.keys()].sort(),['0','1','2','3','4','5']);
const wExif=injectAppleMakerNoteTag(exif(v,vd),currentMarker.payload,0x54,currentMarker.type);
const w=rebuildHeic(v,vd,v.slice(0,topBox(v,'ftyp').size),v.slice(vd.meta.off,vd.meta.off+vd.meta.size),
  new Map([[vd.exifItem,wExif]]));

const displayIds=new Set([a.primary,...a.primaryTiles,a.hdrGrid,...a.hdrTiles,atmap,a.exifItem]);
const properties=(bytes,d,id)=>(d.props.associations.get(id)||[]).map(ref=>{
  const property=d.props.properties[ref.index-1];
  return {essential:ref.essential,type:property.type,bytes:bytes.slice(property.box.off,property.box.off+property.box.size)};
});

await fs.mkdir(output,{recursive:true});
const variants=mode==='native'
  ?[['X_NativeRendition',v,'Q-eight-key']]
  :[
    ['V_CurrentRenditionModernMarker',v,'Q-eight-key'],
    ['W_CurrentRenditionSavedMarker',w,'Photos-six-key'],
  ];
const files=new Map(),report=[];
for(const [label,data,marker]of variants){
  const d=discoverHeic(data);
  assert.notEqual(d.stylesItem,null);assert.notEqual(d.linearThumb,null);assert.notEqual(d.deltaGrid,null);
  assert.notEqual(d.hdrGrid,null);
  const missingProperties=[];
  for(const [id,refs]of d.props.associations)for(const ref of refs)
    if(!d.props.properties[ref.index-1])missingProperties.push({id,index:ref.index,essential:ref.essential});
  assert.deepEqual(missingProperties,[],`missing properties (${d.props.properties.length} available)`);
  for(const id of a.iloc.items.keys()){
    if(displayIds.has(id))continue;
    assert.deepEqual(read(data,d,id),read(base,a,id),'retained editing payload '+id);
    assert.deepEqual(properties(data,d,id),properties(base,a,id),'retained editing properties '+id);
  }
  assert.deepEqual(read(data,d,d.stylesItem),read(base,a,a.stylesItem),'Styles metadata');
  assert.deepEqual(read(data,d,d.linearThumb),read(base,a,a.linearThumb),'linear thumbnail');
  assert.deepEqual(read(data,d,d.deltaGrid),read(base,a,a.deltaGrid),'StyleDelta grid');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);
  assert.equal(checked.compatibilityError,null);
  assert.equal(checked.compatibility?.status,'known-compatible',JSON.stringify(checked.compatibility?.reasons));
  if(marker==='Q-eight-key'){
    assert.deepEqual(listExifMetadataEntries(exif(data,d)),listExifMetadataEntries(exif(base,a)));
    assert.deepEqual(listAppleMakerNoteTags(exif(data,d)),listAppleMakerNoteTags(exif(base,a)));
  }
  const name=`native-1_${label}.HEIC`;
  await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,marker,styles:true,texture:true,hdr:true,
    referencePrimaryAndHdr:true,nativeEditingGraphExact:true,compatibility:checked.compatibility.status,
    productionRepair:false});
}
await fs.writeFile(path.join(output,mode==='native'?'Styles-preview-X.zip':'Styles-preview-VW.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
