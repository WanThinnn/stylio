import test from 'node:test';
import assert from 'node:assert/strict';
import {fusePortraitDepth} from '../../web/src/portrait/subject-depth-guidance.js';

const field=(w,h,value)=>new Uint8Array(w*h).fill(value);

function erodedSurface(shape='ellipse',seed=1){
 const w=96,h=80,gray=field(w,h,60),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3),truth=gray.slice(),distance=field(w,h,255);
 const inside=(x,y)=>{
  const xx=(x-48)/29,yy=(y-40)/28;
  if(shape==='rectangle')return Math.abs(xx)<1&&Math.abs(yy)<1;
  if(shape==='ring')return xx*xx+yy*yy<1&&xx*xx+yy*yy>.12;
  if(shape==='triangle')return yy>-.95&&yy<.95&&Math.abs(xx)<(yy+1.05)/2;
  return xx*xx+yy*yy<1;
 };
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,fg=inside(x,y);rgb.set(fg?[165+(x*seed%35),80+(y%21),30]:[25,45,165+(y%17)],p*3);
  if(fg){confidence[p]=250;semantic[p]=255;truth[p]=190+Math.round((x-48)*.3+(y-40)*.2);}
  else distance[p]=0;
 }
 // Exact Manhattan distance to the observed silhouette, independent of optimizer.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;distance[p]=Math.min(distance[p],x?distance[p-1]+1:255,y?distance[p-w]+1:255);}
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const p=y*w+x;distance[p]=Math.min(distance[p],x+1<w?distance[p+1]+1:255,y+1<h?distance[p+w]+1:255);}
 for(let p=0;p<gray.length;p++)gray[p]=confidence[p]?truth[p]-Math.round(55*Math.max(0,1-distance[p]/5)):truth[p];
 return {w,h,gray,truth,rgb,distance,matte:{width:w,height:h,confidence,refinementConfidence:semantic,source:'edge-refined'}};
}

for(const shape of ['ellipse','rectangle','ring','triangle'])test(`scene optimizer reconstructs an eroded ${shape} silhouette without flattening its sloped surface`,()=>{
 const s=erodedSurface(shape),before=s.gray.slice(),mask=s.matte.confidence.slice();
 const out=fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb});
 let oldError=0,newError=0;
 for(let p=0;p<s.gray.length;p++){
  if(s.distance[p]>0&&s.distance[p]<4){oldError+=Math.abs(s.gray[p]-s.truth[p]);newError+=Math.abs(out.gray[p]-s.truth[p]);}
  if(s.distance[p]===0||s.distance[p]>8)assert.equal(out.gray[p],s.gray[p],'background holes and reliable interior planes stay exact');
 }
 assert.ok(newError<oldError*.5,`boundary surface error must halve, got ${oldError} -> ${newError}`);
 assert.deepEqual(s.gray,before);assert.deepEqual(s.matte.confidence,mask);
});

test('surface optimization cannot amplify foreground erosion on a curved shoulder, in either depth order',()=>{
 for(const invert of [false,true]){
  const s=erodedSurface('ellipse');
  for(let p=0;p<s.gray.length;p++)if(s.matte.confidence[p])s.gray[p]-=Math.round(Math.max(0,16-s.distance[p])*1.4);
  if(invert)for(let p=0;p<s.gray.length;p++)s.gray[p]=255-s.gray[p];
  const out=fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb});
  for(let p=0;p<s.gray.length;p++)if(s.matte.confidence[p]){
   assert.ok(invert?out.gray[p]<=s.gray[p]:out.gray[p]>=s.gray[p],'occlusion ordering must constrain extrapolation, not amplify erosion');
  }
 }
});

test('a resolved affine surface and printed RGB texture do not acquire synthetic geometry',()=>{
 const s=erodedSurface('rectangle',17);s.gray.set(s.truth);
 const out=fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb});
 for(let p=0;p<s.gray.length;p++)assert.ok(Math.abs(out.gray[p]-s.gray[p])<=1,'sub-code fitting tolerance only on an already resolved surface');
 s.gray.fill(155);
 assert.deepEqual(fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb}).gray,s.gray,'colour/semantic edges cannot manufacture a depth edge on a constant plane');
});

