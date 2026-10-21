// Per-photo projection for AI depth already registered to the decoded image.
// EXIF gives an estimated pinhole projection, never measured lens calibration
// or metric depth. An image without optics uses explicit relative coordinates.
import {dimensionsForItem,extractItemData} from '../raster/heif.js';
import {readAppleDepthRange} from './apple-depth-metadata.js';
import {matchPortraitHdrCapacity,portraitSourceHeadroom} from './portrait-hdr-calibration.js';

export function readPortraitOptics(exif){
  try{
    const offset=new DataView(exif.buffer,exif.byteOffset,exif.byteLength).getUint32(0)+4;
    if(offset<4||offset>exif.length-8)return null;
    const t=exif.subarray(offset),v=new DataView(t.buffer,t.byteOffset,t.byteLength),order=String.fromCharCode(t[0],t[1]);
    if(!['II','MM'].includes(order))return null;
    const little=order==='II';if(v.getUint16(2,little)!==42)return null;
    const table=at=>{
      if(at<8||at+2>t.length)throw Error('Invalid optics IFD');
      const n=v.getUint16(at,little);if(n>4096||at+2+n*12+4>t.length)throw Error('Truncated optics IFD');
      const result=new Map();
      for(let i=0;i<n;i++){
        const p=at+2+i*12,id=v.getUint16(p,little);
        result.set(id,result.has(id)?null:p);
      }
      return result;
    };
    const number=(entries,id)=>{
      const p=entries.get(id);if(p===undefined||p===null||v.getUint32(p+4,little)!==1)return null;
      const type=v.getUint16(p+2,little);let value;
      if(type===3)value=v.getUint16(p+8,little);
      else if(type===4)value=v.getUint32(p+8,little);
      else if(type===5){
        const at=v.getUint32(p+8,little);if(at<8||at+8>t.length)return null;
        const den=v.getUint32(at+4,little);if(!den)return null;value=v.getUint32(at,little)/den;
      }else return null;
      return Number.isFinite(value)&&value>0?value:null;
    };
    const root=table(v.getUint32(4,little)),sub=number(root,0x8769);if(sub===null)return null;
    const entries=table(sub);
    return {focalMm:number(entries,0x920a),equivalentMm:number(entries,0xa405),zoom:number(entries,0xa404),
      resolutionX:number(entries,0xa20e),resolutionY:number(entries,0xa20f),unit:number(entries,0xa210),
      width:number(entries,0xa002),height:number(entries,0xa003)};
  }catch{return null;}
}

export function portraitProjection(width,height,optics){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid Portrait projection dimensions');
  const diagonal=Math.hypot(width,height),cx=(width-1)/2,cy=(height-1)/2;
  let fx=diagonal,fy=diagonal,pixelSize=null,geometry='relative-image-grid';
  const focal=Number.isFinite(optics?.focalMm)&&optics.focalMm>0?optics.focalMm:null;
  const validFocal=n=>Number.isFinite(n)&&n>0&&n<diagonal*1000;
  const mmPerUnit={2:25.4,3:10,4:1,5:.001}[optics?.unit];
  // Focal-plane resolution refers to the EXIF pixel grid. Use it only when that
  // grid has the same aspect/orientation as the stored photo, not a rotated crop.
  if(focal>0&&mmPerUnit&&optics.resolutionX>0&&optics.resolutionY>0&&optics.width>0&&optics.height>0
    &&Math.abs(width/height/(optics.width/optics.height)-1)<.001){
    const x=focal*optics.resolutionX/mmPerUnit*width/optics.width,y=focal*optics.resolutionY/mmPerUnit*height/optics.height;
    if(validFocal(x)&&validFocal(y)){fx=x;fy=y;pixelSize=focal/fx;geometry='exif-focal-plane-estimate';}
  }
  if(geometry==='relative-image-grid'&&optics?.equivalentMm>=1&&optics.equivalentMm<=2000){
    // The 35mm equivalent describes the captured field of view. In the actual
    // iPhone fixtures it already includes the digital crop (53mm ~= 28mm*1.885).
    // Multiplying DigitalZoomRatio again fabricated a second crop.
    const estimate=diagonal*optics.equivalentMm/Math.hypot(36,24);
    if(validFocal(estimate)){
      fx=fy=estimate;if(focal>0)pixelSize=focal/fx;
      geometry='exif-35mm-estimate';
    }
  }
  return {width,height,fx,fy,cx,cy,pixelSize,geometry};
}

const scalar=(xmp,name,value)=>xmp.replace(new RegExp('(<'+name+'>)[^<]*(</'+name+'>)'),(_,a,b)=>a+value+b);
const sequence=(xmp,name,values)=>xmp.replace(new RegExp('<'+name+'>[\\s\\S]*?</'+name+'>'),
  '<'+name+'><rdf:Seq>'+values.map(v=>'<rdf:li>'+v+'</rdf:li>').join('')+'</rdf:Seq></'+name+'>');

function completeNativeOptics(xmp){
  const element=name=>new RegExp('<(?:\\w+:)?'+name+'>([\\s\\S]*?)</(?:\\w+:)?'+name+'>').exec(xmp)?.[1];
  const matrix=[...(element('IntrinsicMatrix')||'').matchAll(/<(?:\w+:)?li>([^<]+)</g)].map(m=>Number(m[1]));
  return matrix.length===9&&matrix.every(Number.isFinite)&&matrix[0]>0&&matrix[4]>0&&matrix[8]===1
    &&['IntrinsicMatrixReferenceWidth','IntrinsicMatrixReferenceHeight','PixelSize'].every(k=>{
      const value=Number(element(k));return Number.isFinite(value)&&value>0;
    });
}

