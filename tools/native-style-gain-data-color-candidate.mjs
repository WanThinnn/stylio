// Diagnostic only: isolate inherited flattened Linear Gray ICC routing on a
// reconstructed Styles graph. Never change gain samples or their ISO equation.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,URI_HDR_GAIN,auxUriForItem} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {editableTmapHeadroom} from '../web/src/styles/hdr-compatibility.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [baseFile,outputFile]=process.argv.slice(2);
if(!baseFile||!outputFile)
  throw Error('Usage: node tools/native-style-gain-data-color-candidate.mjs <CQ.heic> <CR.heic>');
assert.notEqual(path.resolve(baseFile),path.resolve(outputFile));
const base=new Uint8Array(await fs.readFile(baseFile)),a=discoverHeic(base);
assert.notEqual(a.stylesItem,null);assert.notEqual(a.linearThumb,null);
assert.notEqual(a.hdrGrid,null);assert.ok(a.hdrTiles.length);
assert.equal(auxUriForItem(a.props,a.hdrGrid),URI_HDR_GAIN);
assert.ok(editableTmapHeadroom(base,a)>1);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const colorKind=raw=>Buffer.from(raw).toString('ascii',8,12);
function isIdentityGrayProfile(raw){
  if(colorKind(raw)!=='prof')return false;
  const icc=Buffer.from(raw).subarray(12);
  if(icc.toString('ascii',16,20)!=='GRAY'||icc.length<132)return false;
  const count=icc.readUInt32BE(128);
  if(count>32||132+count*12>icc.length)return false;
  let trc=null;
  for(let i=0;i<count;i++){
    const at=132+12*i,sig=icc.toString('ascii',at,at+4),start=icc.readUInt32BE(at+4),length=icc.readUInt32BE(at+8);
    if(start+length>icc.length)return false;
    if(sig==='kTRC')trc=icc.subarray(start,start+length);
  }
  return trc?.toString('hex')==='6375727600000000000000010100';
}

let meta=base.slice(a.meta.off,a.meta.off+a.meta.size);
const removed=[];
for(const id of [a.hdrGrid,...a.hdrTiles]){
  const retained=[];
  for(const ref of a.props.associations.get(id)||[]){
    const p=a.props.properties[ref.index-1],raw=base.slice(p.box.off,p.box.off+p.box.size);
    if(p.type==='colr'&&colorKind(raw)==='prof'){
      assert.ok(isIdentityGrayProfile(raw),'only the known identity Gray ICC may be removed');
      removed.push({id,index:ref.index});
    }else retained.push([ref.index,ref.essential]);
  }
  assert.equal(removed.filter(x=>x.id===id).length,1,'one flattened Gray ICC on each gain resource');
  meta=setItemPropertyAssociations(meta,id,retained);
}
const data=rebuildHeic(base,a,base.slice(0,topBox(base,'ftyp').size),meta,new Map()),d=discoverHeic(data);
assert.deepEqual(d.refs,a.refs,'all graph relationships exact');
assert.equal(d.primary,a.primary);assert.equal(d.infos.size,a.infos.size);
assert.equal(editableTmapHeadroom(data,d),editableTmapHeadroom(base,a));
const protectedGainIds=new Set([a.hdrGrid,...a.hdrTiles]);
const properties=(bytes,g,id)=>(g.props.associations.get(id)||[]).map(ref=>{
  const p=g.props.properties[ref.index-1];return {essential:ref.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
});
for(const id of a.infos.keys()){
  assert.deepEqual(read(data,d,id),read(base,a,id),'every image/metadata payload exact '+id);
  const expected=properties(base,a,id).filter(p=>!protectedGainIds.has(id)
    ||!(Buffer.from(p.bytes).toString('ascii',4,8)==='colr'&&colorKind(p.bytes)==='prof'));
  assert.deepEqual(properties(data,d,id),expected,'only Gray ICC associations removed '+id);
}
const gainColors=(d.props.associations.get(d.hdrGrid)||[]).map(ref=>d.props.properties[ref.index-1])
  .filter(p=>p.type==='colr').map(p=>Buffer.from(data.slice(p.box.off,p.box.off+p.box.size)).toString('hex'));
assert.deepEqual(gainColors,['00000013636f6c726e636c7800020002000280'],'native data-only grid declaration');
const checked=await executeJob({operation:'read',file:new Blob([data])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
assert.equal(checked.compatibility?.status,'known-compatible');
await fs.mkdir(path.dirname(path.resolve(outputFile)),{recursive:true});
await fs.writeFile(outputFile,data,{flag:'wx'});
const report={file:outputFile,base:path.basename(baseFile),bytes:data.length,
  removedGrayIccAssociations:removed.length,allItemPayloadsAndReferencesExact:true,
  primaryAndStyleColorExact:true,isoHdrEquationAndSamplesExact:true,
  sourceHeadroom:editableTmapHeadroom(data,d),compatibility:checked.compatibility.status,
  sha256:crypto.createHash('sha256').update(data).digest('hex'),productionEnabled:false,
  deviceValidation:'pending'};
await fs.writeFile(outputFile+'.json',JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report,null,2));
