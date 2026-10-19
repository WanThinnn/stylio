import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {discoverHeic,extractItem,idatItemBytes,dimensionsForItem,irotAngleForItem,imirAxisForItem} from '../web/src/core/heif.js';
import {hevcSpsColor} from '../web/src/raster/hevc-color.js';

const [outDir,editedFile,nativeFile]=process.argv.slice(2);
if(!outDir||!editedFile||!nativeFile)throw Error('Usage: node tools/research-linear-thumb-fit.mjs <out-dir> <edited.heic> <same-capture-native.heic>');
await fs.mkdir(outDir,{recursive:true});
const read=async p=>new Uint8Array(await fs.readFile(p));
const native=await read(nativeFile), nd=discoverHeic(native);
assert.notEqual(nd.linearThumb,null,'native linear thumbnail required');
const itemBytes=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
function hvccRecord(bytes,d,id){
  for(const ref of d.props.associations.get(id)||[]){
    const p=d.props.properties[ref.index-1];
    if(p?.type==='hvcC')return bytes.slice(p.box.off+p.box.hdr,p.box.off+p.box.size);
  }
  throw Error('hvcC missing');
}
function annexB(record,payload){
  if(record.length<23||record[0]!==1)throw Error('invalid hvcC');
  const parts=[],start=Uint8Array.of(0,0,0,1);let pos=23;
  for(let i=0;i<record[22];i++){
    const type=record[pos++]&63;
    const count=(record[pos]<<8)|record[pos+1];pos+=2;
    for(let j=0;j<count;j++){
      const size=(record[pos]<<8)|record[pos+1];pos+=2;
      parts.push(start,record.slice(pos,pos+size));pos+=size;
    }
  }
  if(pos!==record.length)throw Error('hvcC parse mismatch');
  const lengthSize=(record[21]&3)+1;
  for(pos=0;pos<payload.length;){
    let size=0;for(let k=0;k<lengthSize;k++)size=(size<<8)|payload[pos+k];pos+=lengthSize;
    parts.push(start,payload.slice(pos,pos+size));pos+=size;
  }
  const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let o=0;
  for(const p of parts){out.set(p,o);o+=p.length;}
  return out;
}
const lt=nd.linearThumb, dims=dimensionsForItem(nd.props,lt), record=hvccRecord(native,nd,lt);
const bitstream=annexB(record,itemBytes(native,nd,lt));
await fs.writeFile(path.join(outDir,'native-linear.h265'),bitstream);
const metadata={editedFile,nativeFile,linearThumbItem:lt,width:dims[0],height:dims[1],primaryWidth:dimensionsForItem(nd.props,nd.primary)[0],primaryHeight:dimensionsForItem(nd.props,nd.primary)[1],primaryIrot:irotAngleForItem(native,nd.props,nd.primary),linearIrot:irotAngleForItem(native,nd.props,lt),primaryImir:imirAxisForItem(native,nd.props,nd.primary),linearImir:imirAxisForItem(native,nd.props,lt),sps:hevcSpsColor(record)};
await fs.writeFile(path.join(outDir,'meta.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({...metadata,bytes:bitstream.length},null,2));
