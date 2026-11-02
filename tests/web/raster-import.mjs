import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {imageFormat} from '../../web/src/media/image-format.js';
import {targetGeometry, buildRasterHeic, sampleRasterLuma, applyRasterStyleRecommendation} from '../../web/src/raster/raster-import.js';
import {buildLightMaps} from '../../web/src/raster/styles.js';
import {parseBplist} from '../../web/src/raster/bplist.js';
import {generateSyntheticHevc} from '../../web/src/raster/synthetic-hevc.js';
import {buildGeneratedProfile} from '../../web/src/raster/generated-profile.js';
import {discoverHeic, dimensionsForItem, extractItem, auxUriForItem, MATTE_URIS,
  propertyBoxBytes} from '../../web/src/raster/heif.js';
import {readExifOrientation} from '../../web/src/raster/exif.js';
import {hasTexture} from '../../web/src/raster/texture.js';
import {rgbaToI420} from '../../web/src/raster/raster-color.js';
import {box, concat, be} from '../../web/src/raster/box.js';
import {installPortraitMatte} from '../../web/src/raster/portrait-matte.js';
import {parseIref,parseIinf} from '../../web/src/raster/heif.js';
import {topBox} from '../../web/src/raster/box.js';

test('signatures distinguish HEIC and AVIF regardless of file extension', () => {
  const text = s => new TextEncoder().encode(s);
  const ftyp = (...brands) => box('ftyp', concat([text(brands[0]), be(0,4), ...brands.slice(1).map(text)]));
  assert.equal(imageFormat(ftyp('mif1','avif')), 'avif');
  assert.equal(imageFormat(ftyp('heic','mif1')), 'heic');
  assert.equal(imageFormat(Uint8Array.of(255,216,255)), 'jpeg');
  assert.equal(imageFormat(Uint8Array.of(137,80,78,71,13,10,26,10)), 'png');
  assert.equal(imageFormat(text('RIFF0000WEBP')), 'webp');
  assert.equal(imageFormat(text('GIF89a')), 'gif');
  assert.equal(imageFormat(text('<svg>')), 'unknown');
  assert.equal(imageFormat(Uint8Array.of(137,80,0,0,0,0,0,0)), 'unknown');
});

test('portrait, landscape, small, high-resolution and panorama geometry fits every grid', () => {
  // Geometry coverage only: these ratios do not establish Photos editor support.
  const commonRatios=[[1200,1200],[2000,3000],[3000,2000],[2400,3000],[3000,2400],
    [3024,4032],[4032,3024],[2160,3840],[3840,2160]];
  const sizes=[...commonRatios.flatMap(([w,h])=>[[w,h],[w*2,h*2]]),
    [900,600],[600,900],[4284,4284],[7,5],[8000,6000],[48000,600],[600,48000]];
  for (const [width,height] of sizes) {
    const g = targetGeometry({width,height});
    assert.ok(g.primaryTiles <= 48);
    assert.ok(g.hdrColumns*g.hdrRows <= 12);
    assert.ok(g.deltaColumns*g.deltaRows <= 30);
    assert.ok(Math.abs((g.displayWidth/g.displayHeight)/(width/height)-1) < 0.01);
    if(width===900) assert.deepEqual([g.displayWidth,g.displayHeight], [900,600]);
  }
  assert.throws(()=>targetGeometry({width:0,height:100}));
});

test('software colour conversion preserves black/white and RGB endpoint ranges', () => {
  for (const [color,expected] of [[[0,0,0],[16,128,128]],[[255,255,255],[235,128,128]],
    [[255,0,0],[63,102,240]],[[0,255,0],[173,42,26]],[[0,0,255],[32,240,118]]]) {
    const rgba = Uint8ClampedArray.from(Array(4).fill([...color,255]).flat());
    assert.deepEqual([...rgbaToI420(rgba,2,2)], [...Array(4).fill(expected[0]), ...expected.slice(1)]);
  }
});

test('tone sampling has no artificial dark border for portrait and panorama inputs',()=>{
  const previous=globalThis.document;
  try {
    for (const image of [{width:1200,height:1600},{width:8000,height:600}]) {
      let sampledFullImage=false;
      globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({
        drawImage(source,x,y,width,height) {
          assert.equal(source,image);
          sampledFullImage=x===0&&y===0&&width===256&&height===192;
        },
        getImageData(x,y,width,height) {
          const data=new Uint8ClampedArray(width*height*4).fill(sampledFullImage?255:0);
          return {data};
        },
      })})};
      const luma=sampleRasterLuma(image);
      assert.equal(luma.length,256*192);
      assert.ok(luma.every(value=>Math.abs(value-1)<1e-12));
    }
  } finally {
    if(previous===undefined) delete globalThis.document; else globalThis.document=previous;
  }
});

