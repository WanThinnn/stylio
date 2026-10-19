import {decodeGainLog,encodeGainLog} from './jpeg-hdr.js';
import {buildReferenceWhiteHagcPayload} from './hagc.js';

const clamp01=v=>Math.max(0,Math.min(1,v));

function assertChannel(channel,label){
  if(!channel||![channel.min,channel.max,channel.gamma,channel.baseOffset,channel.alternateOffset].every(Number.isFinite)
    ||channel.min>channel.max||channel.gamma<=0)
    throw new Error(`Invalid ${label} HDR gain-map channel`);
}

/**
 * Derive the standards-defined Reference White Tone Mapping Operator metadata
 * directly from an ISO 21496-1 tmap. Apple Image I/O derives HAGC from gain-map
 * images in the same source-only spirit; no donor/original asset is involved.
 *
 * For the single-channel iPhone edited exports under study, native HAGC baseline
 * headroom equals tmap.max rounded to 1e-4 across the calibration corpus.
 */
export function referenceWhiteHagcFromTmap(metadata){
  if(!metadata||!Array.isArray(metadata.channels)||metadata.channels.length!==1)
    throw new Error('Reference-white HAGC currently requires one gain-map channel');
  const channel=metadata.channels[0];assertChannel(channel,'source');
  if(!(channel.max>=0&&channel.max<=6))throw new Error('Unsupported HAGC baseline headroom');
  const baseline=Math.round(channel.max*10000)/10000;
  return {
    baselineHdrHeadroom:baseline,
    payload:buildReferenceWhiteHagcPayload(baseline),
  };
}

/**
 * Re-encode an 8-bit ISO gain map from one (min,max,gamma) curve to another
 * while preserving the represented log2 gain. Offsets are intentionally not
 * part of the sample remap: they belong to the base/alternate image equation.
 */
export function remapIsoGainSamples(samples,sourceChannel,targetChannel){
  if(!(samples instanceof Uint8Array))throw new Error('Gain samples must be Uint8Array');
  assertChannel(sourceChannel,'source');assertChannel(targetChannel,'target');
  const out=new Uint8Array(samples.length);
  let sumLogError=0,maxLogError=0,clippedLow=0,clippedHigh=0;
  for(let i=0;i<samples.length;i++){
    const sourceSample=samples[i]/255;
    const logGain=decodeGainLog(sourceSample,sourceChannel);
    const encoded=encodeGainLog(logGain,targetChannel);
    if(encoded<=0&&logGain<targetChannel.min)clippedLow++;
    if(encoded>=1&&logGain>targetChannel.max)clippedHigh++;
    const code=Math.round(255*clamp01(encoded));
    out[i]=code;
    const reconstructed=decodeGainLog(code/255,targetChannel);
    const error=Math.abs(reconstructed-logGain);
    sumLogError+=error;if(error>maxLogError)maxLogError=error;
  }
  return {
    samples:out,
    meanLogError:samples.length?sumLogError/samples.length:0,
    maxLogError,
    clippedLow,
    clippedHigh,
  };
}

export function compareIsoGainFields(a,aChannel,b,bChannel){
  if(!(a instanceof Uint8Array)||!(b instanceof Uint8Array)||a.length!==b.length)
    throw new Error('Gain fields must have equal Uint8Array geometry');
  assertChannel(aChannel,'first');assertChannel(bChannel,'second');
  let sum=0,sumSq=0,max=0;
  for(let i=0;i<a.length;i++){
    const da=decodeGainLog(a[i]/255,aChannel),db=decodeGainLog(b[i]/255,bChannel);
    const e=Math.abs(da-db);sum+=e;sumSq+=e*e;if(e>max)max=e;
  }
  return {
    meanAbsLogError:a.length?sum/a.length:0,
    rmsLogError:a.length?Math.sqrt(sumSq/a.length):0,
    maxLogError:max,
  };
}
