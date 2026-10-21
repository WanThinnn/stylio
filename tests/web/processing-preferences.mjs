import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessingPreferences,bindProcessingPreferences,memoryConstrainedProcessing} from '../../web/src/ui/processing-preferences.js';
import {createScreenAwake} from '../../web/src/ui/screen-awake.js';
import {createTaskQueue} from '../../web/src/app/processing/task-queue.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('iPhone, desktop-mode iPad and Safari expose parallel with a managed-memory explanation',()=>{
 for(const nav of [{userAgent:'iPhone Safari/605'},
  {userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5},
  {userAgent:'Macintosh Version/18 Safari/605'},
  {userAgent:'iPhone CriOS/131 Mobile Safari/605'}]){
  assert.equal(memoryConstrainedProcessing(nav),true);
  const preferences=createProcessingPreferences({getItem:()=>null}),listeners={};
  const control={checked:false,disabled:false,addEventListener:(event,fn)=>listeners[event]=fn},hint={dataset:{}};
  bindProcessingPreferences({preferences,nav,doc:{getElementById:id=>id==='parallel-processing'?control:id==='parallel-hint'?hint:null}});
  assert.equal(control.disabled,false);assert.equal(hint.dataset.i18n,'settings.parallelmanaged');
  control.checked=true;listeners.change();assert.equal(preferences.get('parallel'),true);
 }
 assert.equal(memoryConstrainedProcessing({userAgent:'Windows Chrome/130 Safari/537'}),false);
});

test('processing preferences persist real settings and support blocked storage',()=>{
  const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const preferences=createProcessingPreferences(storage),changes=[];
  preferences.subscribe((...args)=>changes.push(args));
  assert.equal(preferences.get('parallel'),false);
  preferences.set('parallel',true);preferences.set('keepAwake',true);preferences.set('saveAction','download');preferences.set('originalHint',false);
  const restored=createProcessingPreferences(storage);
  for(const key of ['parallel','keepAwake','saveAction','originalHint'])assert.equal(restored.get(key),preferences.get(key));
  assert.equal(changes.length,4);
  const denied=createProcessingPreferences({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});
  assert.doesNotThrow(()=>denied.set('parallel',true));assert.equal(denied.get('parallel'),true);
});

test('original-format reminder can be restored after a legacy Got it dismissal',()=>{
  const saved=new Map([['photo-format-tip-dismissed-v1','1']]);
  const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const preferences=createProcessingPreferences(storage);assert.equal(preferences.get('originalHint'),false);
  preferences.set('originalHint',true);
  assert.equal(createProcessingPreferences(storage).get('originalHint'),true);
});

test('wake lock is acquired only for visible processing and resumes after visibility changes',async()=>{
  const doc=new EventTarget();doc.visibilityState='visible';let requests=0,releases=0;
  const states=[],nav={wakeLock:{async request(type){
    assert.equal(type,'screen');requests++;
    const lock=new EventTarget();lock.release=async()=>{releases++;lock.dispatchEvent(new Event('release'));};return lock;
  }}};
  const awake=createScreenAwake({nav,doc,enabled:()=>true,onState:state=>states.push(state)});
  awake.setBusy(true);await tick();assert.equal(requests,1);assert.equal(states.at(-1),'active');
  awake.setBusy(true);await tick();assert.equal(requests,1,'progress updates cannot request multiple locks');
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(releases,1);
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(requests,2);
  awake.setBusy(false);await tick();assert.equal(releases,2);
  awake.dispose();
});

test('late wake-lock completion releases immediately after processing ends',async()=>{
  let resolve,releases=0;const doc=new EventTarget();doc.visibilityState='visible';
  const awake=createScreenAwake({doc,enabled:()=>true,nav:{wakeLock:{request:()=>new Promise(r=>resolve=r)}}});
  awake.setBusy(true);awake.setBusy(false);resolve({release:async()=>releases++});
  await tick();assert.equal(releases,1);awake.dispose();
});

test('denied and unsupported wake locks do not fail processing or retry in a loop',async()=>{
  const doc=new EventTarget();doc.visibilityState='visible';const states=[];let requests=0;
  const awake=createScreenAwake({doc,enabled:()=>true,onState:s=>states.push(s),nav:{wakeLock:{request:async()=>{requests++;throw Error('low battery');}}}});
  awake.setBusy(true);await tick();assert.equal(states.at(-1),'unavailable');assert.equal(requests,1);awake.dispose();
  const unsupported=createScreenAwake({doc,nav:{},enabled:()=>true,onState:s=>states.push(s)});
  unsupported.setBusy(true);await tick();assert.equal(states.at(-1),'unsupported');unsupported.dispose();
});

test('task queue waits for visibility and frees a lane after failure',async()=>{
  let visible;const gate=new Promise(resolve=>visible=resolve),started=[];
  const queue=createTaskQueue({waitUntilVisible:()=>gate,run:async job=>{started.push(job.name);if(job.fail)throw Error('failure');}});
  const failed=queue.enqueue([{name:'first',fail:true}]);const failure=assert.rejects(failed,/failure/);
  const next=queue.enqueue([{name:'second'}]);await tick();assert.deepEqual(started,[]);
  visible();await failure;await next;await tick();assert.deepEqual(started,['first','second']);assert.equal(queue.snapshot().pending,0);
});

test('parallel queue never overlaps jobs bound to the same runtime lane',async()=>{
  const active=new Set(),started=[],finish=new Map();
  const queue=createTaskQueue({concurrency:()=>2,run:async(job,lane)=>{
    assert.equal(active.has(lane),false);active.add(lane);started.push(job.name);
    await new Promise(resolve=>finish.set(job.name,resolve));active.delete(lane);
  }});
  const complete=queue.enqueue([{name:'a',lane:1},{name:'b',lane:1},{name:'c',lane:0}]);
  await tick();assert.deepEqual(started,['a','c']);finish.get('a')();await tick();assert.deepEqual(started,['a','c','b']);
  finish.get('b')();finish.get('c')();await complete;await tick();assert.equal(queue.snapshot().pending,0);
});
