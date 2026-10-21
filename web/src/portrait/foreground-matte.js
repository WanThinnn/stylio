export const MATTE_FOREGROUND=224;
export const MATTE_BACKGROUND=31;

function validateConfidence(confidence,width,height,label='matte'){
  if(!(confidence instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
    ||confidence.length!==width*height)throw Error(`Invalid ${label} geometry`);
}

function componentsAt(confidence,width,height,threshold=MATTE_FOREGROUND){
  validateConfidence(confidence,width,height);
  const seen=new Uint8Array(confidence.length),queue=new Int32Array(confidence.length),components=[];
  for(let start=0;start<confidence.length;start++){
    if(seen[start]||confidence[start]<threshold)continue;
    let head=0,tail=1;queue[0]=start;seen[start]=1;
    let left=width,top=height,right=-1,bottom=-1,sum=0,touchesBorder=false;
    const indices=[];
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width);
      indices.push(p);sum+=confidence[p];
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      touchesBorder ||= x===0||y===0||x===width-1||y===height-1;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
        const q=ay*width+ax;if(seen[q]||confidence[q]<threshold)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    components.push({
      pixels:indices.length,
      bounds:{left:left/width,top:top/height,right:(right+1)/width,bottom:(bottom+1)/height},
      touchesBorder,
      mean:sum/indices.length,
      indices
    });
  }
  components.sort((a,b)=>b.pixels-a.pixels);
  return components;
}

function publicComponent({indices,...component}){return component;}

export function analyzeForegroundMatte(confidence,width,height){
  validateConfidence(confidence,width,height);
  let confidentForeground=0,uncertain=0,confidentBackground=0,sum=0,borderForeground=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const value=confidence[y*width+x];sum+=value;
    if(value>=MATTE_FOREGROUND){confidentForeground++;if(x===0||y===0||x===width-1||y===height-1)borderForeground++;}
    else if(value<=MATTE_BACKGROUND)confidentBackground++;
    else uncertain++;
  }
  return {
    confidentForeground,uncertain,confidentBackground,
    coverage:confidentForeground/confidence.length,
    confidenceMean:sum/confidence.length,
    borderTouching:borderForeground>0,
    components:componentsAt(confidence,width,height).map(publicComponent)
  };
}

function matteInput(matte,width,height,label){
  if(!matte)return null;
  if(matte.width!==width||matte.height!==height)throw Error(`${label} matte geometry mismatch`);
  validateConfidence(matte.confidence,width,height,label);
  return matte;
}

export function dominantForegroundMatte(matte,width,height){
  const input=matteInput(matte,width,height,'dominant');
  if(!input)return null;
  const components=componentsAt(input.confidence,width,height);
  if(!components.length)return null;
  const anchor=components[0],confidence=new Uint8Array(width*height),distance=new Uint16Array(width*height);
  distance.fill(0xffff);
  const queue=new Int32Array(width*height);let head=0,tail=0;
  const supportRadius=Math.max(3,Math.round(Math.max(width,height)*.025));
  for(const p of anchor.indices){confidence[p]=input.confidence[p];distance[p]=0;queue[tail++]=p;}
  while(head<tail){
    const p=queue[head++],d=distance[p];if(d>=supportRadius)continue;
    const x=p%width,y=Math.floor(p/width),next=d+1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
      const q=ay*width+ax;
      if(distance[q]!==0xffff||input.confidence[q]<=MATTE_BACKGROUND)continue;
      distance[q]=next;confidence[q]=input.confidence[q];queue[tail++]=q;
    }
  }
  return {confidence,width,height,source:`${input.source||'matte'}-dominant`,report:{
    ...analyzeForegroundMatte(confidence,width,height),anchorPixels:anchor.pixels,ignoredComponents:Math.max(0,components.length-1),supportRadius
  }};
}

