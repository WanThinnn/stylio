// Private Q-based probes: T neutralizes only delta samples; U makes existing
// P3/sRGB ICC colour explicit in the primary SPS. No automatic production route.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {box,topBox,be,concat} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes,dimensionsForItem,appendIpcoProperty} from '../web/src/core/heif.js';
import {setItemPropertyAssociations} from '../web/src/raster/heif.js';
import {readSpsInfo} from '../web/src/codecs/hevc-linear-tags.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {loadProfile,writeZip} from '../web/src/core/zip.js';

const [output,sourceFile]=process.argv.slice(2);
if(!output||!sourceFile)throw Error('Usage: node tools/native-style-preview-render-variants.mjs <output-directory> <Q.heic>');
const source=new Uint8Array(await fs.readFile(sourceFile)),a=discoverHeic(source);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
for(const key of ['hdrGrid','stylesItem','linearThumb','deltaGrid'])assert.notEqual(a[key],null,key);
const metaOf=(bytes,d)=>bytes.slice(d.meta.off,d.meta.off+d.meta.size);
const ft=topBox(source,'ftyp'),ftyp=source.slice(ft.off,ft.off+ft.size);
const profile=await loadProfile(new Uint8Array(await fs.readFile(new URL('../web/profiles/48-12.zip',import.meta.url))));
const pd=discoverHeic(profile.meta),neutral=profile.retained.get(pd.deltaTiles[0]);
assert.ok(neutral);assert.ok(pd.deltaTiles.every(id=>Buffer.from(profile.retained.get(id)).equals(Buffer.from(neutral))),'constant neutral delta asset');
const neutralHvcc=propertyBoxBytes(profile.meta,pd.props,pd.deltaTiles[0],'hvcC');
let tmeta=metaOf(source,a),deltaCodec;[tmeta,deltaCodec]=appendIpcoProperty(tmeta,neutralHvcc);
const tvalues=new Map();
for(const id of a.deltaTiles){
 assert.deepEqual(dimensionsForItem(a.props,id),dimensionsForItem(pd.props,pd.deltaTiles[0]),'delta tile dimensions');
 tvalues.set(id,neutral);
 const refs=a.props.associations.get(id).map(ref=>[a.props.properties[ref.index-1].type==='hvcC'?deltaCodec:ref.index,ref.essential]);
 tmeta=setItemPropertyAssociations(tmeta,id,refs);
}
const t=rebuildHeic(source,a,ftyp,tmeta,tvalues);

