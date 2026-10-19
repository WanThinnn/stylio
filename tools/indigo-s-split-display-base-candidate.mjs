import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {addItems,discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {setItemReference} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [sFile,outFile]=process.argv.slice(2);
if(!sFile||!outFile)throw Error('Usage: node tools/indigo-s-split-display-base-candidate.mjs <S.heic> <T.heic>');
assert.notEqual(path.resolve(sFile).toLowerCase(),path.resolve(outFile).toLowerCase());

const S=new Uint8Array(await fs.readFile(sFile)),s=discoverHeic(S);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

const tmap=[...s.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.ok(tmap!==undefined,'tmap required');
const tmapRef=s.refs.find(r=>r.type==='dimg'&&r.from===tmap);
assert.ok(tmapRef&&tmapRef.to.length===2,'tmap input pair required');
assert.equal(tmapRef.to[0],s.primary,'S tmap must currently derive from pitm');
const isoGain=tmapRef.to[1];
assert.notEqual(isoGain,s.hdrGrid,'ISO RGB gain must remain distinct from Apple aux');

const primaryInfo=s.infos.get(s.primary),primaryAssoc=(s.props.associations.get(s.primary)||[]).map(a=>[a.index,a.essential]);
let meta=S.slice(s.meta.off,s.meta.off+s.meta.size),assigned;
[meta,assigned]=addItems(meta,[{
  key:'display-base',
  itemType:primaryInfo.type,
  itemName:primaryInfo.name||'',
  reuse:primaryAssoc,
}]);
const displayBase=assigned.get('display-base');
meta=setItemReference(meta,'dimg',displayBase,[...s.primaryTiles]);
meta=setItemReference(meta,'dimg',tmap,[displayBase,isoGain]);

const payloads=new Map([[displayBase,read(S,s,s.primary)]]);
const out=rebuildHeic(S,s,S.slice(0,topBox(S,'ftyp').size),meta,payloads),d=discoverHeic(out);
assert.equal(d.primary,s.primary,'pitm changed');
assert.equal(d.hdrGrid,s.hdrGrid,'Apple editor aux changed');
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===displayBase)?.to,s.primaryTiles,'display base tiles');
assert.deepEqual(d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to,[displayBase,isoGain],'tmap split');
assert.deepEqual(read(out,d,displayBase),read(S,s,s.primary),'display base grid payload');
for(const [id] of s.infos){
  assert.ok(d.infos.has(id),'original item missing '+id);
  assert.deepEqual(read(out,d,id),read(S,s,id),'original payload changed '+id);
}
for(const id of s.infos.keys()){
  const before=s.props.associations.get(id)||[],after=d.props.associations.get(id)||[];
  assert.deepEqual(after,before,'original property associations changed '+id);
}
const allowedRef=(r)=>r.type==='dimg'&&r.from===tmap;
const beforeRefs=s.refs.filter(r=>!allowedRef(r));
const afterRefs=d.refs.filter(r=>r.from!==displayBase&&!allowedRef(r));
assert.deepEqual(afterRefs,beforeRefs,'existing graph refs changed outside tmap split');

const altr=(disc)=>disc.refs?.filter?.(()=>false);
const checked=await executeJob({operation:'read',file:new Blob([out])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({
  file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(sFile),
  primary:d.primary,displayBase,tmap,isoGain,appleAux:d.hdrGrid,
  tmapInputs:d.refs.find(r=>r.type==='dimg'&&r.from===tmap)?.to,
  appleTargets:d.refs.find(r=>r.type==='auxl'&&r.from===d.hdrGrid)?.to,
  primaryTilesReused:s.primaryTiles.length,
  originalPayloadsExact:true,originalPropertiesExact:true,nonTmapRefsExact:true,
  purpose:'separate RGB HDR viewing base from mono Apple editor base',deviceValidation:'pending'
},null,2));