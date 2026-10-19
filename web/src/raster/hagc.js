// SMPTE ST 2094-50 Application #5 / ICC HAGC helpers.
// Kept independent from export code until the source-only editable-HDR converter is proven.
//
// ST 2094-50 stores headroom in 1/10000 stop, reference white in 1/5 nit,
// gain-curve X in 1/1000 and Y in 1/10000. Apple HAGC ICC tags observed on
// iPhone images use the standard 'hagc' tag type and may report a payload-size
// field one byte smaller than the tag-table payload extent; parsing accepts both
// representations while serialization defaults to the standard exact size.

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const u16=(b,p)=>(b[p]<<8)|b[p+1];
const push16=(a,v)=>{v=clamp(Math.round(v),0,65535);a.push(v>>8,v&255);};

function fail(message){throw new Error('Invalid HAGC: '+message);}

function mixingSemantics(type,coefficients){
  if(type===0)return {red:0,green:0,blue:0,max:1,min:0,component:0};
  if(type===1)return {red:0,green:0,blue:0,max:0,min:0,component:1};
  if(type===2)return {red:1/6,green:1/6,blue:1/6,max:1/2,min:0,component:0};
  if(type!==3)fail('component mixing type');
  const values=coefficients.map(x=>Math.min(x,50000)/50000);
  const sum=values.reduce((a,b)=>a+b,0);
  if(!(sum>0))fail('zero custom component mix');
  // ST semantics define the six coefficients directly. Normalized values are
  // included separately because some consumers normalize during evaluation.
  return {
    red:values[0],green:values[1],blue:values[2],max:values[3],min:values[4],component:values[5],
    normalized:{
      red:values[0]/sum,green:values[1]/sum,blue:values[2]/sum,
      max:values[3]/sum,min:values[4]/sum,component:values[5]/sum,
    },
  };
}

