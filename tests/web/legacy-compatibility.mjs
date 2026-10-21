import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {be,box,concat,topBox,metaChildren,findChild,boxes} from '../../web/src/core/box.js';
import {buildBplist,parseBplist,BplistReal} from '../../web/src/core/bplist.js';
import {injectAppleMakerNoteTag,extractAppleMakerNoteTag} from '../../web/src/core/exif.js';
import {
  addItems,discoverHeic,extractItem,idatItemBytes,auxUriForItem,replaceIpcoProperty,DEPTH_URI,URI_STYLES,
} from '../../web/src/core/heif.js';
import {loadProfile} from '../../web/src/core/zip.js';
import {rebuildHeic} from '../../web/src/styles/graft.js';
import {styleCapabilities} from '../../web/src/styles/style-capabilities.js';
import {addTexture} from '../../web/src/styles/texture.js';
import {fingerprintPhotoContract,sanitizeContractFingerprint} from '../../web/src/compatibility/contract-fingerprint.js';
import {classifyPhotoContract} from '../../web/src/compatibility/contract-classifier.js';
import {stripAppleEditingContract} from '../../web/src/compatibility/legacy-sanitize.js';
import {
  legacyCompatibilityExport,safeLegacyCompatibilityExport,
} from '../../web/src/compatibility/legacy-export.js';
import {
  preflightLegacyCompatibilityExport,classifyCompatibilityReason,
} from '../../web/src/compatibility/recovery-preflight.js';
import {
  contractSignature,contractSignatureFromSanitized,stableContractJson,
} from '../../web/src/compatibility/contract-signature.js';
import {
  COMPATIBILITY_ENGINE_VERSION,CONTRACT_FINGERPRINT_VERSION,CONVERSION_PLAN_VERSION,
  TARGET_REGISTRY_VERSION,COMPATIBILITY_LIMITS,
} from '../../web/src/compatibility/versions.js';
import {semanticPreservationDiff} from '../../web/src/compatibility/semantic-diff.js';
import {editingGraphCycles,protectedSemanticItemIds} from '../../web/src/compatibility/graph-policy.js';
import {verifyLegacyMutationBudget} from '../../web/src/compatibility/mutation-budget.js';
import {verifyLegacyOutput} from '../../web/src/compatibility/output-verifier.js';
import {buildLegacyConversionPlan} from '../../web/src/compatibility/conversion-plan.js';
import {legacyTarget,targetCandidatesFor,targetSupportsClassification} from '../../web/src/compatibility/target-registry.js';
import {
  selectCompatibilityAdapter,validateCompatibilityAdapter,
} from '../../web/src/compatibility/adapters/index.js';
import {CONTRACT_IDS,GENERIC_RECOVERY_STRATEGY_ID,LEGACY_BASELINE_CONTRACT_ID} from '../../web/src/compatibility/contract-registry.js';
import {executeJob} from '../../web/src/media/heic-worker.js';
import {photoContentIdentifier} from '../../web/src/media/live-photo.js';
import {createFileProcessor} from '../../web/src/app/processing/file-processor.js';

function nativeStyleExif(model='iPhone 16 Pro',{nativeTextureMarker=false}={}) {
  const value=new TextEncoder().encode(model+'\0');
  const signature=new TextEncoder().encode('Apple iOS');
  const maker=concat([signature,new Uint8Array(3),new TextEncoder().encode('MM'),be(0,2),new Uint8Array(4)]);
  const tiff=concat([
    new TextEncoder().encode('MM'),be(42,2),be(8,4),
    be(2,2),
    be(0x0110,2),be(2,2),be(value.length,4),be(76,4),
    be(0x8769,2),be(4,2),be(1,4),be(38,4),
    new Uint8Array(4),
    be(1,2),be(0x927c,2),be(7,2),be(maker.length,4),be(56,4),new Uint8Array(4),
    maker,value,
  ]);
  const base=concat([be(6,4),new TextEncoder().encode('Exif\0\0'),tiff]);
  const marker=buildBplist(new Map([
    ['0',1],['1',new BplistReal(0)],['2',new BplistReal(0)],['3',new BplistReal(1)],
    ['4',1],['5',1],['6',4],['7',0],
  ]));
  let exif=injectAppleMakerNoteTag(base,marker,0x54,7);
  if(nativeTextureMarker)exif=injectAppleMakerNoteTag(exif,new Uint8Array([0x62,0x70,0x6c,0x69,0x73,0x74]),0x65,7);
  return exif;
}

async function profilePhoto({schema=14,model='iPhone 16 Pro',nativeTextureMarker=false}={}) {
  const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
  const meta=profile.meta.slice(),d=discoverHeic(meta),chunks=[];
  let cursor=profile.ftyp.length+meta.length+8;
  for(const [id,item] of d.iloc.items){
    if(item.constructionMethod!==0||!item.extents.length)continue;
    let payload=profile.retained.get(id)||new Uint8Array([0,0,0,8,38,1,id&255,0]);
    if(id===d.exifItem)payload=nativeStyleExif(model,{nativeTextureMarker});
    if(id===d.stylesItem){
      const plist=parseBplist(payload,{preserveReals:true});
      plist.set('0',schema);
      payload=buildBplist(plist);
    }
    meta.set(be(cursor,d.iloc.offsetSize),item.extents[0].offsetPos);
    meta.set(be(payload.length,d.iloc.lengthSize),item.extents[0].lengthPos);
    cursor+=payload.length;chunks.push(payload);
  }
  return {data:concat([profile.ftyp,meta,box('mdat',concat(chunks))]),profile};
}

function readItem(bytes,d,id){
  const item=d.iloc.items.get(id);
  return item.constructionMethod===0?extractItem(bytes,d.iloc,id):idatItemBytes(bytes,id,d.meta);
}

function rewriteStylesSchema(source,schema){
  const d=discoverHeic(source);
  assert.ok(d.stylesItem!==null,'fixture needs Styles metadata');
  const plist=parseBplist(extractItem(source,d.iloc,d.stylesItem),{preserveReals:true});
  plist.set('0',schema);
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),
    source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.stylesItem,buildBplist(plist)]]));
}

function addStylesKey(source,key,value){
  const d=discoverHeic(source);
  assert.ok(d.stylesItem!==null,'fixture needs Styles metadata');
  const plist=parseBplist(extractItem(source,d.iloc,d.stylesItem),{preserveReals:true});
  plist.set(key,value);
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),
    source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.stylesItem,buildBplist(plist)]]));
}
function replaceStylesPayload(source,payload){
  const d=discoverHeic(source),ft=topBox(source,'ftyp');
  assert.ok(d.stylesItem!==null,'fixture needs Styles metadata');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),
    source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.stylesItem,payload]]));
}

function rewriteStyleMarker(source,payload,type=7){
  const d=discoverHeic(source),ft=topBox(source,'ftyp');
  assert.ok(d.exifItem!==null,'fixture needs Exif');
  const exif=injectAppleMakerNoteTag(extractItem(source,d.iloc,d.exifItem),payload,0x54,type);
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),
    source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
}

function rewriteTexturePeopleVersion(source,version){
  const d=discoverHeic(source);
  const found=[...d.infos].find(([,info])=>info.uri==='tag:apple.com,2026:photo:metadata:texture_styles');
  assert.ok(found,'fixture needs Texture metadata');
  const [id]=found,plist=parseBplist(extractItem(source,d.iloc,id),{preserveReals:true});
  plist.set('TextureStylePeopleDataVersion',version);
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),
    source.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[id,buildBplist(plist)]]));
}

function addUnknownStyleReference(source){
  const d=discoverHeic(source);
  assert.ok(d.stylesItem!==null,'fixture needs Styles metadata');
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'futureSidecar',itemType:'mime',contentType:'application/octet-stream',
    refType:'futr',refTo:[d.stylesItem],
  }]);
  const id=assigned.get('futureSidecar'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,
    new Map([[id,new Uint8Array([9,8,7,6])]]));
}

