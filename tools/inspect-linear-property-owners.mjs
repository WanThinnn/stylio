import fs from 'node:fs/promises';
import {discoverHeic,propertyForItem} from '../web/src/core/heif.js';
for(const file of process.argv.slice(2)){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b);
 const ids=[d.linearThumb,d.deltaGrid].filter(x=>x!=null);
 const owners=new Map();
 for(const [id] of d.infos){
  for(const a of d.props.associations.get(id)||[]){
   if(!owners.has(a.index))owners.set(a.index,[]);
   owners.get(a.index).push(id);
  }
 }
 console.log('\n'+file);
 for(const id of ids){
  console.log('item',id,d.infos.get(id));
  console.log((d.props.associations.get(id)||[]).map(a=>({
    index:a.index,essential:a.essential,type:d.props.properties[a.index-1]?.type,owners:owners.get(a.index)
  })));
 }
}