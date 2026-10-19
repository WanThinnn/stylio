// Same-capture diagnostic: preserve the complete original Bright editor graph,
// including its Bright HDR/tmap, and add a second exact Standard HDR rendition
// used only as the preferred viewer alternative.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {be,box,boxes,concat,findChild,metaChildren,topBox,u} from '../web/src/core/box.js';
import {
  addItems,
  appendIpcoProperty,
  dimensionsForItem,
  discoverHeic,
  extractItem,
  idatItemBytes,
} from '../web/src/core/heif.js';
import {setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,brightEditorFile,standardCurrentFile]=process.argv.slice(2);
if(!output||!brightEditorFile||!standardCurrentFile)
  throw Error('Usage: node tools/native-style-split-tmap-variants.mjs <output-directory> <L.heic> <native-standard-current.heic>');

const [base,current]=await Promise.all([brightEditorFile,standardCurrentFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(current);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tmaps=d=>[...d.infos].filter(([,info])=>info.type==='tmap').map(([id])=>id);
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);assert.notEqual(a.deltaGrid,null);
assert.notEqual(a.hdrGrid,null);assert.notEqual(b.hdrGrid,null);
assert.equal(tmaps(a).length,1);assert.equal(tmaps(b).length,1);
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary));
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
      if(index===undefined){[meta,index]=appendIpcoProperty(meta,bytes);targetPropertyByBytes.set(key,index);}
      importedProperty.set(association.index,index);
    }
    result.push([index,association.essential]);
  }
  return result;
}

const [currentTmap]=tmaps(b);
const sourceIds=[b.primary,...b.primaryTiles,b.hdrGrid,...b.hdrTiles,currentTmap];
const specs=sourceIds.map(id=>{
  const info=b.infos.get(id);
  return {key:`standard-${id}`,itemType:info.type,itemName:info.name,
    contentType:info.type==='uri '?info.uri:info.type==='mime'?info.contentType:null,
    reuse:cloneAssociations(id)};
});
let assigned;[meta,assigned]=addItems(meta,specs);
const mapped=new Map(sourceIds.map(id=>[id,assigned.get(`standard-${id}`)]));
const standardPrimary=mapped.get(b.primary),standardHdr=mapped.get(b.hdrGrid),standardTmap=mapped.get(currentTmap);
meta=setItemReference(meta,'dimg',standardPrimary,b.primaryTiles.map(id=>mapped.get(id)));
meta=setItemReference(meta,'dimg',standardHdr,b.hdrTiles.map(id=>mapped.get(id)));
meta=setItemReference(meta,'dimg',standardTmap,[standardPrimary,standardHdr]);

const payloads=new Map(sourceIds.map(id=>[mapped.get(id),read(current,b,id)]));
if(a.thumbnail!==null&&b.thumbnail!==null){
  payloads.set(a.thumbnail,read(current,b,b.thumbnail));
  const associations=cloneAssociations(b.thumbnail);
  meta=setItemPropertyAssociations(meta,a.thumbnail,associations);
}

const originalMeta=topBox(meta,'meta');
const groups=metaChildren(meta,originalMeta).filter(child=>child.type==='grpl');
assert.equal(groups.length,1,'one native alternate-rendition group');
const originalAltr=[...boxes(meta,groups[0].off+groups[0].hdr,groups[0].off+groups[0].size)];
assert.equal(originalAltr.length,1);assert.equal(originalAltr[0].type,'altr');
const groupId=u(meta,originalAltr[0].off+originalAltr[0].hdr+4,4);
function withAlternates(ids){
  const altr=box('altr',concat([new Uint8Array(4),be(groupId,4),be(ids.length,4),...ids.map(id=>be(id,4))]));
  const m=topBox(meta,'meta');
  return box('meta',concat([meta.slice(m.off+m.hdr,m.off+m.hdr+4),
    ...metaChildren(meta,m).map(child=>child.type==='grpl'?box('grpl',altr):meta.slice(child.off,child.off+child.size))]));
}