test('connected foreground depth layers keep distinct interiors and a thin structure is not erased',()=>{
 const w=100,h=80,gray=field(w,h,60),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3).fill(20);
 for(let y=12;y<66;y++)for(let x=10;x<88;x++){
  const p=y*w+x;confidence[p]=250;semantic[p]=255;gray[p]=x<48?145:220;
  rgb.set(x<48?[190,40,30]:[30,180,60],p*3);
 }
 for(let y=3;y<12;y++)for(let x=60;x<62;x++){const p=y*w+x;gray[p]=220;confidence[p]=semantic[p]=255;rgb.set([30,180,60],p*3);}
 const out=fusePortraitDepth(gray,{width:w,height:h,confidence,refinementConfidence:semantic},w,h,{preserveGeometry:true,rgb});
 assert.equal(out.gray[40*w+25],145);assert.equal(out.gray[40*w+70],220);
 for(let y=3;y<12;y++)for(let x=60;x<62;x++)assert.equal(out.gray[y*w+x],220,'thin appendage retains its source depth, without needing an eroded interior');
 for(let p=0;p<gray.length;p++)if(!confidence[p])assert.equal(out.gray[p],gray[p]);
});

test('a reflective silhouette fragment is not mistaken for an independently supported depth surface',()=>{
 const w=96,h=80,gray=field(w,h,60),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,inside=x>=20&&x<72&&y>=12&&y<68;
  rgb.set(inside?[170,95,25]:[185,185,180],p*3);
  if(inside){gray[p]=205;confidence[p]=255;semantic[p]=255;}
 }
 // A narrow specular rim: strong general membership, weak edge-model score,
 // background-contaminated depth. RGB contrast alone cannot establish that
 // this one-pixel fragment is a separate surface from its adjacent interior.
 for(let x=27;x<65;x++){
  const p=12*w+x;gray[p]=85;semantic[p]=5;rgb.set([240,242,244],p*3);
 }
 const raw=gray.slice(),out=fusePortraitDepth(gray,{width:w,height:h,confidence,refinementConfidence:semantic},w,h,{preserveGeometry:true,rgb});
 for(let x=30;x<62;x++)assert.ok(out.gray[12*w+x]>185,'a supported reflective rim must approach its same-side surface');
 for(let p=0;p<gray.length;p++)if(!confidence[p]||p===40*w+48)assert.equal(out.gray[p],raw[p]);
 assert.deepEqual(gray,raw);
});

test('support scale follows a broad contaminated transition rather than only the frame-size band',()=>{
 const w=256,h=192,gray=field(w,h,55),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,inside=x>=40&&x<216&&y>=24&&y<168;
  rgb.set(inside?[180,75,25]:[25,50,180],p*3);
  if(inside){const d=Math.min(x-39,216-x,y-23,168-y);gray[p]=210-Math.round(65*Math.max(0,1-d/13));confidence[p]=250;semantic[p]=255;}
 }
 const out=fusePortraitDepth(gray,{width:w,height:h,confidence,refinementConfidence:semantic},w,h,{preserveGeometry:true,rgb});
 assert.ok(out.gray[25*w+128]>=200,'the inferred support must reach beyond the contaminated ramp');
 assert.equal(out.gray[80*w+128],210);assert.equal(out.gray[10*w+128],55);
});

test('a small inset depth layer is not merged just because it has no wide interior',()=>{
 const s=erodedSurface('rectangle');s.gray.set(s.truth);
 for(let y=34;y<38;y++)for(let x=22;x<26;x++){
  const p=y*s.w+x;s.gray[p]=120;s.rgb.set([30,40,190],p*3);
 }
 const out=fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb});
 for(let y=34;y<38;y++)for(let x=22;x<26;x++)assert.equal(out.gray[y*s.w+x],120,'a distinct inset surface is not a silhouette fragment');
});

