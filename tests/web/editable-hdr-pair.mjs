import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSmpte2094App5} from '../../web/src/raster/hagc.js';
import {
  referenceWhiteHagcFromTmap,remapIsoGainSamples,compareIsoGainFields,
} from '../../web/src/raster/editable-hdr-pair.js';

const flat={min:0,max:2.396483898162842,gamma:1,baseOffset:.005,alternateOffset:.005};
const native={min:-0.002293,max:2.396484,gamma:.844238,baseOffset:.00001,alternateOffset:.00001};

test('derive reference-white HAGC baseline from tmap max',()=>{
  const {baselineHdrHeadroom,payload}=referenceWhiteHagcFromTmap({channels:[flat]});
  assert.equal(baselineHdrHeadroom,2.3965);
  const parsed=parseSmpte2094App5(payload);
  assert.equal(parsed.adaptiveToneMap.baselineHdrHeadroom,2.3965);
  assert.equal(parsed.adaptiveToneMap.useReferenceWhiteToneMapping,true);
});

test('ISO gain remap preserves log-gain within 8-bit quantization error',()=>{
  const samples=Uint8Array.from({length:256},(_,i)=>i);
  const converted=remapIsoGainSamples(samples,flat,native);
  assert.equal(converted.clippedLow,0);
  assert.equal(converted.clippedHigh,0);
  assert.ok(converted.meanLogError<0.004);
  assert.ok(converted.maxLogError<0.007);
  const parity=compareIsoGainFields(samples,flat,converted.samples,native);
  assert.ok(parity.meanAbsLogError<0.004);
  assert.ok(parity.maxLogError<0.007);
});

test('identity remap is byte exact for same curve',()=>{
  const samples=Uint8Array.from({length:256},(_,i)=>i);
  const converted=remapIsoGainSamples(samples,flat,flat);
  assert.deepEqual(converted.samples,samples);
  assert.equal(converted.clippedLow,0);
  assert.equal(converted.clippedHigh,0);
  assert.ok(converted.maxLogError<1e-12);
});
