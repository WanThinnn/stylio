import {dimensionsForItem,extractItemData} from '../raster/heif.js';
import {portraitProjection,readPortraitOptics} from './portrait-geometry.js';

// The initial K2 response over-blurred multiple scenes even at f/16. The phone
// trial on IMG_1880 accepts one fifth of that response (.75 -> .15). Apply the
// same correction to generated depth only; v1 remains an explicit historical
// replay profile. These are artistic effect limits, not metric depth units.
export function relativePortraitResponse(width,height,optics,template,base,policy='projection-v2',scene=null){
  if(!Number.isFinite(base)||base<=0||base>32)throw Error('Invalid relative Portrait response');
  if(!['projection-v1','projection-v2','scene-v3'].includes(policy))throw Error('Unsupported relative Portrait response');
  if(policy==='scene-v3'&&(!scene||scene.version!==1))throw Error('Missing Portrait scene calibration');
  if(policy==='scene-v3'&&!scene.usable)return {...relativePortraitResponse(width,height,optics,template,base,'projection-v2'),
    blurResponse:policy,sceneResponseApplied:false,sceneResponseReason:scene.reason};
  const responseScale=policy==='projection-v2'?.2:1;
  const p=portraitProjection(width,height,optics);
  if(p.pixelSize===null){
    if(policy==='scene-v3')return {...relativePortraitResponse(width,height,optics,template,base,'projection-v2'),
      blurResponse:policy,sceneResponseApplied:false,sceneResponseReason:'unknown-optics'};
    return {disparityMax:base*responseScale,blurResponse:'relative-unscaled',blurResponseLimited:false};
  }
  const scalar=k=>Number(new RegExp('<depthData:'+k+'>([^<]+)<').exec(template.depthXmp)?.[1]);
  const block=/<depthData:IntrinsicMatrix>([\s\S]+?)<\/depthData:IntrinsicMatrix>/.exec(template.depthXmp)?.[1]||'';
  const matrix=[...block.matchAll(/<rdf:li>([^<]+)</g)].map(m=>Number(m[1]));
  const refPixels=Math.sqrt(matrix[0]*matrix[4]),refMm=refPixels*scalar('PixelSize');
  const reference=refMm*refPixels/Math.hypot(scalar('IntrinsicMatrixReferenceWidth'),scalar('IntrinsicMatrixReferenceHeight'));
  const pixels=Math.sqrt(p.fx*p.fy),actual=(pixels*p.pixelSize)*pixels/Math.hypot(width,height);
  const ratio=reference/actual;
  if(!Number.isFinite(ratio)||ratio<=0)throw Error('Invalid Portrait response profile');
  if(policy==='scene-v3'){
    if(!Number.isFinite(scene.separation)||scene.separation<=0||scene.separation>1
      ||!Number.isFinite(scene.targetResponse)||scene.targetResponse<=0||scene.targetResponse>1
      ||!['background','foreground'].includes(scene.side))throw Error('Invalid Portrait scene calibration');
    const previewDisparityMax=base/3*scene.targetResponse/scene.separation,disparityMax=ratio*previewDisparityMax;
    if(!Number.isFinite(disparityMax)||disparityMax<=0||disparityMax>2**30)throw Error('Portrait scene response exceeds representation');
    return {disparityMax,previewDisparityMax,blurResponse:policy,blurResponseLimited:false,
      sceneResponseApplied:true,sceneSide:scene.side,sceneSeparation:scene.separation,
      sceneTarget:scene.targetResponse,subjectConfidence:scene.subjectConfidence};
  }
  const proposed=base*2*ratio,bounded=Math.max(.75,Math.min(24,proposed));
  return {disparityMax:bounded*responseScale,blurResponse:policy,blurResponseLimited:bounded!==proposed};
}

export function sourcePortraitResponse(source,d,template,base,policy='projection-v2',scene=null){
  const [width,height]=dimensionsForItem(d.props,d.primary);
  return relativePortraitResponse(width,height,readPortraitOptics(extractItemData(source,d,d.exifItem)),template,base,policy,scene);
}