test('one configuration preserves background and improves aggregate boundary error across 1000 seeded scenes',t=>{
 let state=0x4d3a917b;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 let before=0,after=0,supported=0;
 for(let sample=0;sample<1000;sample++){
  const w=48,h=40,cx=20+random()*8,cy=16+random()*8,rx=9+random()*9,ry=9+random()*7,angle=random()*Math.PI,
   cosine=Math.cos(angle),sine=Math.sin(angle),shape=sample%4,near=sample%2===0,fg=near?190:70,bg=near?55:210,
   sx=(random()-.5)*.5,sy=(random()-.5)*.5,blur=1+random()*2;
  const gray=field(w,h,bg),truth=gray.slice(),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3),distance=field(w,h,255);
  const colour=[125+random()*90,65+random()*40,15+random()*30],back=[10+random()*30,25+random()*25,140+random()*75];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p=y*w+x,u=((x-cx)*cosine+(y-cy)*sine)/rx,v=(-(x-cx)*sine+(y-cy)*cosine)/ry;
   const inside=shape===0?u*u+v*v<1:shape===1?Math.abs(u)<1&&Math.abs(v)<1:shape===2?u*u+v*v<1&&u*u+v*v>.16:v>-.9&&v<.9&&Math.abs(u)<(v+1)/2;
   rgb.set(inside?colour.map(c=>Math.round(c+(x+y)%9)):back,p*3);
   if(inside){confidence[p]=250;semantic[p]=255;truth[p]=Math.round(fg+sx*(x-cx)+sy*(y-cy));}
   else distance[p]=0;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;distance[p]=Math.min(distance[p],x?distance[p-1]+1:255,y?distance[p-w]+1:255);}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const p=y*w+x;distance[p]=Math.min(distance[p],x+1<w?distance[p+1]+1:255,y+1<h?distance[p+w]+1:255);}
  for(let p=0;p<gray.length;p++)gray[p]=confidence[p]?truth[p]+(near?-1:1)*Math.round(45*Math.max(0,1-distance[p]/(blur+1))):truth[p];
  const source=gray.slice(),matte={width:w,height:h,confidence,refinementConfidence:semantic};
  const out=fusePortraitDepth(gray,matte,w,h,{preserveGeometry:true,rgb});
  if(out.report.applied)supported++;
  for(let p=0;p<gray.length;p++){
   if(distance[p]===0||distance[p]>8)assert.equal(out.gray[p],source[p],`scene ${sample}, pixel ${p}, distance ${distance[p]}: background/interior must stay exact`);
   if(distance[p]>0&&distance[p]<=3){before+=Math.abs(source[p]-truth[p]);after+=Math.abs(out.gray[p]-truth[p]);}
  }
  assert.deepEqual(gray,source,'solver does not mutate source observations');
  if(sample<5)assert.deepEqual(fusePortraitDepth(gray,matte,w,h,{preserveGeometry:true,rgb}).gray,out.gray,'replay is deterministic');
 }
 assert.ok(supported>850,`sufficiently supported scenes: ${supported}`);
 assert.ok(after<before*.5,`seeded stress set aggregate boundary error: ${before} -> ${after}`);
 t.diagnostic(JSON.stringify({scenes:1000,supported,boundaryAbsoluteErrorBefore:before,boundaryAbsoluteErrorAfter:after}));
});

test('transposing the same scene retains geometry without an orientation-specific policy',()=>{
 const s=erodedSurface('ellipse',7),transpose=(values,channels=1)=>{
  const out=new Uint8Array(values.length);
  for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)for(let c=0;c<channels;c++)out[(x*s.h+y)*channels+c]=values[(y*s.w+x)*channels+c];
  return out;
 };
 const normal=fusePortraitDepth(s.gray,s.matte,s.w,s.h,{preserveGeometry:true,rgb:s.rgb});
 const rotated=fusePortraitDepth(transpose(s.gray),{width:s.h,height:s.w,confidence:transpose(s.matte.confidence),refinementConfidence:transpose(s.matte.refinementConfidence)},s.h,s.w,{preserveGeometry:true,rgb:transpose(s.rgb,3)});
 const expected=transpose(normal.gray);
 for(let p=0;p<expected.length;p++)assert.ok(Math.abs(expected[p]-rotated.gray[p])<=1,'only sub-code fitting/tie differences are allowed');
});

