import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readPortraitOptics,portraitProjection} from '../../web/src/portrait/portrait-geometry.js';
import {relativePortraitResponse} from '../../web/src/portrait/portrait-blur-response.js';
import {be,concat} from '../../web/src/core/box.js';

function opticsExif(little=false){
  const n=(v,size)=>little?be(v,size).reverse():be(v,size);
  const entry=(id,type,count,value)=>concat([n(id,2),n(type,2),n(count,4),value]);
  // Independent TIFF with focal length 7 mm, 24 mm equivalent and 2x zoom.
  const tiff=concat([new TextEncoder().encode(little?'II':'MM'),n(42,2),n(8,4),n(1,2),
    entry(0x8769,4,1,n(26,4)),n(0,4),n(3,2),entry(0x920a,5,1,n(68,4)),
    entry(0xa405,3,1,concat([n(24,2),n(0,2)])),entry(0xa404,5,1,n(76,4)),n(0,4),
    n(7,4),n(1,4),n(2,4),n(1,4)]);
  return concat([be(6,4),new TextEncoder().encode('Exif\0\0'),tiff]);
}

test('bounded optics reader handles both TIFF orders and declines truncated or invalid rational metadata',()=>{
  for(const little of [false,true]){
    const exif=opticsExif(little),copy=exif.slice(),o=readPortraitOptics(exif);
    assert.equal(o.focalMm,7);assert.equal(o.equivalentMm,24);assert.equal(o.zoom,2);
    const p=portraitProjection(4000,3000,o);
    assert.ok(Math.abs(p.fx-5000*24/Math.hypot(36,24))<1e-9);
    assert.equal(p.geometry,'exif-35mm-estimate');assert.equal(p.pixelSize,7/p.fx);
    assert.deepEqual(exif,copy);
    for(const length of [0,4,12,28,40,60])assert.equal(readPortraitOptics(exif.subarray(0,length)),null);
    const bad=exif.slice();new DataView(bad.buffer).setUint32(10+72,0,little);
    assert.equal(readPortraitOptics(bad).focalMm,null,'zero denominator is not a lens estimate');
  }
});

test('relative blur normalization is resolution invariant, bounded and explicit when optics are missing',()=>{
  const profile=JSON.parse(fs.readFileSync(new URL('../../web/src/portrait/portrait-template.json',import.meta.url)));
  const optics={focalMm:6.765,equivalentMm:24};
  const a=relativePortraitResponse(4000,3000,optics,profile,3),b=relativePortraitResponse(8000,6000,optics,profile,3);
  assert.equal(a.disparityMax,b.disparityMax);assert.equal(a.blurResponse,'projection-v2');
  assert.deepEqual(relativePortraitResponse(4000,3000,null,profile,3),{disparityMax:3*.2,blurResponse:'relative-unscaled',blurResponseLimited:false});
  const wide=relativePortraitResponse(4000,3000,{focalMm:1,equivalentMm:10},profile,3);
  assert.equal(wide.disparityMax,24*.2);assert.equal(wide.blurResponseLimited,true);
  const legacy=relativePortraitResponse(4000,3000,optics,profile,3,'projection-v1');
  assert.equal(a.disparityMax,legacy.disparityMax*.2,'device-accepted f/16 response correction');
  assert.throws(()=>relativePortraitResponse(4,3,optics,profile,0),/Invalid/);
});

test('projection uses the matching focal-plane grid, with honest relative fallback when optics cannot be inferred',()=>{
  const source={focalMm:7,resolutionX:2000,resolutionY:2000,unit:4,width:4000,height:3000};
  const a=portraitProjection(2000,1500,source),b=portraitProjection(4000,3000,source);
  assert.equal(a.geometry,'exif-focal-plane-estimate');assert.equal(a.fx,7000);assert.equal(b.fx,14000);
  assert.equal(a.pixelSize,.001);assert.equal(b.pixelSize,.0005);
  const relative=portraitProjection(3000,4000,source);
  assert.equal(relative.geometry,'relative-image-grid');assert.equal(relative.pixelSize,null);
  assert.equal(relative.cx,1499.5);assert.equal(relative.cy,1999.5);
  assert.equal(portraitProjection(1000,1000,null).pixelSize,null);
  assert.equal(portraitProjection(4000,3000,{...source,resolutionX:1e20,equivalentMm:24}).geometry,'exif-35mm-estimate','invalid focal-plane metadata falls back to a usable source estimate');
  assert.equal(portraitProjection(1000,1000,{focalMm:Infinity,equivalentMm:24}).pixelSize,null);
  assert.throws(()=>portraitProjection(0,3,null),/dimensions/);
});
