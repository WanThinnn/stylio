const KEYS={saveAction:'stylio-save-action-v1',keepAwake:'stylio-keep-awake-v1',parallel:'stylio-parallel-v1',originalHint:'stylio-original-hint-v1'};
export const PROCESSING_STORAGE_KEYS=Object.values(KEYS);
export function parallelProcessingSupported({userAgent='',platform='',maxTouchPoints=0}=globalThis.navigator||{}){
  const ios=/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1);
  const safari=/Safari/i.test(userAgent)&&!/Chrome|Chromium|Edg\/|OPR\/|Android|Firefox/i.test(userAgent);
  return !ios&&!safari;
}
export function createProcessingPreferences(storage){
  if(storage===undefined)try{storage=globalThis.localStorage;}catch{}
  const listeners=new Set();
  const read=key=>{try{return storage?.getItem(key);}catch{return null;}};
  const values={
    saveAction:read(KEYS.saveAction)==='download'?'download':'share',
    keepAwake:read(KEYS.keepAwake)==='on',parallel:read(KEYS.parallel)==='on',
    originalHint:read(KEYS.originalHint)!=='off'&&read('photo-format-tip-dismissed-v1')!=='1',
  };
  return {
    get:key=>values[key],
    set(key,value){
      if(!(key in KEYS))return;
      value=key==='saveAction'?(value==='download'?'download':'share'):Boolean(value);
      if(values[key]===value)return;
      values[key]=value;
      try{storage?.setItem(KEYS[key],typeof value==='boolean'?(value?'on':'off'):value);
        if(key==='originalHint')storage?.removeItem('photo-format-tip-dismissed-v1');}catch{}
      for(const listener of listeners)listener(key,value);
    },
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  };
}
let instance;
export const getProcessingPreferences=()=>instance??=createProcessingPreferences();

export function bindProcessingPreferences({doc=globalThis.document,preferences=getProcessingPreferences(),nav=globalThis.navigator}={}){
  const parallelAllowed=parallelProcessingSupported(nav);
  if(!parallelAllowed){
    const hint=doc.getElementById('parallel-hint');if(hint)hint.dataset.i18n='settings.parallelunavailable';
  }
  const controls={saveAction:'default-save-action',keepAwake:'keep-screen-awake',parallel:'parallel-processing',originalHint:'original-format-hint'};
  for(const [key,id] of Object.entries(controls)){
    const control=doc.getElementById(id);if(!control)continue;
    const update=()=>{if(key==='saveAction')control.value=preferences.get(key);else control.checked=key==='parallel'&&!parallelAllowed?false:preferences.get(key);
      if(key==='parallel'&&!parallelAllowed)control.disabled=true;};
    update();control.addEventListener('change',()=>{if(key==='parallel'&&!parallelAllowed){update();return;}preferences.set(key,key==='saveAction'?control.value:control.checked);});
    preferences.subscribe(changed=>{if(changed===key)update();});
  }
}