// Without an Apple PEM/skin anchor, a generated semantic matte is only useful
// when it describes one substantial, self-contained subject. Fragmented masks
// and masks entering from an image edge are commonly foliage, seats, or other
// salient scene regions; forcing all of them onto one focus plane corrupts an
// otherwise useful monocular depth map. Fail closed to raw depth in those cases.
export function selectGeneratedPortraitMatte(matte,width,height){
  const input=matteInput(matte,width,height,'generated Portrait');
  if(!input)return {matte:null,report:{applied:false,reason:'missing'}};
  const analysis=analyzeForegroundMatte(input.confidence,width,height);
  const anchor=componentsAt(input.confidence,width,height)[0];
  if(!anchor)return {matte:null,report:{...analysis,applied:false,reason:'no-confident-foreground'}};
  const minimumPixels=Math.max(16,Math.round(width*height*.005));
  const dominance=analysis.confidentForeground?anchor.pixels/analysis.confidentForeground:0;
  let reason=null;
  if(anchor.pixels<minimumPixels)reason='fragmented';
  else if(dominance<.6)reason='ambiguous-components';
  else if(anchor.touchesBorder&&dominance<.9)reason='border-ambiguous';
  if(reason)return {matte:null,report:{...analysis,applied:false,reason,anchorPixels:anchor.pixels,minimumPixels,dominance}};
  const selected=dominantForegroundMatte(input,width,height);
  return {matte:selected,report:{...selected.report,applied:true,reason:'coherent-subject',minimumPixels,dominance}};
}

// PEM describes the whole foreground, including non-skin objects and fingers
// disconnected in the skin matte by an occluding object. Skin can supply an
// anchor only when PEM has no usable foreground; it must not replace PEM.
export function portraitFocusAnchor(appleMatte,skinMatte,width,height){
  return dominantForegroundMatte(appleMatte,width,height)
    ??dominantForegroundMatte(skinMatte,width,height);
}

function locallyExpandGeneratedMatte(appleConfidence,generatedConfidence,width,height){
  const count=width*height,accepted=new Uint8Array(count),cost=new Uint16Array(count);
  cost.fill(0xffff);
  const queue=new Int32Array(count);let head=0,tail=0;
  const longest=Math.max(width,height),seedRadius=Math.max(1,Math.round(longest*.004)),
    maxExpansion=Math.max(4,Math.round(longest*.035));

  // Apple PEM is the authority. IS-Net can travel freely inside Apple's own
  // foreground/uncertainty support. Only excursions into Apple-confirmed
  // background consume the expansion budget. This preserves thin held-object
  // edges while preventing one broad IS-Net component from pulling a distant
  // salient object into the Portrait focus group.
  const appleSupported=new Uint8Array(count);
  for(let p=0;p<count;p++)if(appleConfidence[p]>MATTE_BACKGROUND)appleSupported[p]=1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;if(generatedConfidence[p]<=MATTE_BACKGROUND)continue;
    let nearApple=appleSupported[p]===1;
    for(let dy=-seedRadius;dy<=seedRadius&&!nearApple;dy++)for(let dx=-seedRadius;dx<=seedRadius;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))>seedRadius)continue;
      const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
      if(appleSupported[ay*width+ax]){nearApple=true;break;}
    }
    if(!nearApple)continue;
    accepted[p]=1;cost[p]=0;queue[tail++]=p;
  }

  // Every generated pixel inside Apple's own soft support is already a seed.
  // Expansion therefore only needs to count how far we travel through pixels
  // Apple classified as background. Each pixel is queued at most once.
  while(head<tail){
    const p=queue[head++],x=p%width,y=Math.floor(p/width),base=cost[p];
    if(base>=maxExpansion)continue;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
      const q=ay*width+ax;
      if(cost[q]!==0xffff||generatedConfidence[q]<=MATTE_BACKGROUND)continue;
      // A generated foreground pixel that also has Apple support would have
      // been seeded above; any unseen pixel here is an Apple-background excursion.
      const next=base+1;if(next>maxExpansion)continue;
      cost[q]=next;accepted[q]=1;queue[tail++]=q;
    }
  }
  let acceptedGeneratedPixels=0,rejectedGeneratedPixels=0;
  for(let p=0;p<count;p++)if(generatedConfidence[p]>MATTE_BACKGROUND){
    if(accepted[p])acceptedGeneratedPixels++;else rejectedGeneratedPixels++;
  }
  return {accepted,maxExpansion,seedRadius,acceptedGeneratedPixels,rejectedGeneratedPixels};
}