test('fragmented depth guidance cannot exceed the mobile typed-scratch allocation budget',()=>{
 const w=1024,h=512,gray=field(w,h,80),confidence=field(w,h,250),semantic=field(w,h,255),rgb=new Uint8Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,side=Math.floor(x/40)%2;gray[p]=side?210:80;rgb.set(side?[200,40,30]:[30,70,200],p*3);
 }
 const out=fusePortraitDepth(gray,{width:w,height:h,confidence,refinementConfidence:semantic},w,h,{preserveGeometry:true,rgb});
 assert.equal(out.report.reason,'boundary-memory-budget');assert.deepEqual(out.gray,gray);
});

test('unanchored foreground membership does not make a near object and a larger rear bag one focus plane',()=>{
 const w=100,h=80,gray=field(w,h,80),confidence=field(w,h,0);
 for(let y=12;y<61;y++)for(let x=5;x<57;x++){const p=y*w+x;gray[p]=145+Math.floor(y/12);confidence[p]=250;}
 for(let y=19;y<68;y++)for(let x=52;x<73;x++){const p=y*w+x;gray[p]=220+Math.floor(y/20);confidence[p]=250;}
 // The support plane is not foreground. Its local geometry was already sound.
 for(let y=68;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=220+Math.floor((y-68)*2);
 const original=gray.slice(),matte={confidence,width:w,height:h,source:'edge-refined'};
 const old=fusePortraitDepth(gray,matte,w,h);
 assert.ok(Math.abs(old.gray[45*w+60]-gray[70*w+60])>50,'reproduces the wrong can/table separation from blanket focus fusion');
 const out=fusePortraitDepth(gray,matte,w,h,{preserveGeometry:true});
 assert.equal(Buffer.compare(out.gray,original),0,'without an ownership anchor, preserve the scene rather than flattening semantic foreground');
 assert.deepEqual(gray,original);
});

test('geometry-preserving fusion repairs only RGB/SAM-corroborated soft occlusion edges',()=>{
 const w=80,h=60,gray=field(w,h,60),confidence=field(w,h,0),semantic=field(w,h,0),rgb=new Uint8Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,inside=x>=10&&x<40&&y>=10&&y<50;
  rgb.set(inside?[200,30,20]:[20,40,190],p*3);
  if(inside){gray[p]=200;confidence[p]=250;semantic[p]=255;}
 }
 const edge=30*w+40,hole=30*w+25;
 gray[edge]=95;confidence[edge]=180;semantic[edge]=250;rgb.set([200,30,20],edge*3);
 gray[hole]=60;confidence[hole]=semantic[hole]=0;
 const matte={confidence,refinementConfidence:semantic,width:w,height:h,source:'edge-refined'};
 const saved=gray.slice(),out=fusePortraitDepth(gray,matte,w,h,{preserveGeometry:true,rgb});
 assert.ok(out.gray[edge]>180,'locally confirmed inner edge must not inherit background-like depth');
 assert.equal(out.gray[hole],60,'a background hole inside the subject must remain open');
 for(let p=0;p<gray.length;p++)if(p!==edge)assert.equal(out.gray[p],gray[p],'confident interior, background and other planes stay exact');
 assert.deepEqual(gray,saved);
 const ambiguousRgb=new Uint8Array(rgb.length).fill(70);
 assert.equal(fusePortraitDepth(gray,matte,w,h,{preserveGeometry:true,rgb:ambiguousRgb}).gray[edge],95,'colour ambiguity cannot authorize edge correction');
 const noSam={...matte,refinementConfidence:undefined};
 assert.equal(fusePortraitDepth(gray,noSam,w,h,{preserveGeometry:true,rgb}).gray[edge],95,'without semantic corroboration keep scene geometry');
});

