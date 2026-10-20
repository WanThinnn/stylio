import {displayPointToStored,storedPointToDisplay} from '../raster/heif.js';

function orientationValue(orientation={}){
  const {angle=0,mirror=null}=orientation;
  if(![0,90,180,270].includes(angle)||![null,0,1].includes(mirror))throw Error('Invalid foreground matte orientation');
  return {angle,mirror};
}

function bilinearRgb(rgb,width,height,x,y,c){
  const sx=x*width-.5,sy=y*height-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  let value=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const ax=Math.max(0,Math.min(width-1,ix+dx)),ay=Math.max(0,Math.min(height-1,iy+dy));
    value+=rgb[(ay*width+ax)*3+c]*(dx?fx:1-fx)*(dy?fy:1-fy);
  }
  return value;
}

export function foregroundImageInput(rgb,width,height,orientation,size=1024){
  if(!(rgb instanceof Uint8Array)||rgb.length!==width*height*3||!Number.isInteger(size)||size<16)throw Error('Invalid foreground matte RGB');
  const {angle,mirror}=orientationValue(orientation),data=new Float32Array(3*size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const displayX=(x+.5)/size,displayY=(y+.5)/size,stored=displayPointToStored(displayX,displayY,angle,mirror),p=y*size+x;
    for(let c=0;c<3;c++)data[c*size*size+p]=bilinearRgb(rgb,width,height,stored.x,stored.y,c)/255-.5;
  }
  return {data,width:size,height:size};
}

function bilinearScalar(values,width,height,x,y){
  const sx=x*width-.5,sy=y*height-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  let value=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const ax=Math.max(0,Math.min(width-1,ix+dx)),ay=Math.max(0,Math.min(height-1,iy+dy));
    value+=values[ay*width+ax]*(dx?fx:1-fx)*(dy?fy:1-fy);
  }
  return value;
}

export function foregroundOutputMatte(values,modelWidth,modelHeight,width,height,orientation){
  if(!(values instanceof Float32Array)||values.length!==modelWidth*modelHeight
    ||![modelWidth,modelHeight,width,height].every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid foreground matte output');
  const {angle,mirror}=orientationValue(orientation);
  let min=Infinity,max=-Infinity;
  for(const value of values){if(!Number.isFinite(value))throw Error('Invalid foreground matte value');min=Math.min(min,value);max=Math.max(max,value);}
  const confidence=new Uint8Array(width*height),range=max-min;
  if(range<=1e-8)return {confidence,min,max,range};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const display=storedPointToDisplay((x+.5)/width,(y+.5)/height,angle,mirror);
    const value=bilinearScalar(values,modelWidth,modelHeight,display.x,display.y);
    confidence[y*width+x]=Math.max(0,Math.min(255,Math.round((value-min)/range*255)));
  }
  return {confidence,min,max,range};
}