function addFutureAppleMetadata(source){
  const d=discoverHeic(source);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'futureTexture',itemType:'uri ',itemName:'metadata',
    contentType:'tag:apple.com,2028:photo:metadata:texture_styles_v2',
    refType:'cdsc',refTo:[d.primary],
  }]);
  const id=assigned.get('futureTexture');
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map([[id,new Uint8Array([1,2,3,4])]]));
}
function addFutureAppleAux(source){
  const d=discoverHeic(source);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'futureAux',itemType:'hvc1',itemName:'future auxiliary',
    uri:'tag:apple.com,2028:photo:aux:futuredepthv2',
    refType:'auxl',refTo:[d.primary],
  }]);
  const id=assigned.get('futureAux'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,
    new Map([[id,new Uint8Array([1,1,2,3,5,8])]]));
}
function addUnknownNonEssentialPrimaryProperty(source){
  const d=discoverHeic(source);
  const association=(d.props.associations.get(d.primary)||[])
    .find(entry=>!entry.essential&&d.props.properties[entry.index-1]?.type!=='ispe');
  assert.ok(association,'fixture needs a non-essential primary property');
  const meta0=source.slice(d.meta.off,d.meta.off+d.meta.size);
  const meta=replaceIpcoProperty(meta0,association.index,box('futr',new Uint8Array([0,0,0,1])));
  const ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map());
}
function addFutureDimgToDepth(source){
  const d=discoverHeic(source);
  const depth=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
  assert.ok(depth!==undefined,'fixture needs depth');
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'futureDepthController',itemType:'uri ',itemName:'metadata',
    contentType:'tag:apple.com,2028:photo:metadata:future_depth_controller',
    refType:'dimg',refTo:[depth],
  }]);
  const id=assigned.get('futureDepthController'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,
    new Map([[id,new Uint8Array([4,3,2,1])]]));
}
function addUnplannedNeutralItem(source){
  const d=discoverHeic(source);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'unexpectedNeutral',itemType:'mime',itemName:'unexpected',
    contentType:'application/octet-stream',
  }]);
  const id=assigned.get('unexpectedNeutral'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,
    new Map([[id,new Uint8Array([7,7,7,7])]]));
}
function addDuplicateStylesContract(source){
  const d=discoverHeic(source),payload=extractItem(source,d.iloc,d.stylesItem);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'duplicateStyles',itemType:'uri ',itemName:'metadata',
    contentType:URI_STYLES,refType:'cdsc',refTo:[d.primary],
  }]);
  const id=assigned.get('duplicateStyles'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,new Map([[id,payload]]));
}
function addDanglingFutureReference(source){
  const d=discoverHeic(source);
  let meta=source.slice(d.meta.off,d.meta.off+d.meta.size),assigned;
  [meta,assigned]=addItems(meta,[{
    key:'danglingFuture',itemType:'uri ',itemName:'metadata',
    contentType:'tag:apple.com,2028:photo:metadata:dangling',
    refType:'cdsc',refTo:[65534],
  }]);
  const id=assigned.get('danglingFuture'),ft=topBox(source,'ftyp');
  return rebuildHeic(source,d,source.slice(ft.off,ft.off+ft.size),meta,
    new Map([[id,new Uint8Array([9,9,9])]]));
}

const realNativeRegression=[
  'tests/private-fixtures/NativeStyles_Regression_V7/IMG_1092_A_Preserved.HEIC',
  'tests/private-fixtures/LivePhoto_0471/IMG_0471.HEIC',
  'tests/private-fixtures/Automatic_Portrait_V16/0932_Complete.HEIC',
];
test('real known iPhone 16 fixtures stay out of compatibility recovery',
  {skip:realNativeRegression.some(file=>!fs.existsSync(file))},()=>{
    for(const file of realNativeRegression){
      const data=new Uint8Array(fs.readFileSync(file)),result=classifyPhotoContract(data);
      assert.equal(result.status,'known-compatible',file);
      assert.equal(result.recovery.mode,'none',file);
      assert.equal(result.safeOperations.normalNativePipeline,true,file);
      assert.equal(result.safeOperations.legacyCompatibilityExport,false,file);
    }
  });

test('known iPhone 18 native Texture marker remains on the established preservation path',
  {skip:!fs.existsSync('tests/private-fixtures/Film_Halation_V1/IMG_0240.HEIC')},()=>{
    const data=new Uint8Array(fs.readFileSync('tests/private-fixtures/Film_Halation_V1/IMG_0240.HEIC'));
    const fp=fingerprintPhotoContract(data),result=classifyPhotoContract(data,fp);
    assert.equal(fp.camera.generation,18);
    assert.equal(fp.maker.nativeTexture,true);
    assert.equal(result.status,'known-compatible');
    assert.equal(result.recovery.mode,'none');
  });

test('sanitized contract fingerprint keeps structural evidence but removes item identifiers',async()=>{
  const {data}=await profilePhoto({schema:14});
  const safe=sanitizeContractFingerprint(fingerprintPhotoContract(data));
  assert.deepEqual(safe.roles.primarySize,[4032,3024]);
  assert.equal(safe.styles.schema,14);
  assert.equal(Object.hasOwn(safe.roles,'primary'),false);
  assert.equal(safe.apple.itemUris.every(value=>typeof value==='string'),true);
});

test('known iPhone 16 native contract stays on the existing native path',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data);
  const result=classifyPhotoContract(data,fp);
  assert.equal(fp.camera.generation,16);
  assert.equal(fp.styles.schema,14);
  assert.equal(result.status,'known-compatible');
  assert.equal(result.sourceContractId,CONTRACT_IDS.knownNative);
  assert.deepEqual(result.targetCandidates,[]);
  assert.deepEqual(result.unknownCriticalResources,[]);
  assert.equal(result.recovery.mode,'none');
  assert.equal(result.safeOperations.normalNativePipeline,true);
  assert.equal(result.safeOperations.mayAddTexture,true);
  assert.equal(result.safeOperations.legacyCompatibilityExport,false);
});

test('documented Styles flags k/l keep iPhone 16/17 native metadata on its original route',async()=>{
  for(const model of ['iPhone 16 Pro','iPhone 17 Pro']){
    for(const schema of [16,131088]){
      const {data,profile}=await profilePhoto({model,schema});
      const source=addStylesKey(addStylesKey(data,'k',false),'l',false);
      const classification=classifyPhotoContract(source);
      assert.equal(classification.status,'known-compatible');
      assert.deepEqual(classification.reasons,[]);
      assert.equal(classification.safeOperations.normalNativePipeline,true);
      const result=await legacyCompatibilityExport(source,profile);
      assert.equal(result.data,source,'known native Styles must never be rebuilt');
    }
  }
});

test('preflight rejects idat extents beyond the containing box and safe export preserves the source',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const d=discoverHeic(data),idat=findChild(metaChildren(data,d.meta),'idat');
  const primary=d.iloc.items.get(d.primary);
  assert.equal(primary.constructionMethod,1);
  const idatBytes=idat.size-idat.hdr;
  const cases=[
    {id:d.primary,offset:0x7fffffff},
    {id:d.primary,offset:idatBytes-1},
    {id:d.primary,length:idatBytes+1},
    {id:d.hdrGrid,offset:idatBytes},
    {id:d.deltaGrid,offset:idatBytes},
  ];
  for(const {id,offset,length} of cases){
    const item=d.iloc.items.get(id),malformed=data.slice();
    assert.equal(item.constructionMethod,1);
    if(offset!==undefined)malformed.set(be(offset,d.iloc.offsetSize),item.extents[0].offsetPos);
    if(length!==undefined)malformed.set(be(length,d.iloc.lengthSize),item.extents[0].lengthPos);
    const preflight=preflightLegacyCompatibilityExport(malformed);
    assert.equal(preflight.eligible,false);
    assert.ok(preflight.blockers.some(b=>b.code==='idat-out-of-bounds'&&b.detail.id===id));
    const result=await safeLegacyCompatibilityExport(malformed,profile);
    assert.equal(result.data,malformed);
    assert.equal(result.report.mode,'legacy-compatibility-preserved');
  }
  assert.equal(preflightLegacyCompatibilityExport(data).eligible,true,'valid boundary extents remain accepted');
});

