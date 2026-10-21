import {createBokehRenderer} from './ai-bokeh.js';
import {displayPointToStored} from '../raster/heif.js';
import {latestSettingsWriter} from './ai-portrait-assembler.js';
import {portraitPreviewBlur} from './portrait-scene-response.js';
const APERTURES=[1.4,1.6,1.8,2,2.2,2.5,2.8,3.2,3.5,4,4.5,5,5.6,6.3,7.1,8,9,10,11,13,14,16,null];
const DEFAULT_APERTURE=APERTURES.indexOf(4.5);
const selectedAperture=input=>APERTURES[Number(input.value)];
const apertureLabel=value=>value===null?'Off':`f/${value<10?value.toFixed(1):value}`;
const previewBlur=portraitPreviewBlur;
// A native range owns touch, keyboard and assistive-technology interaction.
// The ruler is decorative; its wave follows the value without a render loop.
function apertureControl(input,strings){
  const control=document.createElement('label');control.className='ai-aperture';
  const heading=document.createElement('span');heading.className='ai-aperture-heading';
  const caption=document.createElement('span');caption.textContent=strings.aperture;
  const value=document.createElement('output');value.className='ai-aperture-value';
  heading.append(caption,value);
  const track=document.createElement('span');track.className='ai-aperture-track';
  const ruler=document.createElement('span');ruler.className='ai-aperture-ruler';ruler.setAttribute('aria-hidden','true');
  const TICK_SPACING=24;
  ruler.style.width=`${(APERTURES.length-1)*TICK_SPACING}px`;
  const ticks=Array.from({length:APERTURES.length},(_,i)=>{
    const tick=document.createElement('span');tick.className='ai-aperture-tick';tick.style.left=`${i*TICK_SPACING}px`;ruler.append(tick);return tick;
  });
  const origin=document.createElement('span');origin.className='ai-aperture-origin';origin.style.left=`${DEFAULT_APERTURE*TICK_SPACING}px`;ruler.append(origin);
  const selection=document.createElement('span');selection.className='ai-aperture-selection';selection.setAttribute('aria-hidden','true');
  input.step='1';input.setAttribute('aria-label',strings.aperture);
  track.append(ruler,selection,input);control.append(heading,track);
  let adjusting=false;
  const update=()=>{
    const index=Number(input.value);
    value.textContent=apertureLabel(selectedAperture(input));input.setAttribute('aria-valuetext',value.textContent);
    ruler.style.transform=`translateX(${-index*TICK_SPACING}px)`;
    ticks.forEach((tick,i)=>{
      const distance=(i-index)/2.6;
      const wave=adjusting?Math.exp(-distance*distance)*1.6:0;
      tick.style.transform=`translateX(-50%) scaleY(${1+wave})`;
    });
  };
  const active=enabled=>{adjusting=enabled;control.classList.toggle('is-adjusting',enabled);update();};
  const events=new AbortController(),options={signal:events.signal};
  let drag=null;
  const setIndex=index=>{
    const next=Math.max(0,Math.min(APERTURES.length-1,index));
    if(Number(input.value)===next)return;
    input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));
  };
  track.addEventListener('pointerdown',event=>{
    if(input.disabled||event.button!==0||event.isPrimary===false)return;
    const rect=track.getBoundingClientRect(),center=rect.left+rect.width/2,startIndex=Number(input.value);
    drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,startIndex,center,moved:false,captured:false};
    input.focus({preventScroll:true});active(true);
  },options);
  track.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    if(!drag.moved&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;active(false);return;}
    if(Math.abs(dx)<4&&!drag.moved)return;
    drag.moved=true;
    if(!drag.captured){try{track.setPointerCapture(event.pointerId);drag.captured=true;}catch{}}
    event.preventDefault();
    setIndex(Math.round(drag.startIndex-dx/TICK_SPACING));
  },options);
  const finishDrag=event=>{
    if(!drag||drag.id!==event.pointerId)return;
    if(!drag.moved){
      const offset=(event.clientX-drag.center)/TICK_SPACING;
      setIndex(Math.round(drag.startIndex+offset));
    }else input.dispatchEvent(new Event('change',{bubbles:true}));
    try{if(drag.captured)track.releasePointerCapture(event.pointerId);}catch{}
    drag=null;active(false);
  };
  track.addEventListener('pointerup',finishDrag,options);
  track.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId){drag=null;active(false);}},options);
  window.addEventListener('blur',()=>{drag=null;if(adjusting)active(false);},options);
  input.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))active(true);},options);
  input.addEventListener('keyup',()=>active(false),options);
  input.addEventListener('blur',()=>{if(!drag)active(false);},options);
  input.addEventListener('input',update,options);update();
  return {element:control,update,dispose:()=>events.abort()};
}
// Preview only. Export keeps the unblurred primary and editable Portrait depth.
export function portraitPreview(result,host,strings,onSettings,{onPending=()=>{}}={}){
  const {width:w,height:h,gray,previewRgb:rgb,orientation:{angle,mirror}}=result;
  let renderer=null;
  const ensureRenderer=()=>{
    if(renderer)return renderer;
    const source=document.createElement('canvas');source.width=w;source.height=h;
    try{
      const ctx=source.getContext('2d'),pixels=ctx.createImageData(w,h);
      for(let i=0;i<gray.length;i++){const p=i*4,k=i*3;pixels.data[p]=rgb[k];pixels.data[p+1]=rgb[k+1];pixels.data[p+2]=rgb[k+2];pixels.data[p+3]=255;}
      ctx.putImageData(pixels,0,0);renderer=createBokehRenderer(source,gray,w,h,{angle,mirror});return renderer;
    }finally{source.width=source.height=0;}
  };
  const releaseRenderer=()=>{renderer?.close();renderer=null;};
  const view=document.createElement('canvas'),swap=angle===90||angle===270;
  view.width=swap?h:w;view.height=swap?w:h;view.className='ai-preview';
  const frame=document.createElement('button');frame.type='button';frame.className='ai-preview-frame';frame.setAttribute('aria-label',strings.focusKeyboard||strings.focus);
  const marker=document.createElement('span');marker.className='ai-focus-marker';marker.hidden=true;marker.setAttribute('aria-hidden','true');
  marker.innerHTML='<svg viewBox="0 0 100 100" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M1 1h98v98H1zM50 1v8M50 91v8M1 50h8M91 50h8"/></svg>';frame.append(view,marker);
  const blur=document.createElement('input');blur.type='range';blur.min='0';blur.max=String(APERTURES.length-1);blur.value=String(DEFAULT_APERTURE);
  const aperture=apertureControl(blur,strings);
  const instruction=document.createElement('p');instruction.className='ai-focus-hint';instruction.textContent=strings.focus;
  const reset=document.createElement('button');reset.type='button';reset.className='ai-reset';reset.title=strings.reset;reset.setAttribute('aria-label',strings.reset);
  reset.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4M4 7h8a8 8 0 1 1-8 8"/></svg>';
  const centerFocus=document.createElement('button');centerFocus.type='button';centerFocus.className='ai-center-focus';centerFocus.title=strings.centreFocus;centerFocus.setAttribute('aria-label',strings.centreFocus);
  centerFocus.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M3 16v2a3 3 0 0 0 3 3h2M21 16v2a3 3 0 0 1-3 3h-2"/><circle cx="12" cy="12" r="2.2"/></svg>';
  const toolbar=document.createElement('div');toolbar.className='ai-preview-toolbar';
  const photos=document.createElement('div');photos.className='ai-photos-controls';photos.setAttribute('role','group');photos.setAttribute('aria-label',strings.photosEdit);
  const apertureMode=document.createElement('button');apertureMode.type='button';apertureMode.className='ai-photo-mode';apertureMode.dataset.mode='aperture';apertureMode.setAttribute('aria-pressed','true');apertureMode.setAttribute('aria-label',strings.aperture);
  apertureMode.innerHTML='<span class="ai-mode-f" aria-hidden="true">ƒ</span>';
  const lightingMode=document.createElement('button');lightingMode.type='button';lightingMode.className='ai-photo-mode';lightingMode.dataset.mode='lighting';lightingMode.setAttribute('aria-pressed','false');lightingMode.setAttribute('aria-label',strings.lighting);
  lightingMode.innerHTML='<svg class="ai-lighting-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round" aria-hidden="true"><path d="m12 2.8 7.8 4.5v9L12 20.8l-7.8-4.5v-9Z"/><circle cx="12" cy="11.8" r="4.25"/><circle class="ai-lighting-core" cx="12" cy="11.8" r="1.85" fill="currentColor" stroke="none"/></svg>';
  photos.append(lightingMode,apertureMode);
  const portraitToggle=document.createElement('button');portraitToggle.type='button';portraitToggle.className='ai-portrait-toggle';portraitToggle.textContent=strings.preview;portraitToggle.setAttribute('aria-pressed','true');portraitToggle.setAttribute('aria-label',strings.portraitToggle);
  const utilities=document.createElement('div');utilities.className='ai-preview-actions';utilities.append(centerFocus,reset);
  const photosInfo=document.createElement('p');photosInfo.className='ai-photos-info';photosInfo.textContent=strings.photosEditHint;photosInfo.hidden=true;
  toolbar.append(photos,portraitToggle,utilities);
  const state=document.createElement('p');state.className='ai-preview-state';state.setAttribute('role','status');
  host.append(toolbar,photosInfo,frame,instruction,aperture.element,state);
  const showUpdating=busy=>{host.setAttribute('aria-busy',String(busy));};
  const initialFocus=result.suggestedFocus||{x:.5,y:.5,displayX:.5,displayY:.5};
  let x=initialFocus.x,y=initialFocus.y,displayX=initialFocus.displayX,displayY=initialFocus.displayY,pending=null,timer=null,version=0,disposed=false,lastCommitted=0,inFlight=null,lastPortraitAperture=DEFAULT_APERTURE;
  const syncPortraitState=()=>{
    const enabled=selectedAperture(blur)!==null;
    portraitToggle.setAttribute('aria-pressed',String(enabled));
    portraitToggle.title=enabled?strings.portraitOn:strings.portraitOff;
    host.classList.toggle('is-portrait-off',!enabled);
    blur.disabled=!enabled;
  };
  const selectPhotoMode=mode=>{
    const lighting=mode==='lighting';
    apertureMode.setAttribute('aria-pressed',String(!lighting));
    lightingMode.setAttribute('aria-pressed',String(lighting));
    photosInfo.hidden=!lighting;
  };
  apertureMode.addEventListener('click',()=>selectPhotoMode('aperture'));
  lightingMode.addEventListener('click',()=>selectPhotoMode('lighting'));
  portraitToggle.addEventListener('click',()=>{
    const enabled=selectedAperture(blur)!==null;
    if(enabled){lastPortraitAperture=Number(blur.value);blur.value=String(APERTURES.length-1);}
    else blur.value=String(lastPortraitAperture);
    aperture.update();syncPortraitState();changed();commit();
  });
  const writeLatest=latestSettingsWriter(({chosen,current},isLatest)=>onSettings(chosen,()=>!disposed&&version===current&&isLatest()));
  // The saved HEIC always starts with Portrait off and keeps editable depth.
  // Off is a preview state, not an invalid zero aperture in its depth metadata.
  const settings=()=>({focusX:x,focusY:y,aperture:selectedAperture(blur)??16});
  const draw=()=>{
    if(document.hidden)return;
    const focus=gray[Math.min(h-1,Math.floor(y*h))*w+Math.min(w-1,Math.floor(x*w))];
    const active=ensureRenderer();active.draw({focus,blur:previewBlur(selectedAperture(blur))*(result.disparityMax??1)});view.getContext('2d').drawImage(active.canvas,0,0);
  };
  const commit=()=>{
    clearTimeout(timer);timer=null;
    if(disposed||lastCommitted===version)return inFlight||Promise.resolve();
    const current=version,chosen=settings();lastCommitted=current;
    inFlight=writeLatest({chosen,current}).then(()=>{
      if(!disposed&&version===current){showUpdating(false);state.textContent='';onPending(false);}
    }).catch(error=>{
      console.warn('Portrait settings update failed',error);
      if(!disposed&&version===current){showUpdating(false);state.textContent=strings.updateFailed;lastCommitted=0;}
    });
    return inFlight;
  };
  const changed=()=>{
    version++;onPending(true);showUpdating(true);state.textContent=strings.updating;
    marker.hidden=false;marker.style.left=`${displayX*100}%`;marker.style.top=`${displayY*100}%`;
    if(pending!==null)cancelAnimationFrame(pending);
    pending=requestAnimationFrame(()=>{pending=null;try{draw();}catch(error){console.warn('Preview unavailable',error);state.textContent=strings.previewFailed;}});
    clearTimeout(timer);timer=setTimeout(commit,220);
  };
  const focus=(a,b)=>{
    displayX=Math.max(0,Math.min(1,a));displayY=Math.max(0,Math.min(1,b));
    const point=displayPointToStored(displayX,displayY,angle,mirror);x=point.x;y=point.y;changed();
  };
  frame.addEventListener('click',e=>{const r=view.getBoundingClientRect(),keyboard=e.detail===0&&e.target===frame;
    focus(keyboard?.5:(e.clientX-r.left)/r.width,keyboard?.5:(e.clientY-r.top)/r.height);});
  frame.addEventListener('keydown',e=>{
    const delta={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[e.key];
    if(delta){e.preventDefault();focus(displayX+delta[0],displayY+delta[1]);}
  });
  blur.addEventListener('input',()=>{selectPhotoMode('aperture');if(selectedAperture(blur)!==null)lastPortraitAperture=Number(blur.value);syncPortraitState();changed();});
  blur.addEventListener('change',commit);
  centerFocus.addEventListener('click',()=>{focus(.5,.5);commit();});
  reset.addEventListener('click',()=>{selectPhotoMode('aperture');blur.value=String(DEFAULT_APERTURE);lastPortraitAperture=DEFAULT_APERTURE;aperture.update();syncPortraitState();focus(initialFocus.displayX,initialFocus.displayY);commit();});
  syncPortraitState();draw();
  // Histories can contain many photos. Keep live GPU contexts only for previews
  // that are visible; their canvas snapshots and settings survive suspension.
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{host.classList.toggle('is-suspended',!entries[0].isIntersecting);if(!entries[0].isIntersecting)releaseRenderer();}):null;
  observer?.observe(frame);
  const suspend=()=>{if(pending!==null){cancelAnimationFrame(pending);pending=null;}releaseRenderer();};
  const visibility=()=>{if(document.hidden)suspend();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',suspend);
  const dispose=()=>{disposed=true;clearTimeout(timer);if(pending!==null)cancelAnimationFrame(pending);aperture.dispose();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',suspend);releaseRenderer();view.width=view.height=0;host.replaceChildren();};
  dispose.flush=commit;return dispose;
}
