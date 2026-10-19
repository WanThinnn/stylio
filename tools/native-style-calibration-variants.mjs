// Private diagnostic only. Requires editing resources from the SAME capture.
// It is not a production repair or permission to reuse another photo's calibration.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,dimensionsForItem,appendIpcoProperty} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag,listExifMetadataEntries} from '../web/src/core/exif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {parseBplist} from '../web/src/core/bplist.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,experimentFile,nativeFile]=process.argv.slice(2);
if(!output||!experimentFile||!nativeFile)throw Error('Usage: node tools/native-style-calibration-variants.mjs <output-directory> <E.heic> <same-capture-native.heic>');
const [base,native]=await Promise.all([experimentFile,nativeFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(base),b=discoverHeic(native);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const capture=(bytes,d)=>listExifMetadataEntries(read(bytes,d,d.exifItem)).filter(e=>[0x110,0x9003,0x9291,0x829a,0x829d].includes(e.tag));
assert.ok(capture(base,a).some(e=>e.tag===0x9003),'capture timestamp required');
assert.deepEqual(capture(base,a),capture(native,b),'reference must be the same capture');
assert.deepEqual(extractAppleMakerNoteTag(read(base,a,a.exifItem),0x2b),
  extractAppleMakerNoteTag(read(native,b,b.exifItem),0x2b),'capture UUID must match');
assert.deepEqual(dimensionsForItem(a.props,a.primary),dimensionsForItem(b.props,b.primary));
for(const d of [a,b])for(const name of ['stylesItem','linearThumb','deltaGrid'])assert.notEqual(d[name],null,name);
const atiles=a.refs.find(r=>r.type==='dimg'&&r.from===a.deltaGrid).to;
const btiles=b.refs.find(r=>r.type==='dimg'&&r.from===b.deltaGrid).to;
assert.equal(atiles.length,btiles.length,'native delta geometry');
assert.deepEqual(read(base,a,a.deltaGrid),read(native,b,b.deltaGrid),'native delta grid layout');

function replaceResources(pairs){
  let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
  const payloads=new Map([[a.stylesItem,read(native,b,b.stylesItem)]]),properties=new Map();
  for(const [target,source]of pairs){
    payloads.set(target,read(native,b,source));
    const associations=[];
    for(const ref of b.props.associations.get(source)||[]){
      let index=properties.get(ref.index);
      if(index===undefined){
        const p=b.props.properties[ref.index-1];
        [meta,index]=appendIpcoProperty(meta,native.slice(p.box.off,p.box.off+p.box.size));
        properties.set(ref.index,index);
      }
      associations.push([index,ref.essential]);
    }
    meta=setItemPropertyAssociations(meta,target,associations);
  }
  const ft=topBox(base,'ftyp');
  return rebuildHeic(base,a,base.slice(ft.off,ft.off+ft.size),meta,payloads);
}
function verify(data,changed){
  const d=discoverHeic(data);
  for(const [id]of a.iloc.items){
    if(changed.has(id))continue;
    assert.deepEqual(read(data,d,id),read(base,a,id),'unchanged payload '+id);
    const properties=(bytes,g)=>(g.props.associations.get(id)||[]).map(ref=>{
      const p=g.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
    });
    assert.deepEqual(properties(data,d),properties(base,a),'unchanged properties '+id);
  }
  assert.deepEqual(d.refs,a.refs,'all relationships unchanged');
  assert.deepEqual(extractAppleMakerNoteTag(read(data,d,d.exifItem)),extractAppleMakerNoteTag(read(base,a,a.exifItem)),'selected preset unchanged');
}
await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
const variants=[['G_NativeMetadata',[]],['H_NativeThumbnail',[[a.linearThumb,b.linearThumb]]],
 ['I_NativeDelta',[[a.linearThumb,b.linearThumb],...atiles.map((id,i)=>[id,btiles[i]])]]];
for(const [variant,pairs]of variants){
  const data=replaceResources(pairs),changed=new Set([a.stylesItem,...pairs.map(([id])=>id)]);
  verify(data,changed);
  const name='native-1_'+variant+'.HEIC';
  await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,reference:path.basename(nativeFile),changedItems:[...changed],
    sourceSchema:parseBplist(read(base,a,a.stylesItem)).get('0'),referenceSchema:parseBplist(read(native,b,b.stylesItem)).get('0'),
    originalPrimaryHdrExifTexturePreserved:true,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-colour-GHI.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