test('unknown references touching primary, HDR or depth cannot enter native mutation or generic recovery',async()=>{
  const {data:base,profile}=await profilePhoto();
  const baseGraph=discoverHeic(base),baseFtyp=topBox(base,'ftyp');
  const [depthMeta,depthIds]=addItems(base.slice(baseGraph.meta.off,baseGraph.meta.off+baseGraph.meta.size),[{
    key:'depth',itemType:'hvc1',uri:DEPTH_URI,refType:'auxl',refTo:[baseGraph.primary],
  }]);
  const data=rebuildHeic(base,baseGraph,base.slice(baseFtyp.off,baseFtyp.off+baseFtyp.size),depthMeta,
    new Map([[depthIds.get('depth'),new Uint8Array([4,3,2,1])]]));
  const d=discoverHeic(data);
  const depth=[...d.infos.keys()].find(id=>auxUriForItem(d.props,id)===DEPTH_URI);
  assert.ok(depth!==undefined);
  for(const target of [d.primary,d.primaryTiles[0],d.hdrGrid,depth]){
    const ft=topBox(data,'ftyp');
    const [meta,ids]=addItems(data.slice(d.meta.off,d.meta.off+d.meta.size),[{
      key:'futureSidecar',itemType:'mime',contentType:'application/octet-stream',refType:'futr',refTo:[target],
    }]);
    const source=rebuildHeic(data,d,data.slice(ft.off,ft.off+ft.size),meta,
      new Map([[ids.get('futureSidecar'),new Uint8Array([1,2,3])]]));
    const classification=classifyPhotoContract(source);
    assert.equal(classification.status,'unknown-apple-contract');
    assert.equal(classification.safeOperations.normalNativePipeline,false);
    const preflight=preflightLegacyCompatibilityExport(source,{classification});
    assert.equal(preflight.eligible,false);
    assert.ok(preflight.blockers.some(b=>b.code==='unknown-reference-on-protected-resource'));
    const result=await safeLegacyCompatibilityExport(source,profile);
    assert.equal(result.data,source);
    assert.equal(result.report.mode,'legacy-compatibility-preserved');
  }
  // A changed thumbnail relation must be detected even though discovery no
  // longer recognizes the item as a thumbnail once thmb becomes unfamiliar.
  const iref=findChild(metaChildren(data,d.meta),'iref');
  const thumb=[...boxes(data,iref.off+iref.hdr+4,iref.off+iref.size)].find(b=>b.type==='thmb');
  const future=data.slice();
  future.set(new TextEncoder().encode('futr'),thumb.off+4);
  assert.equal(classifyPhotoContract(future).status,'unknown-apple-contract');
  assert.equal(preflightLegacyCompatibilityExport(future).eligible,false);
});

test('unrelated generic metadata references do not block the native route',async()=>{
  const {data}=await profilePhoto();
  const d=discoverHeic(data),ft=topBox(data,'ftyp');
  let [meta,ids]=addItems(data.slice(d.meta.off,d.meta.off+d.meta.size),[
    {key:'generic',itemType:'mime',contentType:'application/octet-stream'},
  ]);
  const target=ids.get('generic');
  [meta,ids]=addItems(meta,[{
    key:'genericSidecar',itemType:'mime',contentType:'application/octet-stream',refType:'futr',refTo:[target],
  }]);
  const source=rebuildHeic(data,d,data.slice(ft.off,ft.off+ft.size),meta,new Map([
    [target,new Uint8Array([1])],[ids.get('genericSidecar'),new Uint8Array([2])],
  ]));
  assert.equal(classifyPhotoContract(source).status,'known-compatible');
});

test('contract fingerprint v2 and canonical signature are deterministic without changing native routing',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data),classification=classifyPhotoContract(data,fp);
  assert.equal(fp.version,CONTRACT_FINGERPRINT_VERSION);
  assert.equal(classification.contractIdentity.engineVersion,COMPATIBILITY_ENGINE_VERSION);
  assert.equal(classification.sourceSignature,contractSignature(fp));
  assert.equal(contractSignature(fp),contractSignature(fingerprintPhotoContract(data)));
  assert.equal(contractSignatureFromSanitized(sanitizeContractFingerprint(fp)),contractSignature(fp));
  assert.equal(stableContractJson(fp),stableContractJson(fingerprintPhotoContract(data)));
  assert.match(classification.sourceSignature,/^c2-[0-9a-f]{32}$/);
  assert.ok(fp.maker.tagInventory.some(entry=>entry.tag===0x54&&entry.type===7&&entry.bytes>0));
  assert.equal(fp.maker.tagInventory.some(entry=>Object.hasOwn(entry,'payload')),false);
  assert.equal(classification.status,'known-compatible');
  const preflight=preflightLegacyCompatibilityExport(data,{classification});
  assert.equal(preflight.decision,'noop');
  assert.equal(preflight.eligible,false);
});

test('future editing-only contract passes compatibility preflight but known native never enters it',async()=>{
  const {data}=await profilePhoto({schema:999});
  const classification=classifyPhotoContract(data);
  const preflight=preflightLegacyCompatibilityExport(data,{classification});
  assert.equal(classification.status,'unknown-apple-contract');
  assert.equal(preflight.eligible,true);
  assert.equal(preflight.decision,'legacy-rebuild');
  assert.equal(preflight.sourceSignature,classification.sourceSignature);
  assert.ok(preflight.editingItems.length>0);
  assert.equal(Object.values(preflight.reasonClasses).every(value=>value==='discardable-editing-change'),true);
});

test('preflight resource limits fail closed without touching the source',async()=>{
  const {data}=await profilePhoto({schema:999});
  const limits={...COMPATIBILITY_LIMITS,maxItems:1};
  const preflight=preflightLegacyCompatibilityExport(data,{limits});
  assert.equal(preflight.eligible,false);
  assert.equal(preflight.decision,'preserve-only');
  assert.ok(preflight.blockers.some(blocker=>blocker.code==='resource-limit-exceeded'&&blocker.kind==='items'));
});

test('source byte budget is enforced before compatibility parsing',()=>{
  const malformed=new Uint8Array([1,2,3,4]);
  const limits={...COMPATIBILITY_LIMITS,maxSourceBytes:1};
  const preflight=preflightLegacyCompatibilityExport(malformed,{limits});
  assert.equal(preflight.eligible,false);
  assert.equal(preflight.decision,'preserve-only');
  assert.equal(preflight.sourceSignature,null);
  assert.deepEqual(preflight.blockers,[{
    code:'resource-limit-exceeded',kind:'source-bytes',actual:4,limit:1,
  }]);
});

test('preflight bounds per-item references, associations and URI sizes before recovery',async()=>{
  const {data}=await profilePhoto({schema:999});
  const limits={...COMPATIBILITY_LIMITS,maxUriLength:1,maxReferencesPerItem:0,maxPropertyAssociationsPerItem:0};
  const preflight=preflightLegacyCompatibilityExport(data,{limits});
  assert.equal(preflight.eligible,false);
  const kinds=new Set(preflight.blockers.filter(blocker=>blocker.code==='resource-limit-exceeded')
    .map(blocker=>blocker.kind));
  assert.ok(kinds.has('item-uri-length')||kinds.has('aux-uri-length'));
  assert.ok(kinds.has('references-per-item'));
  assert.ok(kinds.has('property-associations-per-item'));
});

test('compatibility reason risk classes keep photographic and container changes out of generic recovery',()=>{
  assert.equal(classifyCompatibilityReason('styles-schema:999'),'discardable-editing-change');
  assert.equal(classifyCompatibilityReason('unknown-nonessential-property:futr'),'discardable-editing-change');
  assert.equal(classifyCompatibilityReason('unknown-urn:urn:com:apple:photo:future'),'photographic-semantic-change');
  assert.equal(classifyCompatibilityReason('container-contract'),'container-change');
  assert.equal(classifyCompatibilityReason('something-never-seen'),'ambiguous-dependency');
});