const fixture = JSON.parse(fs.readFileSync(new URL('./raster-hevc.fixture.json',import.meta.url)));
const assets = await generateSyntheticHevc(null, async (_, options) => {
  const asset = options.pixelFormat !== 'gray' ? fixture.assets.delta
    : options.width === 768 ? fixture.assets.textureMask : fixture.assets.mask;
  return {...asset, hvcc:Uint8Array.from(asset.hvcc), payload:Uint8Array.from(asset.payload)};
});

test('raster Style recommendation derives a marker without mutating the neutral profile and invalid input keeps Standard',()=>{
  const profile=buildGeneratedProfile('48-12',assets),saved=profile.mn54.slice();
  const applied=applyRasterStyleRecommendation(profile,{styleId:11,tone:-.42,color:.16,palette:.88,confidence:.9,level:'standard'});
  assert.notEqual(applied.profile,profile);
  assert.deepEqual(profile.mn54,saved);
  const marker=parseBplist(applied.profile.mn54);
  assert.deepEqual([marker.get('4'),marker.get('1'),marker.get('2'),marker.get('3')],[11,-.42,.16,.88]);
  assert.equal(applied.recommendation.styleName,'Dramatic');
  const invalid=applyRasterStyleRecommendation(profile,{styleId:99,tone:0,color:0,palette:1});
  assert.equal(invalid.profile,profile);
  assert.equal(invalid.recommendation,null);
  assert.match(invalid.error,/Invalid recommendation/);
  assert.deepEqual(profile.mn54,saved);
});

test('generated Portrait matte has one dedicated descriptor and repeated registration is stable',()=>{
  const profile=buildGeneratedProfile('48-12',assets),graph=discoverHeic(profile.meta),payloads=new Map(profile.retained);
  const generated={...assets.mask,width:64,height:64,pixi:box('pixi',Uint8Array.of(0,0,0,0,1,8))};
  const first=installPortraitMatte(profile.meta,payloads,null,null,generated,graph.primary);
  const refs=parseIref(first.meta,topBox(first.meta,'meta')),infos=parseIinf(first.meta,topBox(first.meta,'meta'));
  const sides=refs.filter(r=>r.type==='cdsc'&&r.to.includes(first.report.itemId)&&infos.get(r.from)?.type==='mime');
  assert.equal(sides.length,1);
  const xmp=new TextDecoder().decode(payloads.get(sides[0].from));
  assert.match(xmp,/<apdi:AuxiliaryImageType>depth<\//);
  assert.match(xmp,/<apdi:StoredFormat>1278226488<\//);
  assert.match(xmp,/<portraitEffectsMatte:PortraitEffectsMatteVersion>65537<\//);
  assert.ok(!xmp.includes('FSINCMatteVersion'));
  const second=installPortraitMatte(first.meta,payloads,null,null,generated,graph.primary);
  assert.deepEqual(second.meta,first.meta);
});

test('new raster container keeps own tiles, independent Main10 thumbnail and removes donor Portrait masks', () => {
  const profile = buildGeneratedProfile('48-12',assets), d = discoverHeic(profile.meta);
  const geometry = targetGeometry({width:900,height:600});
  const payload = Uint8Array.of(0,0,0,4,38,1,0,0);
  const codec = propertyBoxBytes(profile.meta,d.props,d.primaryTiles[0],'hvcC');
  const linear = {...assets.delta, width:768,height:1024,
    pixi:box('pixi',Uint8Array.of(0,0,0,0,3,10,10,10)),colr:assets.delta.colr};
  const maps=buildLightMaps(Float64Array.from({length:1024},(_,i)=>i/1023));
  const output = buildRasterHeic(profile,{main:Array(geometry.primaryTiles).fill(payload),
    mainHvcc:codec,thumb:payload,thumbHvcc:codec,hdr:payload,hdrHvcc:codec,
    linearThumbnail:linear,lightMaps:maps},[0.2,0.4,0.8],null,geometry);
  const result = discoverHeic(output);
  assert.deepEqual(dimensionsForItem(result.props,result.primary),[600,900]);
  assert.equal(result.primaryTiles.length,geometry.primaryTiles);
  for(const id of result.primaryTiles) assert.deepEqual(extractItem(output,result.iloc,id),payload);
  assert.equal(readExifOrientation(extractItem(output,result.iloc,result.exifItem)),6);
  assert.deepEqual(dimensionsForItem(result.props,result.linearThumb),[768,1024]);
  assert.ok(result.stylesItem !== null);
  const styles=parseBplist(extractItem(output,result.iloc,result.stylesItem));
  assert.deepEqual(styles.get('c'),maps[0]);
  assert.deepEqual(styles.get('d'),maps[1]);
  assert.equal(styles.get('6').get('ToneMappedImage').get('p50'),0.4);
  assert.ok(hasTexture(result.infos));
  assert.equal([...result.infos.keys()].some(id => auxUriForItem(result.props,id) === MATTE_URIS.portraiteffectsmatte),false);
});