export function fuseForegroundMattes(appleMatte,generatedMatte,width,height){
  const apple=matteInput(appleMatte,width,height,'Apple');
  const generated=matteInput(generatedMatte,width,height,'generated');
  if(!apple&&!generated)return null;
  if(!apple){
    const confidence=generated.confidence.slice();
    return {confidence,width,height,source:generated.source||'isnet',report:{...analyzeForegroundMatte(confidence,width,height),apple:false,generated:true}};
  }
  if(!generated){
    const confidence=apple.confidence.slice();
    return {confidence,width,height,source:apple.source||'apple-pem',report:{...analyzeForegroundMatte(confidence,width,height),apple:true,generated:false}};
  }

  const confidence=apple.confidence.slice();
  const expansion=locallyExpandGeneratedMatte(apple.confidence,generated.confidence,width,height);
  for(let p=0;p<confidence.length;p++){
    if(expansion.accepted[p]){
      // Generated additions are proposals until boundary refinement confirms
      // them. Promoting them directly to immutable foreground prevents SAM
      // from rejecting a nearby background object included by IS-Net.
      const proposal=Math.min(generated.confidence[p],MATTE_FOREGROUND-1);
      confidence[p]=Math.max(confidence[p],proposal);
    }
    // Apple-confirmed foreground is immutable under generated-matte fusion.
    if(apple.confidence[p]>=MATTE_FOREGROUND)confidence[p]=Math.max(confidence[p],apple.confidence[p]);
  }
  return {
    confidence,width,height,source:'fused',appleConfidence:apple.confidence,
    report:{...analyzeForegroundMatte(confidence,width,height),apple:true,generated:true,
      acceptedGeneratedPixels:expansion.acceptedGeneratedPixels,rejectedGeneratedPixels:expansion.rejectedGeneratedPixels,
      maxExpansion:expansion.maxExpansion,seedRadius:expansion.seedRadius}
  };
}

function distanceInside(confidence,width,height,threshold=MATTE_FOREGROUND){
  const inf=0xffff,d=new Uint16Array(confidence.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;
    d[p]=confidence[p]>=threshold?Math.min(inf,Math.min(x+1,y+1,width-x,height-y)):0;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;if(!d[p])continue;
    if(x)d[p]=Math.min(d[p],d[p-1]+1);
    if(y)d[p]=Math.min(d[p],d[p-width]+1);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const p=y*width+x;if(!d[p])continue;
    if(x+1<width)d[p]=Math.min(d[p],d[p+1]+1);
    if(y+1<height)d[p]=Math.min(d[p],d[p+width]+1);
  }
  return d;
}

export function foregroundFocusPoint(matte,width,height){
  const input=matteInput(matte,width,height,'focus');
  if(!input)return null;
  const components=componentsAt(input.confidence,width,height);
  if(!components.length)return null;
  const dominant=components[0];
  const distance=distanceInside(input.confidence,width,height);
  let best=-1,bestDistance=-1,bestConfidence=-1;
  for(const p of dominant.indices){
    const d=distance[p],c=input.confidence[p];
    if(d>bestDistance||(d===bestDistance&&c>bestConfidence)||(d===bestDistance&&c===bestConfidence&&p<best)){
      best=p;bestDistance=d;bestConfidence=c;
    }
  }
  if(best<0)return null;
  const x=best%width,y=Math.floor(best/width);
  return {x:(x+.5)/width,y:(y+.5)/height,distance:bestDistance,confidence:bestConfidence,componentPixels:dominant.pixels};
}

function pickSpaced(candidates,count,width,height){
  const picked=[];
  for(const candidate of candidates){
    if(picked.length>=count)break;
    const minDistance=Math.max(1,Math.max(width,height)/Math.max(4,count*2));
    if(picked.every(p=>Math.hypot((p.x-candidate.x)*width,(p.y-candidate.y)*height)>=minDistance))picked.push(candidate);
  }
  return picked;
}

export function mattePromptPoints(matte,width,height,{positiveCount=6,negativeCount=6}={}){
  const input=matteInput(matte,width,height,'prompt');
  if(!input)return {positive:[],negative:[]};
  const distance=distanceInside(input.confidence,width,height),positiveCandidates=[],negativeCandidates=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,c=input.confidence[p],point={x:(x+.5)/width,y:(y+.5)/height};
    if(c>=MATTE_FOREGROUND)positiveCandidates.push({...point,score:distance[p]*512+c});
    else if(c<=MATTE_BACKGROUND){
      // Prefer confident background near the image centre before corners; this
      // supplies useful negative context without depending on scene semantics.
      const centre=Math.hypot((x+.5)/width-.5,(y+.5)/height-.5);
      negativeCandidates.push({...point,score:(MATTE_BACKGROUND-c)*512-centre*100});
    }
  }
  positiveCandidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
  negativeCandidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
  const strip=points=>points.map(({score,...p})=>p);
  return {
    positive:strip(pickSpaced(positiveCandidates,positiveCount,width,height)),
    negative:strip(pickSpaced(negativeCandidates,negativeCount,width,height))
  };
}
