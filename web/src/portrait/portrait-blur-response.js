import {dimensionsForItem,extractItemData} from '../raster/heif.js';
import {portraitProjection,readPortraitOptics} from './portrait-geometry.js';

// K2 was device-selected as close to Native. This is an artistic response
// normalization across estimated projections, NOT metric monocular calibration
// or a decoded equation for Apple's private renderer. Bounds are effect limits.
export function relativePortraitResponse(width,height,optics,template,base){
  if(!Number.isFinite(base)||base<=0||base>32)throw Error('Invalid relative Portrait response');
  const p=portraitProjection(width,height,optics);
  if(p.pixelSize===null)return {disparityMax:base,blurResponse:'relative-unscaled',blurResponseLimited:false};
  const scalar=k=>Number(new RegExp('<depthData:'+k+'>([^<]+)<').exec(template.depthXmp)?.[1]);
  const block=/<depthData:IntrinsicMatrix>([\s\S]+?)<\/depthData:IntrinsicMatrix>/.exec(template.depthXmp)?.[1]||'';
  const matrix=[...block.matchAll(/<rdf:li>([^<]+)</g)].map(m=>Number(m[1]));
  const refPixels=Math.sqrt(matrix[0]*matrix[4]),refMm=refPixels*scalar('PixelSize');
  const reference=refMm*refPixels/Math.hypot(scalar('IntrinsicMatrixReferenceWidth'),scalar('IntrinsicMatrixReferenceHeight'));
  const pixels=Math.sqrt(p.fx*p.fy),actual=(pixels*p.pixelSize)*pixels/Math.hypot(width,height);
  const ratio=reference/actual;
  if(!Number.isFinite(ratio)||ratio<=0)throw Error('Invalid Portrait response profile');
  const proposed=base*2*ratio,disparityMax=Math.max(.75,Math.min(24,proposed));
  return {disparityMax,blurResponse:'projection-v1',blurResponseLimited:disparityMax!==proposed};
}

export function sourcePortraitResponse(source,d,template,base){
  const [width,height]=dimensionsForItem(d.props,d.primary);
  return relativePortraitResponse(width,height,readPortraitOptics(extractItemData(source,d,d.exifItem)),template,base);
}