test('target registry exposes only structurally qualified recovery targets and honors its kill switch',async()=>{
  const {data}=await profilePhoto({schema:999});
  const result=classifyPhotoContract(data);
  assert.deepEqual(result.targetCandidates,[LEGACY_BASELINE_CONTRACT_ID]);
  assert.deepEqual(targetCandidatesFor(result),[LEGACY_BASELINE_CONTRACT_ID]);
  const target=legacyTarget(result.targetCandidates[0]);
  assert.equal(target.qualification.structural,true);
  assert.equal(target.qualification.physicalApplePhotos,false);
  assert.equal(target.qualification.normalUserAvailable,false);
  assert.equal(targetSupportsClassification(target,result),true);
  assert.equal(targetSupportsClassification({...target,enabled:false,killSwitchReason:'future regression'},result),false);
});

test('adapter selector requires an exact single match and has no speculative future adapters',async()=>{
  const {data}=await profilePhoto({schema:999});
  const classification=classifyPhotoContract(data);
  assert.equal(selectCompatibilityAdapter(classification),null);
  const adapter=id=>({
    engineVersion:COMPATIBILITY_ENGINE_VERSION,
    fingerprintVersion:CONTRACT_FINGERPRINT_VERSION,
    targetRegistryVersion:TARGET_REGISTRY_VERSION,
    id,enabled:true,matchMode:'predicate',targets:[LEGACY_BASELINE_CONTRACT_ID],
    match:()=>true,extract:()=>({}),evidence:['synthetic-test-fixture'],
    capabilities:{styles:'test'},allowedMutations:{editingLayerOnly:true},informationLoss:[],
    qualification:{state:'test',physicalApplePhotos:false,normalUserAvailable:false},
  });
  assert.equal(validateCompatibilityAdapter(adapter('shape')).id,'shape');
  assert.equal(selectCompatibilityAdapter(classification,[adapter('one')]),null);
  assert.equal(selectCompatibilityAdapter(classification,[adapter('one')],{allowUnqualified:true}).id,'one');
  assert.throws(()=>selectCompatibilityAdapter(classification,[adapter('one'),adapter('two')],{allowUnqualified:true}),error=>
    error?.code==='adapter-ambiguous');
  const exact={...adapter('exact'),matchMode:'signature',sourceSignatures:[classification.sourceSignature]};
  delete exact.match;
  assert.equal(selectCompatibilityAdapter(classification,[exact],{allowUnqualified:true}).id,'exact');
  assert.equal(selectCompatibilityAdapter({...classification,sourceSignature:'c2-no-match'},[exact],{allowUnqualified:true}),null);
  assert.throws(()=>validateCompatibilityAdapter({...adapter('stale'),engineVersion:COMPATIBILITY_ENGINE_VERSION-1}),
    /engineVersion mismatch/);
});

test('a future native Texture marker appearing on iPhone 16 is isolated before legacy Texture can be grafted',async()=>{
  const {data}=await profilePhoto({schema:14,nativeTextureMarker:true});
  const fp=fingerprintPhotoContract(data);
  assert.equal(fp.maker.nativeTexture,true);
  assert.equal(fp.texture.present,false);
  const result=classifyPhotoContract(data,fp);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('future-native-texture-marker'));
  assert.equal(result.safeOperations.addTexture,false);
});

test('iPhone 16 MakerNote 0x65 remains future-contract evidence even beside a known Texture graph',async()=>{
  const {data}=await profilePhoto({schema:14});
  const textured=addTexture(data,{preserveStyles:true}).data;
  const d=discoverHeic(textured),ft=topBox(textured,'ftyp');
  const exif=extractItem(textured,d.iloc,d.exifItem);
  const withMarker=injectAppleMakerNoteTag(
    exif,new Uint8Array([0x62,0x70,0x6c,0x69,0x73,0x74]),0x65,7
  );
  const future=rebuildHeic(
    textured,d,textured.slice(ft.off,ft.off+ft.size),
    textured.slice(d.meta.off,d.meta.off+d.meta.size),
    new Map([[d.exifItem,withMarker]])
  );
  const fp=fingerprintPhotoContract(future),result=classifyPhotoContract(future,fp);
  assert.equal(fp.texture.present,true);
  assert.equal(fp.maker.nativeTexturePresent,true);
  assert.equal(result.status,'unknown-apple-contract');
  assert.ok(result.reasons.includes('future-native-texture-marker'));
  assert.equal(result.safeOperations.normalNativePipeline,false);
});

test('a future HEIF meta contract on iPhone 16 fails closed before the native pipeline',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data);
  const future={...fp,container:{...fp.container,metaVersion:1}};
  const result=classifyPhotoContract(data,future);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,false);
  assert.equal(result.recovery.mode,'preserve-only');
  assert.ok(result.reasons.includes('container-contract'));
});

test('an unknown essential HEIF property on iPhone 16 fails closed instead of guessing',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data);
  const future={...fp,container:{...fp.container,
    unknownEssentialProperties:[{id:fp.roles.primary,type:'futr'}]}};
  const result=classifyPhotoContract(data,future);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,false);
  assert.ok(result.reasons.includes('unknown-essential-property:futr'));
});

test('unknown non-essential property on a protected native resource is isolated and preflight blocks guessing',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addUnknownNonEssentialPrimaryProperty(data);
  const fp=fingerprintPhotoContract(future),classification=classifyPhotoContract(future,fp);
  assert.ok(fp.container.unknownNonEssentialProperties.some(entry=>entry.type==='futr'));
  assert.equal(classification.status,'unknown-apple-contract');
  assert.ok(classification.reasons.includes('unknown-nonessential-property:futr'));
  const preflight=preflightLegacyCompatibilityExport(future,{classification});
  assert.equal(preflight.eligible,false);
  assert.equal(preflight.decision,'preserve-only');
  assert.ok(preflight.blockers.some(blocker=>blocker.code==='unknown-property-on-protected-resource'));
});

test('editing graph may never acquire an unknown dimg dependency on preserved native depth',
  {skip:!fs.existsSync('tests/private-fixtures/Portrait_5129_Full_Baseline/IMG_5129__1__A_Original.HEIC')},()=>{
    const source=new Uint8Array(fs.readFileSync('tests/private-fixtures/Portrait_5129_Full_Baseline/IMG_5129__1__A_Original.HEIC'));
    const future=addFutureDimgToDepth(source),classification=classifyPhotoContract(future);
    assert.equal(classification.status,'unknown-apple-contract');
    const preflight=preflightLegacyCompatibilityExport(future,{classification});
    assert.equal(preflight.eligible,false);
    assert.ok(preflight.blockers.some(blocker=>blocker.code==='cross-boundary-dependency'));
  });

test('duplicate editing contract families are isolated before native mutation and remain bounded to editing recovery',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addDuplicateStylesContract(data),classification=classifyPhotoContract(future);
  assert.equal(classification.status,'unknown-apple-contract');
  assert.ok(classification.reasons.some(reason=>reason==='duplicate-editing-family:styles:2'));
  const preflight=preflightLegacyCompatibilityExport(future,{classification});
  assert.equal(preflight.eligible,true);
  assert.equal(preflight.decision,'legacy-rebuild');
});

test('dangling references in a future editing graph fail closed at preflight',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addDanglingFutureReference(data),classification=classifyPhotoContract(future);
  assert.equal(classification.status,'unknown-apple-contract');
  const preflight=preflightLegacyCompatibilityExport(future,{classification});
  assert.equal(preflight.eligible,false);
  assert.ok(preflight.blockers.some(blocker=>blocker.code==='dangling-reference-target'));
});

test('editing graph cycle detector rejects recursive dimg relationships',()=>{
  const d={refs:[
    {type:'dimg',from:1,to:[2]},{type:'dimg',from:2,to:[3]},{type:'dimg',from:3,to:[1]},
  ]};
  const cycles=editingGraphCycles(d,new Set([1,2,3]));
  assert.ok(cycles.length>0);
});

