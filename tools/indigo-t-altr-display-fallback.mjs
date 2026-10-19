import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {be,box,boxes,concat,metaChildren,topBox,u} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';

const [tFile,outFile]=process.argv.slice(2);
if(!tFile||!outFile)throw Error('Usage: node tools/indigo-t-altr-display-fallback.mjs <T.heic> <U.heic>');
assert.notEqual(path.resolve(tFile).toLowerCase(),path.resolve(outFile).toLowerCase());

const T=new Uint8Array(await fs.readFile(tFile)),t=discoverHeic(T);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

const tmap=[...t.infos].find(([,info])=>info.type==='tmap')?.[0];
assert.ok(tmap!==undefined,'tmap required');
const tmapRef=t.refs.find(r=>r.type==='dimg'&&r.from===tmap);
assert.ok(tmapRef&&tmapRef.to.length===2,'tmap inputs');
const displayBase=tmapRef.to[0],isoGain=tmapRef.to[1];
assert.notEqual(displayBase,t.primary,'T must have split display base');
const apple=t.hdrGrid;
assert.deepEqual(t.refs.find(r=>r.type==='auxl'&&r.from===apple)?.to,[t.primary],'Apple aux must stay on editor pitm');

const meta0=T.slice(t.meta.off,t.meta.off+t.meta.size),m=topBox(meta0,'meta');
const groups=metaChildren(meta0,m).filter(child=>child.type==='grpl');
assert.equal(groups.length,1,'one grpl');
const altrs=[...boxes(meta0,groups[0].off+groups[0].hdr,groups[0].off+groups[0].size)];
assert.equal(altrs.length,1,'one altr');
const a=altrs[0],at=a.off+a.hdr;
const groupId=u(meta0,at+4,4),count=u(meta0,at+8,4),ids=[];
for(let i=0;i<count;i++)ids.push(u(meta0,at+12+i*4,4));
assert.deepEqual(ids,[tmap,t.primary],'expected T altr');
const newAltr=box('altr',concat([new Uint8Array(4),be(groupId,4),be(2,4),be(tmap,4),be(displayBase,4)]));
const meta=box('meta',concat([
  meta0.slice(m.off+m.hdr,m.off+m.hdr+4),
  ...metaChildren(meta0,m).map(child=>child.type==='grpl'?box('grpl',newAltr):meta0.slice(child.off,child.off+child.size))
]));
const out=rebuildHeic(T,t,T.slice(0,topBox(T,'ftyp').size),meta,new Map()),d=discoverHeic(out);
assert.equal(d.primary,t.primary);assert.equal(d.hdrGrid,apple);
assert.deepEqual(d.refs,t.refs,'iref graph must be exact');
for(const [id] of t.infos)assert.deepEqual(read(out,d,id),read(T,t,id),'payload changed '+id);
for(const id of t.infos.keys())assert.deepEqual(d.props.associations.get(id)||[],t.props.associations.get(id)||[],'props changed '+id);

const checked=await executeJob({operation:'read',file:new Blob([out])});
assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
await fs.writeFile(outFile,out,{flag:'wx'});
console.log(JSON.stringify({
  file:path.resolve(outFile),bytes:out.length,sha256:hash(out),base:path.basename(tFile),
  primary:d.primary,tmap,displayBase,isoGain,appleAux:d.hdrGrid,
  alternateGroupBefore:ids,alternateGroupAfter:[tmap,displayBase],
  allItemPayloadsExact:true,allIrefExact:true,allPropertiesExact:true,
  deviceValidation:'pending'
},null,2));