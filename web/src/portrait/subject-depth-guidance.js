// Relative subject-depth assistance for generated AI depth only.
// A supplied binary object mask is independent
// evidence about membership, not measured depth or camera calibration.
export function stabilizeSubjectDepth(gray,mask,width,height){
  if(!(gray instanceof Uint8Array)||!(mask instanceof Uint8Array)
    ||![width,height].every(n=>Number.isInteger(n)&&n>0)||gray.length!==width*height||mask.length!==gray.length)
    throw Error('Invalid subject depth geometry');
  const unchanged=reason=>({gray:gray.slice(),report:{applied:false,reason}});
  const inside=new Uint8Array(mask.length);let count=0;
  for(let p=0;p<mask.length;p++){
    if(mask[p]!==0&&mask[p]!==255)throw Error('Subject mask must contain binary membership');
    inside[p]=mask[p]===255?1:0;count+=inside[p];
  }
  if(count<32||count>mask.length*.5)return unchanged('insufficient-isolated-subject');
  const distanceTo=flag=>{
    const d=new Uint16Array(mask.length);d.fill(65535);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=y*width+x;if(inside[p]===flag){d[p]=0;continue;}
      if(x)d[p]=Math.min(d[p],d[p-1]+1);if(y)d[p]=Math.min(d[p],d[p-width]+1);
    }
    for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
      const p=y*width+x;if(x+1<width)d[p]=Math.min(d[p],d[p+1]+1);if(y+1<height)d[p]=Math.min(d[p],d[p+width]+1);
    }
    return d;
  };
  const toOutside=distanceTo(0),toInside=distanceTo(1),radius=Math.max(1,Math.round(Math.max(width,height)/256));
  const core=new Uint32Array(256),surrounding=new Uint32Array(256);let nc=0,ns=0;
  for(let p=0;p<mask.length;p++){
    if(mask[p]>=250&&toOutside[p]>radius){core[gray[p]]++;nc++;}
    else if(mask[p]===0&&toInside[p]>radius*2&&toInside[p]<=radius*4){surrounding[gray[p]]++;ns++;}
  }
  if(nc<16||ns<16)return unchanged('insufficient-confidence');
  const quantile=(hist,n,f)=>{let count=0;for(let i=0;i<256;i++){count+=hist[i];if(count>=Math.max(1,n*f))return i;}return 255;};
  const plane=quantile(core,nc,.5),background=quantile(surrounding,ns,.5),gap=plane-background;
  const span=quantile(core,nc,.99)-quantile(core,nc,.01);
  if(gap<=0||span>=gap)return unchanged('distinct-internal-depth');
  const spread=quantile(core,nc,.95)-quantile(core,nc,.05);
  if(spread*2>=gap)return unchanged('distinct-internal-depth');
  // Only weak relief within an independently segmented, separated subject is
  // regularized. Strong internal separation (e.g. a hand reaching toward the
  // lens) is retained. This is an artistic focus aid, not recovered metric depth.
  const scale=(spread/gap)**3,out=gray.slice();let changed=0;
  for(let p=0;p<mask.length;p++)if(mask[p]){
    const corrected=plane+(gray[p]-plane)*scale;
    out[p]=Math.round(gray[p]+(corrected-gray[p])*mask[p]/255);
    if(out[p]!==gray[p])changed++;
  }
  return {gray:out,report:{applied:changed>0,mode:'relative-subject-coherence',plane,gap,spread,scale,coreSamples:nc,surroundingSamples:ns,changed}};
}