test('future container variants outside known iloc/iref/ipma/codec assumptions remain preserve-only',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data);
  const variants=[
    {...fp,container:{...fp.container,irefVersion:1}},
    {...fp,container:{...fp.container,ipma:{...fp.container.ipma,flags:1}}},
    {...fp,container:{...fp.container,iloc:{...fp.container.iloc,offsetSize:8}}},
    {...fp,roles:{...fp.roles,primaryTileTypes:['av01']}},
  ];
  for(const future of variants){
    const result=classifyPhotoContract(data,future);
    assert.equal(result.status,'unknown-apple-contract');
    assert.equal(result.recovery.eligible,false);
    assert.equal(result.recovery.mode,'preserve-only');
    assert.ok(result.reasons.includes('container-contract'));
  }
});

test('future Styles schema on iPhone 16 is isolated from the current native mutators',async()=>{
  const {data}=await profilePhoto({schema:999});
  const fp=fingerprintPhotoContract(data);
  const result=classifyPhotoContract(data,fp);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.sourceContractId,CONTRACT_IDS.unknownApple);
  assert.equal(result.recovery.mode,'legacy-rebuild');
  assert.equal(result.recovery.strategyId,GENERIC_RECOVERY_STRATEGY_ID);
  assert.equal(result.recovery.eligible,true);
  assert.deepEqual(result.targetCandidates,[LEGACY_BASELINE_CONTRACT_ID]);
  assert.equal(result.safeOperations.normalNativePipeline,false);
  assert.equal(result.safeOperations.addTexture,false);
  assert.equal(result.safeOperations.repairTexture,false);
  assert.equal(result.safeOperations.softSkin,false);
  assert.equal(result.safeOperations.aiPortrait,false);
  assert.equal(result.safeOperations.legacyCompatibilityExport,true);
  assert.equal(result.safeOperations.mayLegacyExport,true);
});

test('an unreadable Styles payload on iPhone 16 fails into compatibility recovery instead of native mutation',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=replaceStylesPayload(data,Uint8Array.of(1,2,3,4,5));
  const fp=fingerprintPhotoContract(future),result=classifyPhotoContract(future,fp);
  assert.equal(fp.styles.readable,false);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('styles-unreadable'));
  assert.equal(result.safeOperations.normalNativePipeline,false);
});

test('a new Styles key on an otherwise known iPhone 16 schema is treated as a future contract',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addStylesKey(data,'futureField',new Uint8Array([1,2,3]));
  const fp=fingerprintPhotoContract(future),result=classifyPhotoContract(future,fp);
  assert.deepEqual(fp.styles.unknownKeys,['futureField']);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('styles-key:futureField'));
});

test('a new 0x54 field on an otherwise valid style marker is isolated before native mutation',async()=>{
  const {data}=await profilePhoto({schema:14});
  const d=discoverHeic(data);
  const current=parseBplist(extractAppleMakerNoteTag(extractItem(data,d.iloc,d.exifItem),0x54).payload);
  current.set('futureSelectionField',1);
  const future=rewriteStyleMarker(data,buildBplist(current));
  const fp=fingerprintPhotoContract(future),result=classifyPhotoContract(future,fp);
  assert.equal(fp.maker.styleSelection,true);
  assert.deepEqual(fp.maker.styleSelectionUnknownKeys,['futureSelectionField']);
  assert.equal(result.status,'unknown-apple-contract');
  assert.ok(result.reasons.includes('style-selection-key:futureSelectionField'));
});

test('a changed 0x54 style-selection contract on iPhone 16 is isolated even when the Styles schema is still known',async()=>{
  const {data}=await profilePhoto({schema:14});
  const futureMarker=buildBplist(new Map([['0',2],['futureSelection',99]]));
  const future=rewriteStyleMarker(data,futureMarker);
  const fp=fingerprintPhotoContract(future),result=classifyPhotoContract(future,fp);
  assert.equal(fp.styles.known,true);
  assert.equal(fp.maker.styleSelectionPresent,true);
  assert.equal(fp.maker.styleSelection,false);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('style-selection-contract'));
});

test('duplicate MakerNote tags on iPhone 16 fail closed instead of entering generic recovery',async()=>{
  const {data}=await profilePhoto({schema:14});
  const fp=fingerprintPhotoContract(data);
  const future={...fp,maker:{...fp.maker,duplicateTags:[0x54]}};
  const result=classifyPhotoContract(data,future);
  assert.equal(result.status,'unknown-apple-contract');
  assert.ok(result.reasons.includes('duplicate-makernote-tag:0x54'));
  const preflight=preflightLegacyCompatibilityExport(data,{classification:result});
  assert.equal(preflight.eligible,false);
  assert.ok(preflight.blockers.some(blocker=>blocker.code==='non-editing-contract-change'
    &&blocker.detail?.reason==='duplicate-makernote-tag:0x54'));
});

test('legacy export falls back to the known profile marker when a future 0x54 payload is not understood',async()=>{
  const {data,profile}=await profilePhoto({schema:14});
  const future=rewriteStyleMarker(data,buildBplist(new Map([['0',2],['futureSelection',99]])));
  const output=await legacyCompatibilityExport(future,profile,{texture:false,experimental:true});
  const d=discoverHeic(output.data);
  const marker=parseBplist(extractAppleMakerNoteTag(extractItem(output.data,d.iloc,d.exifItem),0x54).payload);
  assert.equal(output.report.patch.styleSelectionCompatibility,'legacy-profile-marker');
  assert.equal(marker.get('0'),1);
  assert.equal(marker.get('4'),1);
  assert.equal(classifyPhotoContract(output.data).status,'known-compatible');
});

test('legacy export removes a future native Texture marker before installing the legacy Texture target',async()=>{
  const {data,profile}=await profilePhoto({schema:14,nativeTextureMarker:true});
  const output=await legacyCompatibilityExport(data,profile,{experimental:true});
  const fp=fingerprintPhotoContract(output.data);
  assert.equal(fp.maker.nativeTexturePresent,false);
  assert.equal(fp.texture.present,true);
  assert.deepEqual(output.report.sanitizer.removedMakerTags,['0x65']);
  assert.ok(output.report.plan.allowedExifChanges.some(value=>value.includes('0x65')));
  assert.equal(classifyPhotoContract(output.data).status,'known-compatible');
});

test('a changed Texture payload version on iPhone 16 is treated as a future contract',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const baseline=(await legacyCompatibilityExport(data,profile,{experimental:true})).data;
  assert.equal(classifyPhotoContract(baseline).status,'known-compatible');
  const future=rewriteTexturePeopleVersion(baseline,4);
  const fp=fingerprintPhotoContract(future);
  assert.equal(fp.texture.present,true);
  assert.equal(fp.texture.peopleVersion,4);
  assert.equal(fp.texture.known,false);
  const result=classifyPhotoContract(future,fp);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('texture-people-version:4'));
});

test('a new reference type attached to the Styles graph is treated as a future editing contract',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addUnknownStyleReference(data),fp=fingerprintPhotoContract(future);
  assert.deepEqual(fp.apple.unknownReferenceTypes,['futr']);
  const result=classifyPhotoContract(future,fp);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
  assert.ok(result.reasons.includes('unknown-edit-reference:futr'));
});

test('future Apple tag namespace is detected even when Styles schema itself is known',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addFutureAppleMetadata(data);
  const fp=fingerprintPhotoContract(future);
  assert.deepEqual(fp.apple.unknownTagUris,['tag:apple.com,2028:photo:metadata:texture_styles_v2']);
  const result=classifyPhotoContract(future,fp);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,true);
});

test('unknown future Apple auxiliary tag is treated as photographic and preserved instead of stripped',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addFutureAppleAux(data),classification=classifyPhotoContract(future);
  assert.equal(classification.status,'unknown-apple-contract');
  assert.ok(classification.reasons.includes('unknown-tag:tag:apple.com,2028:photo:aux:futuredepthv2'));
  const preflight=preflightLegacyCompatibilityExport(future,{classification});
  assert.equal(preflight.eligible,false);
  assert.equal(preflight.decision,'preserve-only');
  assert.equal(preflight.reasonClasses['unknown-tag:tag:apple.com,2028:photo:aux:futuredepthv2'],
    'photographic-semantic-change');
});

