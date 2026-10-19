// Same-capture diagnostic: keep the original Bright primary as the editable
// Styles base, but make the preferred HDR alternate rendition use the exact
// native Standard current rendition. This tests whether Photos can keep its
// viewer and Styles editor on two coherent image bases inside one HEIC.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {
  addItems,
  appendIpcoProperty,
  dimensionsForItem,
  discoverHeic,
  extractItem,
  idatItemBytes,
  replaceIdatItem,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,editableBaseFile,currentFile]=process.argv.slice(2);
if(!output||!editableBaseFile||!currentFile)
  throw Error('Usage: node tools/native-style-dual-rendition-variants.mjs <output-directory> <L.heic> <native-standard-current.heic>');

const [base,current]=await Promise.all([editableBaseFile,currentFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(current);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tmaps=d=>[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);

for(const [label,value]of [['base Styles',a.stylesItem],['base linear thumbnail',a.linearThumb],
  ['base StyleDelta',a.deltaGrid],['base HDR',a.hdrGrid],['current HDR',b.hdrGrid]])
  assert.notEqual(value,null,label);
assert.equal(tmaps(a).length,1,'base tmap');
assert.equal(tmaps(b).length,1,'current tmap');
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary),'same geometry');
assert.deepEqual(
  extractAppleMakerNoteTag(read(base,a,a.exifItem),0x2b),
  extractAppleMakerNoteTag(read(current,b,b.exifItem),0x2b),
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
      const bytes=current.slice(property.box.off,property.box.off+property.box.size);
      const key=Buffer.from(bytes).toString('hex');
      index=targetPropertyByBytes.get(key);
      if(index===undefined){
        [meta,index]=appendIpcoProperty(meta,bytes);
        targetPropertyByBytes.set(key,index);
      }
      importedProperty.set(association.index,index);
    }
    result.push([index,association.essential]);
  }
  return result;
}

const sourceIds=[b.primary,...b.primaryTiles,b.hdrGrid,...b.hdrTiles];
const specs=sourceIds.map(id=>{
  const info=b.infos.get(id);
  return {key:`copy-${id}`,itemType:info.type,itemName:info.name,
    contentType:info.type==='uri '?info.uri:info.type==='mime'?info.contentType:null,
    reuse:cloneAssociations(id)};
});
let assigned;[meta,assigned]=addItems(meta,specs);
const mapped=new Map(sourceIds.map(id=>[id,assigned.get(`copy-${id}`)]));
const displayPrimary=mapped.get(b.primary),displayHdr=mapped.get(b.hdrGrid);
meta=setItemReference(meta,'dimg',displayPrimary,b.primaryTiles.map(id=>mapped.get(id)));
meta=setItemReference(meta,'dimg',displayHdr,b.hdrTiles.map(id=>mapped.get(id)));

const [baseTmap]=tmaps(a),[currentTmap]=tmaps(b);
const currentTmapPayload=read(current,b,currentTmap);
if(a.iloc.items.get(baseTmap).constructionMethod===1)meta=replaceIdatItem(meta,baseTmap,currentTmapPayload);
else throw Error('Expected the native tmap in idat');
const tmapAssociations=cloneAssociations(currentTmap);
meta=setItemPropertyAssociations(meta,baseTmap,tmapAssociations);
meta=setItemReference(meta,'dimg',baseTmap,[displayPrimary,displayHdr]);

const payloads=new Map();
for(const id of sourceIds)payloads.set(mapped.get(id),read(current,b,id));
if(a.thumbnail!==null&&b.thumbnail!==null){
  payloads.set(a.thumbnail,read(current,b,b.thumbnail));
  const thumbnailAssociations=cloneAssociations(b.thumbnail);
  meta=setItemPropertyAssociations(meta,a.thumbnail,thumbnailAssociations);
}

function build(stripAlternateEditingTargets){
  let variantMeta=meta;
  if(stripAlternateEditingTargets){
    const graph=discoverHeic(variantMeta);
    for(const ref of graph.refs){
      if(!['auxl','cdsc'].includes(ref.type)||!ref.to.includes(a.primary)||!ref.to.includes(baseTmap))continue;
      variantMeta=setItemReference(variantMeta,ref.type,ref.from,ref.to.filter(id=>id!==baseTmap));
    }
  }
  return rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),variantMeta,payloads);
}

await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,data,stripped]of [
  ['AA_StandardAlternate_BrightEditor',build(false),false],
  ['AB_StandardAlternate_PrimaryOnlyEditor',build(true),true],
]){
  const d=discoverHeic(data),[tmap]=tmaps(d);
  assert.equal(d.primary,a.primary,'editable Bright primary remains pitm');
  assert.deepEqual(d.refs.find(ref=>ref.type==='dimg'&&ref.from===tmap)?.to,[displayPrimary,displayHdr]);
  assert.deepEqual(read(data,d,displayPrimary),read(current,b,b.primary),'exact Standard display grid');
  assert.deepEqual(read(data,d,displayHdr),read(current,b,b.hdrGrid),'exact Standard HDR grid');
  assert.deepEqual(read(data,d,tmap),currentTmapPayload,'exact Standard tmap metadata');
  assert.deepEqual(read(data,d,d.primary),read(base,a,a.primary),'exact original Bright editor grid');
  assert.deepEqual(read(data,d,d.stylesItem),read(base,a,a.stylesItem),'exact native Styles metadata');
  assert.deepEqual(read(data,d,d.linearThumb),read(base,a,a.linearThumb),'exact native linear thumbnail');
  assert.deepEqual(read(data,d,d.deltaGrid),read(base,a,a.deltaGrid),'exact native StyleDelta grid');
  const missing=[];
  for(const [id,associations]of d.props.associations)for(const association of associations)
    if(!d.props.properties[association.index-1])missing.push({id,index:association.index,properties:d.props.properties.length});
  assert.deepEqual(missing,[],'all property associations resolve');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
  assert.equal(checked.compatibility?.status,'known-compatible',JSON.stringify(checked.compatibility?.reasons));
  const name=`native-1_${label}.HEIC`;await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,preview:'exact native Standard alternate rendition',
    editorBase:'exact original Bright primary',alternateEditingTargetsRemoved:stripped,
    styles:true,texture:true,hdr:true,compatibility:checked.compatibility.status,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-AA-AB.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