test('matte-conditioned fusion brings hand and held key into one focus band',()=>{
  const w=80,h=60,gray=field(w,h,70),confidence=field(w,h,0);
  for(let y=12;y<52;y++)for(let x=5;x<31;x++){gray[y*w+x]=215+((x+y)%7);confidence[y*w+x]=245;}
  for(let y=25;y<45;y++)for(let x=36;x<52;x++){gray[y*w+x]=105+((x+y)%5);confidence[y*w+x]=245;}
  // Soft learned-matte bridge: membership connects the two semantic pieces.
  for(let y=29;y<40;y++)for(let x=30;x<37;x++)confidence[y*w+x]=160;
  const before=gray.slice(),out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'fused'},w,h);
  assert.equal(out.report.applied,true);
  const hand=out.gray[30*w+18],key=out.gray[32*w+43];
  assert.ok(Math.abs(hand-key)<=8,`hand/key focus gap should be compressed, got ${hand} vs ${key}`);
  assert.deepEqual(gray,before,'source depth must remain immutable');
});

test('matte-conditioned fusion preserves bounded relief inside foreground components',()=>{
  const w=64,h=48,gray=field(w,h,60),confidence=field(w,h,0);
  for(let y=10;y<40;y++)for(let x=12;x<48;x++){
    confidence[y*w+x]=250;gray[y*w+x]=180+Math.round((x-12)*30/35);
  }
  const out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'apple-pem'},w,h);
  const left=out.gray[24*w+16],right=out.gray[24*w+44];
  assert.ok(right>left,'foreground relief must not be flattened to a card');
  assert.ok(right-left<12,'foreground relief must be compressed into a focus-safe band');
});

test('connected foreground cannot retain a large monocular offset for a thin held object',()=>{
  const w=80,h=60,gray=field(w,h,55),confidence=field(w,h,0);
  for(let y=10;y<50;y++)for(let x=8;x<36;x++){gray[y*w+x]=213;confidence[y*w+x]=250;}
  // One confident component, not two masks: a metal ring touching the hand.
  for(let y=24;y<30;y++)for(let x=36;x<60;x++){gray[y*w+x]=160+(x%8)*5;confidence[y*w+x]=250;}
  const out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'fused'},w,h);
  assert.equal(out.report.components,1);
  for(let x=36;x<60;x++)assert.ok(Math.abs(out.gray[26*w+x]-out.report.focusPlane)<=3,
    'a connected thin object must stay inside the same bounded focus band');
  assert.ok(new Set(out.gray.filter((_,p)=>confidence[p]>=224)).size>1,
    'retain quantized relief instead of flattening to a card');
});

