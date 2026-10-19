import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {parseBplist} from '../web/src/core/bplist.js';
const files=process.argv.slice(2);
const read=(b,d,id)=>d.iloc.items.get(id).constructionMethod===1?idatItemBytes(b,id,d.meta):extractItem(b,d.iloc,id);
function tm(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);let p=6;
 const q=(s=false)=>{const n=s?v.getInt32(p):v.getUint32(p),z=v.getUint32(p+4);p+=8;return n/z;};
 return {base:q(),alt:q(),min:q(true),max:q(true),gamma:q(),baseOffset:q(true),altOffset:q(true)};
}
for(const file of files){
 const b=new Uint8Array(await fs.readFile(file)),d=discoverHeic(b);if(d.stylesItem==null)continue;
 const p=parseBplist(read(b,d,d.stylesItem),{preserveReals:true}),six=p.get('6');
 const lin=six?.get('LinearImage'),tone=six?.get('ToneMappedImage'),range=p.get('i');
 const tid=[...d.infos].find(([,x])=>x.type==='tmap')?.[0],t=tm(read(b,d,tid));
 const val=x=>x?.value??x??null;
 console.log(JSON.stringify({file:path.basename(file),alt:t.alt,headroom:2**t.alt,
  lw:val(lin?.get('whitePoint')),lh:val(lin?.get('highKey')),lp98:val(lin?.get('p98')),
  tw:val(tone?.get('whitePoint')),th:val(tone?.get('highKey')),tp98:val(tone?.get('p98')),
  h:val(p.get('h')),gain:val(range?.get('Gain')),rmax:val(range?.get('OriginalRangeMax')),rmin:val(range?.get('OriginalRangeMin'))}));
}