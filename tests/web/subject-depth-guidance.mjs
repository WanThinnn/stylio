import test from 'node:test';
import assert from 'node:assert/strict';
import {fusePortraitDepth} from '../../web/src/portrait/subject-depth-guidance.js';

const field=(w,h,value)=>new Uint8Array(w*h).fill(value);

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
