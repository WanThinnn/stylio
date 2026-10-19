import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerTmapHdr,editableTmapHeadroom} from '../web/src/styles/hdr-compatibility.js';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,URI_HDR_GAIN} from '../web/src/core/heif.js';
import {writeZip} from '../web/src/core/zip.js';
const [inputDir,output]=process.argv.slice(2);
if(!inputDir||!output)throw Error('Usage: node tools/native-style-hdr-variants.mjs <ABC-directory> <output-directory>');
await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
const entries=await fs.readdir(inputDir);
const scenes=[...new Set(entries.filter(name=>name.endsWith('_B_GraphLegacy.HEIC'))
 .map(name=>name.slice(0,-'_B_GraphLegacy.HEIC'.length)))].sort();
if(!scenes.length)throw Error('No *_B_GraphLegacy.HEIC inputs found');
for(const scene of scenes){
 for(const [label,base,headroom]of [['D_B_HDRRole','B_GraphLegacy',false],['E_B_HDRHeadroom','B_GraphLegacy',true],['F_C_HDRHeadroom','C_GraphModern',true]]){
  const source=new Uint8Array(await fs.readFile(path.join(inputDir,scene+'_'+base+'.HEIC'))),before=discoverHeic(source);
  const data=registerTmapHdr(source,{headroom})||source,after=discoverHeic(data);
  assert.equal(auxUriForItem(after.props,after.hdrGrid),URI_HDR_GAIN);
  for(const [id,item]of before.iloc.items){
   const read=(bytes,d)=>item.constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
   assert.deepEqual(read(data,after),read(source,before),'unchanged B/C payload '+id);
   if(id===before.hdrGrid)continue;
   const props=(bytes,d)=>(d.props.associations.get(id)||[]).map(a=>{const p=d.props.properties[a.index-1];return {essential:a.essential,bytes:bytes.slice(p.box.off,p.box.off+p.box.size)};});
   assert.deepEqual(props(data,after),props(source,before),'unchanged B/C properties '+id);
   assert.deepEqual(after.refs.filter(r=>r.from===id),before.refs.filter(r=>r.from===id),'unchanged B/C references '+id);
  }
  assert.equal(editableTmapHeadroom(data),editableTmapHeadroom(source));
  const name=scene+'_'+label+'.HEIC';
  await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,base:scene+'_'+base+'.HEIC',headroomAdded:headroom,headroom:editableTmapHeadroom(data),addedBytes:data.length-source.length,allOriginalPayloadsPreserved:true});
 }
}
await fs.writeFile(path.join(output,'Styles-HDR-DEF.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
