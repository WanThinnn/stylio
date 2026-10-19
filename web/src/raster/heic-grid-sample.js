import {
  extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,
} from '../core/heif.js';
import {topBox} from '../core/box.js';
import {decodeHevcYuv,decodeHevcLuma} from './ffmpeg-hevc.js';
import {hevcSpsColor} from './hevc-color.js';
import {yuv420ToRgba} from './jpeg-hdr.js';

function itemBytes(data,d,id){
  const item=d.iloc.items.get(id);
  if(!item)throw Error('HEIC grid item missing');
  return item.constructionMethod===1?idatItemBytes(data,id,d.meta):extractItem(data,d.iloc,id);
}
function hvccRecord(data,d,id){
  const p=propertyBoxBytes(data,d.props,id,'hvcC');
  if(!p)throw Error(`HEIC item ${id} has no hvcC`);
  const b=topBox(p,'hvcC');
  return p.subarray(b.off+b.hdr,b.off+b.size);
}
function colorFromRecord(record,{allowMonochrome=false,iccBacked=false}={}){
  const sps=hevcSpsColor(record);
  if(sps.luma!==8||sps.chromaDepth!==8||![1,...(allowMonochrome?[0]:[])].includes(sps.chroma))
    throw Error('Grid sampler requires Main8 4:2:0 or monochrome tiles');
  let primaries={1:'bt709',2:'unspecified',12:'smpte432'}[sps.primaries];
  let transfer={1:'bt709',2:'unspecified',6:'smpte170m',13:'iec61966-2-1'}[sps.transfer];
  const matrix={1:'bt709',2:'unspecified',5:'bt470bg',6:'smpte170m'}[sps.matrix];
  if(!primaries||!transfer||!matrix||!sps.video||typeof sps.fullRange!=='boolean')
    throw Error('Unsupported grid colour signalling');
  // Flattened Apple Photos exports commonly leave primaries/transfer unspecified
  // in HEVC VUI while carrying the actual RGB colour contract in HEIF `colr=prof`.
  // Their Main8 primary is matrix-6 with an sRGB-like transfer; this matches the
  // decoded primary used by the corpus/holdout calibration. Do not generalize this
  // fallback to files without an ICC property.
  if(sps.chroma===1&&iccBacked&&matrix==='smpte170m'){
    if(primaries==='unspecified')primaries='icc';
    if(transfer==='unspecified')transfer='srgb';
  }
  if(sps.chroma===1&&[primaries,transfer,matrix].includes('unspecified'))
    throw Error('Ambiguous RGB grid colour signalling');
  return {primaries,transfer,matrix,fullRange:sps.fullRange,chroma:sps.chroma,sps};
}
function sameColor(a,b){
  return ['primaries','transfer','matrix','fullRange','chroma'].every(k=>a[k]===b[k]);
}

export function nearestGridSamplePlan(width,height,tileWidth,tileHeight,targetWidth,targetHeight){
  if(![width,height,tileWidth,tileHeight,targetWidth,targetHeight].every(Number.isInteger)
      ||Math.min(width,height,tileWidth,tileHeight,targetWidth,targetHeight)<1)
    throw Error('Invalid grid sample geometry');
  const columns=Math.ceil(width/tileWidth),rows=Math.ceil(height/tileHeight);
  const buckets=Array.from({length:columns*rows},()=>[]);
  for(let y=0;y<targetHeight;y++){
    const sy=Math.min(height-1,Math.max(0,Math.floor((y+.5)*height/targetHeight)));
    const row=Math.floor(sy/tileHeight),localY=sy-row*tileHeight;
    for(let x=0;x<targetWidth;x++){
      const sx=Math.min(width-1,Math.max(0,Math.floor((x+.5)*width/targetWidth)));
      const col=Math.floor(sx/tileWidth),localX=sx-col*tileWidth;
      buckets[row*columns+col].push({target:y*targetWidth+x,x:localX,y:localY});
    }
  }
  return {columns,rows,buckets};
}

