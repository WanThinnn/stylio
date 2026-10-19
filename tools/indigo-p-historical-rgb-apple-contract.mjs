import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,propertyBoxBytes,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {auxcBox,internIpcoProperty,associateItemProperty,setItemPropertyAssociations,setItemReference} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [pFile,outFile]=process.argv.slice(2);
if(!pFile||!outFile)throw Error('Usage: node tools/indigo-p-historical-rgb-apple-contract.mjs <P.heic> <V.heic>');
assert.notEqual(path.resolve(pFile).toLowerCase(),path.resolve(outFile).toLowerCase());

const P=new Uint8Array(await fs.readFile(pFile)),p=discoverHeic(P);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

const tmap=[...p.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.ok(tmap!==undefined,'tmap required');
const tmapRef=p.refs.find(r=>r.type==='dimg'&&r.from===tmap);
assert.ok(tmapRef&&tmapRef.to.length===2,'tmap input pair required');
const [primary,isoGain]=tmapRef.to;
assert.equal(primary,p.primary,'P tmap base');
assert.notEqual(isoGain,p.hdrGrid,'P must use separate Apple fallback before V');
assert.equal(auxUriForItem(p.props,isoGain),null,'ISO gain must not already be Apple aux');
assert.equal(auxUriForItem(p.props,p.hdrGrid),URI_HDR_GAIN,'separate Apple aux required');

const appleGrid=p.hdrGrid;
const appleTiles=p.hdrTiles||[];
const appleSidecars=p.refs.filter(r=>r.type==='cdsc'&&r.to.includes(appleGrid)).map(r=>r.from);
assert.ok(appleTiles.length&&appleSidecars.length,'Apple fallback resources not found');

let meta=P.slice(p.meta.off,p.meta.off+p.meta.size);
// Demote the separate fallback without deleting any bytes: remove only its Apple role.
{
  const props=discoverHeic(meta).props;
  meta=setItemPropertyAssociations(meta,appleGrid,(props.associations.get(appleGrid)||[])
    .filter(a=>props.properties[a.index-1]?.type!=='auxC').map(a=>[a.index,a.essential]));
}
meta=setItemReference(meta,'auxl',appleGrid,[]);
for(const sidecar of appleSidecars)meta=setItemReference(meta,'cdsc',sidecar,[]);

// Promote the source RGB ISO gain itself, exactly like the historical IDG contract.
let auxIndex;[meta,auxIndex]=internIpcoProperty(meta,auxcBox(URI_HDR_GAIN));
meta=associateItemProperty(meta,isoGain,auxIndex,true);
meta=setItemReference(meta,'auxl',isoGain,[primary,tmap]);

const out=rebuildHeic(P,p,P.slice(0,topBox(P,'ftyp').size),meta,new Map()),d=discoverHeic(out);
assert.equal(d.primary,primary);
assert.equal(d.hdrGrid,isoGain,'RGB ISO gain must become discovered Apple HDR grid');
assert.equal(auxUriForItem(d.props,isoGain),URI_HDR_GAIN);
assert.equal(auxUriForItem(d.props,appleGrid),null,'old fallback still has Apple aux role');
assert.deepEqual(d.refs.find(r=>r.type==='auxl'&&r.from===isoGain)?.to,[primary,tmap]);
assert.ok(!d.refs.some(r=>r.type==='auxl'&&r.from===appleGrid),'old fallback auxl survived');
assert.ok(!d.refs.some(r=>r.type==='cdsc'&&appleSidecars.includes(r.from)&&r.to.includes(appleGrid)),'old Apple sidecar still targets fallback');
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to,[primary,isoGain]);
assert.ok(d.refs.some(r=>r.type==='cdsc'&&r.from===99&&r.to.includes(isoGain)),'Adobe XMP sidecar must remain on RGB gain');

for(const [id] of p.infos){
  assert.ok(d.infos.has(id),'item missing '+id);
  assert.deepEqual(read(out,d,id),read(P,p,id),'payload changed '+id);
}
for(const id of p.infos.keys()){
  if(id===isoGain||id===appleGrid)continue;
  const before=p.props.associations.get(id)||[],after=d.props.associations.get(id)||[];
  assert.deepEqual(after,before,'unrelated item properties changed '+id);
}
const tmapColrBefore=propertyBoxBytes(P,p.props,tmap,'colr');
const tmapColrAfter=propertyBoxBytes(out,d.props,tmap,'colr');
assert.deepEqual(tmapColrAfter,tmapColrBefore,'tmap colr changed');

const checked=await executeJob({operation:'read',file:new Blob([out])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({
  file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(pFile),
  primary,tmap,rgbIsoAppleGain:isoGain,
  auxTargets:d.refs.find(r=>r.type==='auxl'&&r.from===isoGain)?.to,
  adobeXmpItem:99,
  demotedSeparateAppleGrid:appleGrid,demotedAppleTiles:appleTiles.length,demotedAppleSidecars:appleSidecars,
  allPayloadsExact:true,tmapColrExact:true,
  contract:'historical IDG RGB gain shared by tmap + Apple aux',
  deviceValidation:'pending'
},null,2));