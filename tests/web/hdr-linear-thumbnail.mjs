import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeHdrLinearThumbnailRgb,HDR_LINEAR_THUMBNAIL_COEFFICIENTS} from '../../web/src/raster/hdr-linear-thumbnail.js';

const meta={channels:[{min:0,max:4,gamma:1,baseOffset:0,alternateOffset:0}]};

test('HDR linear thumbnail preserves dimensions and produces Uint8 RGB',()=>{
  const primary=new Uint8Array([128,128,128,64,96,128]);
  const gain=new Uint8Array([0,255]);
  const out=synthesizeHdrLinearThumbnailRgb(primary,gain,meta);
  assert.ok(out instanceof Uint8Array);
  assert.equal(out.length,primary.length);
});

test('HDR excess raises the highlight tail while leaving zero-gain midtone bounded',()=>{
  const primary=new Uint8Array([160,160,160,160,160,160]);
  const low=synthesizeHdrLinearThumbnailRgb(primary,new Uint8Array([0,0]),meta);
  const high=synthesizeHdrLinearThumbnailRgb(primary,new Uint8Array([255,255]),meta);
  const luma=v=>.2126*v[0]+.7152*v[1]+.0722*v[2];
  assert.ok(luma(high)>luma(low)+20);
  assert.ok(Math.max(...high)>Math.max(...low));
  for(const v of high)assert.ok(v>=0&&v<=255);
});

test('custom coefficients are validated',()=>{
  assert.throws(()=>synthesizeHdrLinearThumbnailRgb(new Uint8Array(3),new Uint8Array(1),meta,{coefficients:[[1]]}));
  assert.equal(HDR_LINEAR_THUMBNAIL_COEFFICIENTS.length,3);
});

test('one-channel ISO metadata is required',()=>{
  assert.throws(()=>synthesizeHdrLinearThumbnailRgb(new Uint8Array(3),new Uint8Array(1),{channels:[]}));
});