function withGroups(groupItems,primary=a.primary){
  const altrs=groupItems.map((ids,index)=>box('altr',concat([
    new Uint8Array(4),be(groupId+index,4),be(ids.length,4),...ids.map(id=>be(id,4)),
  ])));
  const m=topBox(meta,'meta');
  let result=box('meta',concat([meta.slice(m.off+m.hdr,m.off+m.hdr+4),
    ...metaChildren(meta,m).map(child=>child.type==='grpl'
      ?box('grpl',concat(altrs)):meta.slice(child.off,child.off+child.size))]));
  const rm=topBox(result,'meta'),pitm=findChild(metaChildren(result,rm),'pitm');
  const version=result[pitm.off+pitm.hdr],size=version===0?2:4;
  result=result.slice();result.set(be(primary,size),pitm.off+pitm.hdr+4);
  return result;
}

const [brightTmap]=tmaps(a);
const variants=[
  ['AQ_StandardTmap_BrightEditor',withAlternates([standardTmap,a.primary]),a.primary,'one-standard-bright'],
  ['AR_StandardTmap_StandardGrid_BrightEditor',withAlternates([standardTmap,standardPrimary,a.primary]),a.primary,'one-standard-grid-bright'],
  ['AS_StandardTmap_BrightTmap_BrightEditor',withAlternates([standardTmap,brightTmap,a.primary]),a.primary,'one-standard-bright-tmap-bright'],
  ['AT_TwoGroupsStandardFirst_BrightPrimary',withGroups([[standardTmap,standardPrimary],[brightTmap,a.primary]]),a.primary,'two-standard-first'],
  ['AU_TwoGroupsBrightFirst_BrightPrimary',withGroups([[brightTmap,a.primary],[standardTmap,standardPrimary]]),a.primary,'two-bright-first'],
  ['AV_UnifiedGroup_StandardPrimary',withGroups([[standardTmap,standardPrimary,brightTmap,a.primary]],standardPrimary),standardPrimary,'one-all-standard-primary'],
  ['AW_TwoGroups_StandardPrimary',withGroups([[standardTmap,standardPrimary],[brightTmap,a.primary]],standardPrimary),standardPrimary,'two-standard-primary'],
];
await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,variantMeta,expectedPrimary,groupLayout]of variants){
  const data=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),variantMeta,payloads);
  const d=discoverHeic(data),allTmaps=tmaps(d);
  assert.equal(d.primary,expectedPrimary,'expected pitm');
  assert.deepEqual(read(data,d,a.primary),read(base,a,a.primary),'Bright primary exact');
  assert.deepEqual(read(data,d,d.hdrGrid),read(base,a,a.hdrGrid),'Bright HDR exact');
  assert.deepEqual(read(data,d,brightTmap),read(base,a,brightTmap),'Bright tmap exact');
  assert.deepEqual(read(data,d,d.stylesItem),read(base,a,a.stylesItem),'Styles exact');
  assert.deepEqual(read(data,d,d.linearThumb),read(base,a,a.linearThumb),'linear thumbnail exact');
  assert.deepEqual(read(data,d,d.deltaGrid),read(base,a,a.deltaGrid),'StyleDelta exact');
  assert.ok(allTmaps.includes(brightTmap)&&allTmaps.includes(standardTmap),'both tmaps retained');
  assert.deepEqual(read(data,d,standardPrimary),read(current,b,b.primary),'Standard primary exact');
  assert.deepEqual(read(data,d,standardHdr),read(current,b,b.hdrGrid),'Standard HDR exact');
  assert.deepEqual(read(data,d,standardTmap),read(current,b,currentTmap),'Standard tmap exact');
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
  const name=`native-1_${label}.HEIC`;await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,groupLayout,primary:expectedPrimary===a.primary?'exact original Bright':'exact native Standard',
    editorTmap:'exact original Bright',preferredViewer:'exact native Standard HDR tmap',
    styles:true,texture:true,hdr:true,compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-AQ-AW.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
