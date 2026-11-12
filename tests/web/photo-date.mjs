import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exifDateFields, photoCaptureDate} from '../../web/src/media/photo-date.js';
import {buildRasterExif} from '../../web/src/raster/raster-import.js';
import {concat,be} from '../../web/src/core/box.js';
import {buildAppleStyleExif,preserveRasterExif} from '../../web/src/raster/exif.js';
import {discoverHeic,extractItem} from '../../web/src/core/heif.js';
import {inspectSharedPhoto} from '../../web/src/app/native-engine.js';

function datedExif() {
  const le = (n,size) => be(n,size).reverse(), text = s => new TextEncoder().encode(s+'\0');
  const parts=[Uint8Array.of(73,73,42,0,0,0,0,0)]; let length=8;
  const append = b => {const offset=length;parts.push(b);length+=b.length;return offset;};
  const table = fields => {
    const entries=fields.map(([tag,value])=>{
      const bytes=text(value), offset=append(bytes);
      return concat([le(tag,2),le(2,2),le(bytes.length,4),bytes.length>4?le(offset,4):concat([bytes,new Uint8Array(4-bytes.length)])]);
    });
    return append(concat([le(fields.length,2),...entries,new Uint8Array(4)]));
  };
  const date=table([[0x9003,'2018:04:05 06:07:08'],[0x9004,'2018:04:05 06:07:08'],
    [0x9011,'+07:00'],[0x9012,'+07:00'],[0x9291,'456'],[0x9292,'456']]);
  const time=text('2026:10:08 12:00:00'), timeOffset=append(time);
  const root=append(concat([le(2,2),le(0x0132,2),le(2,2),le(time.length,4),le(timeOffset,4),
    le(0x8769,2),le(4,2),le(1,4),le(date,4),new Uint8Array(4)]));
  const tiff=concat(parts);tiff.set(le(root,4),4);
  return concat([be(6,4),new TextEncoder().encode('Exif\0\0'),tiff]);
}

test('raster EXIF keeps capture date, timezone and fractional seconds independently of modification date',()=>{
  const original=datedExif();
  const output=buildRasterExif(new TextEncoder().encode('test-style-marker'),7,original,
    {storedWidth:600,storedHeight:900});
  assert.deepEqual(exifDateFields(output),exifDateFields(original));
  assert.equal(exifDateFields(output).original,'2018:04:05 06:07:08');
  assert.equal(exifDateFields(output).offsetOriginal,'+07:00');
  assert.equal(exifDateFields(output).subsecOriginal,'456');
});

test('a shared JPEG without an Apple pairing identifier still exposes its original capture time',async t=>{
  const exif=datedExif().subarray(4);
  const jpeg=concat([Uint8Array.of(255,216,255,225),be(exif.length+2,2),exif,Uint8Array.of(255,217)]);
  t.mock.method(globalThis,'fetch',async()=>new Response(jpeg));
  assert.deepEqual(await inspectSharedPhoto('/probes/converted'),{
    identifier:null,format:'jpeg',date:'2018:04:05 06:07:08',timestamp:Date.parse('2018-04-05T06:07:08.456+07:00'),
  });
});

for(const [original,processed] of [
  ['C:/Users/WanThinnn/Downloads/IMG_1739.HEIC','C:/Users/WanThinnn/Downloads/IMG_1739_ExperimentalStyle.HEIC'],
  ['ref/Elio-backup/tests/IMG_0269.HEIC','ref/Elio-backup/tests/IMG_0269_texture_only.HEIC'],
]) test(`capture time is identical after processing ${original}`,{skip:!fs.existsSync(original)||!fs.existsSync(processed)},()=>{
  const read = path => photoCaptureDate(new Uint8Array(fs.readFileSync(path)));
  const before=read(original); assert.ok(before);
  assert.deepEqual(read(processed),before);
  if(before.subsec && before.timestamp!==undefined) assert.equal(before.timestamp%1000,
    Number(before.subsec.slice(0,3).padEnd(3,'0')));
});

test('missing and malformed date metadata is not replaced with the current time',()=>{
  assert.deepEqual(exifDateFields(null),{});
  assert.deepEqual(exifDateFields(Uint8Array.of(1,2,3)),{});
});

test('identical duplicate raster Exif fields are normalized, conflicts remain errors',()=>{
  // A source Exif IFD with Indigo's repeated ColorSpace and no MakerNote.
  const field=value=>concat([be(0xa001,2),be(3,2),be(1,4),be(value,2),be(0,2)]);
  const source=value=>concat([be(6,4),new TextEncoder().encode('Exif\0\0'),
    Uint8Array.of(77,77,0,42),be(8,4),be(1,2),be(0x8769,2),be(4,2),be(1,4),be(26,4),be(0,4),
    be(2,2),field(65535),field(value),be(0,4)]);
  const style=buildAppleStyleExif(new TextEncoder().encode('test-marker'));
  const original=source(65535),saved=original.slice();
  const result=preserveRasterExif(original,style,{width:600,height:900});
  assert.deepEqual(original,saved);assert.ok(result.length>original.length);
  assert.throws(()=>preserveRasterExif(source(1),style,{width:600,height:900}),/Conflicting source Exif tag/);
});

const safariOriginal='C:/Users/WanThinnn/Downloads/iCloud Photos (24444)/iCloud Photos/IMG_0486.HEIC';
const safariSaved='C:/Users/WanThinnn/Downloads/IMG_0612.HEIC';
test('reported Safari/iCloud date mismatch retains the complete original EXIF',{
  skip:!fs.existsSync(safariOriginal)||!fs.existsSync(safariSaved),
},()=>{
  const read=path=>new Uint8Array(fs.readFileSync(path));
  const before=read(safariOriginal),after=read(safariSaved);
  const exif=bytes=>{const d=discoverHeic(bytes);return extractItem(bytes,d.iloc,d.exifItem);};
  assert.deepEqual(exif(after),exif(before));
  // Date bytes alone are insufficient if the metadata stops describing the
  // displayed image. Verify the original EXIF association still reaches it.
  const sourceGraph=discoverHeic(before),outputGraph=discoverHeic(after);
  const exifReferences=d=>d.refs.filter(ref=>ref.type==='cdsc'&&ref.from===d.exifItem);
  assert.deepEqual(exifReferences(outputGraph),exifReferences(sourceGraph));
  assert.ok(exifReferences(outputGraph).some(ref=>ref.to.includes(outputGraph.primary)));
  assert.deepEqual(photoCaptureDate(after),photoCaptureDate(before));
  assert.equal(photoCaptureDate(after).date,'2026:10:03 17:14:19');
});