test('unknown future Apple contract on non-16/17 hardware fails closed instead of entering recovery',async()=>{
  const {data,profile}=await profilePhoto({schema:999,model:'iPhone 15 Pro'});
  const result=classifyPhotoContract(data);
  assert.equal(result.status,'unknown-apple-contract');
  assert.equal(result.recovery.eligible,false);
  assert.equal(result.safeOperations.legacyCompatibilityExport,false);
  await assert.rejects(()=>legacyCompatibilityExport(data,profile),error=>error?.code==='unknown-source-contract');
});

test('compatibility sanitizer removes unknown sidecars that depend only on the discarded editing graph',async()=>{
  const {data}=await profilePhoto({schema:14});
  const future=addUnknownStyleReference(data);
  const result=stripAppleEditingContract(future),after=discoverHeic(result.data);
  assert.equal(after.refs.some(ref=>ref.type==='futr'),false);
  assert.equal(after.stylesItem,null);
  assert.ok(result.report.removedItems>1);
});

test('compatibility sanitizer removes Apple editing graph while preserving photographic payloads',async()=>{
  const {data}=await profilePhoto({schema:999});
  const future=addFutureAppleMetadata(data),before=discoverHeic(future);
  const primary=readItem(future,before,before.primary);
  const hdr=before.hdrGrid===null?null:readItem(future,before,before.hdrGrid);
  const result=stripAppleEditingContract(future);
  const after=discoverHeic(result.data);
  assert.equal(after.stylesItem,null);
  assert.equal(after.linearThumb,null);
  assert.equal(after.deltaGrid,null);
  assert.deepEqual(readItem(result.data,after,after.primary),primary);
  if(hdr)assert.deepEqual(readItem(result.data,after,after.hdrGrid),hdr);
  const appleTags=[...after.infos.values()].map(i=>i.uri).filter(u=>u?.startsWith('tag:apple.com'));
  const appleAux=[...after.infos.keys()].map(id=>auxUriForItem(after.props,id)).filter(u=>u?.startsWith('tag:apple.com'));
  assert.deepEqual(appleTags,[]);
  assert.deepEqual(appleAux,[]);
  assert.ok(result.report.removedItems>0);
});

test('real iPhone 16 Pro 24 MP/HDR payloads survive a simulated future Styles schema rebuild',
  {skip:!fs.existsSync('tests/private-fixtures/NativeStyles_Regression_V7/IMG_1092_A_Preserved.HEIC')},async()=>{
    const source=new Uint8Array(fs.readFileSync('tests/private-fixtures/NativeStyles_Regression_V7/IMG_1092_A_Preserved.HEIC'));
    const future=rewriteStylesSchema(source,999);
    const before=discoverHeic(future);
    const sourceFingerprint=fingerprintPhotoContract(source);
    assert.ok(sourceFingerprint.maker.tagInventory.some(entry=>entry.type===16),
      'real Apple MakerNote extended TIFF type 16 must remain readable');
    assert.equal(classifyPhotoContract(future).recovery.eligible,true);
    assert.equal(before.primaryTiles.length,45);
    assert.equal(before.hdrTiles.length,15);
    const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
    const output=await legacyCompatibilityExport(future,profile,{experimental:true});
    const after=discoverHeic(output.data);
    assert.equal(classifyPhotoContract(output.data).status,'known-compatible');
    assert.deepEqual(readItem(output.data,after,after.primary),readItem(future,before,before.primary));
    assert.deepEqual(readItem(output.data,after,after.hdrGrid),readItem(future,before,before.hdrGrid));
    for(const id of before.primaryTiles)assert.deepEqual(readItem(output.data,after,id),readItem(future,before,id));
    for(const id of before.hdrTiles)assert.deepEqual(readItem(output.data,after,id),readItem(future,before,id));
  });

test('legacy recovery preserves the Live Photo content identifier when present',
  {skip:!fs.existsSync('tests/private-fixtures/LivePhoto_0471/IMG_0471.HEIC')},async()=>{
    const source=new Uint8Array(fs.readFileSync('tests/private-fixtures/LivePhoto_0471/IMG_0471.HEIC'));
    const identifier=photoContentIdentifier(source);
    assert.ok(identifier);
    const future=rewriteStylesSchema(source,999);
    const profile=await loadProfile(new Uint8Array(fs.readFileSync(new URL('../../web/profiles/48-12.zip',import.meta.url))));
    const output=await legacyCompatibilityExport(future,profile,{experimental:true});
    assert.equal(photoContentIdentifier(output.data),identifier);
    assert.deepEqual(output.report.semanticPreservation.changed,[]);
  });

test('legacy conversion plan v3 is deterministic and declares the complete two-way mutation budget',async()=>{
  const {data}=await profilePhoto({schema:999});
  const classification=classifyPhotoContract(data);
  const preflight=preflightLegacyCompatibilityExport(data,{classification});
  const options={targetId:LEGACY_BASELINE_CONTRACT_ID,targetProfileName:'48-12',texture:true,
    generatedLinearThumbnail:false,preflight};
  const a=buildLegacyConversionPlan(classification,options),b=buildLegacyConversionPlan(classification,options);
  assert.deepEqual(a,b);
  assert.equal(a.version,CONVERSION_PLAN_VERSION);
  assert.equal(a.engineVersion,COMPATIBILITY_ENGINE_VERSION);
  assert.equal(a.sourceContractId,CONTRACT_IDS.unknownApple);
  assert.equal(a.sourceSignature,classification.sourceSignature);
  assert.equal(a.recoveryStrategyId,GENERIC_RECOVERY_STRATEGY_ID);
  assert.ok(a.planId.includes(LEGACY_BASELINE_CONTRACT_ID));
  assert.deepEqual(a.translate,[]);
  assert.ok(a.propertiesChanged.length);
  assert.ok(a.referencesChanged.length);
  assert.deepEqual(a.allowedRemovedIds,preflight.editingItems);
  assert.ok(a.allowedAddedFamilies.includes('target-editing-descendants'));
  assert.equal(a.mutationBudget.preserveSourcePhotoPayloads,true);
  assert.equal(a.mutationBudget.preserveProtectedTopology,true);
  assert.equal(a.mutationBudget.forbidUnplannedOutputItems,true);
  assert.equal(a.mutationBudget.preserveUnlistedMakerNoteTags,true);
});

test('output self-check recognizes one complete target contract without duplicate editing families',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{experimental:true});
  const check=verifyLegacyOutput(output.data);
  assert.equal(check.status,'known-compatible');
  assert.equal(check.editable,true);
  assert.equal(check.families.styles,1);
  assert.equal(check.families.texture,1);
  assert.ok(check.families.linearThumbnail<=1);
  assert.ok(check.families.styleDelta<=1);
  assert.deepEqual(output.report.selfCheck,check);
  assert.match(output.report.target.signature,/^c2-[0-9a-f]{32}$/);
  assert.ok(output.report.sanitizer.verification);
  assert.ok(output.report.preservation.exifFields>0);
  assert.deepEqual(output.report.sanitizer.removedIds,output.report.plan.allowedRemovedIds);
});

test('output self-check requires Texture exactly when the conversion plan requests it',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{texture:false,experimental:true});
  assert.equal(output.report.selfCheck.families.styles,1);
  assert.equal(output.report.selfCheck.families.texture,0);
  assert.equal(verifyLegacyOutput(output.data,{expectTexture:false}).families.texture,0);
  assert.throws(()=>verifyLegacyOutput(output.data,{expectTexture:true}),
    error=>error?.code==='target-classification-failed'&&/Texture contract/.test(error.message));
});

test('successful compatibility export records semantic preservation by protected role',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{texture:false,experimental:true});
  assert.equal(output.report.engineVersion,COMPATIBILITY_ENGINE_VERSION);
  assert.equal(output.report.preflight.eligible,true);
  assert.deepEqual(output.report.semanticPreservation.changed,[]);
  assert.deepEqual(output.report.semanticPreservation.payloadChanged,[]);
  assert.deepEqual(output.report.semanticPreservation.topologyChanged,[]);
  const diff=semanticPreservationDiff(data,output.data);
  assert.deepEqual(diff.changed,[]);
  assert.deepEqual(diff.topologyChanged,[]);
});

