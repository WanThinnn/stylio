// Private-fixture validation. This verifies encoded metadata/payloads and the
// intended response statistic, NOT the appearance of Apple's Photos renderer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPortraitDepth} from './audit-portrait-depth.mjs';
import {describePortraitScene} from '../web/src/portrait/portrait-scene-response.js';
import {discoverHeic,extractItemData} from '../web/src/raster/heif.js';

const root=path.resolve(process.argv[2]||'tests/private-fixtures/depth-regression-v3');
const previous=path.resolve(process.argv[3]||'tests/private-fixtures/depth-regression-v2');
const pairs=[
 ['IMG_2862_STANDARD_SCENE.HEIC','IMG_2862_STANDARD_FROM_ORIGINAL.HEIC'],
 ['IMG_2862_PRO_SCENE.HEIC','IMG_2862_PRO_FROM_ORIGINAL.HEIC'],
 ['IMG_2694_STANDARD_SCENE.HEIC','IMG_2694_STANDARD_FROM_ORIGINAL.HEIC'],
 ['IMG_2694_PRO_SCENE.HEIC','IMG_2694_PRO_FROM_ORIGINAL.HEIC'],
 ['IMG_1880_SCENE.HEIC','IMG_1880_ACCEPTED_RESPONSE.HEIC'],
 ['IMG_6215_SCENE.HEIC','IMG_6215_FROM_ORIGINAL.HEIC'],
 ['IMG_9188_SCENE.HEIC','IMG_9188_FROM_ORIGINAL.HEIC'],
];
const summaries=new Map();
const imageHashes=file=>{
 const bytes=new Uint8Array(fs.readFileSync(file)),d=discoverHeic(bytes);
 return [...d.infos].filter(([,info])=>['hvc1','grid'].includes(info.type))
  .map(([id])=>createHash('sha256').update(extractItemData(bytes,d,id)).digest('hex')).sort();
};
for(const [name,oldName]of pairs){
 const file=path.join(root,name),oldFile=path.join(previous,oldName),r=readPortraitDepth(file);
 const scene=describePortraitScene(r.gray,r.width,r.height,{focusX:r.focusX,focusY:r.focusY});
 assert.equal(scene.usable,true,name+' must have a usable measured scene');
 assert.deepEqual(imageHashes(file),imageHashes(oldFile),name+' must retain every encoded image/depth sample');
 assert.ok(r.range[0]===0&&r.range[1]>0&&Number.isFinite(r.range[1]));
 const p=r.projection,g=p.fx*p.fy*p.pixelSize/Math.hypot(p.width,p.height);
 const response=g*r.range[1]*scene.separation;
 const old=readPortraitDepth(oldFile),op=old.projection;
 // v2 encoded the 35mm equivalent * zoom; reproduce that historical camera
 // factor only in this audit. Production must not apply the digital crop twice.
 const oldG=op.fx*op.fy*op.pixelSize/Math.hypot(op.width,op.height)*(old.optics?.zoom>=1?old.optics.zoom:1);
 const prior=describePortraitScene(old.gray,old.width,old.height,{focusX:old.focusX,focusY:old.focusY});
 const oldResponse=oldG*old.range[1]*prior.separation;
 const summary={name,side:scene.side,focusCode:scene.focusCode,separation:scene.separation,
  encodedMax:r.range[1],response,ratioToV2:response/oldResponse};
 summaries.set(name,summary);console.log(JSON.stringify(summary));
}
for(const number of ['2862','2694']){
 const a=summaries.get(`IMG_${number}_STANDARD_SCENE.HEIC`),b=summaries.get(`IMG_${number}_PRO_SCENE.HEIC`);
 assert.ok(Math.abs(a.response/b.response-1)<1e-9,number+' model tiers must have the same calibrated median response');
}
assert.ok(summaries.get('IMG_2862_STANDARD_SCENE.HEIC').ratioToV2<.6,'over-blurred Standard must decrease');
assert.ok(summaries.get('IMG_2694_STANDARD_SCENE.HEIC').ratioToV2>4,'under-blurred ultrawide must increase');
console.log('PASS: seven encoded readbacks, unchanged photographic/depth samples, matched tier response. Photos visual verification remains required.');