function explicitSps(nal){
 const before=readSpsInfo(nal);assert.equal(before.present,true);assert.equal(before.video,true);
 assert.equal(before.primaries,2);assert.equal(before.transfer,2);assert.equal(before.matrix,6);assert.equal(before.fullRange,true);
 // Colour-description fields already exist; changing these 16 bits leaves
 // dimensions, reference frames, matrix, range and all coded picture data alone.
 const raw=[];
 for(let i=2;i<nal.length;i++)if(!(i>=4&&nal[i]===3&&nal[i-1]===0&&nal[i-2]===0))raw.push(nal[i]);
 const bits=raw.flatMap(byte=>Array.from({length:8},(_,i)=>(byte>>(7-i))&1));
 const start=before.start+6;
 for(const [offset,value]of [[0,12],[8,13]])for(let i=0;i<8;i++)bits[start+offset+i]=(value>>(7-i))&1;
 const rbsp=[];for(let i=0;i<bits.length;i+=8)rbsp.push(bits.slice(i,i+8).reduce((n,b)=>n*2+b,0));
 const escaped=[];let zeros=0;
 for(const byte of rbsp){if(zeros>=2&&byte<=3){escaped.push(3);zeros=0;}escaped.push(byte);zeros=byte===0?zeros+1:0;}
 const result=concat([nal.slice(0,2),Uint8Array.from(escaped)]),after=readSpsInfo(result);
 assert.deepEqual({...after,primaries:2,transfer:2},before,'only primary/transfer declarations');
 return result;
}
function explicitRecord(record){
 const pieces=[record.slice(0,23)];let pos=23,countSps=0;
 for(let i=0;i<record[22];i++){
  const header=record.slice(pos,pos+3),type=record[pos]&63,count=record[pos+1]*256+record[pos+2];pos+=3;pieces.push(header);
  for(let j=0;j<count;j++){
   const size=record[pos]*256+record[pos+1];pos+=2;const old=record.slice(pos,pos+size);pos+=size;
   const nal=type===33?explicitSps(old):old;if(type===33)countSps++;
   pieces.push(be(nal.length,2),nal);
  }
 }
 assert.equal(pos,record.length);assert.ok(countSps>0);return concat(pieces);
}
let umeta=metaOf(source,a);const codecs=new Map();
for(const id of a.primaryTiles){
 const refs=[];
 for(const ref of a.props.associations.get(id)){
  const property=a.props.properties[ref.index-1];let index=ref.index;
  if(property.type==='hvcC'){
   index=codecs.get(ref.index);
   if(index===undefined){
    const record=source.slice(property.box.off+8,property.box.off+property.box.size),updated=explicitRecord(record);
    [umeta,index]=appendIpcoProperty(umeta,box('hvcC',updated));codecs.set(ref.index,index);
   }
  }
  refs.push([index,ref.essential]);
 }
 const oldRecord=propertyBoxBytes(source,a.props,id,'hvcC').slice(8),lengthSize=(oldRecord[21]&3)+1,payload=read(source,a,id);
 for(let pos=0;pos<payload.length;){
  let size=0;for(let j=0;j<lengthSize;j++)size=size*256+payload[pos++];
  assert.ok(size>=2&&pos+size<=payload.length);
  assert.notEqual((payload[pos]>>1)&63,33,'no in-band SPS overriding the configuration');pos+=size;
 }
 umeta=setItemPropertyAssociations(umeta,id,refs);
}
const u=rebuildHeic(source,a,ftyp,umeta,new Map());
const properties=(bytes,d,id,excludeCodec=false)=>(d.props.associations.get(id)||[]).map(ref=>{
 const p=d.props.properties[ref.index-1];return {essential:ref.essential,type:p.type,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};
}).filter(p=>!excludeCodec||p.type!=='hvcC');
await fs.mkdir(output,{recursive:true});const files=new Map(),report=[];
for(const [label,data,changed]of [['T_NeutralDelta',t,new Set(a.deltaTiles)],['U_ExplicitPrimaryColor',u,new Set(a.primaryTiles)]]){
 const d=discoverHeic(data);
 for(const id of a.infos.keys()){
  if(label.startsWith('U')||!changed.has(id))assert.deepEqual(read(data,d,id),read(source,a,id),'unchanged payload '+id);
  assert.deepEqual(properties(data,d,id,changed.has(id)),properties(source,a,id,changed.has(id)),'unrelated properties '+id);
 }
 assert.deepEqual(d.refs,a.refs,'all graph references');
 if(label.startsWith('U'))for(const id of d.primaryTiles){
  const color=hevcSpsColor(propertyBoxBytes(data,d.props,id,'hvcC').slice(8));
  assert.equal(color.primaries,12);assert.equal(color.transfer,13);assert.equal(color.matrix,6);assert.equal(color.fullRange,true);
 }
 const checked=await executeJob({operation:'read',file:new Blob([data])});
 assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);assert.equal(checked.compatibility?.status,'known-compatible');
 const name='native-1_'+label+'.HEIC';await fs.writeFile(path.join(output,name),data);files.set(name,data);
 report.push({file:name,bytes:data.length,base:'Q',changed:label.startsWith('T')?'delta samples and matching decoder':'primary SPS colour declarations only',
  sourceHdrExifNativeStylesLinearThumbnailTextureExact:true,primaryPictureSamplesExact:true,compatibility:checked.compatibility.status,productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-TU.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