export function parseSmpte2094App5(data){
  if(!(data instanceof Uint8Array))data=new Uint8Array(data);
  let p=0;
  const byte=()=>{if(p>=data.length)fail('truncated');return data[p++];};
  const word=()=>{if(p+2>data.length)fail('truncated u16');const v=u16(data,p);p+=2;return v;};

  const app=byte();
  const applicationVersion=(app>>5)&7,minimumApplicationVersion=(app>>2)&7;
  if(app&3)fail('application reserved bits');
  const cvt=byte();
  const hasCustomHdrReferenceWhite=Boolean((cvt>>7)&1);
  const hasAdaptiveToneMap=Boolean((cvt>>6)&1);
  if(cvt&0x3f)fail('color-volume reserved bits');

  let hdrReferenceWhiteRaw=null;
  if(hasCustomHdrReferenceWhite)hdrReferenceWhiteRaw=word();

  const result={
    applicationVersion,minimumApplicationVersion,
    hasCustomHdrReferenceWhite,hasAdaptiveToneMap,
    hdrReferenceWhiteRaw,
    hdrReferenceWhite:hasCustomHdrReferenceWhite?clamp(hdrReferenceWhiteRaw,1,50000)/5:203,
    adaptiveToneMap:null,
  };
  if(!hasAdaptiveToneMap){
    result.bytesConsumed=p;
    result.trailingBytes=data.slice(p);
    return result;
  }

  const baselineRaw=word(),flags=byte(),useReferenceWhiteToneMapping=Boolean(flags>>7);
  const adaptive={
    baselineHdrHeadroomRaw:baselineRaw,
    baselineHdrHeadroom:Math.min(baselineRaw,60000)/10000,
    useReferenceWhiteToneMapping,
    numAlternateImages:0,
    gainApplicationSpaceChromaticitiesMode:null,
    gainApplicationSpaceChromaticitiesRaw:null,
    commonComponentMix:false,
    commonCurveParams:false,
    alternates:[],
  };
  result.adaptiveToneMap=adaptive;

  if(useReferenceWhiteToneMapping){
    if(flags&0x7f)fail('RWTMO reserved bits');
    result.bytesConsumed=p;
    result.trailingBytes=data.slice(p);
    return result;
  }

  const numAlternateImages=(flags>>4)&7;
  const chromMode=(flags>>2)&3;
  const commonComponentMix=Boolean((flags>>1)&1),commonCurveParams=Boolean(flags&1);
  if(numAlternateImages>4)fail('too many alternate images');
  adaptive.numAlternateImages=numAlternateImages;
  adaptive.gainApplicationSpaceChromaticitiesMode=chromMode;
  adaptive.commonComponentMix=commonComponentMix;
  adaptive.commonCurveParams=commonCurveParams;
  if(chromMode===3)adaptive.gainApplicationSpaceChromaticitiesRaw=Array.from({length:8},word);

  const first={mix:null,curve:null};
  for(let a=0;a<numAlternateImages;a++){
    const alternateHdrHeadroomRaw=word();
    let mix;
    if(a===0||!commonComponentMix){
      const mf=byte(),type=(mf>>6)&3;
      const present=Array(6).fill(false),coefficients=Array(6).fill(0);
      if(type===3){
        for(let k=0;k<6;k++)present[k]=Boolean((mf>>(5-k))&1);
        for(let k=0;k<6;k++)if(present[k])coefficients[k]=word();
      }else if(mf&0x3f)fail('component-mix reserved bits');
      mix={type,present,coefficients,semantics:mixingSemantics(type,coefficients)};
      if(a===0)first.mix=mix;
    }else mix=structuredClone(first.mix);

    let count,pchip,xRaw;
    if(a===0||!commonCurveParams){
      const gf=byte();
      count=((gf>>3)&31)+1;pchip=Boolean((gf>>2)&1);
      if(gf&3)fail('gain-curve reserved bits');
      xRaw=Array.from({length:count},word);
      if(a===0)first.curve={count,pchip,xRaw};
    }else{
      ({count,pchip,xRaw}=first.curve);
      xRaw=[...xRaw];
    }
    const yRaw=Array.from({length:count},word);
    const thetaRaw=pchip?null:Array.from({length:count},word);
    const sign=baselineRaw<alternateHdrHeadroomRaw?1:-1;
    const controlPoints=xRaw.map((x,i)=>{
      const rawTheta=thetaRaw?.[i]??null;
      const angle=rawTheta==null?null:(clamp(rawTheta,1,35999)-18000)*Math.PI/36000;
      return {
        x:Math.min(x,64000)/1000,
        y:sign*Math.min(yRaw[i],60000)/10000,
        slope:angle==null?null:Math.tan(angle),
        raw:{x,y:yRaw[i],theta:rawTheta},
      };
    });
    const curve={count,usePchipSlope:pchip,xRaw,yRaw,thetaRaw,controlPoints};
    if(a===0)first.curve={count,pchip,xRaw:[...xRaw]};
    adaptive.alternates.push({
      alternateHdrHeadroomRaw,
      alternateHdrHeadroom:Math.min(alternateHdrHeadroomRaw,60000)/10000,
      componentMix:mix,gainCurve:curve,
    });
  }
  result.bytesConsumed=p;
  result.trailingBytes=data.slice(p);
  return result;
}