export function portraitDepthMetadata(source,d,depth,template,aperture){
  let xmp=template.depthXmp,geometry,referenceCalibration=false,qualityDeclaration='editing-profile';
  if(depth.nativeXmp!==undefined){
    // Camera depth stays with its own calibration, including unknown fields.
    // Only attach editable-effect fields; do not replace its optical matrices.
    const range=readAppleDepthRange(depth.nativeXmp);
    if(!depth.nativeAuxc||!range||range.floatMin!==depth.floatMin||range.floatMax!==depth.floatMax
      ||/<!DOCTYPE|<!ENTITY|depthBlurEffect:RenderingParameters/i.test(depth.nativeXmp))throw Error('Invalid source Portrait calibration');
    if(!completeNativeOptics(depth.nativeXmp)){
      // Older native depth can omit calibration entirely. Its warped camera
      // depth cannot safely adopt the virtual RGB-grid optics used for AI.
      // Keep the device-tested restoration profile, with the real source range.
      xmp=scalar(xmp,'apdi:FloatMinValue',depth.floatMin);
      xmp=scalar(xmp,'apdi:FloatMaxValue',depth.floatMax);
      xmp=scalar(xmp,'depthBlurEffect:SimulatedAperture',aperture.toFixed(6));
      geometry='reference-native-depth-fallback';referenceCalibration=true;
    }else{
    xmp=depth.nativeXmp;qualityDeclaration='source';
    for(const [prefix,uri]of [['depthBlurEffect','http://ns.apple.com/depthBlurEffect/1.0/'],
      ['portraitLightingEffect','http://ns.apple.com/portraitLightingEffect/2.0/']]){
      const namespace=new RegExp('xmlns:'+prefix+'\\s*=\\s*["\']([^"\']+)["\']').exec(xmp);
      if(namespace&&namespace[1]!==uri)throw Error('Conflicting source Portrait namespace');
      if(!namespace)xmp=xmp.replace('<rdf:Description','<rdf:Description xmlns:'+prefix+'="'+uri+'"');
    }
    const rendering=/<depthBlurEffect:RenderingParameters>[\s\S]*?<\/depthBlurEffect:RenderingParameters>/.exec(template.depthXmp)?.[0];
    if(!rendering||!xmp.includes('</rdf:Description>'))throw Error('Unsupported source Portrait calibration');
    xmp=xmp.replace(/<depthBlurEffect:SimulatedAperture>[^<]*<\/depthBlurEffect:SimulatedAperture>/g,'')
      .replace(/<portraitLightingEffect:EffectStrength>[^<]*<\/portraitLightingEffect:EffectStrength>/g,'')
      .replace('</rdf:Description>',rendering+'<depthBlurEffect:SimulatedAperture>'+aperture.toFixed(6)
        +'</depthBlurEffect:SimulatedAperture><portraitLightingEffect:EffectStrength>0.5</portraitLightingEffect:EffectStrength></rdf:Description>');
    geometry='native-depth-calibration';
    }
  }else{
    const [w,h]=dimensionsForItem(d.props,d.primary),exif=extractItemData(source,d,d.exifItem);
    const p=portraitProjection(w,h,readPortraitOptics(exif));geometry=p.geometry;
    xmp=scalar(xmp,'depthData:IntrinsicMatrixReferenceWidth',w);
    xmp=scalar(xmp,'depthData:IntrinsicMatrixReferenceHeight',h);
    xmp=sequence(xmp,'depthData:IntrinsicMatrix',[p.fx,0,0,0,p.fy,0,p.cx,p.cy,1]);
    // This is a virtual camera co-located with the decoded RGB grid. Applying
    // another capture's lens warp would misregister the computed AI edges.
    xmp=sequence(xmp,'depthData:LensDistortionCoefficients',Array(8).fill(0));
    xmp=sequence(xmp,'depthData:InverseLensDistortionCoefficients',Array(8).fill(0));
    xmp=sequence(xmp,'depthData:ExtrinsicMatrix',[1,0,0,0,1,0,0,0,1,0,0,0]);
    xmp=scalar(xmp,'depthData:LensDistortionCenterOffsetX',p.cx);
    xmp=scalar(xmp,'depthData:LensDistortionCenterOffsetY',p.cy);
    xmp=scalar(xmp,'depthData:Accuracy','relative');
    // Preserve the profile's editing-eligibility declaration. On-device J1/J4
    // isolate low -> high as the aperture-control gate on these captures.
    // This is not model confidence or a claim of metric camera accuracy.
    xmp=p.pixelSize===null?xmp.replace(/\s*<depthData:PixelSize>[^<]*<\/depthData:PixelSize>/,''):scalar(xmp,'depthData:PixelSize',p.pixelSize);
    xmp=scalar(xmp,'apdi:FloatMinValue',depth.floatMin??0);
    xmp=scalar(xmp,'apdi:FloatMaxValue',depth.floatMax??1);
    xmp=scalar(xmp,'depthBlurEffect:SimulatedAperture',aperture.toFixed(6));
  }
  const headroom=portraitSourceHeadroom(source,d);
  return {data:new TextEncoder().encode(matchPortraitHdrCapacity(xmp,headroom)),
    report:{geometry,referenceCalibration,rendererProfile:'reference-v7',qualityDeclaration,hdrCapacity:headroom}};
}
