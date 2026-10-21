// A scene statistic for RELATIVE AI disparity, not metres. Measure separation
// from the initial focus, once per image. Later refocusing must keep that scale.
const quantile=(histogram,fraction)=>{
  const count=histogram.reduce((a,b)=>a+b,0);if(!count)return null;
  let sum=0;for(let code=0;code<histogram.length;code++){sum+=histogram[code];if(sum>=count*fraction)return code;}
  return histogram.length-1;
};
// Global renderer-response calibration, shared by all images and model tiers.
// .335 matches the accepted complex-scene Pro response; semantic confidence
// permits the stronger response validated on isolated foreground subjects.
const COMPLEX_RESPONSE=.335,ISOLATED_RESPONSE=1;
// Keep the foreground roll-off used by the preview's existing bokeh contract.
// This is an effect policy, not a decoded Apple renderer parameter.
export const FOREGROUND_RESPONSE=.35;

// A nonzero aperture still has a nonzero circle of confusion. Off is separate;
// the old logarithmic slider reached zero before f/16 and hid export errors.
export function portraitPreviewBlur(aperture){
  if(aperture===null)return 0;
  if(!Number.isFinite(aperture)||aperture<1||aperture>22)throw Error('Invalid Portrait preview aperture');
  return 8*4.5/aperture;
}

export function describePortraitScene(gray,width,height,{focusX=.5,focusY=.5,matte=null}={}){
  if(!(gray instanceof Uint8Array)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||gray.length!==width*height
    ||![focusX,focusY].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid Portrait scene geometry');
  if(matte&&(matte.width!==width||matte.height!==height||!(matte.confidence instanceof Uint8Array)||matte.confidence.length!==gray.length))
    throw Error('Invalid Portrait scene matte');
  const x=Math.min(width-1,Math.floor(focusX*width)),y=Math.min(height-1,Math.floor(focusY*height)),focusCode=gray[y*width+x];
  const histogram=new Uint32Array(256),background=new Uint32Array(256),foreground=new Uint32Array(256);
  const local=new Uint32Array(256),radius=Math.max(1,Math.round(Math.min(width,height)*.025));
  for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++)local[gray[yy*width+xx]]++;
  const noiseBand=Math.max(3,Math.min(12,Math.round((quantile(local,.9)-quantile(local,.1))*.1)));
  let backgroundCount=0,foregroundCount=0,subjectCount=0,subjectSum=0;
  for(let p=0;p<gray.length;p++){
    const code=gray[p],delta=code-focusCode;histogram[code]++;
    if(delta < -noiseBand){background[-delta]++;backgroundCount++;}
    if(delta > noiseBand){foreground[delta]++;foregroundCount++;}
    if(matte?.confidence[p]>=224){subjectCount++;subjectSum+=matte.confidence[p];}
  }
  const lo=quantile(histogram,.05),hi=quantile(histogram,.95),localSpread=quantile(local,.9)-quantile(local,.1);
  const subjectConfidence=subjectCount?subjectSum/(255*subjectCount):0;
  const base={version:1,focusX,focusY,focusCode,noiseBand,robustSpan:hi-lo,subjectConfidence,
    backgroundFraction:backgroundCount/gray.length,foregroundFraction:foregroundCount/gray.length,
    backgroundMedian:quantile(background,.5),foregroundMedian:quantile(foreground,.5)};
  if(Math.abs(focusCode-quantile(local,.5))>Math.max(noiseBand*2,localSpread))return {...base,usable:false,reason:'unstable-focus'};
  // A real focused subject may occupy less than 5% of the frame. Its coherent
  // local focus still establishes contrast against a broad uniform foreground.
  if(Math.max(hi-lo,Math.abs(focusCode-lo),Math.abs(focusCode-hi))<=noiseBand*2)return {...base,usable:false,reason:'flat-scene'};
  // A small far tail must not calibrate an interior/landscape focused near the
  // far end. Use the foreground population in that case, with its roll-off.
  const side=base.backgroundFraction>=.15?'background':base.foregroundFraction>=.15?'foreground':null;
  if(!side)return {...base,usable:false,reason:'insufficient-separated-support'};
  const separation=(side==='background'?base.backgroundMedian:base.foregroundMedian*FOREGROUND_RESPONSE)/255;
  if(!(separation>0))return {...base,usable:false,reason:'no-separation'};
  return {...base,usable:true,reason:'focus-separated-scene',side,separation,
    targetResponse:COMPLEX_RESPONSE+(ISOLATED_RESPONSE-COMPLEX_RESPONSE)*subjectConfidence};
}
