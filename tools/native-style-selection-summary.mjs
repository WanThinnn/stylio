import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,extractItem,idatItemBytes,auxUriForItem,DEPTH_URI} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag} from '../web/src/core/exif.js';
import {parseBplist} from '../web/src/core/bplist.js';
const files=process.argv.slice(2);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
for(const file of files){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b);
 let marker=null;try{marker=Object.fromEntries(parseBplist(extractAppleMakerNoteTag(read(b,d,d.exifItem),0x54).payload));}catch{}
 const depths=[...d.infos.keys()].filter(id=>auxUriForItem(d.props,id)===DEPTH_URI);
 console.log(JSON.stringify({file:path.basename(file),stylesItem:d.stylesItem,texture:[...d.infos.values()].some(x=>x.uri?.includes('texture')),depths,marker}));
}