import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHagcIccTag,parseSmpte2094App5,serializeSmpte2094App5,
  buildReferenceWhiteHagcPayload,buildHagcIccTag,
  expandReferenceWhiteToneMapping,evaluateHagcGainCurve,
} from '../../web/src/raster/hagc.js';

const hex=s=>Uint8Array.from(Buffer.from(s,'hex'));
const native1729=hex(
  '68616763000000000000003200405d9d14000080300000061b09f60f1b139a143f149115122c3c38fb4b3e55c257015d9d2e6139ba3053371532dc35aa38ba'
);

test('parse native Apple HAGC / ST 2094-50 payload',()=>{
  const tag=parseHagcIccTag(native1729),m=tag.metadata,t=m.adaptiveToneMap,a=t.alternates[0];
  assert.equal(tag.appleLengthMinusOne,true);
  assert.equal(tag.declaredPayloadBytes,50);
  assert.equal(tag.payload.length,51);
  assert.equal(m.applicationVersion,0);
  assert.equal(m.minimumApplicationVersion,0);
  assert.equal(m.hdrReferenceWhite,203);
  assert.equal(t.baselineHdrHeadroom,2.3965);
  assert.equal(t.useReferenceWhiteToneMapping,false);
  assert.equal(t.numAlternateImages,1);
  assert.equal(t.gainApplicationSpaceChromaticitiesMode,1);
  assert.equal(a.alternateHdrHeadroom,0);
  assert.equal(a.componentMix.type,2);
  assert.equal(a.gainCurve.count,7);
  assert.equal(a.gainCurve.usePchipSlope,false);
  assert.equal(a.gainCurve.controlPoints[0].x,0);
  assert.equal(a.gainCurve.controlPoints.at(-1).x,5.265);
  assert.equal(a.gainCurve.controlPoints.at(-1).y,-2.3965);
  assert.equal(m.bytesConsumed,51);
  assert.equal(m.trailingBytes.length,0);
  assert.deepEqual(serializeSmpte2094App5(m),tag.payload);
});

test('reference-white tone mapping HAGC is compact and round-trips',()=>{
  const payload=buildReferenceWhiteHagcPayload(2.39648);
  assert.deepEqual(payload,hex('00405d9d80'));
  const m=parseSmpte2094App5(payload);
  assert.equal(m.adaptiveToneMap.baselineHdrHeadroom,2.3965);
  assert.equal(m.adaptiveToneMap.useReferenceWhiteToneMapping,true);
  assert.equal(m.adaptiveToneMap.numAlternateImages,0);
  assert.equal(m.bytesConsumed,payload.length);
  assert.deepEqual(serializeSmpte2094App5(m),payload);
});

test('expand reference-white tone mapping using ST 2094-50 equations',()=>{
  const one=expandReferenceWhiteToneMapping(1);
  assert.equal(one.alternates.length,2);
  assert.ok(Math.abs(one.alternates[1].alternateHdrHeadroom-0.6151137835929048)<1e-12);
  assert.deepEqual(one.alternates[0].componentMix,{red:0,green:0,blue:0,max:1,min:0,component:0});
  assert.equal(one.alternates[0].gainCurve.controlPoints.length,8);

  const full=expandReferenceWhiteToneMapping(2.3965);
  const sdr=full.alternates[0],mid=full.alternates[1];
  assert.ok(Math.abs(mid.alternateHdrHeadroom-Math.log2(8/3))<1e-12);
  assert.ok(Math.abs(sdr.gainCurve.controlPoints[0].y+1)<1e-12);
  assert.ok(Math.abs(sdr.gainCurve.controlPoints.at(-1).y+2.3965)<1e-12);
  assert.ok(Math.abs(mid.gainCurve.controlPoints[0].y)<1e-12);
  assert.ok(Math.abs(mid.gainCurve.controlPoints.at(-1).y-(mid.alternateHdrHeadroom-2.3965))<1e-12);
  for(const alt of full.alternates)for(const cp of alt.gainCurve.controlPoints)
    assert.ok(Math.abs(evaluateHagcGainCurve(alt.gainCurve,cp.x)-cp.y)<1e-9);
});

test('HAGC ICC wrapper supports standard and observed Apple length conventions',()=>{
  const payload=buildReferenceWhiteHagcPayload(2);
  const standard=buildHagcIccTag(payload);
  assert.equal(new DataView(standard.buffer,standard.byteOffset).getUint32(8),payload.length);
  assert.equal(parseHagcIccTag(standard).appleLengthMinusOne,false);
  const apple=buildHagcIccTag(payload,{appleLengthMinusOne:true});
  assert.equal(new DataView(apple.buffer,apple.byteOffset).getUint32(8),payload.length-1);
  assert.equal(parseHagcIccTag(apple).appleLengthMinusOne,true);
  assert.deepEqual(parseHagcIccTag(apple).payload,payload);
});
