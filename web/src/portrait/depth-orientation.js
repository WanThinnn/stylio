import {storedPointToDisplay,displayPointToStored} from '../raster/heif.js';

function geometry(width,height,{angle=0,mirror=null}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1
  ||![0,90,180,270].includes(angle)||![null,0,1].includes(mirror))throw Error('Invalid depth orientation geometry');
 return {width:angle%180?height:width,height:angle%180?width:height,angle,mirror};
}

// HEIF pixels stay in stored coordinates everywhere else in Portrait. Neural
// inference must instead see the upright photograph, just like the foreground
// models. Quarter-turns/mirrors permute samples exactly, without interpolation.
export function depthImageInput(rgb,width,height,orientation){
 const g=geometry(width,height,orientation);
 if(!(rgb instanceof Uint8Array)||rgb.length!==width*height*3)throw Error('Invalid depth RGB geometry');
 if(!g.angle&&g.mirror===null)return {rgb,width,height};
 const upright=new Uint8Array(rgb.length);
 for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
  const p=displayPointToStored((x+.5)/g.width,(y+.5)/g.height,g.angle,g.mirror);
  const source=(Math.min(height-1,Math.floor(p.y*height))*width+Math.min(width-1,Math.floor(p.x*width)))*3,target=(y*g.width+x)*3;
  upright[target]=rgb[source];upright[target+1]=rgb[source+1];upright[target+2]=rgb[source+2];
 }
 return {rgb:upright,width:g.width,height:g.height};
}

export function depthOutputToStored(values,width,height,orientation){
 const g=geometry(width,height,orientation);
 if(!(values instanceof Float32Array)||values.length!==width*height)throw Error('Invalid depth output geometry');
 if(!g.angle&&g.mirror===null)return {values,mw:width,mh:height};
 const stored=new Float32Array(values.length);
 for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
  const p=storedPointToDisplay((x+.5)/g.width,(y+.5)/g.height,g.angle,g.mirror);
  stored[y*g.width+x]=values[Math.min(height-1,Math.floor(p.y*height))*width+Math.min(width-1,Math.floor(p.x*width))];
 }
 return {values:stored,mw:g.width,mh:g.height};
}
