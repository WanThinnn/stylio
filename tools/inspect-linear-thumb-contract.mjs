import fs from 'node:fs/promises';
import {discoverHeic,propertyBoxBytes,dimensionsForItem} from '../web/src/core/heif.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {topBox} from '../web/src/core/box.js';
const f=process.argv[2],b=new Uint8Array(await fs.readFile(f)),d=discoverHeic(b),id=d.linearThumb;
const out={id,dims:dimensionsForItem(d.props,id)};
for(const t of ['pixi','colr','hvcC']){const x=propertyBoxBytes(b,d.props,id,t);if(!x){out[t]=null;continue;}if(t==='hvcC'){const q=topBox(x,'hvcC');out[t]=hevcSpsColor(x.slice(q.off+q.hdr,q.off+q.size));}else out[t]=Buffer.from(x).toString('hex');}
console.log(JSON.stringify(out,null,2));