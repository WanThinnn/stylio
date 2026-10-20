import {MATTE_FOREGROUND,MATTE_BACKGROUND} from './foreground-matte.js';

function validate(gray,matte,width,height){
  if(!(gray instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
    ||gray.length!==width*height||!(matte?.confidence instanceof Uint8Array)
    ||matte.width!==width||matte.height!==height||matte.confidence.length!==gray.length)
    throw Error('Invalid portrait depth geometry');
}

function validateProtection(matte,width,height,length){
  if(!matte)return null;
  if(!(matte.confidence instanceof Uint8Array)||matte.width!==width||matte.height!==height||matte.confidence.length!==length)
    throw Error('Invalid portrait protection matte geometry');
  return matte.confidence;
}

function quantile(hist,count,f){
  let seen=0,target=Math.max(1,Math.ceil(count*f));
  for(let i=0;i<256;i++){seen+=hist[i];if(seen>=target)return i;}
  return 255;
}

function softRegions(confidence,width,height){
  const seen=new Uint8Array(confidence.length),queue=new Int32Array(confidence.length),regions=[];
  for(let start=0;start<confidence.length;start++){
    if(seen[start]||confidence[start]<=MATTE_BACKGROUND)continue;
    let head=0,tail=1;queue[0]=start;seen[start]=1;
    const indices=[];let confident=0,left=width,top=height,right=-1,bottom=-1,touches=0;
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width);indices.push(p);
      if(confidence[p]>=MATTE_FOREGROUND)confident++;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      if(x===0||y===0||x===width-1||y===height-1)touches++;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
        const q=ay*width+ax;if(seen[q]||confidence[q]<=MATTE_BACKGROUND)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    regions.push({indices,confident,left,top,right,bottom,touches});
  }
  regions.sort((a,b)=>b.confident-a.confident||b.indices.length-a.indices.length);
  return regions;
}

function confidentComponents(confidence,width,height,regionMask){
  const seen=new Uint8Array(confidence.length),queue=new Int32Array(confidence.length),components=[];
  for(let start=0;start<confidence.length;start++){
    if(seen[start]||!regionMask[start]||confidence[start]<MATTE_FOREGROUND)continue;
    let head=0,tail=1;queue[0]=start;seen[start]=1;const indices=[];
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width);indices.push(p);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
        const q=ay*width+ax;
        if(seen[q]||!regionMask[q]||confidence[q]<MATTE_FOREGROUND)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    components.push(indices);
  }
  components.sort((a,b)=>b.length-a.length);
  return components;
}

function componentMedian(gray,indices){
  const hist=new Uint32Array(256);for(const p of indices)hist[gray[p]]++;
  return quantile(hist,indices.length,.5);
}

function dominantPlane(gray,confidence,region){
  const hist=new Uint32Array(256);let count=0;
  for(const p of region.indices)if(confidence[p]>=MATTE_FOREGROUND){hist[gray[p]]++;count++;}
  return count?quantile(hist,count,.5):null;
}

function assignComponents(regionMask,components,width,height){
  const owner=new Int32Array(regionMask.length);owner.fill(-1);
  const queue=new Int32Array(regionMask.length);let head=0,tail=0;
  components.forEach((component,index)=>{
    for(const p of component){if(owner[p]!==-1)continue;owner[p]=index;queue[tail++]=p;}
  });
  while(head<tail){
    const p=queue[head++],x=p%width,y=Math.floor(p/width),id=owner[p];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
      const q=ay*width+ax;if(!regionMask[q]||owner[q]!==-1)continue;
      owner[q]=id;queue[tail++]=q;
    }
  }
  return owner;
}

function foregroundProtectionBand(finalConfidence,protectionConfidence,width,height){
  if(!protectionConfidence)return null;
  const count=finalConfidence.length,distance=new Uint16Array(count);distance.fill(0xffff);
  const queue=new Int32Array(count);let head=0,tail=0;
  // 2 px at small test geometry, ~3 px at the production 1024-long-edge
  // Portrait working map. Deliberately narrow: protect skin antialiasing
  // without turning this into a general foreground dilation.
  const radius=Math.max(2,Math.round(Math.max(width,height)*.003));
  for(let p=0;p<count;p++){
    if(protectionConfidence[p]<MATTE_FOREGROUND||finalConfidence[p]<=MATTE_BACKGROUND)continue;
    distance[p]=0;queue[tail++]=p;
  }
  while(head<tail){
    const p=queue[head++],d=distance[p];if(d>=radius)continue;
    const x=p%width,y=Math.floor(p/width),next=d+1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
      const q=ay*width+ax;
      if(distance[q]!==0xffff||finalConfidence[q]<=MATTE_BACKGROUND||protectionConfidence[q]<=MATTE_BACKGROUND)continue;
      distance[q]=next;queue[tail++]=q;
    }
  }
  return {distance,radius};
}

