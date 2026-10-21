// Confidence-weighted, one-sided surface completion on an RGB affinity graph.
// Solve sum(c_i*(z_i-d_i)^2) + sum(w_ij*((z_i-z_j)-g_ij)^2).
// Unlike scalar bilateral smoothing, g transports reliable local surface slopes:
// a foreground label never establishes a shared depth/focus plane. This is a
// bounded pixel-graph solver, not an implementation of the bilateral-grid solver.
// All observations and graph weights are immutable during the solve.
export function optimizeSceneDepth(gray,matte,width,height,rgb){
 const result=solveSceneDepth(gray,matte,width,height,rgb,true);
 if(['non-convergent-system','boundary-memory-budget','no-reliable-interior'].includes(result.report.reason)
   &&result.report.edgeRadius>Math.max(4,Math.round(Math.max(width,height)*.012))){
  const fallback=solveSceneDepth(gray,matte,width,height,rgb,false);
  fallback.report.scaleFallback=result.report.reason;return fallback;
 }
 return result;
}

function solveSceneDepth(gray,matte,width,height,rgb,adaptive){
 const count=gray.length,out=gray.slice(),confidence=matte.confidence,semantic=matte.refinementConfidence;
 const baseRadius=Math.max(4,Math.round(Math.max(width,height)*.012)),searchRadius=Math.min(240,baseRadius*4);
 let radius=baseRadius;
 const report={applied:false,mode:'scene-geometry',source:matte.source||'unknown',algorithm:'confidence-surface-graph-v2',
  changed:0,uncertainChanged:0,confidentChanged:0,protectionRadius:0,edgeRadius:radius,activePixels:0,iterations:0};
 const unchanged=reason=>({gray:out,report:{...report,reason}});
 // Model scores are guidance, not calibrated depth probabilities. Missing
 // independent geometry/appearance evidence cannot authorize reconstruction.
 if(!rgb||!semantic)return unchanged('missing-guidance');
 const foreground=p=>confidence[p]>31&&(confidence[p]>=128||semantic[p]>=224);
 const colourDistance=(p,q)=>{let sum=0;for(let c=0;c<3;c++)sum+=(rgb[p*3+c]-rgb[q*3+c])**2;return sum;};
 // Boundary evidence uses a small appearance scale, not individual printed
 // texture pixels. The original RGB still supplies the optimization affinities.
 const appearance=new Uint8Array(rgb.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=y*width+x;let r=0,g=0,b=0,n=0;
  for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
   const q=(yy*width+xx)*3;r+=rgb[q];g+=rgb[q+1];b+=rgb[q+2];n++;
  }
  appearance[p*3]=Math.round(r/n);appearance[p*3+1]=Math.round(g/n);appearance[p*3+2]=Math.round(b/n);
 }
 const edgeContrast=(p,q)=>{let sum=0;for(let c=0;c<3;c++)sum+=(appearance[p*3+c]-appearance[q*3+c])**2;return sum;};
 const hist=new Uint32Array(256);
 for(const value of gray)hist[value]++;
 const quantile=f=>{let n=0;for(let i=0;i<256;i++){n+=hist[i];if(n>=count*f)return i;}return 255;};
 const depthJump=Math.max(12,(quantile(.99)-quantile(.01))*.1);
 const right=new Uint8Array(count),down=new Uint8Array(count),distance=new Uint8Array(count),opposite=new Float32Array(count);distance.fill(255);
 const queue=new Int32Array(count),nearest=new Int32Array(count);let head=0,tail=0;
 const directions=[[-1,0],[1,0],[0,-1],[0,1]];
 const barrier=(p,q)=>width>1&&q===p+1?right[p]:width>1&&q===p-1?right[q]:q>p?down[p]:down[q];
 // Freeze occlusion cuts before solving. Colour alone cannot invent geometry;
 // depth alone cannot turn a smooth same-colour ramp into an object boundary.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=y*width+x;
  if(x+1<width)right[p]=+(Math.abs(gray[p]-gray[p+1])>depthJump&&colourDistance(p,p+1)>576&&edgeContrast(p,p+1)>144);
  if(y+1<height)down[p]=+(Math.abs(gray[p]-gray[p+width])>depthJump&&colourDistance(p,p+width)>576&&edgeContrast(p,p+width)>144);
 }
 const measureDistance=()=>{
 distance.fill(255);opposite.fill(0);head=tail=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=y*width+x;if(!foreground(p))continue;
  let other=0,support=0;
  for(const [dx,dy]of directions){
   const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
   const q=ay*width+ax;
   if((!foreground(q)&&edgeContrast(p,q)>144)||barrier(p,q)){
    other+=gray[q];support++;
   }
  }
  if(support){distance[p]=1;opposite[p]=other/support;queue[tail++]=p;}
 }
 while(head<tail){
  const p=queue[head++],d=distance[p];if(d>searchRadius)continue;
  const x=p%width,y=Math.floor(p/width);
  for(const [dx,dy]of directions){
   const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
   const q=ay*width+ax;
   if(!foreground(q)||barrier(p,q)||distance[q]!==255)continue;
   distance[q]=d+1;opposite[q]=opposite[p];queue[tail++]=q;
  }
 }
 return tail;
 };
 if(!measureDistance())return unchanged('no-corroborated-boundary');
 // A contrast/depth jump is not independently supported just because it cuts
 // a tiny reflective fragment away from its own foreground interior. Retain
 // cuts between supported surfaces; reconsider only one-sided unsupported cuts.
 const component=new Int32Array(count);component.fill(-1);
 const supported=new Uint8Array(count);let components=0;
 for(let start=0;start<count;start++){
  if(!foreground(start)||component[start]>=0)continue;
  const id=components++;head=0;tail=1;queue[0]=start;component[start]=id;
  while(head<tail){
   const p=queue[head++],x=p%width,y=Math.floor(p/width);
   if(distance[p]>baseRadius&&confidence[p]>=224)supported[id]|=1;
   for(const [dx,dy]of directions){
    const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
    const q=ay*width+ax;
    if(!foreground(q)){supported[id]|=2;continue;}
    if(component[q]>=0||barrier(p,q))continue;
    component[q]=id;queue[tail++]=q;
   }
  }
 }
 let unsupportedCuts=0;
 const reconsiderCut=(p,q,cuts)=>{
  if(!cuts[p]||!foreground(q))return;
  const a=supported[component[p]]&1,b=supported[component[q]]&1,fragment=a?q:p;
  if(a!==b&&(supported[component[fragment]]&2)&&confidence[fragment]>=224){cuts[p]=0;unsupportedCuts++;}
 };
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=y*width+x;if(!foreground(p))continue;
  if(x+1<width)reconsiderCut(p,p+1,right);
  if(y+1<height)reconsiderCut(p,p+width,down);
 }
 if(unsupportedCuts)measureDistance();
 report.unsupportedCuts=unsupportedCuts;
 if(adaptive){
  // Estimate the extent of non-affine depth transitions, using discrete normal
  // curvature above the measured deep-interior quantization/noise floor.
  // Affine surfaces have zero curvature, regardless of slope. No reference
  // photo, model tier, object category or focus-plane value enters this scale.
  const noiseHist=new Uint32Array(256),mass=new Float64Array(searchRadius+1);let noiseCount=0;
  const curvature=(p,q,r)=>Math.abs(gray[q]+gray[r]-2*gray[p]);
  const observe=(p,q,r,d,callback)=>{
   if(!foreground(q)||!foreground(r)||barrier(p,q)||barrier(p,r))return;
   if((distance[q]===d-1&&distance[r]===d+1)||(distance[r]===d-1&&distance[q]===d+1))callback(d,curvature(p,q,r));
  };
  const visit=callback=>{
   for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x,d=distance[p];if(d<2||d>searchRadius||confidence[p]<224)continue;
    observe(p,p-1,p+1,d,callback);observe(p,p-width,p+width,d,callback);
   }
  };
  visit((d,c)=>{if(d>=searchRadius*.75){noiseHist[Math.min(255,c)]++;noiseCount++;}});
  let noise=3,seen=0;
  for(let i=0;noiseCount&&i<256;i++){seen+=noiseHist[i];if(seen>=noiseCount*.75){noise=Math.max(noise,i);break;}}
  visit((d,c)=>{mass[d]+=Math.min(depthJump,Math.max(0,c-noise));});
  const total=mass.reduce((a,b)=>a+b,0);let sum=0;
  if(total>0)for(let d=1;d<=searchRadius;d++){
   sum+=mass[d];if(sum>=total*.9){radius=Math.min(searchRadius,Math.max(baseRadius,d+4));break;}
  }
  report.edgeRadius=radius;report.scaleNoiseFloor=noise;
 }
 // Multi-source propagation supplies local, same-side observations. A thin or
 // disputed region without a reliable interior is left unchanged, not erased.
 head=tail=0;
 for(let p=0;p<count;p++)if(foreground(p)&&distance[p]===radius+1&&confidence[p]>=224){nearest[p]=p+1;queue[tail++]=p;}
 if(!tail)return unchanged('no-reliable-interior');
 while(head<tail){
  const p=queue[head++],x=p%width,y=Math.floor(p/width);
  for(const [dx,dy]of directions){
   const ax=x+dx,ay=y+dy;if(ax<0||ay<0||ax>=width||ay>=height)continue;
   const q=ay*width+ax;
   if(!foreground(q)||barrier(p,q)||distance[q]>radius||nearest[q])continue;
   nearest[q]=nearest[p];queue[tail++]=q;
  }
 }
 const pixels=[];
 for(let p=0;p<count;p++)if(distance[p]<=radius&&nearest[p]&&Math.abs(gray[nearest[p]-1]-opposite[p])>3)pixels.push(p);
 if(!pixels.length)return unchanged('no-supported-boundary');
 // Keep noisy/fragmented guidance from turning a boundary solve into another
 // full-frame mobile allocation. This bounds typed scratch, not total JS heap.
 if(count*27+pixels.length*92+hist.byteLength>32*1024*1024)return unchanged('boundary-memory-budget');
 const n=pixels.length,index=new Int32Array(count);index.fill(-1);
 pixels.forEach((p,i)=>{index[p]=i;});
 const slopes=new Map();
 const slope=p=>{
  if(slopes.has(p))return slopes.get(p);
  const x=p%width,y=Math.floor(p/width);let n=0,sx=0,sy=0,sz=0,sxx=0,sxy=0,syy=0,sxz=0,syz=0;
  // Fit a local plane to reliable observations, rather than differentiating
  // one or two quantized pixels. Both the intercept and slopes are estimated.
  for(let yy=Math.max(0,y-4);yy<=Math.min(height-1,y+4);yy++)for(let xx=Math.max(0,x-4);xx<=Math.min(width-1,x+4);xx++){
   const q=yy*width+xx;
   if(distance[q]<=radius||!foreground(q)||confidence[q]<224||Math.abs(gray[q]-gray[p])>depthJump)continue;
   const dx=xx-x,dy=yy-y,z=gray[q];n++;sx+=dx;sy+=dy;sz+=z;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;sxz+=dx*z;syz+=dy*z;
  }
  const xx=sxx-sx*sx/n,xy=sxy-sx*sy/n,yy=syy-sy*sy/n,xz=sxz-sx*sz/n,yz=syz-sy*sz/n,det=xx*yy-xy*xy;
  const a=n>=3&&det>1e-6?(xz*yy-yz*xy)/det:0,b=n>=3&&det>1e-6?(yz*xx-xz*xy)/det:0;
  const g=[a,b,n?sz/n-a*sx/n-b*sy/n:gray[p]];
  slopes.set(p,g);return g;
 };
 const value=new Float64Array(n),gx=new Float32Array(n),gy=new Float32Array(n),dataWeight=new Float32Array(n),lower=new Float32Array(n),upper=new Float32Array(n);
 for(let i=0;i<n;i++){
  const p=pixels[i],seed=nearest[p]-1,g=slope(seed),dx=p%width-seed%width,dy=Math.floor(p/width)-Math.floor(seed/width);
  const prediction=g[2]+g[0]*dx+g[1]*dy,fitResidual=gray[p]-prediction;
  // Affine extrapolation is trustworthy on a consistent plane, not on a
  // curved/quantized shoulder. Robust shrinkage prevents an unreliable normal
  // slope from amplifying the very silhouette erosion being reconstructed.
  const slopeConfidence=9/(9+fitResidual*fitResidual);
  gx[i]=g[0]*slopeConfidence;gy[i]=g[1]*slopeConfidence;
  // Relative occlusion order comes from the reliable same-side interior and
  // the observed opposite surface, not from the semantic foreground label.
  // Box constraints forbid moving an eroded edge further towards that surface.
  lower[i]=gray[seed]>opposite[p]?gray[p]:0;upper[i]=gray[seed]<opposite[p]?gray[p]:255;
  // A wider search must not perturb an already compatible interior merely
  // because its affine fit differs within quantization/noise tolerance.
  if(distance[p]>baseRadius&&Math.abs(prediction-gray[p])<=3)lower[i]=upper[i]=gray[p];
  value[i]=Math.max(lower[i],Math.min(upper[i],g[2]+gx[i]*dx+gy[i]*dy));
  // Robust fidelity retains compatible observations, downweights inconsistent
  // boundary samples, and increases towards the immutable reliable interior.
  const residual=gray[p]-value[i],relative=distance[p]/(radius+1);
  dataWeight[i]=(.01+relative**4)/(1+residual*residual/9);
 }
 const neighbours=new Int32Array(n*4);neighbours.fill(-1);
 const weights=new Float32Array(n*4),diagonal=new Float64Array(n),rhs=new Float64Array(n);
 for(let i=0;i<n;i++){
  const p=pixels[i],x=p%width,y=Math.floor(p/width);
  diagonal[i]=dataWeight[i];rhs[i]=dataWeight[i]*gray[p];
  for(let k=0;k<4;k++){
   const [dx,dy]=directions[k],ax=x+dx,ay=y+dy;
   if(ax<0||ay<0||ax>=width||ay>=height)continue;
   const q=ay*width+ax;if(!foreground(q)||barrier(p,q))continue;
   const j=index[q],g=j>=0?null:slope(q);
   // The small affinity floor allows reflective/printed surfaces to have
   // different colours without declaring each colour a separate depth plane.
   const agreement=1-Math.abs(semantic[p]-semantic[q])/255;
   const weight=(.05+.95*Math.exp(-colourDistance(p,q)/(2*24*24)))*(.25+.75*agreement);
   const gradient=-dx*(gx[i]+(g?g[0]:gx[j]))/2-dy*(gy[i]+(g?g[1]:gy[j]))/2;
   weights[i*4+k]=weight;neighbours[i*4+k]=j;diagonal[i]+=weight;
   rhs[i]+=weight*(gradient+(j<0?gray[q]:0));
  }
 }
 // Accelerated projected gradient in diagonal-preconditioned coordinates.
 // The normalized graph Hessian has spectral radius <=2; step 1/2 is safe.
 // The stopping test is the projected fixed-point residual, not momentum.
 let extrapolated=value.slice(),work=new Float64Array(n),momentum=1;
 let iterations=0,maxUpdate=Infinity;
 for(;iterations<256&&maxUpdate>.01;iterations++){
  const nextMomentum=(1+Math.sqrt(1+4*momentum*momentum))/2,beta=(momentum-1)/nextMomentum;
  for(let i=0;i<n;i++){
   let sum=rhs[i];
   for(let k=0;k<4;k++){const j=neighbours[i*4+k];if(j>=0)sum+=weights[i*4+k]*extrapolated[j];}
   const next=Math.max(lower[i],Math.min(upper[i],(extrapolated[i]+sum/diagonal[i])*.5));
   work[i]=next+beta*(next-value[i]);value[i]=next;
  }
  [extrapolated,work]=[work,extrapolated];momentum=nextMomentum;
  if(iterations%8===7||iterations===255){
   maxUpdate=0;
   for(let i=0;i<n;i++){
    let sum=rhs[i];for(let k=0;k<4;k++){const j=neighbours[i*4+k];if(j>=0)sum+=weights[i*4+k]*value[j];}
    maxUpdate=Math.max(maxUpdate,Math.abs(Math.max(lower[i],Math.min(upper[i],sum/diagonal[i]))-value[i]));
   }
  }
 }
 if(!Number.isFinite(maxUpdate)||maxUpdate>.01)return unchanged('non-convergent-system');
 for(let i=0;i<n;i++){
  const p=pixels[i],v=Math.round(Math.max(0,Math.min(255,value[i])));
  if(!Number.isFinite(v))return unchanged('non-finite-depth');
  if(v!==gray[p]){out[p]=v;report.changed++;if(confidence[p]>=224)report.confidentChanged++;else report.uncertainChanged++;}
 }
 report.applied=report.changed>0;report.activePixels=n;report.iterations=iterations;
 report.maxUpdate=maxUpdate;report.depthJump=depthJump;
 report.scratchBufferBytes=hist.byteLength+appearance.byteLength+right.byteLength+down.byteLength+distance.byteLength+opposite.byteLength+queue.byteLength+nearest.byteLength+index.byteLength+component.byteLength+supported.byteLength+
  [value,gx,gy,dataWeight,lower,upper,neighbours,weights,diagonal,rhs,extrapolated,work].reduce((sum,a)=>sum+a.byteLength,0);
 return {gray:out,report};
}