export function serializeSmpte2094App5(value){
  const out=[];
  const applicationVersion=clamp(value.applicationVersion??0,0,7);
  const minimum=clamp(value.minimumApplicationVersion??0,0,7);
  out.push((applicationVersion<<5)|(minimum<<2));
  const custom=Boolean(value.hasCustomHdrReferenceWhite),adaptive=Boolean(value.hasAdaptiveToneMap);
  out.push((custom?0x80:0)|(adaptive?0x40:0));
  if(custom)push16(out,value.hdrReferenceWhiteRaw??Math.round((value.hdrReferenceWhite??203)*5));
  if(!adaptive)return Uint8Array.from(out);

  const tone=value.adaptiveToneMap||{};
  const baselineRaw=tone.baselineHdrHeadroomRaw??Math.round((tone.baselineHdrHeadroom??0)*10000);
  push16(out,baselineRaw);
  if(tone.useReferenceWhiteToneMapping){
    out.push(0x80);
    return Uint8Array.from(out);
  }

  const alternates=tone.alternates||[];
  if(alternates.length>4)throw new Error('HAGC supports at most four alternate images');
  const chromMode=clamp(tone.gainApplicationSpaceChromaticitiesMode??0,0,3);
  const commonMix=Boolean(tone.commonComponentMix),commonCurve=Boolean(tone.commonCurveParams);
  out.push((alternates.length<<4)|(chromMode<<2)|(commonMix?2:0)|(commonCurve?1:0));
  if(chromMode===3){
    const c=tone.gainApplicationSpaceChromaticitiesRaw;
    if(!Array.isArray(c)||c.length!==8)throw new Error('Eight HAGC chromaticities are required');
    for(const x of c)push16(out,x);
  }

  let firstMix=null,firstCurve=null;
  for(let a=0;a<alternates.length;a++){
    const alt=alternates[a];
    push16(out,alt.alternateHdrHeadroomRaw??Math.round((alt.alternateHdrHeadroom??0)*10000));
    if(a===0||!commonMix){
      const mix=alt.componentMix||{},type=clamp(mix.type??0,0,3),present=mix.present||Array(6).fill(false);
      let flags=type<<6;
      if(type===3)for(let k=0;k<6;k++)if(present[k])flags|=1<<(5-k);
      out.push(flags);
      if(type===3){
        const coeff=mix.coefficients||[];
        for(let k=0;k<6;k++)if(present[k])push16(out,coeff[k]??0);
      }
      if(a===0)firstMix=mix;
    }else if(!firstMix)throw new Error('Missing common component mix');

    let curve=alt.gainCurve;
    if(a===0||!commonCurve){
      if(!curve)throw new Error('Missing HAGC gain curve');
      const count=curve.count??curve.xRaw?.length??curve.controlPoints?.length;
      if(!(count>=1&&count<=32))throw new Error('Invalid HAGC control-point count');
      const pchip=Boolean(curve.usePchipSlope??curve.pchip);
      out.push(((count-1)<<3)|(pchip?4:0));
      const xRaw=curve.xRaw||curve.controlPoints?.map(x=>Math.round(x.x*1000));
      if(!xRaw||xRaw.length!==count)throw new Error('Invalid HAGC X control points');
      for(const x of xRaw)push16(out,x);
      if(a===0)firstCurve={count,pchip,xRaw:[...xRaw]};
    }else{
      if(!firstCurve)throw new Error('Missing common curve parameters');
      curve={...curve,count:firstCurve.count,usePchipSlope:firstCurve.pchip,xRaw:firstCurve.xRaw};
    }
    const count=curve.count??curve.xRaw.length,pchip=Boolean(curve.usePchipSlope??curve.pchip);
    const yRaw=curve.yRaw||curve.controlPoints?.map(x=>Math.round(Math.abs(x.y)*10000));
    if(!yRaw||yRaw.length!==count)throw new Error('Invalid HAGC Y control points');
    for(const y of yRaw)push16(out,y);
    if(!pchip){
      const thetaRaw=curve.thetaRaw||curve.controlPoints?.map(x=>Math.round(Math.atan(x.slope??0)*36000/Math.PI+18000));
      if(!thetaRaw||thetaRaw.length!==count)throw new Error('Invalid HAGC slopes');
      for(const t of thetaRaw)push16(out,t);
    }
  }
  return Uint8Array.from(out);
}

export function buildReferenceWhiteHagcPayload(baselineHdrHeadroom){
  if(!Number.isFinite(baselineHdrHeadroom)||baselineHdrHeadroom<0||baselineHdrHeadroom>6)
    throw new Error('HAGC baseline headroom must be within 0..6 stops');
  return serializeSmpte2094App5({
    applicationVersion:0,minimumApplicationVersion:0,
    hasCustomHdrReferenceWhite:false,hasAdaptiveToneMap:true,
    adaptiveToneMap:{baselineHdrHeadroom,useReferenceWhiteToneMapping:true},
  });
}

/**
 * Expand ST 2094-50 Reference White Tone Mapping into the explicit semantic
 * model used by renderers. This follows clause C.3.8 / the reference Skia
 * implementation: Rec.2020 gain-application space, two alternate headrooms,
 * maxRGB component mixing, and eight cubic control points per alternate.
 */