async function decodeGridNearest(data,d,gridId,tileIds,targetWidth,targetHeight,onProgress,stage,{monochrome=false}={}){
  if(!tileIds?.length)throw Error(`${stage} grid has no tiles`);
  const [width,height]=dimensionsForItem(d.props,gridId);
  const [tileWidth,tileHeight]=dimensionsForItem(d.props,tileIds[0]);
  const plan=nearestGridSamplePlan(width,height,tileWidth,tileHeight,targetWidth,targetHeight);
  if(plan.columns*plan.rows!==tileIds.length)throw Error(`${stage} grid layout does not match tiles`);
  const gridColr=propertyBoxBytes(data,d.props,gridId,'colr');
  const tileColr=propertyBoxBytes(data,d.props,tileIds[0],'colr');
  const prof=raw=>raw&&String.fromCharCode(...raw.subarray(8,12))==='prof';
  const iccBacked=prof(gridColr)||prof(tileColr);
  const first=colorFromRecord(hvccRecord(data,d,tileIds[0]),{allowMonochrome:monochrome,iccBacked});
  const output=monochrome?new Uint8Array(targetWidth*targetHeight):new Uint8Array(targetWidth*targetHeight*3);

  for(let i=0;i<tileIds.length;i++){
    const id=tileIds[i],[tw,th]=dimensionsForItem(d.props,id);
    if(tw!==tileWidth||th!==tileHeight)throw Error(`${stage} tile dimensions differ`);
    const record=hvccRecord(data,d,id),color=colorFromRecord(record,{allowMonochrome:monochrome,iccBacked});
    if(!sameColor(first,color))throw Error(`${stage} tile colour descriptions differ`);
    if(monochrome){
      const decoded=await decodeHevcLuma(record,itemBytes(data,d,id),{width:tw,height:th},onProgress);
      for(const p of plan.buckets[i])output[p.target]=decoded.bytes[p.y*tw+p.x];
    }else{
      const decoded=await decodeHevcYuv(record,itemBytes(data,d,id),{width:tw,height:th},onProgress);
      const rgba=yuv420ToRgba(decoded,tw,th,{matrix:color.matrix,fullRange:color.fullRange});
      for(const p of plan.buckets[i]){
        const from=(p.y*tw+p.x)*4,to=p.target*3;
        output[to]=rgba[from];output[to+1]=rgba[from+1];output[to+2]=rgba[from+2];
      }
    }
    onProgress?.({stage,done:i+1,total:tileIds.length});
  }
  return {bytes:output,width:targetWidth,height:targetHeight,color:first};
}

export function decodeGridNearestRgb(data,d,gridId,tileIds,width,height,onProgress,stage='linearPrimaryDecode'){
  return decodeGridNearest(data,d,gridId,tileIds,width,height,onProgress,stage);
}
export function decodeGridNearestLuma(data,d,gridId,tileIds,width,height,onProgress,stage='linearGainDecode'){
  return decodeGridNearest(data,d,gridId,tileIds,width,height,onProgress,stage,{monochrome:true});
}

function axisSample(index,sourceSize,targetSize){
  const s=(index+.5)*sourceSize/targetSize-.5;
  const a=Math.max(0,Math.min(sourceSize-1,Math.floor(s))),b=Math.min(sourceSize-1,a+1);
  const f=Math.max(0,Math.min(1,s-a));
  return {a,b,wa:1-f,wb:f};
}

export function bilinearGridSampleAxes(sourceWidth,sourceHeight,targetWidth,targetHeight){
  if(![sourceWidth,sourceHeight,targetWidth,targetHeight].every(Number.isInteger)
      ||Math.min(sourceWidth,sourceHeight,targetWidth,targetHeight)<1)
    throw Error('Invalid bilinear sample geometry');
  return {
    x:Array.from({length:targetWidth},(_,i)=>axisSample(i,sourceWidth,targetWidth)),
    y:Array.from({length:targetHeight},(_,i)=>axisSample(i,sourceHeight,targetHeight)),
  };
}