function restoreEnclosedFocusRims(gray,out,original,confidence,regionMask,skinDisagreement,width,height,depthTolerance){
  const count=gray.length,seen=new Uint8Array(count),distance=new Uint8Array(count),supportDepth=new Uint8Array(count),supportOutput=new Uint8Array(count),
    queue=new Int32Array(count),radius=Math.max(1,Math.round(Math.max(width,height)*.002));
  let restored=0,changed=0;
  for(let start=0;start<count;start++){
    if(seen[start]||confidence[start]>MATTE_BACKGROUND||original[start]<=MATTE_BACKGROUND)continue;
    let head=0,tail=1,enclosed=true;queue[0]=start;seen[start]=1;
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;
        if(ax<0||ay<0||ax>=width||ay>=height){enclosed=false;continue;}
        const q=ay*width+ax;
        if(original[q]<=MATTE_BACKGROUND){enclosed=false;continue;}
        if(seen[q]||confidence[q]>MATTE_BACKGROUND)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    // An open rejection region may be a real background object. Only an
    // internal rejection hole can receive this narrow continuity repair.
    if(!enclosed)continue;
    const componentCount=tail;let seeds=0;
    for(let i=0;i<componentCount;i++){
      const p=queue[i];if(original[p]<MATTE_FOREGROUND)continue;
      const x=p%width,y=Math.floor(p/width);let support=-1;
      for(let dy=-1;dy<=1&&support<0;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
        const q=ay*width+ax;
        if(regionMask[q]&&confidence[q]>=MATTE_FOREGROUND&&!skinDisagreement?.[q]
          &&Math.abs(gray[p]-gray[q])<=depthTolerance){support=q;break;}
      }
      if(support<0)continue;
      distance[p]=1;supportDepth[p]=gray[support];supportOutput[p]=out[support];queue[seeds++]=p;
    }
    head=0;tail=seeds;
    while(head<tail){
      const p=queue[head++];if(distance[p]>=radius)continue;
      const x=p%width,y=Math.floor(p/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
        const q=ay*width+ax;
        if(distance[q]||confidence[q]>MATTE_BACKGROUND||original[q]<MATTE_FOREGROUND
          ||Math.abs(gray[q]-supportDepth[p])>depthTolerance)continue;
        distance[q]=distance[p]+1;supportDepth[q]=supportDepth[p];supportOutput[q]=supportOutput[p];queue[tail++]=q;
      }
    }
    // Restore after traversal, so restored pixels cannot recursively seed an
    // unlimited expansion. The hole's deeper interior remains at scene depth.
    for(let i=0;i<tail;i++){
      const p=queue[i];if(out[p]!==supportOutput[p]){out[p]=supportOutput[p];changed++;}restored++;
    }
  }
  return {restored,changed,radius};
}

function focusConfidence(gray,matte,skin){
  const semantic=matte.refinementConfidence,original=matte.confidence;
  if(semantic!==undefined&&(!(semantic instanceof Uint8Array)||semantic.length!==gray.length))
    throw Error('Invalid Portrait refinement confidence geometry');
  if(!skin||!semantic)return {confidence:original,excluded:0,skinDepthInterval:null};
  const hist=new Uint32Array(256);let count=0;
  for(let p=0;p<gray.length;p++)if(skin[p]>=MATTE_FOREGROUND&&original[p]>=MATTE_FOREGROUND){hist[gray[p]]++;count++;}
  if(count<16)return {confidence:original,excluded:0,skinDepthInterval:null};
  // A PEM foreground label is not a guarantee of equal focus distance. When
  // SAM disagrees, use the observed skin depth distribution as corroboration:
  // retain skin-compatible metal/fingers, but leave a distant foreground-class
  // object at its inferred depth. No scene coordinates or reference depths.
  const spread=quantile(hist,count,.75)-quantile(hist,count,.25),margin=Math.max(1,Math.round(spread*.22));
  const low=Math.max(0,quantile(hist,count,.01)-margin),high=Math.min(255,quantile(hist,count,.99)+margin);
  const confidence=original.slice(),skinDisagreement=new Uint8Array(gray.length);let excluded=0,disputedSkinPixels=0;
  for(let p=0;p<gray.length;p++){
    if(original[p]<=MATTE_BACKGROUND||skin[p]>=MATTE_FOREGROUND||semantic[p]>MATTE_BACKGROUND)continue;
    if(gray[p]>=low&&gray[p]<=high)continue;
    if(skin[p]>MATTE_BACKGROUND){
      // Weak skin uncertainty cannot overrule confident SAM background plus
      // incompatible scene depth. Keep its soft coverage, rather than snapping
      // texture just outside a finger onto the photographic focus plane.
      skinDisagreement[p]=1;disputedSkinPixels++;continue;
    }
    confidence[p]=0;excluded++;
  }
  return {confidence,excluded,skinDisagreement,disputedSkinPixels,skinDepthInterval:[low,high],boundaryDepthTolerance:Math.max(3,margin*2)};
}

