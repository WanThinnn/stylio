import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,propertyBoxBytes,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {topBox} from '../web/src/core/box.js';
import {parseTmapMetadata} from '../web/src/raster/jpeg-hdr.js';
import {parseHagcIccTag,serializeSmpte2094App5} from '../web/src/raster/hagc.js';

const be32=(b,o)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
for(const file of process.argv.slice(2)){
  const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b);
  const tmapId=[...d.infos].find(([,x])=>x.type==='tmap')?.[0];
  if(tmapId===undefined){console.log(JSON.stringify({file:path.basename(file),error:'no-tmap'}));continue;}
  const tmap=parseTmapMetadata(read(b,d,tmapId));
  const colr=propertyBoxBytes(b,d.props,tmapId,'colr');
  const bb=colr?topBox(colr,'colr'):null;
  if(!colr||String.fromCharCode(...colr.slice(bb.off+bb.hdr,bb.off+bb.hdr+4))!=='prof'){
    console.log(JSON.stringify({file:path.basename(file),tmap:tmap.channels[0],hagc:null}));continue;
  }
  const icc=colr.slice(bb.off+bb.hdr+4,bb.off+bb.size),count=be32(icc,128);
  let hagc=null,hagcRoundTripExact=null;
  for(let i=0;i<count;i++){
    const p=132+i*12,sig=String.fromCharCode(...icc.slice(p,p+4));
    if(sig!=='HAGC')continue;
    const off=be32(icc,p+4),size=be32(icc,p+8),parsed=parseHagcIccTag(icc.slice(off,off+size));
    hagc=parsed.metadata;
    hagcRoundTripExact=Buffer.from(serializeSmpte2094App5(hagc)).equals(Buffer.from(parsed.payload));
  }
  const c=tmap.channels[0],baseline=hagc?.adaptiveToneMap?.baselineHdrHeadroom??null;
  console.log(JSON.stringify({
    file:path.basename(file),
    tmap:{min:c.min,max:c.max,gamma:c.gamma,baseOffset:c.baseOffset,alternateOffset:c.alternateOffset},
    hagc:baseline==null?null:{
      baseline,
      baselineMinusTmapMax:baseline-c.max,
      referenceWhite:hagc.hdrReferenceWhite,
      rwtmo:hagc.adaptiveToneMap.useReferenceWhiteToneMapping,
      roundTripExact:hagcRoundTripExact,
      alternates:hagc.adaptiveToneMap.alternates.map(x=>({
        headroom:x.alternateHdrHeadroom,
        mixType:x.componentMix.type,
        points:x.gainCurve.count,
      }))
    }
  }));
}