test('focus grouping preserves distant PEM foreground geometry when SAM and skin depth disagree',()=>{
  const w=100,h=70,gray=field(w,h,70),confidence=field(w,h,0),skin=field(w,h,0),semantic=field(w,h,0);
  for(let y=15;y<58;y++)for(let x=10;x<44;x++){
    const p=y*w+x;confidence[p]=250;skin[p]=250;semantic[p]=255;gray[p]=180+(x%7)*8;
  }
  // A ring and a distant object touch the same PEM foreground region. SAM
  // rejects both as non-hand; only the ring has depth compatible with the skin.
  for(let y=28;y<34;y++)for(let x=44;x<63;x++){confidence[y*w+x]=248;gray[y*w+x]=185;}
  for(let y=17;y<28;y++)for(let x=40;x<55;x++){confidence[y*w+x]=248;skin[y*w+x]=0;gray[y*w+x]=110;}
  const matte={confidence,width:w,height:h,source:'fused'},protection={confidence:skin,width:w,height:h};
  const withoutEvidence=fusePortraitDepth(gray,matte,w,h,{protectionMatte:protection});
  const before=confidence.slice(),out=fusePortraitDepth(gray,{...matte,refinementConfidence:semantic},w,h,{protectionMatte:protection});
  assert.ok(withoutEvidence.gray[21*w+50]>190,'reproduces foreground-class/equal-focus conflation');
  assert.equal(out.gray[21*w+50],110,'distant object keeps original inferred geometry');
  assert.ok(Math.abs(out.gray[30*w+55]-out.report.focusPlane)<=3,'skin-compatible ring remains focused');
  assert.deepEqual(confidence,before,'Apple foreground membership is not erased');
  assert.ok(out.report.focusExcludedPixels>0);
  const corroborated=semantic.slice();
  for(let y=17;y<28;y++)for(let x=40;x<55;x++)corroborated[y*w+x]=255;
  const confirmed=fusePortraitDepth(gray,{...matte,refinementConfidence:corroborated},w,h,{protectionMatte:protection});
  assert.ok(confirmed.gray[21*w+50]>190,
    'a SAM-confirmed held object is retained despite a large monocular offset');
  assert.throws(()=>fusePortraitDepth(gray,{...matte,refinementConfidence:new Uint8Array(3)},w,h),/geometry/);
});

test('weak skin evidence cannot retain distant background texture or seed foreground rim repair',()=>{
  const w=100,h=70,gray=field(w,h,70),confidence=field(w,h,0),skin=field(w,h,0),semantic=field(w,h,0);
  for(let y=15;y<58;y++)for(let x=10;x<44;x++){
    const p=y*w+x;confidence[p]=250;skin[p]=250;semantic[p]=255;gray[p]=180+(x%7)*8;
  }
  // PEM labels this attached patch foreground, but skin is only uncertain,
  // SAM rejects it, and its depth lies far outside the observed skin interval.
  for(let y=20;y<30;y++)for(let x=44;x<58;x++){
    const p=y*w+x;confidence[p]=245;skin[p]=48;gray[p]=118;
  }
  // One nearby background point is enclosed by the disputed patch. It must
  // not be restored from that patch's previously incorrect focus depth.
  const rim=25*w+53;skin[rim]=31;
  const matte={confidence,refinementConfidence:semantic,width:w,height:h,source:'fused'},protection={confidence:skin,width:w,height:h};
  const before=confidence.slice(),out=fusePortraitDepth(gray,matte,w,h,{protectionMatte:protection});
  assert.ok(out.gray[25*w+52]<=130,'weak skin does not snap background texture to the focus plane');
  assert.equal(out.gray[rim],118,'disputed background cannot seed an enclosed-rim repair');
  assert.ok(Math.abs(out.gray[35*w+25]-out.report.focusPlane)<=3,'confident skin stays focused');
  assert.deepEqual(confidence,before,'source foreground matte remains immutable');
  const confirmed=semantic.slice();confirmed[25*w+52]=255;
  const corroborated=fusePortraitDepth(gray,{...matte,refinementConfidence:confirmed},w,h,{protectionMatte:protection});
  assert.ok(corroborated.gray[25*w+52]>190,'SAM corroboration can retain a true held object despite depth error');
  const confidentSkin=skin.slice();confidentSkin[25*w+52]=250;
  const actualSkin=fusePortraitDepth(gray,matte,w,h,{protectionMatte:{...protection,confidence:confidentSkin}});
  assert.ok(actualSkin.gray[25*w+52]>190,'confident skin remains protected even if the other signals disagree');
});

