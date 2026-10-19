import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,DEPTH_URI} from '../web/src/core/heif.js';
import {nativePortraitBaseState,portraitEligibility} from '../web/src/portrait/ai-portrait-container.js';
const files=process.argv.slice(2);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,16);
for(const file of files){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b);
 const depth=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
 const sides=depth===undefined?[]:d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(depth)&&d.infos.get(r.from)?.type==='mime').map(r=>{
  const p=read(b,d,r.from),x=new TextDecoder().decode(p);
  const get=tag=>x.match(new RegExp('<(?:[^:>]+:)?'+tag+'>([^<]*)<'))?.[1]??null;
  return {id:r.from,hash:hash(p),bytes:p.length,rendering:x.includes('depthBlurEffect:RenderingParameters'),
    aperture:get('SimulatedAperture'),lightingStrength:get('EffectStrength'),lightingVersion:x.match(/portraitLightingEffect\/(\d+\.\d+)/)?.[1]??null};
 });
 console.log(JSON.stringify({file:path.basename(file),state:nativePortraitBaseState(b,d),eligibility:portraitEligibility(b),
  depth:depth===undefined?null:{id:depth,hash:hash(read(b,d,depth)),bytes:read(b,d,depth).length},sidecars:sides}));
}