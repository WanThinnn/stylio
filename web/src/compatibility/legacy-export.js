import {patch} from '../styles/port.js';
import {discoverHeic,extractItem,idatItemBytes,propertyBoxBytes} from '../core/heif.js';
import {classifyPhotoContract} from './contract-classifier.js';
import {fingerprintPhotoContract} from './contract-fingerprint.js';
import {stripAppleEditingContract} from './legacy-sanitize.js';
import {buildLegacyConversionPlan} from './conversion-plan.js';
import {verifyLegacyMutationBudget} from './mutation-budget.js';
import {LEGACY_BASELINE_CONTRACT_ID} from './contract-registry.js';
import {legacyTarget} from './target-registry.js';
import {verifyLegacyOutput} from './output-verifier.js';
import {COMPATIBILITY_ERROR,compatibilityError} from './errors.js';
import {preflightLegacyCompatibilityExport} from './recovery-preflight.js';
import {verifySemanticPreservation} from './semantic-diff.js';
import {contractSignature} from './contract-signature.js';
import {
  COMPATIBILITY_ENGINE_VERSION,COMPATIBILITY_REPORT_VERSION,COMPATIBILITY_LIMITS,
} from './versions.js';

function preflightFailureCode(preflight){
  if(preflight.blockers.some(blocker=>blocker.code==='resource-limit-exceeded'))
    return COMPATIBILITY_ERROR.RESOURCE_LIMIT_EXCEEDED;
  if(preflight.blockers.some(blocker=>[
    'cross-boundary-dependency','unknown-property-on-protected-resource',
    'unknown-property-on-preserved-resource','editing-graph-cycle','unknown-reference-on-protected-resource',
  ].includes(blocker.code)))return COMPATIBILITY_ERROR.AMBIGUOUS_DEPENDENCY;
  return COMPATIBILITY_ERROR.PREFLIGHT_FAILED;
}
function reportBase(mode){
  return {version:COMPATIBILITY_REPORT_VERSION,engineVersion:COMPATIBILITY_ENGINE_VERSION,mode};
}
function profileLinearThumbnail(profile){
  const id=Number(profile?.manifest?.donor_linear_thumb_item);
  if(!Number.isInteger(id))throw new Error('Legacy target profile has no linear thumbnail');
  const d=discoverHeic(profile.meta),item=d.iloc.items.get(id);
  if(!item)throw new Error('Legacy target linear thumbnail item is missing');
  const sample=profile.retained.get(id)||(item.constructionMethod===1
    ?idatItemBytes(profile.meta,id,d.meta):extractItem(profile.meta,d.iloc,id));
  const hvcC=propertyBoxBytes(profile.meta,d.props,id,'hvcC');
  const ispe=propertyBoxBytes(profile.meta,d.props,id,'ispe');
  const pixi=propertyBoxBytes(profile.meta,d.props,id,'pixi');
  if(!sample||!hvcC||!ispe||!pixi)throw new Error('Legacy target linear thumbnail is incomplete');
  return {sample,hvcC,ispe,pixi};
}