test('focus gating preserves a narrow coherent rim without filling its rejected interior or an open background region',()=>{
  const w=96,h=72,gray=field(w,h,80),confidence=field(w,h,0),skin=field(w,h,0),semantic=field(w,h,0);
  for(let y=10;y<62;y++)for(let x=10;x<78;x++){
    const p=y*w+x;confidence[p]=248;gray[p]=212;
    if(x<36){skin[p]=250;gray[p]=210+(x%7)*4;semantic[p]=255;}
  }
  // A disputed enclosed region with coherent shallow depth deviation. Repair
  // must stop after the narrow rim even though the same deviation continues.
  for(let y=25;y<45;y++)for(let x=43;x<61;x++)gray[y*w+x]=205;
  // A second enclosed hole is genuinely far behind the subject. Even its
  // outermost pixel must not be restored just because it is enclosed.
  for(let y=49;y<57;y++)for(let x=43;x<51;x++)gray[y*w+x]=140;
  // The same small depth deviation on a region open to matte background must
  // stay excluded; this must not become blanket depth-interval expansion.
  for(let y=25;y<45;y++)for(let x=69;x<78;x++)gray[y*w+x]=205;
  // A secondary disconnected foreground region is outside the selected focus
  // group and must not inherit its boundary repair.
  for(let y=10;y<22;y++)for(let x=82;x<94;x++){confidence[y*w+x]=248;gray[y*w+x]=212;}
  for(let y=13;y<19;y++)for(let x=85;x<91;x++)gray[y*w+x]=205;
  const original=gray.slice(),out=fusePortraitDepth(gray,{confidence,refinementConfidence:semantic,width:w,height:h,source:'fused'},w,h,
    {protectionMatte:{confidence:skin,width:w,height:h}});
  assert.ok(Math.abs(out.gray[34*w+43]-out.report.focusPlane)<=3,'thin foreground rim survives focus gating');
  assert.equal(out.gray[34*w+49],205,'repair cannot expand through the hole interior');
  assert.equal(out.gray[52*w+43],140,'large depth disagreement remains rejected even at the rim');
  assert.equal(out.gray[34*w+74],205,'open background remains at original depth');
  assert.equal(out.gray[15*w+85],205,'unselected foreground region remains at original depth');
  assert.deepEqual(gray,original);
});

test('background bytes outside the matte fusion band remain byte-identical',()=>{
  const w=72,h=54,gray=new Uint8Array(w*h),confidence=field(w,h,0);
  for(let p=0;p<gray.length;p++)gray[p]=(p*17)%256;
  for(let y=15;y<40;y++)for(let x=20;x<48;x++)confidence[y*w+x]=245;
  const original=gray.slice(),out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'fused'},w,h);
  for(let p=0;p<gray.length;p++)if(confidence[p]===0)assert.equal(out.gray[p],original[p]);
});

test('uncertain boundary receives bounded blending while confident background never moves',()=>{
  const w=50,h=40,gray=field(w,h,50),confidence=field(w,h,0);
  for(let y=10;y<30;y++)for(let x=14;x<36;x++){gray[y*w+x]=210;confidence[y*w+x]=245;}
  for(let y=9;y<31;y++){confidence[y*w+13]=120;confidence[y*w+36]=120;gray[y*w+13]=120;gray[y*w+36]=120;}
  const out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'fused'},w,h);
  assert.equal(out.gray[5*w+5],50,'confident background is immutable');
  assert.ok(out.gray[20*w+13]>120&&out.gray[20*w+13]<210,'uncertain rim blends toward focus without hard dilation');
});

