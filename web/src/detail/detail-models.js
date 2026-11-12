// Curated families and their pinned manifest at vendor/ai-detail/assets.json.
// Model families require different training objectives; labels indicate resource tiers,
// NOT guaranteed image-quality rankings.
export const DETAIL_MODELS = Object.freeze({
  lite: Object.freeze({label:'Lite',family:'1x SuperScale SPAN',assetFamily:'span',tile:384,overlap:16,webgpuWorkers:2,mix:1}),
  standard: Object.freeze({label:'Standard',family:'RT-Focuser 2025',assetFamily:'rt-focuser',tile:512,overlap:32,webgpuWorkers:4,mix:.25}),
  pro: Object.freeze({label:'Pro',family:'1x Fatality DeBlur',assetFamily:'fatality-deblur',tile:256,overlap:32,webgpuWorkers:1,mix:1}),
});
export const DETAIL_DEFAULT='standard';
export function detailModel(id=DETAIL_DEFAULT){
  if(!Object.hasOwn(DETAIL_MODELS,id))throw new RangeError('Unsupported detail model');
  return DETAIL_MODELS[id];
}
/** Trusted manifest contract, validated before loading an ONNX network. */
export function validateDetailAsset(config){
  if(!config||typeof config!=='object'||!['span','rt-focuser','fatality-deblur'].includes(config.family)
    ||!Number.isInteger(config.bytes)||config.bytes<100
    ||!/^[a-f0-9]{64}$/.test(config.sha256||'')
    ||!/^[-\w.]+\.onnx$/.test(config.file||''))throw Error('Invalid AI detail asset manifest');
  if(config.channels!==3||config.layout!=='rgb'||config.output!=='rgb')throw Error('Unsupported ONNX detail model layout');
  if(config.sourceUrl!==undefined){
    const url=new URL(config.sourceUrl);
    if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid AI detail model source URL');
  }
  return config;
}