export function fusePortraitDepth(gray,matte,width,height,{protectionMatte=null}={}){
  validate(gray,matte,width,height);
  const protectionConfidence=validateProtection(protectionMatte,width,height,gray.length),
    focus=focusConfidence(gray,matte,protectionConfidence),confidence=focus.confidence,
    protection=foregroundProtectionBand(confidence,protectionConfidence,width,height),
    out=gray.slice(),regions=softRegions(confidence,width,height);
  const unchanged=reason=>({gray:out,report:{applied:false,reason,source:matte.source||'unknown'}});
  if(!regions.length)return unchanged('no-foreground-matte');

  const region=regions[0],coverage=region.indices.length/gray.length;
  const spanX=(region.right-region.left+1)/width,spanY=(region.bottom-region.top+1)/height;
  if(region.confident<16||coverage>.72||(spanX>.96&&spanY>.96))
    return unchanged('scene-spanning-or-insufficient-foreground');

  const regionMask=new Uint8Array(gray.length);for(const p of region.indices)regionMask[p]=1;
  const components=confidentComponents(confidence,width,height,regionMask).filter(c=>c.length>=4);
  if(!components.length)return unchanged('no-confident-components');

  const plane=dominantPlane(gray,confidence,region);
  if(plane===null)return unchanged('no-focus-plane');
  const medians=components.map(component=>componentMedian(gray,component));
  const owner=assignComponents(regionMask,components,width,height);

  // Keep local 3-D shape but compress each semantic/matte component around one
  // photographic focus plane. Inter-object offsets can be wildly wrong in
  // monocular depth (e.g. a key vs the hand holding it); intra-object relief is
  // retained instead of flattening the subject. A proportional scale alone is
  // unbounded: a ring touching a hand is one component and can retain a large
  // erroneous monocular offset. Smoothly bound relief to three 8-bit disparity
  // steps (a quantization tolerance, not depth copied from a reference photo).
  const reliefScale=.22,reliefLimit=3;
  let changed=0,uncertainChanged=0,confidentChanged=0,protectedChanged=0;
  for(const p of region.indices){
    const id=owner[p];if(id<0)continue;
    const c=confidence[p];if(c<=MATTE_BACKGROUND)continue;
    const protectedEdge=protection&&protection.distance[p]!==0xffff&&protection.distance[p]>0;
    // Monocular depth often collapses exactly at a finger silhouette. Preserve
    // normal foreground relief everywhere else, but treat a narrow AI-confirmed
    // skin edge as belonging to the local skin plane rather than carrying that
    // erroneous background-like relief into Apple's CoC calculation.
    const localReliefScale=protectedEdge?.06:reliefScale;
    const relief=reliefLimit*Math.tanh((gray[p]-medians[id])*localReliefScale/reliefLimit);
    const target=Math.max(0,Math.min(255,Math.round(plane+relief)));
    let alpha=c>=MATTE_FOREGROUND?1:(c-MATTE_BACKGROUND)/(MATTE_FOREGROUND-MATTE_BACKGROUND);
    if(protection&&protection.distance[p]!==0xffff){
      const d=protection.distance[p];
      // Keep confident skin and its nearest uncertain edge protected. Farther
      // through the soft rim, taper toward scene depth. A nearly constant 90%
      // floor creates a focus plateau followed by a sharp cut at background.
      // Matte foreground/background and non-skin thin structures are unchanged.
      const floor=d===0?1:.94*(protection.radius-d+1)/protection.radius;
      alpha=Math.max(alpha,floor);
    }
    if(focus.skinDisagreement?.[p]){
      const coverage=(protectionConfidence[p]-MATTE_BACKGROUND)/(MATTE_FOREGROUND-MATTE_BACKGROUND);
      alpha=Math.min(alpha,coverage);
    }
    const value=Math.max(0,Math.min(255,Math.round(gray[p]+(target-gray[p])*alpha)));
    if(value!==out[p]){
      out[p]=value;changed++;
      if(c>=MATTE_FOREGROUND)confidentChanged++;else uncertainChanged++;
      if(protection&&protection.distance[p]!==0xffff)protectedChanged++;
    }
  }

  // Repair only previously rejected rims after measuring and fusing the core.
  // This leaves the accepted focus plane, relief and every accepted pixel
  // unchanged; boundary repair cannot feed back into their robust medians.
  const rim=focus.excluded?restoreEnclosedFocusRims(gray,out,matte.confidence,confidence,regionMask,focus.skinDisagreement,width,height,focus.boundaryDepthTolerance)
    :{restored:0,changed:0,radius:0};
  changed+=rim.changed;confidentChanged+=rim.changed;

  return {gray:out,report:{
    applied:changed>0,
    mode:'matte-conditioned-focus',
    source:matte.source||'unknown',
    focusPlane:plane,
    components:components.length,
    componentMedians:medians,
    reliefScale,
    reliefLimit,
    focusExcludedPixels:focus.excluded-rim.restored,
    skinDepthInterval:focus.skinDepthInterval,
    disputedSkinPixels:focus.disputedSkinPixels??0,
    focusBoundaryRestoredPixels:rim.restored,
    focusBoundaryRadius:rim.radius,
    focusBoundaryDepthTolerance:focus.boundaryDepthTolerance??0,
    changed,
    confidentChanged,
    uncertainChanged,
    protectedChanged,
    protectionRadius:protection?.radius??0,
    coverage,
    confidentPixels:region.confident
  }};
}