async function decodeGridBilinear(data,d,gridId,tileIds,targetWidth,targetHeight,onProgress,stage,
  {monochrome=false}={}){
  if(!tileIds?.length)throw Error(`${stage} grid has no tiles`);
  const [width,height]=dimensionsForItem(d.props,gridId),[tileWidth,tileHeight]=dimensionsForItem(d.props,tileIds[0]);
  const columns=Math.ceil(width/tileWidth),rows=Math.ceil(height/tileHeight);
  if(columns*rows!==tileIds.length)throw Error(`${stage} grid layout does not match tiles`);
  const axes=bilinearGridSampleAxes(width,height,targetWidth,targetHeight);
  const gridColr=propertyBoxBytes(data,d.props,gridId,'colr'),tileColr=propertyBoxBytes(data,d.props,tileIds[0],'colr');
  const prof=raw=>raw&&String.fromCharCode(...raw.subarray(8,12))==='prof',iccBacked=prof(gridColr)||prof(tileColr);
  const first=colorFromRecord(hvccRecord(data,d,tileIds[0]),{allowMonochrome:monochrome,iccBacked});
  const channels=monochrome?1:3;
  const acc=new Float32Array(targetWidth*targetHeight*channels);

  for(let i=0;i<tileIds.length;i++){
    const id=tileIds[i],[tw,th]=dimensionsForItem(d.props,id);
    if(tw!==tileWidth||th!==tileHeight)throw Error(`${stage} tile dimensions differ`);
    const record=hvccRecord(data,d,id),color=colorFromRecord(record,{allowMonochrome:monochrome,iccBacked});
    if(!sameColor(first,color))throw Error(`${stage} tile colour descriptions differ`);
    const col=i%columns,row=Math.floor(i/columns),xStart=col*tileWidth,yStart=row*tileHeight;
    const xs=[],ys=[];
    for(let x=0;x<targetWidth;x++){
      const q=axes.x[x],parts=[];
      if(q.a>=xStart&&q.a<xStart+tw&&q.wa)parts.push([q.a-xStart,q.wa]);
      if(q.b>=xStart&&q.b<xStart+tw&&q.wb)parts.push([q.b-xStart,q.wb]);
      if(parts.length)xs.push([x,parts]);
    }
    for(let y=0;y<targetHeight;y++){
      const q=axes.y[y],parts=[];
      if(q.a>=yStart&&q.a<yStart+th&&q.wa)parts.push([q.a-yStart,q.wa]);
      if(q.b>=yStart&&q.b<yStart+th&&q.wb)parts.push([q.b-yStart,q.wb]);
      if(parts.length)ys.push([y,parts]);
    }
    if(monochrome){
      const decoded=await decodeHevcLuma(record,itemBytes(data,d,id),{width:tw,height:th},onProgress);
      for(const [y,yp] of ys)for(const [x,xp] of xs){
        let value=0;
        for(const [yy,wy] of yp)for(const [xx,wx] of xp)value+=decoded.bytes[yy*tw+xx]*wy*wx;
        acc[y*targetWidth+x]+=value;
      }
    }else{
      const decoded=await decodeHevcYuv(record,itemBytes(data,d,id),{width:tw,height:th},onProgress);
      const rgba=yuv420ToRgba(decoded,tw,th,{matrix:color.matrix,fullRange:color.fullRange});
      for(const [y,yp] of ys)for(const [x,xp] of xs){
        const to=(y*targetWidth+x)*3;
        for(const [yy,wy] of yp)for(const [xx,wx] of xp){
          const from=(yy*tw+xx)*4,w=wy*wx;
          acc[to]+=rgba[from]*w;acc[to+1]+=rgba[from+1]*w;acc[to+2]+=rgba[from+2]*w;
        }
      }
    }
    onProgress?.({stage,done:i+1,total:tileIds.length});
  }
  const output=new Uint8Array(acc.length);
  for(let i=0;i<acc.length;i++)output[i]=Math.max(0,Math.min(255,Math.round(acc[i])));
  return {bytes:output,width:targetWidth,height:targetHeight,color:first};
}

export function decodeGridBilinearRgb(data,d,gridId,tileIds,width,height,onProgress,stage='linearPrimaryDecode'){
  return decodeGridBilinear(data,d,gridId,tileIds,width,height,onProgress,stage);
}
export function decodeGridBilinearLuma(data,d,gridId,tileIds,width,height,onProgress,stage='linearGainDecode'){
  return decodeGridBilinear(data,d,gridId,tileIds,width,height,onProgress,stage,{monochrome:true});
}
