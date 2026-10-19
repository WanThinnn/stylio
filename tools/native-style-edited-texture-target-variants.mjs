import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,auxUriForItem,findItemsByType} from '../web/src/core/heif.js';
import {setItemReference} from '../web/src/raster/heif.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {URI_TEXTURE_STYLES,MATTE_2026_URIS} from '../web/src/styles/texture.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {extractItem,idatItemBytes} from '../web/src/core/heif.js';

const [output,input]=process.argv.slice(2);
if(!output||!input)throw Error('Usage: node tools/native-style-edited-texture-target-variants.mjs <output-directory> <edited-native.heic>');
await fs.mkdir(output,{recursive:true});

const source=new Uint8Array(await fs.readFile(input));
const sourceD=discoverHeic(source);
assert.equal(sourceD.stylesItem,null,'expected edited export without standalone Styles graph');
const sourceMarker=extractAppleMakerNoteTag(
  sourceD.iloc.items.get(sourceD.exifItem).constructionMethod===1
    ? idatItemBytes(source,sourceD.exifItem,sourceD.meta)
    : extractItem(source,sourceD.iloc,sourceD.exifItem),0x54
)?.payload;
assert(sourceMarker?.length,'expected native Style selection marker');

const {data:baseline}=await executeJob({
  operation:'texture',
  data:source,
  opts:{preserveStyles:true,allowMissingStyles:true},
});
const baseD=discoverHeic(baseline);
const tmap=findItemsByType(baseD.infos,'tmap')[0];
assert(tmap,'expected ISO tmap');
const texture=[...baseD.infos].find(([,i])=>i.uri===URI_TEXTURE_STYLES)?.[0];
assert(texture,'expected Texture metadata item');

const matteIds=[...baseD.infos.keys()].filter((id)=>MATTE_2026_URIS.includes(auxUriForItem(baseD.props,id)));
assert.equal(matteIds.length,12,'expected all twelve Texture mattes');

const readExif=(bytes,d)=>d.iloc.items.get(d.exifItem).constructionMethod===1
  ? idatItemBytes(bytes,d.exifItem,d.meta)
  : extractItem(bytes,d.iloc,d.exifItem);
const markerOf=(bytes,d)=>extractAppleMakerNoteTag(readExif(bytes,d),0x54)?.payload;
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

function build(name,{textureTargets,matteTargets}){
  let meta=baseline.slice(baseD.meta.off,baseD.meta.off+baseD.meta.size);
  meta=setItemReference(meta,'cdsc',texture,textureTargets(baseD.primary,tmap));
  for(const id of matteIds)meta=setItemReference(meta,'auxl',id,matteTargets(baseD.primary,tmap));
  const ft=topBox(baseline,'ftyp');
  const data=rebuildHeic(baseline,baseD,baseline.slice(ft.off,ft.off+ft.size),meta,new Map());
  const d=discoverHeic(data);
  assert(eq(markerOf(data,d),sourceMarker),'selected Style marker changed');
  assert.equal(d.primary,sourceD.primary,'edited primary identity changed');
  return {name,data,d};
}

const variants=[
  build('BI_PrimaryOnly_AllTextureGraph',{textureTargets:(p)=>[p],matteTargets:(p)=>[p]}),
  build('BJ_TmapOnly_AllTextureGraph',{textureTargets:(_,t)=>[t],matteTargets:(_,t)=>[t]}),
  build('BK_TexturePrimary_MattesPrimaryTmap',{textureTargets:(p)=>[p],matteTargets:(p,t)=>[p,t]}),
  build('BL_TexturePrimaryTmap_MattesPrimary',{textureTargets:(p,t)=>[p,t],matteTargets:(p)=>[p]}),
];

const report=[];
for(const v of variants){
  const file=path.basename(input).replace(/\.heic$/i,'')+'_'+v.name+'.HEIC';
  const checked=await executeJob({operation:'read',file:new Blob([v.data])});
  assert.equal(checked.discoveryError,null);
  assert.equal(checked.compatibilityError,null);
  await fs.writeFile(path.join(output,file),v.data);
  const texRef=v.d.refs.find(r=>r.type==='cdsc'&&r.from===texture)?.to||[];
  const matteRef=v.d.refs.find(r=>r.type==='auxl'&&r.from===matteIds[0])?.to||[];
  report.push({
    file,bytes:v.data.length,
    selectedStyleMarkerPreserved:true,
    primary:'exact edited input',
    hdr:'exact edited input',
    textureTargets:texRef,
    matteTargets:matteRef,
    compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],
    productionRepair:false,
  });
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
