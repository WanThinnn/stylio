import {displayPointToStored,storedPointToDisplay} from '../raster/heif.js';
import {mattePromptPoints,MATTE_FOREGROUND,MATTE_BACKGROUND} from './foreground-matte.js';

function geometry(width,height,orientation={}){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid subject image geometry');
  const {angle=0,mirror=null}=orientation,swap=angle===90||angle===270;
  if(![0,90,180,270].includes(angle)||![null,0,1].includes(mirror))throw Error('Invalid subject orientation');
  return {dw:swap?height:width,dh:swap?width:height,angle,mirror};
}

function storedIndex(x,y,dw,dh,width,height,angle,mirror){
  const p=displayPointToStored((x+.5)/dw,(y+.5)/dh,angle,mirror);
  return Math.max(0,Math.min(height-1,Math.floor(p.y*height)))*width+
    Math.max(0,Math.min(width-1,Math.floor(p.x*width)));
}

// Match EdgeSAM's author preprocessing and operate in display orientation.
export function subjectImageInput(rgb,width,height,orientation){
  const {dw,dh,angle,mirror}=geometry(width,height,orientation);
  if(!(rgb instanceof Uint8Array)||rgb.length!==width*height*3)throw Error('Invalid subject RGB');
  const scale=1024/Math.max(dw,dh),iw=Math.round(dw*scale),ih=Math.round(dh*scale),data=new Float32Array(3*1024*1024);
  const mean=[123.675,116.28,103.53],std=[58.395,57.12,57.375];
  for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){
    const p=displayPointToStored((x+.5)/iw,(y+.5)/ih,angle,mirror),sx=p.x*width-.5,sy=p.y*height-.5;
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    for(let c=0;c<3;c++){
      let value=0;
      for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
        const ax=Math.max(0,Math.min(width-1,ix+dx)),ay=Math.max(0,Math.min(height-1,iy+dy));
        value+=rgb[(ay*width+ax)*3+c]*(dx?fx:1-fx)*(dy?fy:1-fy);
      }
      data[c*1024*1024+y*1024+x]=(value-mean[c])/std[c];
    }
  }
  return {data,width:iw,height:ih,displayWidth:dw,displayHeight:dh};
}

export function subjectDecoderPrompts(matte,width,height,orientation,{positiveCount=6,negativeCount=6}={}){
  if(!matte?.confidence||matte.width!==width||matte.height!==height)throw Error('Invalid subject matte');
  const {angle,mirror}=geometry(width,height,orientation),points=mattePromptPoints(matte,width,height,{positiveCount,negativeCount});
  const convert=(point,label)=>{
    const display=storedPointToDisplay(point.x,point.y,angle,mirror);
    return {x:display.x,y:display.y,label};
  };
  return [...points.positive.map(p=>convert(p,1)),...points.negative.map(p=>convert(p,0))];
}

function rawMaskSample(masks,index,mw,mh,dw,dh,x,y){
  const n=mw*mh,scale=1024/Math.max(dw,dh),iw=Math.round(dw*scale),ih=Math.round(dh*scale);
  const sx=((x+.5)*iw/dw)*mw/1024-.5,sy=((y+.5)*ih/dh)*mh/1024-.5;
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;let value=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const ax=Math.max(0,Math.min(mw-1,ix+dx)),ay=Math.max(0,Math.min(mh-1,iy+dy)),v=masks[index*n+ay*mw+ax];
    if(!Number.isFinite(v))throw Error('Invalid subject mask logits');
    value+=v*(dx?fx:1-fx)*(dy?fy:1-fy);
  }
  return value;
}

function logistic(value){
  if(value>=12)return 1;if(value<=-12)return 0;
  return 1/(1+Math.exp(-value));
}

// EdgeSAM is a boundary refiner, not the foreground authority. Confident matte
// foreground/background is immutable; SAM only reweights the uncertainty band.
export function refineSubjectMatte(masks,mw,mh,scores,matte,width,height,orientation){
  const {dw,dh,angle,mirror}=geometry(width,height,orientation),source=matte?.confidence;
  if(!(source instanceof Uint8Array)||source.length!==width*height||matte.width!==width||matte.height!==height
    ||!(masks instanceof Float32Array)||!Number.isInteger(mw)||!Number.isInteger(mh)||mw<1||mh<1
    ||masks.length!==scores.length*mw*mh||!scores.length)throw Error('Invalid subject matte output');
  if(matte.appleConfidence!==undefined&&(!(matte.appleConfidence instanceof Uint8Array)||matte.appleConfidence.length!==source.length))
    throw Error('Invalid Apple matte confidence geometry');
  let fgTotal=0;for(const value of source)if(value>=MATTE_FOREGROUND)fgTotal++;
  if(fgTotal<16)return {matte:{...matte,confidence:source.slice()},report:{applied:false,reason:'insufficient-matte-foreground'}};

  let best=null;
  for(let i=0;i<scores.length;i++){
    const score=scores[i];if(!Number.isFinite(score)||score<.70)continue;
    let candidatePixels=0,fgHit=0,bgHit=0,uncertainHit=0;
    for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
      const logit=rawMaskSample(masks,i,mw,mh,dw,dh,x,y);if(logit<=0)continue;
      const p=storedIndex(x,y,dw,dh,width,height,angle,mirror),value=source[p];
      candidatePixels++;
      if(value>=MATTE_FOREGROUND)fgHit++;
      else if(value<=MATTE_BACKGROUND)bgHit++;
      else uncertainHit++;
    }
    if(!candidatePixels)continue;
    const recall=fgHit/fgTotal,intrusion=bgHit/candidatePixels,coverage=candidatePixels/(dw*dh);
    if(recall<.30||intrusion>.30||coverage>.75)continue;
    const rank=recall*2+score-intrusion*2-Math.max(0,coverage-.50);
    if(!best||rank>best.rank)best={index:i,score,rank,recall,intrusion,coverage,uncertainHit};
  }
  if(!best)return {matte:{...matte,confidence:source.slice()},report:{applied:false,reason:'no-matte-constrained-mask'}};

  const confidence=source.slice(),refinementConfidence=new Uint8Array(source.length);let changed=0;
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const p=storedIndex(x,y,dw,dh,width,height,angle,mirror),original=source[p];
    const sam=Math.round(logistic(rawMaskSample(masks,best.index,mw,mh,dw,dh,x,y))*255);
    refinementConfidence[p]=sam;
    if(original>=MATTE_FOREGROUND||original<=MATTE_BACKGROUND)continue;
    // Confident SAM background must be able to reject an uncertain IS-Net
    // proposal completely. A weighted average alone leaves a high proposal
    // above the background threshold even when SAM assigns zero foreground.
    const appleFloor=matte.appleConfidence?.[p]??0;
    const refined=Math.max(appleFloor,sam<=MATTE_BACKGROUND?Math.min(original,sam):Math.round(original*.35+sam*.65));
    if(refined!==confidence[p]){confidence[p]=refined;changed++;}
  }
  return {
    matte:{...matte,confidence,refinementConfidence,source:matte.source==='fused'?'fused':'edge-refined'},
    report:{applied:changed>0,changed,model:'EdgeSAM-3x',score:best.score,recall:best.recall,
      backgroundIntrusion:best.intrusion,coverage:best.coverage}
  };
}