export async function legacyCompatibilityExport(source,profile,opts={}){
  if(source.length>COMPATIBILITY_LIMITS.maxSourceBytes)
    throw compatibilityError(COMPATIBILITY_ERROR.RESOURCE_LIMIT_EXCEEDED,
      'Legacy compatibility source exceeds the supported size budget',{
        actual:source.length,limit:COMPATIBILITY_LIMITS.maxSourceBytes,
      });
  const discovery=discoverHeic(source);
  const sourceClassification=classifyPhotoContract(source,fingerprintPhotoContract(source,discovery));
  if(sourceClassification.status!=='unknown-apple-contract'){
    return {data:source,report:{...reportBase('legacy-compatibility-noop'),source:sourceClassification,
      target:sourceClassification.status==='known-compatible'?LEGACY_BASELINE_CONTRACT_ID:null}};
  }
  if(!sourceClassification.recovery.eligible){
    const code=sourceClassification.reasons.includes('container-contract')
      ?COMPATIBILITY_ERROR.UNSUPPORTED_CONTAINER_LAYOUT:COMPATIBILITY_ERROR.UNKNOWN_SOURCE_CONTRACT;
    throw compatibilityError(code,'This future Apple photo contract cannot be rebuilt safely yet.',{
      reasons:sourceClassification.reasons,
    });
  }

  const target=legacyTarget(opts.targetId||LEGACY_BASELINE_CONTRACT_ID);

  const preflight=preflightLegacyCompatibilityExport(source,{classification:sourceClassification,discovery,targetId:target.id});
  if(!preflight.eligible)
    throw compatibilityError(preflightFailureCode(preflight),
      'Legacy compatibility preflight refused to mutate this file',{preflight});

  const plan=buildLegacyConversionPlan(sourceClassification,{
    texture:opts.texture!==false,targetId:target.id,targetProfileName:opts.targetProfileName??null,
    generatedLinearThumbnail:Boolean(opts.linearThumb),preflight,
  });
  // 0x65 is a verified alternate native Texture/Film capture-generation marker.
  // If it appears on 16/17 and triggered recovery, carrying it into the 2026
  // target would leave two competing editing contracts. Other MakerNote records
  // remain untouched.
  const removeMakerTags=sourceClassification.reasons.includes('future-native-texture-marker')?[0x65]:[];
  const sanitized=stripAppleEditingContract(source,{removeMakerTags});
  // Establish the mutation boundary before the mature builder sees the source.
  // A sanitizer mismatch must stop here, not after a partially rebuilt graph.
  const sanitizerCheck=verifyLegacyMutationBudget(source,sanitized.data,{
    removedIds:sanitized.report.removedIds,
    removedMakerTags:removeMakerTags,
    plan,
  });
  const settings={
    ...opts,
    // App callers normally provide a source-derived HDR-aware linear thumbnail.
    // Direct compatibility callers keep the old API by falling back to the real
    // linear resource from the known baseline profile, never the source SDR thumbnail.
    linearThumb:opts.linearThumb||profileLinearThumbnail(profile),
    experimental:opts.experimental!==false,
    texture:opts.texture!==false,
    compatibilityStyleFallback:'profile',
    sceneStats:opts.sceneStats??(opts.decode?'target':'donor'),
    ...(opts.decode?{lightMaps:opts.lightMaps??'target'}:{}),
  };
  const rebuilt=await patch(sanitized.data,profile,settings);
  const selfCheck=verifyLegacyOutput(rebuilt.data,{
    targetId:target.id,expectTexture:opts.texture!==false,
  });
  const preservation=verifyLegacyMutationBudget(source,rebuilt.data,{
    removedIds:sanitized.report.removedIds,
    removedMakerTags:removeMakerTags,
    plan,
  });
  const semanticPreservation=verifySemanticPreservation(source,rebuilt.data);
  const targetFingerprint=fingerprintPhotoContract(rebuilt.data);
  return {
    data:rebuilt.data,
    report:{
      ...reportBase('legacy-compatibility-export'),
      source:sourceClassification,
      target:{...target,profileName:opts.targetProfileName??null,
        fingerprint:targetFingerprint,signature:contractSignature(targetFingerprint)},
      preflight,plan,sanitizer:{...sanitized.report,verification:sanitizerCheck},
      preservation,semanticPreservation,selfCheck,
      patch:rebuilt.report,
    },
  };
}

/** Atomic wrapper for callers that prefer preserve-only to exceptions.
 *
 * Any parser/preflight/sanitizer/builder/verifier failure returns the exact
 * source Uint8Array. No partially rebuilt bytes escape this boundary.
 */
export async function safeLegacyCompatibilityExport(source,profile,opts={}){
  try{return await legacyCompatibilityExport(source,profile,opts);}
  catch(error){
    let sourceClassification=null;
    try{sourceClassification=classifyPhotoContract(source);}catch{}
    return {
      data:source,
      report:{
        ...reportBase('legacy-compatibility-preserved'),
        source:sourceClassification,
        target:null,
        failure:{
          code:error?.code||'legacy-compatibility-failed',
          message:String(error?.message||error),
          details:error?.details??null,
        },
      },
    };
  }
}
