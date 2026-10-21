import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describePortraitScene,portraitPreviewBlur} from '../../web/src/portrait/portrait-scene-response.js';
import {relativePortraitResponse} from '../../web/src/portrait/portrait-blur-response.js';
import {portraitProjection} from '../../web/src/portrait/portrait-geometry.js';
const profile=JSON.parse(fs.readFileSync(new URL('../../web/src/portrait/portrait-template.json',import.meta.url)));
const w=80,h=60,optics={focalMm:6.765,equivalentMm:24};
function scene(multiplier=1,offset=0){
 const gray=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=offset+multiplier*(x>=30&&x<50&&y>=15&&y<45?90:25+Math.floor(x/4));
 return gray;
}
const response=(s,o=optics)=>relativePortraitResponse(4032,3024,o,profile,3,'scene-v3',s);
test('same scene under affine model disparity changes keeps the same focus/background response',()=>{
 const a=describePortraitScene(scene(),w,h),b=describePortraitScene(scene(2,10),w,h);
 assert.equal(a.side,'background');assert.equal(b.side,'background');
 const ra=response(a),rb=response(b);
 assert.ok(Math.abs(ra.disparityMax*a.separation-rb.disparityMax*b.separation)<1e-9);
 assert.ok(Math.abs(ra.disparityMax/rb.disparityMax-2)<1e-9);
});
test('scene optics compensation has no telephoto floor or ultrawide ceiling',()=>{
 const s=describePortraitScene(scene(),w,h);
 const tele={focalMm:15.66,equivalentMm:209,zoom:1.74},wide={focalMm:2.22,equivalentMm:14};
 const r1=response(s,tele),r2=response(s,wide);
 const projected=(o,r)=>{const p=portraitProjection(4032,3024,o);return p.fx*p.fy*p.pixelSize/Math.hypot(4032,3024)*r.disparityMax*s.separation;};
 assert.ok(Math.abs(projected(tele,r1)-projected(wide,r2))<1e-8);
 assert.equal(r1.blurResponseLimited,false);assert.equal(r2.blurResponseLimited,false);
});
test('focus at the far end uses measured foreground separation instead of an absent background',()=>{
 const gray=new Uint8Array(w*h).fill(160);
 for(let y=24;y<36;y++)for(let x=34;x<46;x++)gray[y*w+x]=45;
 const s=describePortraitScene(gray,w,h);
 assert.equal(s.side,'foreground');assert.ok(s.separation>0);assert.ok(response(s).disparityMax>0);
});
test('flat depth and isolated outliers cannot be promoted into strong blur',()=>{
 const gray=new Uint8Array(w*h).fill(100);gray[0]=0;gray[gray.length-1]=255;
 const s=describePortraitScene(gray,w,h);
 assert.equal(s.usable,false);assert.equal(s.reason,'flat-scene');
 assert.equal(response(s).sceneResponseApplied,false);
 gray[Math.floor(h/2)*w+Math.floor(w/2)]=255;
 assert.equal(describePortraitScene(gray,w,h).reason,'unstable-focus');
});
test('accepted semantic subject changes confidence continuously and does not change depth samples',()=>{
 const gray=scene(),copy=gray.slice(),confidence=new Uint8Array(w*h);
 for(let y=15;y<45;y++)for(let x=30;x<50;x++)confidence[y*w+x]=245;
 const plain=describePortraitScene(gray,w,h),guided=describePortraitScene(gray,w,h,{matte:{confidence,width:w,height:h}});
 assert.ok(guided.subjectConfidence>plain.subjectConfidence);
 assert.ok(response(guided).disparityMax>response(plain).disparityMax);
 assert.deepEqual(gray,copy);
});
test('an explicit 35mm equivalent already describes the field of view of a zoomed iPhone image',()=>{
 const o={focalMm:3.99,equivalentMm:53,zoom:1.885286783042394};
 const p=portraitProjection(4032,3024,o);
 assert.ok(Math.abs(p.fx-Math.hypot(4032,3024)*53/Math.hypot(36,24))<1e-9);
});

test('preview aperture follows inverse aperture and f/16 is distinct from Off',()=>{
 assert.ok(portraitPreviewBlur(16)>0);assert.equal(portraitPreviewBlur(null),0);
 assert.ok(Math.abs(portraitPreviewBlur(1.4)/portraitPreviewBlur(16)-16/1.4)<1e-12);
 for(const value of [NaN,0,-1,23])assert.throws(()=>portraitPreviewBlur(value),/aperture/);
});
