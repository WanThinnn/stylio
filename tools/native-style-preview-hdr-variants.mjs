// Private same-capture preview isolation. O repacks without changing items;
// P deliberately removes HDR as a control; Q pairs Standard with its own HDR.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {box,boxes,topBox,concat,be} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,parseIloc,replaceIdatItem,appendIpcoProperty,auxUriForItem,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {removeItems,setItemReference,setItemPropertyAssociations,addItems} from '../web/src/raster/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {editableTmapHeadroom,registerTmapHdr} from '../web/src/styles/hdr-compatibility.js';
import {writeZip} from '../web/src/core/zip.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [output,baseFile,editedFile]=process.argv.slice(2);
if(!output||!baseFile||!editedFile)throw Error('Usage: node tools/native-style-preview-hdr-variants.mjs <output-directory> <M.heic> <edited-native.heic>');
const [base,edited]=await Promise.all([baseFile,editedFile].map(async f=>new Uint8Array(await fs.readFile(f))));
const a=discoverHeic(base),b=discoverHeic(edited);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
assert.deepEqual(extractAppleMakerNoteTag(read(base,a,a.exifItem),0x2b),extractAppleMakerNoteTag(read(edited,b,b.exifItem),0x2b),'same capture UUID');
assert.notEqual(a.hdrGrid,null);assert.notEqual(b.hdrGrid,null);assert.notEqual(editableTmapHeadroom(edited,b),null);
const tmaps=d=>[...d.infos].filter(([,i])=>i.type==='tmap').map(([id])=>id);
assert.equal(tmaps(a).length,1);assert.equal(tmaps(b).length,1);
const atmap=tmaps(a)[0],btmap=tmaps(b)[0];
const sidecars=a.refs.filter(r=>r.type==='cdsc'&&r.to.includes(a.hdrGrid)).map(r=>r.from);
const metaOf=(bytes,d)=>bytes.slice(d.meta.off,d.meta.off+d.meta.size);
const properties=(bytes,d,id)=>(d.props.associations.get(id)||[]).map(ref=>{
 const p=d.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
});
function repack(source,meta,overrides=new Map()){
 const d=discoverHeic(source),m=meta.slice(),iloc=parseIloc(m,topBox(m,'meta'));
 assert.equal(iloc.offsetSize,4);assert.equal(iloc.lengthSize,4);assert.equal(iloc.baseOffsetSize,0);
 const others=[...boxes(source,0,source.length)].filter(b=>!['ftyp','meta','mdat'].includes(b.type)).map(b=>source.slice(b.off,b.off+b.size));
 const ft=topBox(source,'ftyp'),ftyp=source.slice(ft.off,ft.off+ft.size);
 let cursor=ftyp.length+m.length+others.reduce((n,p)=>n+p.length,0)+8;const chunks=[],expected=new Map();
 for(const [id,item]of iloc.items){
  if(item.constructionMethod===1)continue;
  assert.equal(item.constructionMethod,0);assert.equal(item.extents.length,1,'single external extent required');
  const value=overrides.get(id)||read(source,d,id),e=item.extents[0];
  m.set(be(cursor,4),e.offsetPos);m.set(be(value.length,4),e.lengthPos);cursor+=value.length;chunks.push(value);expected.set(id,value);
 }
 assert.ok(cursor<2**32);
 const data=concat([ftyp,m,...others,box('mdat',concat(chunks))]),after=discoverHeic(data);
 for(const [id,value]of expected)assert.deepEqual(read(data,after,id),value,'repacked item '+id);
 assert.equal([...boxes(data,0,data.length)].filter(b=>b.type==='mdat').length,1);
 return data;
}
const o=repack(base,metaOf(base,a)),od=discoverHeic(o);
for(const id of a.infos.keys()){
 assert.deepEqual(read(o,od,id),read(base,a,id),'O item '+id);
 assert.deepEqual(properties(o,od,id),properties(base,a,id),'O properties '+id);
}
assert.deepEqual(od.refs,a.refs);

const hdrIds=new Set([a.hdrGrid,...a.hdrTiles,atmap,...sidecars]);
let pmeta=removeItems(metaOf(o,od),[...hdrIds]);
// Removing a preferred HDR rendition also removes its altr selection group.
const pm=topBox(pmeta,'meta'),parts=[pmeta.slice(pm.off+pm.hdr,pm.off+pm.hdr+4)];
for(const child of boxes(pmeta,pm.off+pm.hdr+4,pm.off+pm.size)){
 if(child.type==='grpl'){
  assert.ok([...boxes(pmeta,child.off+child.hdr,child.off+child.size)].every(b=>b.type==='altr'));
  continue;
 }
 parts.push(pmeta.slice(child.off,child.off+child.size));
}
pmeta=box('meta',concat(parts));
const p=repack(o,pmeta),pd=discoverHeic(p);assert.equal(pd.hdrGrid,null);assert.equal(tmaps(pd).length,0);

