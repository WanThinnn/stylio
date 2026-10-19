// Isolate MakerNote 0x54 selection state on the closest AQ container.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {topBox} from '../web/src/core/box.js';
import {discoverHeic,extractItem,idatItemBytes} from '../web/src/core/heif.js';
import {extractAppleMakerNoteTag,injectAppleMakerNoteTag} from '../web/src/core/exif.js';
import {buildBplist,parseBplist} from '../web/src/core/bplist.js';
import {rebuildHeic} from '../web/src/styles/graft.js';
import {executeJob} from '../web/src/media/heic-worker.js';
import {writeZip} from '../web/src/core/zip.js';

const [output,aqFile,brightFile,standardFile]=process.argv.slice(2);
if(!output||!aqFile||!brightFile||!standardFile)
  throw Error('Usage: node tools/native-style-selection-marker-variants.mjs <output-directory> <AQ.heic> <original-bright.heic> <native-standard-current.heic>');
const [aq,bright,standard]=await Promise.all([aqFile,brightFile,standardFile].map(async file=>new Uint8Array(await fs.readFile(file))));
const a=discoverHeic(aq),b=discoverHeic(bright),s=discoverHeic(standard);
const read=(bytes,d,id)=>d.iloc.items.get(id).constructionMethod===1
  ?idatItemBytes(bytes,id,d.meta):extractItem(bytes,d.iloc,id);
const tag=(bytes,d)=>extractAppleMakerNoteTag(read(bytes,d,d.exifItem),0x54);
const aqTag=tag(aq,a),brightTag=tag(bright,b),savedTag=tag(standard,s);
const aqSelection=parseBplist(aqTag.payload),brightSelection=parseBplist(brightTag.payload),savedSelection=parseBplist(savedTag.payload);
assert.equal(aqSelection.get('4'),1,'AQ Standard');
assert.equal(brightSelection.get('4'),16,'original Bright');
assert.equal(savedSelection.get('4'),1,'saved Standard');
assert.deepEqual([...savedSelection.keys()].sort(),['0','1','2','3','4','5']);

const editFlagSelection=new Map(aqSelection);editFlagSelection.set('5',0);
const adjusted=(key,value)=>{const marker=new Map(aqSelection);marker.set(key,value);marker.set('5',0);return buildBplist(marker);};
const markerVariants=[
  ['AX_OriginalBrightSelection',brightTag.payload,brightTag.type,'Bright'],
  ['AY_PhotosSavedStandardSelection',savedTag.payload,savedTag.type,'Standard-six-key'],
  ['AZ_StandardSelectionEditFlag',buildBplist(editFlagSelection),aqTag.type,'Standard-eight-key-edit-flag'],
  ['BA_StandardTonePlus001',adjusted('1',0.01),aqTag.type,'Standard-Tone+0.01'],
  ['BB_StandardToneMinus001',adjusted('1',-0.01),aqTag.type,'Standard-Tone-0.01'],
  ['BC_StandardColorPlus001',adjusted('2',0.01),aqTag.type,'Standard-Color+0.01'],
  ['BD_StandardColorMinus001',adjusted('2',-0.01),aqTag.type,'Standard-Color-0.01'],
];

await fs.mkdir(output,{recursive:true});
const files=new Map(),report=[];
for(const [label,marker,type,selection]of markerVariants){
  const exif=injectAppleMakerNoteTag(read(aq,a,a.exifItem),marker,0x54,type);
  const data=rebuildHeic(aq,a,aq.slice(0,topBox(aq,'ftyp').size),aq.slice(a.meta.off,a.meta.off+a.meta.size),
    new Map([[a.exifItem,exif]]));
  const d=discoverHeic(data);
  for(const id of a.iloc.items.keys())if(id!==a.exifItem)
    assert.deepEqual(read(data,d,id),read(aq,a,id),'non-Exif payload '+id);
  assert.deepEqual(d.refs,a.refs);assert.equal(d.primary,a.primary);
  const checked=await executeJob({operation:'read',file:new Blob([data])});
  assert.equal(checked.discoveryError,null);assert.equal(checked.compatibilityError,null);
  const name=`native-1_${label}.HEIC`;await fs.writeFile(path.join(output,name),data);files.set(name,data);
  report.push({file:name,bytes:data.length,selection,allImageAndEditingPayloadsExact:true,
    styles:true,texture:true,hdr:true,compatibility:checked.compatibility?.status||null,
    compatibilityReasons:checked.compatibility?.reasons||[],productionRepair:false});
}
await fs.writeFile(path.join(output,'Styles-preview-AX-BD.zip'),writeZip(files));
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