test('Apple skin protection preserves the inner finger edge and feathers its uncertain outer rim',()=>{
  const w=80,h=60,gray=field(w,h,55),confidence=field(w,h,0),skin=field(w,h,0);
  for(let y=15;y<48;y++)for(let x=12;x<42;x++){
    gray[y*w+x]=212;confidence[y*w+x]=248;skin[y*w+x]=250;
  }
  // Two-pixel soft fingertip rim: final matte and skin both still contain
  // evidence, but linear matte blending alone would leave it too close to
  // background depth and Apple Photos would visibly eat into the finger.
  for(let y=20;y<44;y++)for(let x=42;x<=43;x++){
    gray[y*w+x]=95;confidence[y*w+x]=82;skin[y*w+x]=105;
  }
  const matte={confidence,width:w,height:h,source:'fused'};
  const protection={confidence:skin,width:w,height:h,source:'apple-skin'};
  const baseline=fusePortraitDepth(gray,matte,w,h);
  const protectedDepth=fusePortraitDepth(gray,matte,w,h,{protectionMatte:protection});
  const p=30*w+42;
  assert.ok(protectedDepth.gray[p]>baseline.gray[p]+40,
    `protected finger rim should move materially toward focus: ${baseline.gray[p]} -> ${protectedDepth.gray[p]}`);
  assert.ok(Math.abs(protectedDepth.gray[p]-protectedDepth.report.focusPlane)<=28,
    'protected finger rim stays in a focus-safe band');
  assert.equal(protectedDepth.gray[30*w+44],55,'pixel outside both final matte and skin remains byte-identical background');
  assert.ok(protectedDepth.gray[30*w+43]<protectedDepth.gray[p],
    'outer uncertainty transitions toward scene depth instead of forming a protected plateau');
  assert.ok(protectedDepth.report.protectedChanged>0);
});

test('skin uncertainty has a gradual depth transition with immutable confident foreground and background',()=>{
  const w=1024,h=64,gray=field(w,h,80),confidence=field(w,h,0),skin=field(w,h,0);
  for(let y=12;y<52;y++)for(let x=100;x<280;x++){
    const p=y*w+x;gray[p]=212;confidence[p]=248;skin[p]=250;
  }
  for(let y=16;y<48;y++)for(let d=1;d<=3;d++){
    const p=y*w+279+d;confidence[p]=skin[p]=[0,200,128,60][d];
  }
  const before=gray.slice(),out=fusePortraitDepth(gray,{confidence,width:w,height:h,source:'fused'},w,h,
    {protectionMatte:{confidence:skin,width:w,height:h}});
  const profile=Array.from({length:5},(_,i)=>out.gray[30*w+279+i]);
  for(let i=1;i<profile.length;i++){
    assert.ok(profile[i]<profile[i-1],'outer transition must approach background monotonically');
    assert.ok(profile[i-1]-profile[i]<=55,'depth transition must not end in an abrupt step');
  }
  assert.ok(profile[0]-profile[1]<=16,'nearest uncertain edge remains protected');
  for(let p=0;p<gray.length;p++)if(confidence[p]>=224||confidence[p]<=31)assert.equal(out.gray[p],before[p]);
  assert.deepEqual(gray,before);
});

test('skin protection does not protect a non-skin uncertain object edge',()=>{
  const w=64,h=48,gray=field(w,h,60),confidence=field(w,h,0),skin=field(w,h,0);
  for(let y=12;y<36;y++)for(let x=10;x<34;x++){gray[y*w+x]=205;confidence[y*w+x]=245;skin[y*w+x]=248;}
  for(let y=15;y<33;y++)for(let x=34;x<38;x++){gray[y*w+x]=110;confidence[y*w+x]=110;}
  const matte={confidence,width:w,height:h,source:'fused'},protection={confidence:skin,width:w,height:h,source:'apple-skin'};
  const baseline=fusePortraitDepth(gray,matte,w,h),protectedDepth=fusePortraitDepth(gray,matte,w,h,{protectionMatte:protection});
  assert.equal(protectedDepth.gray[24*w+36],baseline.gray[24*w+36],
    'non-skin uncertain edge keeps normal matte-conditioned depth behavior');
});

test('empty or scene-spanning foreground fails closed without changing depth',()=>{
  const w=40,h=30,gray=field(w,h,123),empty=field(w,h,0),full=field(w,h,255);
  assert.deepEqual(fusePortraitDepth(gray,{confidence:empty,width:w,height:h,source:'isnet'},w,h).gray,gray);
  assert.deepEqual(fusePortraitDepth(gray,{confidence:full,width:w,height:h,source:'isnet'},w,h).gray,gray);
  assert.throws(()=>fusePortraitDepth(new Float32Array(w*h),{confidence:empty,width:w,height:h},w,h),/geometry/);
});
