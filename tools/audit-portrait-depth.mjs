// Read actual encoded disparity samples, without canvas or RGB conversion.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {discoverHeic,extractItemData,propertyBoxBytes,auxUriForItem,DEPTH_URI,dimensionsForItem} from '../web/src/raster/heif.js';
import {hevcAnnexB} from '../web/src/raster/ffmpeg-hevc.js';
import {topBox} from '../web/src/core/box.js';
import {readPortraitOptics,portraitProjection} from '../web/src/portrait/portrait-geometry.js';

export function readPortraitDepth(path){
 const data=new Uint8Array(fs.readFileSync(path)),d=discoverHeic(data);
 const id=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
 if(id===undefined)throw Error('No depth: '+path);
 const [width,height]=dimensionsForItem(d.props,id),hv=propertyBoxBytes(data,d.props,id,'hvcC');
 const bitstream=hevcAnnexB(hv.subarray(topBox(hv,'hvcC').hdr),extractItemData(data,d,id));
 const result=spawnSync('ffmpeg',['-loglevel','error','-threads','1','-f','hevc','-i','pipe:0','-frames:v','1','-vf','extractplanes=y','-pix_fmt','gray','-f','rawvideo','pipe:1'],{input:bitstream,maxBuffer:128*1024*1024});
 if(result.status!==0||result.stdout.length!==width*height)throw Error(String(result.stderr)||'Invalid depth readback');
 const gray=new Uint8Array(result.stdout),xmp=d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(id)&&d.infos.get(r.from)?.type==='mime').map(r=>new TextDecoder().decode(extractItemData(data,d,r.from))).join('');
 const focus=d.refs.filter(r=>r.type==='cdsc'&&r.to.includes(d.primary)&&d.infos.get(r.from)?.type==='mime').map(r=>new TextDecoder().decode(extractItemData(data,d,r.from))).find(x=>x.includes('<mwg-rs:Type>Focus</mwg-rs:Type>'))||'';
 const focusX=Number(/stArea:x="([^"]+)"/.exec(focus)?.[1]??.5),focusY=Number(/stArea:y="([^"]+)"/.exec(focus)?.[1]??.5);
 const [w,h]=dimensionsForItem(d.props,d.primary),optics=readPortraitOptics(extractItemData(data,d,d.exifItem)),projection=portraitProjection(w,h,optics);
 return {gray,width,height,focusX,focusY,optics,projection,range:[Number(/FloatMinValue>([^<]+)/.exec(xmp)?.[1]),Number(/FloatMaxValue>([^<]+)/.exec(xmp)?.[1])]};
}

if(process.argv[1]?.replace(/\\/g,'/').endsWith('/audit-portrait-depth.mjs'))for(const path of process.argv.slice(2)){
 const r=readPortraitDepth(path),hist=new Uint32Array(256),far=new Uint32Array(256),near=new Uint32Array(256),local=new Uint32Array(256);
 const fx=Math.min(r.width-1,Math.floor(r.focusX*r.width)),fy=Math.min(r.height-1,Math.floor(r.focusY*r.height)),focus=r.gray[fy*r.width+fx];
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  const v=r.gray[y*r.width+x];hist[v]++;if(v<focus-3)far[focus-v]++;if(v>focus+3)near[v-focus]++;
  if(Math.abs(x-fx)<r.width*.025&&Math.abs(y-fy)<r.height*.025)local[v]++;
 }
 const quantile=(h,q)=>{const n=h.reduce((a,b)=>a+b,0);if(!n)return null;let sum=0;for(let i=0;i<256;i++){sum+=h[i];if(sum>=q*n)return i;}};
 console.log(JSON.stringify({path,width:r.width,height:r.height,focus:[r.focusX,r.focusY,focus],range:r.range,
  quantiles:[.02,.1,.25,.5,.75,.9,.98].map(q=>quantile(hist,q)),local:[.1,.5,.9].map(q=>quantile(local,q)),
  far:[.25,.5,.75,.9].map(q=>quantile(far,q)),near:[.25,.5,.75,.9].map(q=>quantile(near,q)),
  effectiveOptics:r.projection.fx*r.projection.fy*r.projection.pixelSize/Math.hypot(r.projection.width,r.projection.height)}));
}
