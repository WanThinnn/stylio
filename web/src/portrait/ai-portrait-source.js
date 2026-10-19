import {loadLibheif} from '../media/decode.js';
import {releaseLibheif} from '../codecs/libheif-lifecycle.js';
import {displayPointToStored} from '../raster/heif.js';
import {imageFormat,RASTER_MIMES} from '../media/image-format.js';

// Both browser and libheif decoders return display-oriented pixels. Recover
// stored coordinates using the canonical HEIF transform, including ipma order.
export function displayToStoredTransform(width,height,angle,mirror){
  const a=displayPointToStored(0,0,angle,mirror),b=displayPointToStored(1,0,angle,mirror),c=displayPointToStored(0,1,angle,mirror);
  return [(b.x-a.x)*width,(b.y-a.y)*height,(c.x-a.x)*width,(c.y-a.y)*height,a.x*width,a.y*height];
}

// Independent of the stable thumbnail decoder used for Styles statistics.
// Always sample the primary photo; release the full-resolution surface before
// allocating the GPU model. Returned canvas is in the HEIC's stored orientation.
export async function aiSourceCanvas(data,{width,height,angle=0,mirror=null},sourceFile){
  const blob=sourceFile||new Blob([data],{type:'image/heic'});
  let bitmap,browserImage,imageUrl,image,decoder,full,libheif,images;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
  ctx.imageSmoothingQuality='high';
  try {
    try {bitmap=await createImageBitmap(blob);} catch {}
    if(!bitmap&&sourceFile){
      const format=imageFormat(new Uint8Array(await sourceFile.slice(0,256).arrayBuffer()));
      if(RASTER_MIMES[format]){
        // ImageBitmap can reject an HDR/MPF JPEG that HTMLImageElement accepts
        // (including Safari). libheif cannot decode JPEG/PNG/WebP input.
        imageUrl=URL.createObjectURL(sourceFile);browserImage=new Image();
        browserImage.src=imageUrl;
        try{
          await browserImage.decode();
          if(!(browserImage.naturalWidth||browserImage.width)||!(browserImage.naturalHeight||browserImage.height))
            throw Error('Empty decoded image');
        }catch(error){
          browserImage=null;
          // AVIF is also a HEIF container and may use the existing WASM fallback.
          if(format!=='avif')throw new Error('AI source image decode failed',{cause:error});
        }
      }
    }
    if(bitmap||browserImage){
      ctx.setTransform(...displayToStoredTransform(width,height,angle,mirror));
      ctx.drawImage(bitmap||browserImage,0,0,1,1);
    }else{
      libheif=await loadLibheif();decoder=new libheif.HeifDecoder();
      images=decoder.decode(sourceFile?new Uint8Array(await sourceFile.arrayBuffer()):data);
      if(!images?.length)throw Error('AI primary photo decode failed');
      image=images[0];full=document.createElement('canvas');
      full.width=image.get_width();full.height=image.get_height();
      const fctx=full.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
      const pixels=fctx.createImageData(full.width,full.height);
      await new Promise((resolve,reject)=>image.display(pixels,out=>out?resolve():reject(Error('AI primary display failed'))));
      fctx.putImageData(pixels,0,0);
      // libheif display returns the display orientation; undo it like the
      // existing decoder, but without selecting the embedded thumbnail.
      ctx.setTransform(...displayToStoredTransform(width,height,angle,mirror));
      ctx.drawImage(full,0,0,1,1);
    }
    ctx.resetTransform();return canvas;
  }catch(error){canvas.width=canvas.height=0;throw error;}
  finally{bitmap?.close();if(imageUrl)URL.revokeObjectURL(imageUrl);if(full)full.width=full.height=0;releaseLibheif(libheif,decoder,images);}
}

export function rgbSample(canvas,width,height){
  const sample=document.createElement('canvas');sample.width=width;sample.height=height;
  const ctx=sample.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
  ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,0,0,width,height);
  const rgba=ctx.getImageData(0,0,width,height).data,rgb=new Uint8Array(width*height*3);
  for(let i=0;i<width*height;i++)rgb.set(rgba.subarray(i*4,i*4+3),i*3);
  sample.width=sample.height=0;return rgb;
}