test('safe compatibility wrapper is atomic and returns exact source bytes when preflight refuses mutation',async()=>{
  const {data,profile}=await profilePhoto({schema:14});
  const future=addUnknownNonEssentialPrimaryProperty(data);
  const output=await safeLegacyCompatibilityExport(future,profile,{experimental:true});
  assert.equal(output.data,future);
  assert.equal(output.report.mode,'legacy-compatibility-preserved');
  assert.ok(['ambiguous-dependency','preflight-failed'].includes(output.report.failure.code));
});

test('mutation budget uses the plan MakerNote allowlist as the authority',async()=>{
  const {data}=await profilePhoto({schema:14,nativeTextureMarker:true});
  const classification=classifyPhotoContract(data);
  const preflight=preflightLegacyCompatibilityExport(data,{classification});
  const plan=buildLegacyConversionPlan(classification,{preflight,texture:true});
  const sanitized=stripAppleEditingContract(data,{removeMakerTags:[0x65]});
  assert.ok(plan.allowedMakerNoteTags.includes('0x65'));
  assert.doesNotThrow(()=>verifyLegacyMutationBudget(data,sanitized.data,{
    removedIds:sanitized.report.removedIds,removedMakerTags:[0x65],plan,
  }));
  const forbidden={...plan,allowedMakerNoteTags:['0x54']};
  assert.throws(()=>verifyLegacyMutationBudget(data,sanitized.data,{
    removedIds:sanitized.report.removedIds,removedMakerTags:[0x65],plan:forbidden,
  }),error=>error?.code==='mutation-budget-violation'&&/undeclared Apple MakerNote tag/.test(error.message));
});

test('mutation budget rejects an accidental change to a preserved primary tile',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{texture:false,experimental:true});
  const d=discoverHeic(output.data),tile=d.primaryTiles[0],payload=readItem(output.data,d,tile).slice();
  payload[payload.length-1]^=1;
  const ft=topBox(output.data,'ftyp');
  const corrupted=rebuildHeic(output.data,d,output.data.slice(ft.off,ft.off+ft.size),
    output.data.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[tile,payload]]));
  assert.throws(()=>verifyLegacyMutationBudget(data,corrupted,{
    removedIds:output.report.sanitizer.removedIds,
    removedMakerTags:[],
  }),error=>error?.code==='mutation-budget-violation'&&/changed undeclared source item/.test(error.message));
});

test('protected photo closure recursively includes depth dimg descendants',()=>{
  const d={
    primary:1,primaryTiles:[2],hdrGrid:null,hdrTiles:[],thumbnail:null,exifItem:3,
    infos:new Map([[1,{type:'grid'}],[2,{type:'hvc1'}],[3,{type:'Exif'}],
      [20,{type:'grid'}],[21,{type:'grid'}],[22,{type:'hvc1'}]]),
    props:{
      properties:[{type:'auxC',auxUri:DEPTH_URI}],
      associations:new Map([[20,[{index:1,essential:true}]]]),
    },
    refs:[
      {type:'dimg',from:1,to:[2]},
      {type:'dimg',from:20,to:[21]},
      {type:'dimg',from:21,to:[22]},
    ],
  };
  const protectedIds=protectedSemanticItemIds(d);
  assert.ok(protectedIds.has(20),'depth grid must be protected');
  assert.ok(protectedIds.has(21),'nested depth grid must be protected');
  assert.ok(protectedIds.has(22),'depth HEVC tile must be protected through dimg closure');
});

test('mutation budget rejects capture Exif changes outside the declared MakerNote edits',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{texture:false,experimental:true});
  const d=discoverHeic(output.data),exif=readItem(output.data,d,d.exifItem).slice();
  const needle=new TextEncoder().encode('iPhone 16 Pro');
  let at=-1;
  outer:for(let i=0;i<=exif.length-needle.length;i++){
    for(let j=0;j<needle.length;j++)if(exif[i+j]!==needle[j])continue outer;
    at=i;break;
  }
  assert.ok(at>=0,'camera model must be present in synthetic Exif');
  exif[at]^=1;
  const ft=topBox(output.data,'ftyp');
  const corrupted=rebuildHeic(output.data,d,output.data.slice(ft.off,ft.off+ft.size),
    output.data.slice(d.meta.off,d.meta.off+d.meta.size),new Map([[d.exifItem,exif]]));
  assert.throws(()=>verifyLegacyMutationBudget(data,corrupted,{
    removedIds:output.report.sanitizer.removedIds,
    removedMakerTags:[],
    plan:output.report.plan,
  }),error=>error?.code==='mutation-budget-violation'
    &&/capture Exif metadata outside Apple MakerNote/.test(error.message));
});

test('two-way mutation budget rejects any unplanned output resource',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{texture:false,experimental:true});
  const corrupted=addUnplannedNeutralItem(output.data);
  assert.throws(()=>verifyLegacyMutationBudget(data,corrupted,{
    removedIds:output.report.sanitizer.removedIds,
    removedMakerTags:[],
    plan:output.report.plan,
  }),error=>error?.code==='mutation-budget-violation'
    &&/undeclared output item/.test(error.message));
});

