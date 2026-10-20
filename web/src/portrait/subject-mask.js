import {displayPointToStored} from '../raster/heif.js';

function geometry(width,height,orientation={}){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid subject image geometry');
  const {angle=0,mirror=null}=orientation,swap=angle===90||angle===270;
  if(![0,90,180,270].includes(angle)||![null,0,1].includes(mirror))throw Error('Invalid subject orientation');
  return {dw:swap?height:width,dh:swap?width:height,angle,mirror};
}
function storedIndex(x,y,dw,dh,width,height,angle,mirror){
  const p=displayPointToStored((x+.5)/dw,(y+.5)/dh,angle,mirror);
  return Math.max(0,Math.min(height-1,Math.floor(p.y*height)))*width+Math.max(0,Math.min(width-1,Math.floor(p.x*width)));
}

// Match the author's RGB normalization and bottom/right padding. Operate on
// the display-oriented scene; masks are mapped back to the stored HEIF grid.
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

// The initial preview focuses at the centre. If that point has no isolated
// object, probe the remaining grid points in source-depth order, near first.
// No bottle position, subject dimensions or camera calibration is stored here.
export function subjectPrompts(gray,width,height,orientation){
  const {dw,dh,angle,mirror}=geometry(width,height,orientation);
  if(gray.length!==width*height)throw Error('Invalid subject depth');
  const rest=[];
  for(const y of [.25,.5,.75])for(const x of [.25,.5,.75])if(x!==.5||y!==.5){
    const index=storedIndex(Math.floor(x*dw),Math.floor(y*dh),dw,dh,width,height,angle,mirror);
    rest.push({x,y,depth:gray[index]});
  }
  rest.sort((a,b)=>b.depth-a.depth);
  return [{x:.5,y:.5},...rest.map(({x,y})=>({x,y}))];
}

export function subjectMasks(masks,mw,mh,scores,width,height,orientation,point){
  const {dw,dh,angle,mirror}=geometry(width,height,orientation),n=mw*mh;
  if(!(masks instanceof Float32Array)||!Number.isInteger(mw)||!Number.isInteger(mh)||mw<1||mh<1
    ||masks.length!==scores.length*n||!scores.length||!Number.isFinite(point.x)||!Number.isFinite(point.y)
    ||point.x<0||point.x>1||point.y<0||point.y>1)throw Error('Invalid subject mask output');
  const best=Math.max(...scores);if(!Number.isFinite(best))throw Error('Invalid subject mask score');
  const result=[],queue=new Int32Array(dw*dh);
  const sample=(i,x,y)=>{
    // align_corners=false, same two bilinear resizes/crop as EdgeSAM ONNX.
    const scale=1024/Math.max(dw,dh),iw=Math.round(dw*scale),ih=Math.round(dh*scale);
    const sx=((x+.5)*iw/dw)*mw/1024-.5,sy=((y+.5)*ih/dh)*mh/1024-.5;
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;let value=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const ax=Math.max(0,Math.min(mw-1,ix+dx)),ay=Math.max(0,Math.min(mh-1,iy+dy));
      const v=masks[i*n+ay*mw+ax];if(!Number.isFinite(v))throw Error('Invalid subject mask logits');
      value+=v*(dx?fx:1-fx)*(dy?fy:1-fy);
    }
    return value>0;
  };
  for(let i=0;i<scores.length;i++){
    if(!Number.isFinite(scores[i]))throw Error('Invalid subject mask score');
    if(scores[i]<.85||scores[i]<best-.03)continue;
    const sx=Math.min(dw-1,Math.floor(point.x*dw)),sy=Math.min(dh-1,Math.floor(point.y*dh));
    if(!sample(i,sx,sy))continue;
    const seen=new Uint8Array(dw*dh);let head=0,tail=1,border=false;queue[0]=sy*dw+sx;seen[queue[0]]=1;
    while(head<tail){
      const p=queue[head++],x=p%dw,y=Math.floor(p/dw);if(!x||!y||x===dw-1||y===dh-1)border=true;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const ax=x+dx,ay=y+dy;
        if(ax<0||ay<0||ax>=dw||ay>=dh)continue;
        const q=ay*dw+ax;if(seen[q])continue;seen[q]=1;if(sample(i,ax,ay))queue[tail++]=q;
      }
    }
    if(border||tail<32||tail>dw*dh*.5)continue;
    const mask=new Uint8Array(width*height);
    for(let j=0;j<tail;j++){const p=queue[j];mask[storedIndex(p%dw,Math.floor(p/dw),dw,dh,width,height,angle,mirror)]=255;}
    result.push({mask,score:scores[i],pixels:tail,index:i});
  }
  return result.sort((a,b)=>b.pixels-a.pixels);
}