let qmeta=removeItems(metaOf(o,od),[...a.hdrTiles,...sidecars]);
const qvalues=new Map(),propertyIds=new Map();
function cloneProperties(source){
 const refs=[];
 for(const ref of b.props.associations.get(source)||[]){
  let index=propertyIds.get(ref.index);
  if(index===undefined){
   const property=b.props.properties[ref.index-1];
   [qmeta,index]=appendIpcoProperty(qmeta,edited.slice(property.box.off,property.box.off+property.box.size));propertyIds.set(ref.index,index);
  }
  refs.push([index,ref.essential]);
 }
 return refs;
}
const specs=b.hdrTiles.map((id,i)=>({key:'standard-hdr-'+i,reuse:cloneProperties(id)}));
let added;[qmeta,added]=addItems(qmeta,specs);
const newTiles=specs.map((s,i)=>{const id=added.get(s.key);qvalues.set(id,read(edited,b,b.hdrTiles[i]));return id;});
qmeta=setItemReference(qmeta,'dimg',a.hdrGrid,newTiles);
let gridProperties=cloneProperties(b.hdrGrid);
const nativeHdrRole=a.props.associations.get(a.hdrGrid).find(ref=>a.props.properties[ref.index-1].type==='auxC');
assert.ok(nativeHdrRole);gridProperties.push([nativeHdrRole.index,nativeHdrRole.essential]);
qmeta=setItemPropertyAssociations(qmeta,a.hdrGrid,gridProperties);
const tmapProperties=cloneProperties(btmap);
qmeta=setItemPropertyAssociations(qmeta,atmap,tmapProperties);
qmeta=setItemReference(qmeta,'dimg',atmap,[a.primary,a.hdrGrid]);
for(const [id,value]of [[a.hdrGrid,read(edited,b,b.hdrGrid)],[atmap,read(edited,b,btmap)]]){
 if(parseIloc(qmeta,topBox(qmeta,'meta')).items.get(id).constructionMethod===1)qmeta=replaceIdatItem(qmeta,id,value);
 else qvalues.set(id,value);
}
let q=repack(o,qmeta,qvalues);
q=registerTmapHdr(q,{headroom:true})||q;
q=repack(q,metaOf(q,discoverHeic(q)));
const qd=discoverHeic(q);
assert.equal(auxUriForItem(qd.props,qd.hdrGrid),URI_HDR_GAIN);
assert.equal(editableTmapHeadroom(q,qd),editableTmapHeadroom(edited,b));
assert.deepEqual(read(q,qd,qd.hdrGrid),read(edited,b,b.hdrGrid));
for(const [i,id]of qd.hdrTiles.entries()){
 assert.deepEqual(read(q,qd,id),read(edited,b,b.hdrTiles[i]),'Q HDR sample '+i);
 assert.deepEqual(properties(q,qd,id),properties(edited,b,b.hdrTiles[i]),'Q HDR decoder '+i);
}
assert.deepEqual(read(q,qd,atmap),read(edited,b,btmap),'Q own ISO equation');
for(const id of od.infos.keys()){
 if(hdrIds.has(id))continue;
 assert.deepEqual(read(q,qd,id),read(o,od,id),'Q non-HDR payload '+id);
 assert.deepEqual(properties(q,qd,id),properties(o,od,id),'Q non-HDR properties '+id);
 assert.deepEqual(qd.refs.filter(r=>r.from===id),od.refs.filter(r=>r.from===id),'Q non-HDR references '+id);
}

await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,data]of [['O_Repacked',o],['P_SDRControl',p],['Q_MatchedHDR',q]]){
 const d=discoverHeic(data);
 for(const refs of d.props.associations.values())for(const ref of refs)assert.ok(d.props.properties[ref.index-1],'missing property '+ref.index);
 for(const id of [d.stylesItem,d.linearThumb,d.deltaGrid,...d.deltaTiles])assert.deepEqual(read(data,d,id),read(o,od,id),'native editing data '+id);
 for(const ref of d.refs){assert.ok(d.infos.has(ref.from));for(const id of ref.to)assert.ok(d.infos.has(id),'dangling reference '+id);}
 for(const [i,id]of d.primaryTiles.entries())assert.deepEqual(read(data,d,id),read(edited,b,b.primaryTiles[i]),'Standard primary '+i);
 const checked=await executeJob({operation:'read',file:new Blob([data])});
 assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
 assert.equal(checked.compatibility?.status,'known-compatible',JSON.stringify(checked.compatibility?.reasons));
 const name='native-1_'+label+'.HEIC';await fs.writeFile(path.join(output,name),data);files.set(name,data);
 report.push({file:name,bytes:data.length,singleMdat:true,hdrPresent:d.hdrGrid!==null,nativeEditingPayloadsExact:true,
  matchedEditedHdr:label==='Q_MatchedHDR',sdrControlOnly:label==='P_SDRControl',compatibility:checked.compatibility.status,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-OPQ.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
