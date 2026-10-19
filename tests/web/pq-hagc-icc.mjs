import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReferenceWhiteHagcPayload,parseHagcIccTag} from '../../web/src/raster/hagc.js';
import {buildDisplayP3PqHagcIcc,inspectGeneratedPqIcc} from '../../web/src/raster/pq-hagc-icc.js';

const tag=(icc,sig)=>{
  const v=new DataView(icc.buffer,icc.byteOffset,icc.byteLength),n=v.getUint32(128);
  for(let i=0;i<n;i++){
    const p=132+i*12;
    if(String.fromCharCode(...icc.slice(p,p+4))!==sig)continue;
    const o=v.getUint32(p+4),s=v.getUint32(p+8);return icc.slice(o,o+s);
  }
  return null;
};

test('build deterministic Display-P3 PQ ICC v4.4 with HAGC',()=>{
  const payload=buildReferenceWhiteHagcPayload(2.3965);
  const a=buildDisplayP3PqHagcIcc(payload),b=buildDisplayP3PqHagcIcc(payload);
  assert.deepEqual(a,b);
  const info=inspectGeneratedPqIcc(a);
  assert.equal(info.version,0x04400000);
  assert.deepEqual(info.tags.map(x=>x.sig),['desc','rXYZ','gXYZ','bXYZ','wtpt','cicp','HAGC','A2B0','B2A0','cprt']);
  const cicp=tag(a,'cicp');assert.deepEqual(Array.from(cicp.slice(8,12)),[12,16,0,1]);
  const hagc=parseHagcIccTag(tag(a,'HAGC'));
  assert.equal(hagc.metadata.adaptiveToneMap.baselineHdrHeadroom,2.3965);
  assert.equal(hagc.metadata.adaptiveToneMap.useReferenceWhiteToneMapping,true);
});

test('Skia-shape A2B uses 65-entry PQ input curves and 11 cubed CLUT',()=>{
  const icc=buildDisplayP3PqHagcIcc(buildReferenceWhiteHagcPayload(2));
  const a2b=tag(icc,'A2B0'),v=new DataView(a2b.buffer,a2b.byteOffset,a2b.byteLength);
  assert.equal(String.fromCharCode(...a2b.slice(0,4)),'mAB ');
  assert.equal(a2b[8],3);assert.equal(a2b[9],3);
  const clut=v.getUint32(24),a=v.getUint32(28),matrix=v.getUint32(16),m=v.getUint32(20);
  assert.equal(a2b[clut],11);assert.equal(a2b[clut+1],11);assert.equal(a2b[clut+2],11);assert.equal(a2b[clut+16],2);
  assert.equal(String.fromCharCode(...a2b.slice(a,a+4)),'curv');
  assert.equal(new DataView(a2b.buffer,a2b.byteOffset+a,a2b.byteLength-a).getUint32(8),65);
  assert.ok(matrix>0&&m>matrix);
});

test('generated profile is source-usable structurally',()=>{
  const icc=buildDisplayP3PqHagcIcc(buildReferenceWhiteHagcPayload(1));
  const b2a=tag(icc,'B2A0');
  assert.equal(String.fromCharCode(...b2a.slice(0,4)),'mBA ');
  assert.equal(String.fromCharCode(...icc.slice(12,16)),'mntr');
  assert.equal(String.fromCharCode(...icc.slice(16,20)),'RGB ');
  assert.equal(String.fromCharCode(...icc.slice(20,24)),'XYZ ');
  assert.equal(String.fromCharCode(...icc.slice(36,40)),'acsp');
});