test('HEIC worker preserves bytes when a future HEIC container is recognizable but not yet parseable',async()=>{
  const text=value=>new TextEncoder().encode(value);
  const bytes=box('ftyp',concat([text('heic'),new Uint8Array(4),text('mif1')]));
  const file={arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const result=await executeJob({operation:'read',file},async()=>{throw Error('decode should not run');});
  assert.equal(result.format,'heic');
  assert.equal(result.discovery,null);
  assert.ok(result.discoveryError);
  assert.deepEqual(result.bytes,bytes);
});

test('web processing keeps unknown Apple contracts outside mature native interpreters until firewall decision',()=>{
  const source=fs.readFileSync(new URL('../../web/src/app/processing/file-processor.js',import.meta.url),'utf8');
  const classifyAt=source.indexOf('const {compatibility,compatibilityPreflight}=input');
  const nativeStyleAt=source.indexOf('preserveNativeStyles(bytes,d)');
  assert.ok(classifyAt>=0&&nativeStyleAt>classifyAt);
  assert.match(source,/if\(!compatibility\|\|input\.compatibilityError\)\{preserveUnsupportedApple/);
  assert.match(source,/const textureOnly=unknownAppleContract\?false:preserveNativeStyles\(bytes,d\)/);
  assert.match(source,/const nativeTexture=unknownAppleContract\?false:nativeTextureCapture\(bytes,d\)/);
  assert.match(source,/if\(!unknownAppleContract\)\{\s*const \{nativePortraitBaseState\}=await import/);
  assert.doesNotMatch(source,/classifyPhotoContract|preflightLegacyCompatibilityInWorker/);
  assert.match(source,/if \(!preserveIncomplete&&!compatibilityRecovered\)\{/);
  assert.doesNotMatch(source,/if\(compatibilityRecovered\)await tryAiPortrait/);
  assert.match(source,/if\(!unknownAppleContract\)\{await releaseConversion\(\);await tryAiPortrait\(bytes,shareFile/);
});

test('read worker returns classification and preflight alongside the parsed HEIC',async()=>{
  for(const schema of [14,999]){
    const {data}=await profilePhoto({schema});
    const file=new File([data],'source.HEIC',{type:'image/heic'});
    const result=await executeJob({operation:'read',file});
    assert.equal(result.compatibilityError,null);
    assert.deepEqual(result.compatibility,classifyPhotoContract(data));
    assert.equal(result.discovery.primary,discoverHeic(data).primary);
    if(schema===999){
      assert.equal(result.compatibilityPreflight.eligible,true);
      assert.equal(result.compatibilityPreflight.sourceSignature,result.compatibility.sourceSignature);
    }else assert.equal(result.compatibilityPreflight,null);
  }
  const raster=await executeJob({operation:'read',file:new File([new Uint8Array([0xff,0xd8,0xff])],'a.jpg')});
  assert.equal(raster.compatibility,null);
  assert.equal(raster.compatibilityPreflight,null);
});

test('processing publishes one downloadable file and completes every compatibility outcome',async context=>{
  const {data,profile}=await profilePhoto({schema:999});
  const {data:otherCamera}=await profilePhoto({schema:999,model:'iPhone 18 Pro'});
  const blocked=addUnknownNonEssentialPrimaryProperty(data);
  const unparseable=box('ftyp',concat([new TextEncoder().encode('heic'),new Uint8Array(4),new TextEncoder().encode('mif1')]));
  const scenarios=[
    {name:'successful recovery',source:data,suffix:'_LegacyCompatible.HEIC',operations:['read','legacy-compatibility'],features:true},
    {name:'preserve-only camera',source:otherCamera,suffix:'_Preserved.HEIC',operations:['read'],preserved:true},
    {name:'preflight blocked',source:blocked,suffix:'_Preserved.HEIC',operations:['read'],preserved:true},
    {name:'profile failure',source:data,suffix:'_Preserved.HEIC',operations:['read'],preserved:true,profileFailure:true},
    {name:'builder failure',source:data,suffix:'_Preserved.HEIC',operations:['read','legacy-compatibility'],preserved:true,builderFailure:true},
    {name:'unparseable source',source:unparseable,suffix:'_Preserved.HEIC',operations:['read'],preserved:true},
    {name:'classification failure',source:data,suffix:'_Preserved.HEIC',operations:['read'],preserved:true,classificationFailure:true},
  ];
  for(const scenario of scenarios)await context.test(scenario.name,async t=>{
    const originalWorker=globalThis.Worker,operations=[],outputs=[],progress=[],busy=[],states=[];
    let profileLoads=0;
    t.mock.method(console,'warn',()=>{});
    globalThis.Worker=class {
      postMessage(job){
        operations.push(job.operation);
        queueMicrotask(async()=>{
          try{
            if(scenario.builderFailure&&job.operation==='legacy-compatibility')throw Error('builder failed');
            const result=await executeJob(structuredClone(job),()=>assert.fail('unexpected decode'));
            if(scenario.classificationFailure&&job.operation==='read'){
              result.compatibility=null;result.compatibilityError='classification failed';
            }
            this.onmessage({data:{id:job.id,result:structuredClone(result)}});
          }catch(error){this.onmessage({data:{id:job.id,error:error.message}});}
        });
      }
      terminate(){}
    };
    const ui={
      set:(...args)=>states.push(args),note(){},compatibilityReport(){},portraitAdvice(){},
      metadata:async()=>{},output:file=>outputs.push(file),progress:value=>progress.push(value),aiBusy:value=>busy.push(value),
    };
    try{
      const processor=createFileProcessor({
        row:()=>ui,T:key=>key,getLanguage:()=> 'en',aiText:()=>({}),aiFeatures:{enabled:()=>scenario.features===true},
        gpuAcceleration:{checked:false},selectedAiLevel:()=> 'standard',
        liveMovies:new Map(),livePhotos:[],attachMovie(){},handleMovie:()=>assert.fail('unexpected movie'),
        ensureProfileIndex:async()=>({'48-12':{primary_tiles:48,hdr_tiles:12}}),
        getProfile:async()=>{profileLoads++;if(scenario.profileFailure)throw Error('profile unavailable');return profile;},
        tryAiPortrait:()=>assert.fail('unknown contract must skip Portrait'),
        analysis:{ensureDecode:async()=>false,addMissingSoftSkin:()=>assert.fail('unknown contract must skip Soft Skin'),adaptiveStyleCompletionNotice(){}},
      });
      await processor.handleFile(new File([scenario.source],'source.HEIC',{type:'image/heic',lastModified:1234}));
      assert.equal(outputs.length,1,'result must be downloadable exactly once');
      assert.equal(outputs[0].name,'source'+scenario.suffix);
      assert.equal(progress.at(-1),100);
      assert.equal(busy.at(-1),false);
      assert.equal(states.some(([,kind])=>kind==='err'),false);
      assert.deepEqual(operations,scenario.operations,'classification/preflight must share the read job');
      if(scenario.preserved)assert.deepEqual(new Uint8Array(await outputs[0].arrayBuffer()),scenario.source);
      else assert.equal(classifyPhotoContract(new Uint8Array(await outputs[0].arrayBuffer())).status,'known-compatible');
      if(scenario.operations.length===1&&!scenario.profileFailure)assert.equal(profileLoads,0,'blocked input must not load profiles');
    }finally{
      if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
    }
  });
});

test('HEIC worker exposes compatibility preflight without mutating bytes',async()=>{
  const {data}=await profilePhoto({schema:999});
  const result=await executeJob({operation:'legacy-compatibility-preflight',data,opts:{}},
    async()=>{throw Error('decode should not run');});
  assert.equal(result.eligible,true);
  assert.equal(result.decision,'legacy-rebuild');
  assert.equal(result.sourceSignature,classifyPhotoContract(data).sourceSignature);
});

test('HEIC worker safe compatibility operation preserves exact source on a blocked future contract',async()=>{
  const {data,profile}=await profilePhoto({schema:14});
  const future=addUnknownNonEssentialPrimaryProperty(data);
  const result=await executeJob({operation:'legacy-compatibility-safe',data:future,profile,
    opts:{texture:false,experimental:true,decode:false}},async()=>{throw Error('decode should not run');});
  assert.equal(result.data,future);
  assert.equal(result.report.mode,'legacy-compatibility-preserved');
});

test('HEIC worker exposes the legacy compatibility operation without changing the recovery contract',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const result=await executeJob({operation:'legacy-compatibility',data,profile,
    opts:{texture:false,experimental:true,decode:false}},async()=>{throw Error('decode should not run');});
  assert.equal(result.report.mode,'legacy-compatibility-export');
  assert.equal(result.report.hdrCompatibility,undefined);
  assert.equal(classifyPhotoContract(result.data).status,'known-compatible');
  assert.equal(styleCapabilities(result.data).editable,true);
  assert.deepEqual(result.report.semanticPreservation.changed,[]);
});

test('legacy compatibility export rebuilds a known Texture contract by default',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const output=await legacyCompatibilityExport(data,profile,{experimental:true,targetProfileName:'48-12'});
  const d=discoverHeic(output.data);
  assert.equal(output.report.target.profileName,'48-12');
  assert.equal(output.report.plan.targetProfileName,'48-12');
  assert.equal([...d.infos.values()].some(i=>i.uri==='tag:apple.com,2026:photo:metadata:texture_styles'),true);
  assert.equal(classifyPhotoContract(output.data).status,'known-compatible');
});

test('legacy compatibility export rebuilds unknown iPhone 16 editing metadata into a known contract without touching primary/HDR payloads',async()=>{
  const {data,profile}=await profilePhoto({schema:999});
  const future=addFutureAppleMetadata(data),before=discoverHeic(future);
  const primary=readItem(future,before,before.primary);
  const hdr=before.hdrGrid===null?null:readItem(future,before,before.hdrGrid);
  const output=await legacyCompatibilityExport(future,profile,{texture:false,experimental:true});
  assert.equal(output.report.mode,'legacy-compatibility-export');
  assert.equal(output.report.source.status,'unknown-apple-contract');
  assert.equal(styleCapabilities(output.data).editable,true);
  const after=discoverHeic(output.data);
  assert.ok(after.stylesItem!==null);
  assert.deepEqual(readItem(output.data,after,after.primary),primary);
  if(hdr)assert.deepEqual(readItem(output.data,after,after.hdrGrid),hdr);
  assert.equal([...after.infos.values()].some(i=>i.uri==='tag:apple.com,2028:photo:metadata:texture_styles_v2'),false);
  const second=await legacyCompatibilityExport(output.data,profile,{texture:false,experimental:true});
  assert.equal(second.data,output.data);
  assert.equal(second.report.mode,'legacy-compatibility-noop');
});