export function expandReferenceWhiteToneMapping(baselineHdrHeadroom){
  if(!Number.isFinite(baselineHdrHeadroom)||baselineHdrHeadroom<0||baselineHdrHeadroom>6)
    throw new Error('HAGC baseline headroom must be within 0..6 stops');
  const rec2020=[0.708,0.292,0.17,0.797,0.131,0.046,0.3127,0.329];
  if(baselineHdrHeadroom===0)return {
    baselineHdrHeadroom,
    gainApplicationSpaceChromaticities:rec2020,
    alternates:[],
  };
  const scale=Math.min(baselineHdrHeadroom/Math.log2(1000/203),1);
  const alternateHeadrooms=[0,Math.log2(8/3)*scale];
  const alternates=alternateHeadrooms.map((alternateHdrHeadroom,index)=>{
    const yWhite=index===1?1:1-.5*scale;
    const kappa=.65,xKnee=1,yKnee=yWhite;
    const xMax=2**baselineHdrHeadroom,yMax=2**alternateHdrHeadroom;
    const xMid=(1-kappa)*xKnee+kappa*(xKnee*yMax/yKnee);
    const yMid=(1-kappa)*yKnee+kappa*yMax;
    const xA=xKnee-2*xMid+xMax,yA=yKnee-2*yMid+yMax;
    const xB=2*xMid-2*xKnee,yB=2*yMid-2*yKnee;
    const controlPoints=[];
    for(let c=0;c<8;c++){
      const t=c/7;
      const x=xKnee+t*(xB+t*xA),y=yKnee+t*(yB+t*yA);
      const m=(2*yA*t+yB)/(2*xA*t+xB);
      controlPoints.push({
        x,
        y:Math.log2(y/x),
        slope:(x*m-y)/(Math.LN2*x*y),
      });
    }
    return {
      alternateHdrHeadroom,
      componentMix:{red:0,green:0,blue:0,max:1,min:0,component:0},
      gainCurve:{controlPoints},
    };
  });
  return {
    baselineHdrHeadroom,
    gainApplicationSpaceChromaticities:rec2020,
    alternates,
  };
}

/** Evaluate one ST 2094-50 piecewise cubic gain curve in its linear-X/log-gain domain. */
export function evaluateHagcGainCurve(gainCurve,x){
  const cp=gainCurve?.controlPoints;
  if(!Array.isArray(cp)||cp.length<1||cp.length>32||!Number.isFinite(x)||x<=0)
    throw new Error('Invalid HAGC gain curve evaluation');
  if(x<=cp[0].x)return cp[0].y;
  const last=cp.at(-1);
  if(x>=last.x)return last.y+Math.log2(last.x/x);
  let lo=0,hi=cp.length-1;
  while(hi-lo>1){
    const mid=(lo+hi)>>1;
    if(x<cp[mid].x)hi=mid;else lo=mid;
  }
  const a=cp[lo],b=cp[hi],h=b.x-a.x,t=(x-a.x)/h;
  const ma=a.slope*h,mb=b.slope*h;
  const c3=2*a.y+ma-2*b.y+mb;
  const c2=-3*a.y+3*b.y-2*ma-mb;
  return ((c3*t+c2)*t+ma)*t+a.y;
}

export function parseHagcIccTag(tag){
  if(!(tag instanceof Uint8Array))tag=new Uint8Array(tag);
  if(tag.length<12||String.fromCharCode(...tag.slice(0,4))!=='hagc')fail('ICC tag type');
  if(tag.slice(4,8).some(Boolean))fail('ICC tag reserved bytes');
  const declared=(tag[8]*0x1000000)+(tag[9]<<16)+(tag[10]<<8)+tag[11];
  const available=tag.length-12;
  // Apple's current still-image writer has been observed with a declared payload
  // length exactly one byte smaller than the syntax extent. Parse the whole tag
  // in that case so the final control-point slope is not truncated.
  const appleLengthMinusOne=declared+1===available;
  if(declared>available)fail('ICC payload length');
  const payload=tag.slice(12,appleLengthMinusOne?tag.length:12+declared);
  return {declaredPayloadBytes:declared,payload,appleLengthMinusOne,metadata:parseSmpte2094App5(payload)};
}

export function buildHagcIccTag(payload,{appleLengthMinusOne=false}={}){
  if(!(payload instanceof Uint8Array))payload=new Uint8Array(payload);
  if(!payload.length)throw new Error('HAGC payload cannot be empty');
  const declared=payload.length-(appleLengthMinusOne?1:0);
  const out=new Uint8Array(12+payload.length);
  out.set([0x68,0x61,0x67,0x63],0); // hagc
  out[8]=(declared>>>24)&255;out[9]=(declared>>>16)&255;out[10]=(declared>>>8)&255;out[11]=declared&255;
  out.set(payload,12);
  return out;
}
