import {decodeGainLog,encodedToLinear} from './jpeg-hdr.js';

export const HDR_LINEAR_THUMBNAIL_COEFFICIENTS=[
  [0.31822737205870044,-0.002130403822215854,0.07474497872823394,0.19730163944076548,0.293142548762723],
  [0.32478255161334724,0.0011569883469502162,0.07695989152188837,0.06361913078906917,0.2901836221273939],
  [0.33346967903731717,-0.00854419355412267,0.07013748067295772,0.21588147285505746,0.28190665477015264],
];

/**
 * Reconstruct the source-only linear-thumbnail reference used by the edited
 * Styles repair path. The SDR/base term preserves the primary rendition while
 * HDR excess terms restore the specular tail that an SDR-only thumbnail loses.
 *
 * Coefficients were fitted on eight independent iPhone 16 native captures and
 * validated on the held-out 1729 edited/current export. No per-photo original
 * resource is required.
 */
export function synthesizeHdrLinearThumbnailRgb(primaryRgb,gainLuma,metadata,{transfer='srgb',coefficients=HDR_LINEAR_THUMBNAIL_COEFFICIENTS}={}){
  if(!(primaryRgb instanceof Uint8Array)||!(gainLuma instanceof Uint8Array)
      ||primaryRgb.length!==gainLuma.length*3)
    throw Error('HDR linear-thumbnail buffers disagree');
  if(!metadata||!Array.isArray(metadata.channels)||metadata.channels.length!==1)
    throw Error('HDR linear-thumbnail requires a one-channel ISO gain map');
  if(!Array.isArray(coefficients)||coefficients.length!==3||coefficients.some(x=>!Array.isArray(x)||x.length!==5))
    throw Error('Invalid HDR linear-thumbnail coefficients');
  const channel=metadata.channels[0],out=new Uint8Array(primaryRgb.length);
  for(let i=0;i<gainLuma.length;i++){
    const logGain=decodeGainLog(gainLuma[i]/255,channel);
    for(let c=0;c<3;c++){
      const p=primaryRgb[i*3+c]/255;
      const linear=encodedToLinear(p,transfer);
      const scene=Math.max(0,(linear+channel.baseOffset)*2**logGain-channel.alternateOffset);
      const features=[p,Math.max(0,scene-.75),Math.max(0,scene-1.5),Math.max(0,scene-2.5),1];
      const k=coefficients[c];
      let value=0;for(let j=0;j<5;j++)value+=features[j]*k[j];
      out[i*3+c]=Math.max(0,Math.min(255,Math.round(value*255)));
    }
  }
  return out;
}
