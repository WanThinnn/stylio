import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppShell} from '../../web/src/ui/shell/app-shell.js';
import {bindDockViewport} from '../../web/src/ui/shell/dock-viewport.js';
import {bindTabGlass} from '../../web/src/ui/shell/tab-glass.js';

// Small DOM adapter: tests exercise the same shell interface as the browser,
// not HTML/source snapshots. No decoder, encoder, model or filesystem fixtures.
function harness({blockedStorage=false,initialState=null,deferBack=false,thumbnails=false,standalone=false}={}){
  let doc;
  class Element extends EventTarget{
    constructor(tag='div'){super();this.tagName=tag;this.children=[];this.dataset={};this.attrs=new Map();this.css=new Map();this.style={setProperty:(k,v)=>this.css.set(k,v),removeProperty:k=>this.css.delete(k)};this.hidden=false;this.open=false;this.className='';this.classes=new Set();this.classList={toggle:(k,enabled)=>{if(enabled)this.classes.add(k);else this.classes.delete(k);},add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),contains:k=>this.classes.has(k)};}
    get childNodes(){return [...this.children];}
    get firstElementChild(){return this.children[0];}
    get isConnected(){return !!this.parentElement||this===doc.body;}
    setAttribute(k,v){this.attrs.set(k,v);}
    getAttribute(k){return this.attrs.get(k);}
    removeAttribute(k){this.attrs.delete(k);}
    append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
    replaceChildren(...items){for(const child of [...this.children])child.remove();this.append(...items);}
    insertBefore(item,target){item.remove();const i=target?this.children.indexOf(target):this.children.length;item.parentElement=this;this.children.splice(i,0,item);}
    replaceWith(item){if(!this.parentElement)return;const parent=this.parentElement;parent.insertBefore(item,this);this.remove();}
    remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
    focus(){doc.activeElement=this;}
    blur(){if(doc.activeElement===this)doc.activeElement=null;}
    scrollTo(_x,y){this.scrollTop=y;}
    click(){this.focus();this.dispatchEvent(new Event('click'));}
    showModal(){this.open=true;}
    close(){this.open=false;}
    getBoundingClientRect(){return {height:72};}
    querySelector(selector){
      if(selector.includes('>')){const [parent,child]=selector.split('>');return this.querySelector(parent)?.children.find(el=>el.tagName===child);}
      return all(this).find(el=>selector==='.act'?el.className==='act':selector==='[data-close-dialog]'?el.closeButton:el.className===selector.slice(1));
    }
  }
  const all=root=>root.children.flatMap(child=>[child,...all(child)]),nodes=new Map();
  doc={body:new Element('body'),activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id),
    querySelector:selector=>nodes.get(selector),
    querySelectorAll(selector){
      if(selector==='[data-screen]')return tabs;
      if(selector==='.sheet[open]')return sheets.filter(el=>el.open);
      if(selector==='dialog[open]')return [...sheets,nodes.get('photo-workspace')].filter(el=>el.open);
      throw Error('Unexpected selector '+selector);
    }};
  for(const id of ['photo-workspace','photo-content','close-photo','photo-title','settings-screen','guide-screen','history-search','toggle-search','history-search-field','clear-search','search-button-label','history-search-summary','history-no-matches','.app-tabs','.app-dock','header-guide','open-ai-settings','ai-settings','depth-model','history-items','history-empty','history-count','current-task','task-content','process-screen','history-screen']){
    const el=new Element();nodes.set(id,el);doc.body.append(el);
  }
  for(const id of ['task-summary','history-queue-summary','history-queue-note','open-release-notes','release-notes']){const el=new Element();nodes.set(id,el);doc.body.append(el);}
  const main=new Element('main');main.scrollTop=0;nodes.set('main',main);doc.body.append(main);
  const tabs=['process','history','guide','settings'].map(name=>{const el=new Element('button');el.dataset.screen=name;doc.body.append(el);return el;});
  const sheets=['ai-settings','release-notes'].map(id=>nodes.get(id));
  for(const sheet of sheets){const button=new Element('button');button.closeButton=true;sheet.append(button);}
  const storage=new Map(),entries=[initialState];let cursor=0,pendingBack;
  const win=new EventTarget();win.scrollY=0;win.scrollTo=(_x,y)=>win.scrollY=y;
  win.navigator={standalone};win.matchMedia=query=>({matches:query==='(prefers-reduced-motion: reduce)'||standalone&&query==='(display-mode: standalone)'});
  let intersection;
  if(thumbnails){
    win.IntersectionObserver=class {constructor(callback){intersection=callback;}observe(){}unobserve(){}};
    win.createImageBitmap=async()=>({width:96,height:64,close(){}});
    const create=doc.createElement;doc.createElement=tag=>{
      const el=create(tag);
      if(tag==='canvas'){el.getContext=()=>({drawImage(){}});el.toDataURL=()=> 'data:image/jpeg;base64,dGh1bWI=';}
      return el;
    };
  }
  win.localStorage=win.sessionStorage={getItem:key=>{if(blockedStorage)throw Error('denied');return storage.get(key);},setItem:(key,value)=>{if(blockedStorage)throw Error('denied');storage.set(key,value);}};
  win.history={get state(){return entries[cursor];},replaceState(state){entries[cursor]=state;},pushState(state){entries.splice(++cursor);entries[cursor]=state;},back(){if(cursor>0){const go=()=>{cursor--;win.dispatchEvent(new Event('popstate'));};if(deferBack)pendingBack=go;else go();}},forward(){if(cursor<entries.length-1){cursor++;win.dispatchEvent(new Event('popstate'));}}};
  const shell=createAppShell({doc,win,translate:key=>key});
  return {doc,win,tabs,shell,intersect(el){intersection?.([{target:el,isIntersecting:true}]);},flushBack(){pendingBack?.();pendingBack=null;},$:id=>nodes.get(id),row(){const el=new Element();const actions=new Element();actions.className='act';el.append(actions);doc.body.append(el);return el;}};
}

test('History stays available empty; navigation preserves scroll and does not dispose results',()=>{
  const h=harness(),el=h.row();h.shell.register(el,'private photo name');
  h.win.scrollY=135;h.tabs[1].click();
  assert.equal(h.$('history-screen').hidden,false);assert.equal(h.$('process-screen').hidden,true);
  assert.equal(h.$('history-empty').hidden,true);
  h.tabs[0].click();assert.equal(h.win.scrollY,135);
  assert.equal(el.isConnected,true);
});

test('workspace moves the exact result DOM, Back restores it and Forward reopens without private URLs',()=>{
  const h=harness(),el=h.row(),parent=el.parentElement,record=h.shell.register(el,'secret.heic');record.update('ready','Ready');
  const card=h.$('task-content').firstElementChild;card.click();
  assert.equal(h.$('photo-workspace').open,true);
  assert.equal(h.$('photo-content').firstElementChild,el);
  assert.deepEqual(Object.keys(h.win.history.state).sort(),['stylioPhoto','stylioTab']);
  assert.doesNotMatch(JSON.stringify(h.win.history.state),/secret|blob|heic/);
  h.win.history.back();assert.equal(h.$('photo-workspace').open,false);assert.equal(el.parentElement,parent);assert.equal(h.doc.activeElement,card);
  h.win.history.forward();assert.equal(h.$('photo-content').firstElementChild,el);
  h.$('close-photo').click();assert.equal(h.$('photo-workspace').open,false);
});

test('current task is independent of selected photo; updates preserve the focused card',()=>{
  const h=harness(),first=h.row(),old=h.shell.register(first,'old');old.update('ready','Ready');
  h.$('task-content').firstElementChild.click();
  const active=h.shell.register(h.row(),'current');active.update('processing','Working 25%');
  assert.equal(h.$('photo-content').firstElementChild,first);
  const task=h.$('task-content').firstElementChild;task.focus();active.update('processing','Working 50%');
  assert.equal(h.$('task-content').firstElementChild,task);assert.equal(h.doc.activeElement,task);
  assert.equal(task.querySelector('.task-copy>span').textContent,'Working 50%');
});

test('Activity shows every running photo while History also shows waiting photos',()=>{
  const h=harness(),records=[];
  h.shell.batch(()=>{
    for(const name of ['first','second','third'])records.push(h.shell.register(h.row(),name));
    records[0].update('processing','Reading');records[1].update('processing','Encoding');
  });
  assert.equal(h.$('history-items').children.length,3);
  assert.equal(h.$('task-content').children.length,2);
  assert.equal(h.$('history-items').firstElementChild.dataset.state,'queued');
  const waitingCopy=h.$('history-items').firstElementChild.querySelector('.task-copy');
  records[0].progress(50);
  assert.equal(h.$('history-items').firstElementChild.querySelector('.task-copy'),waitingCopy,'another job progress must not rebuild an unchanged queued card');
  records[1].update('ready','Ready');
  assert.equal(h.$('task-content').children.length,1);
  records[0].update('ready','Ready');records[2].update('processing','Reading');
  assert.equal(h.$('task-content').firstElementChild.querySelector('.task-copy>strong').textContent,'third');
});

test('task indicator shows overall percentage when supplied, with stage fallback and stable geometry',()=>{
  const h=harness(),record=h.shell.register(h.row(),'stage.heic');
  const symbol=()=>h.$('task-content').firstElementChild.querySelector('.task-symbol');
  record.update('processing','Encoding 45%');
  assert.equal(symbol().css.get('--task-progress'),'45%');
  assert.equal(symbol().dataset.progressLabel,'45%');
  assert.equal(symbol().classes.has('is-determinate'),true);
  const original=symbol();
  record.update('processing','Loading encoder');
  assert.equal(symbol(),original);
  assert.equal(symbol().classes.has('is-active'),true);
  assert.equal(symbol().classes.has('is-determinate'),false);
  record.progress(63);
  assert.equal(symbol().dataset.progressLabel,'63%');
  assert.equal(symbol().css.get('--task-progress'),'63%');
  assert.equal(symbol().classes.has('is-determinate'),true);
  record.update('processing','Depth on GPU');
  assert.equal(symbol().dataset.progressLabel,'63%','overall progress survives status text changes');
  record.update('ready','Ready');
  assert.equal(symbol().classes.has('is-active'),false);
  assert.equal(symbol().textContent,'✓');
});

test('History thumbnails decode lazily, use small cached images, and preserve result navigation',async()=>{
  const h=harness({thumbnails:true}),source={type:'image/jpeg'},record=h.shell.register(h.row(),'photo.jpg',source);
  const historyCard=h.$('history-items').firstElementChild;
  assert.equal(historyCard.querySelector('.task-symbol').className,'task-symbol');
  h.intersect(historyCard);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.$('history-items').firstElementChild.querySelector('.task-thumbnail'),undefined,'queued photos retain a waiting icon and avoid decoding');
  record.update('ready','Ready');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.$('history-items').firstElementChild.querySelector('.task-thumbnail').className,'task-thumbnail');
  assert.equal(h.$('history-items').firstElementChild.querySelector('.task-thumbnail').alt,'');
  assert.equal(h.$('task-content').firstElementChild.querySelector('.task-thumbnail').className,'task-thumbnail','Activity uses the same small photo thumbnail once ready');
  h.$('history-items').firstElementChild.click();
  assert.equal(h.$('photo-workspace').open,true);
  record.dispose();
  assert.equal(h.$('history-empty').hidden,false);
});

test('restored History can render a persisted thumbnail without decoding the result again',()=>{
  const h=harness(),source={type:'image/heic'};
  const record=h.shell.register(h.row(),'saved.heic',source,{thumbnail:'data:image/jpeg;base64,thumb'});
  record.update('ready','Ready');
  const thumb=h.$('history-items').firstElementChild.querySelector('.task-thumbnail');
  assert.equal(thumb.className,'task-thumbnail');
  assert.equal(thumb.src,'data:image/jpeg;base64,thumb');
});

test('ready results group share/download/delete actions behind one overflow control',()=>{
  const h=harness(),record=h.shell.register(h.row(),'ready.heic');let shared=0,downloaded=0,removed=0;
  record.quickActions([
    {kind:'share',label:'Quick share',run:()=>shared++},
    {kind:'download',label:'Quick download',run:()=>downloaded++},
    {kind:'delete',label:'Remove this result',run:()=>removed++,danger:true},
  ]);
  record.update('ready','Ready');
  const historyCard=h.$('history-items').firstElementChild;
  const trigger=historyCard.querySelector('.task-action-trigger'),menu=historyCard.querySelector('.task-action-menu');
  assert.ok(trigger);assert.ok(menu);assert.equal(menu.hidden,true);
  trigger.click();assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(menu.hidden,false);
  assert.equal(menu.children.length,3);
  menu.children[1].click();assert.equal(downloaded,1);assert.equal(shared,0);assert.equal(removed,0);
  assert.equal(h.$('photo-workspace').open,false);
  historyCard.click();assert.equal(h.$('photo-workspace').open,true);
});

test('an open History overflow menu survives progress renders from another photo',()=>{
  const h=harness(),ready=h.shell.register(h.row(),'ready.heic');
  ready.quickActions([{kind:'download',label:'Quick download',run:()=>{}}]);
  ready.update('ready','Ready');
  const historyCard=h.$('history-items').firstElementChild;
  const trigger=historyCard.querySelector('.task-action-trigger'),menu=historyCard.querySelector('.task-action-menu');
  trigger.click();
  const active=h.shell.register(h.row(),'processing.heic');active.update('processing','Working');active.progress(42);
  assert.equal(h.$('history-items').children[1],historyCard);
  assert.equal(historyCard.querySelector('.task-action-trigger'),trigger);
  assert.equal(historyCard.querySelector('.task-action-menu'),menu);
  assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(menu.hidden,false);
});

test('removed results cannot be resurrected by Forward; blocked storage is harmless',()=>{
  const h=harness({blockedStorage:true}),record=h.shell.register(h.row(),'photo');
  h.$('task-content').firstElementChild.click();record.dispose();h.win.history.forward();
  assert.equal(h.$('photo-workspace').open,false);assert.equal(h.$('process-screen').hidden,false);assert.equal(h.$('history-empty').hidden,false);
});

test('Settings is a destination, keeps results, restores scroll, and participates in Back',()=>{
  const h=harness(),el=h.row();h.shell.register(el,'photo');
  h.win.scrollY=85;h.tabs[3].click();
  assert.equal(h.$('settings-screen').hidden,false);
  assert.equal(h.$('process-screen').hidden,true);
  assert.equal(h.tabs[3].getAttribute('aria-current'),'page');
  assert.equal(h.$('photo-workspace').open,false);
  h.win.scrollY=220;h.tabs[0].click();
  assert.equal(h.win.scrollY,85);
  h.win.history.back();
  assert.equal(h.$('settings-screen').hidden,false);
  assert.equal(h.win.scrollY,220);
  assert.equal(el.isConnected,true);
  assert.equal(h.$('ai-settings').open,false);
});
test('AI controls remain a quick modal sheet rather than a navigation destination',()=>{
  const h=harness();h.$('open-ai-settings').click();
  assert.equal(h.$('ai-settings').open,true);
  assert.equal(h.doc.activeElement,h.$('ai-settings'),'dialog surface owns initial focus instead of the close button');
  assert.equal(h.$('process-screen').hidden,false);
});

test('App version opens release notes in a dismissible sheet without leaving Settings',()=>{
  const h=harness();h.tabs[3].click();h.$('open-release-notes').click();
  assert.equal(h.$('release-notes').open,true);
  assert.equal(h.$('settings-screen').hidden,false);
  assert.equal(h.doc.activeElement,h.$('release-notes'));
  h.$('release-notes').querySelector('[data-close-dialog]').click();
  assert.equal(h.$('release-notes').open,false);
  assert.equal(h.$('settings-screen').hidden,false);
  h.$('open-release-notes').click();
  h.$('release-notes').dispatchEvent(new Event('cancel',{cancelable:true}));
  assert.equal(h.$('release-notes').open,false);
});

test('reload discards stale photo history state instead of reusing it for a new session result',()=>{
  const h=harness({initialState:{stylioPhoto:'result-previous-session-1',stylioTab:'history'}});
  assert.deepEqual(h.win.history.state,{stylioTab:'process'});
  assert.equal(h.$('process-screen').hidden,false);
  h.shell.register(h.row(),'new');h.$('task-content').firstElementChild.click();
  assert.notEqual(h.win.history.state.stylioPhoto,'result-previous-session-1');
});

test('rapid reopen waits for asynchronous Back and then opens the intended result',()=>{
  const h=harness({deferBack:true}),first=h.row(),second=h.row();
  const one=h.shell.register(first,'first');one.update('ready','Ready');
  const two=h.shell.register(second,'second');two.update('ready','Ready');
  const cards=h.$('history-items').children;
  cards[1].click();h.$('close-photo').click();cards[0].click();
  assert.equal(h.$('photo-workspace').open,false);
  h.flushBack();assert.equal(h.$('photo-content').firstElementChild,second);
});


test('four destinations include a standalone Guide and Settings, with Back and selected states',()=>{
  const h=harness();
  for(const [index,name]of ['process','history','guide','settings'].entries()){
    h.tabs[index].click();
    assert.equal(h.$(name+'-screen').hidden,false);
    assert.equal(h.tabs[index].getAttribute('aria-current'),'page');
    assert.equal(h.$('.app-tabs').css.get('--tab-rest-offset'),`calc(${index} * 100%)`,'resting lens uses stable layout math instead of transformed button geometry');
    assert.equal(h.$('header-guide').getAttribute('aria-label'),name==='settings'?'GitHub':'shell.guide');
    assert.equal(h.doc.body.classes.has('is-settings-destination'),name==='settings');
    for(const other of ['process','history','guide','settings'])if(other!==name)assert.equal(h.$(other+'-screen').hidden,true);
  }
  h.tabs[0].click();h.$('header-guide').click();
  assert.equal(h.$('guide-screen').hidden,false);
  assert.equal(h.tabs[2].getAttribute('aria-current'),'page');
});
test('search filters session results locally, handles Vietnamese accents and restores destination',()=>{
  const h=harness();
  h.shell.register(h.row(),'Ảnh Đà Lạt.HEIC').update('ready','Ready');
  h.shell.register(h.row(),'Portrait.jpg').update('failed','Error');
  h.tabs[3].click();h.$('toggle-search').click();
  assert.equal(h.$('history-screen').hidden,false);
  assert.equal(h.$('history-search-field').hidden,false);
  assert.equal(h.$('toggle-search').getAttribute('aria-expanded'),'true');
  assert.equal(h.doc.activeElement,h.$('history-search'));
  h.$('history-search').value='anh da lat';h.$('history-search').dispatchEvent(new Event('input'));
  assert.equal(h.$('history-items').children.length,1);
  assert.equal(h.$('history-items').firstElementChild.querySelector('.task-copy>strong').textContent,'Ảnh Đà Lạt.HEIC');
  h.$('history-search').value='unknown';h.$('history-search').dispatchEvent(new Event('input'));
  assert.equal(h.$('history-no-matches').hidden,false);
  h.$('clear-search').click();
  assert.equal(h.$('history-items').children.length,2);
  h.$('toggle-search').click();
  assert.equal(h.$('settings-screen').hidden,false);
  assert.equal(h.$('history-search-field').hidden,true);
  assert.equal(h.doc.activeElement,h.$('toggle-search'));
});
test('browser Back closes search and leaves the selected destination valid',()=>{
  const h=harness();h.tabs[2].click();h.$('toggle-search').click();h.win.history.back();
  assert.equal(h.$('history-search-field').hidden,true);
  assert.equal(h.$('process-screen').hidden,false);
});

test('Search close tap retains input focus until activation so keyboard clearance cannot move the target',()=>{
  const h=harness(),close=h.$('toggle-search');
  const idle=new Event('pointerdown',{cancelable:true});close.dispatchEvent(idle);
  assert.equal(idle.defaultPrevented,false);
  close.click();assert.equal(h.doc.activeElement,h.$('history-search'));
  const down=new Event('pointerdown',{cancelable:true});close.dispatchEvent(down);
  assert.equal(down.defaultPrevented,true);
  close.dispatchEvent(new Event('click'));
  assert.equal(h.$('history-search-field').hidden,true);
  assert.equal(h.doc.activeElement,close);
});


test('dock clears stale offsets on resume and only lifts for a real Search keyboard resize',()=>{
  const win=new EventTarget(),viewport=new EventTarget(),input=new EventTarget(),values=new Map(),classes=new Set(['is-searching']);
  viewport.height=550;viewport.offsetTop=24;viewport.scale=1;win.visualViewport=viewport;win.innerHeight=700;
  let frame,scheduled=0;win.requestAnimationFrame=fn=>{frame=fn;scheduled++;return scheduled;};win.cancelAnimationFrame=()=>frame=null;
  const flush=()=>{const next=frame;frame=null;next?.();};
  const dock={
    style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},
    classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)}
  };
  const field={hidden:false};
  const doc={activeElement:null,visibilityState:'visible',querySelector:()=>dock,getElementById:id=>id==='history-search-field'?field:input};
  values.set('--dock-viewport-bottom','stale');values.set('--dock-keyboard-offset','180px');
  const dispose=bindDockViewport({win,doc});
  assert.equal(values.has('--dock-viewport-bottom'),false,'binding clears stale inline viewport state');
  assert.equal(values.has('--dock-keyboard-offset'),false);
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(values.has('--dock-keyboard-offset'),false,'warm resume does not invent a resting offset');

  doc.activeElement=input;input.dispatchEvent(new Event('focus'));
  assert.equal(values.has('--dock-keyboard-offset'),false,'focus alone never trusts stale geometry');
  const beforeKeyboard=scheduled;
  viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));
  assert.equal(scheduled,beforeKeyboard+1,'resize/scroll coalesce into one frame');flush();
  assert.equal(values.has('--dock-viewport-bottom'),false,'chrome uses keyboard clearance without a viewport-height override');
  assert.equal(values.get('--dock-keyboard-offset'),'126px');
  viewport.height=500;viewport.dispatchEvent(new Event('resize'));flush();
  assert.equal(values.get('--dock-keyboard-offset'),'176px');
  win.dispatchEvent(new Event('resize'));flush();
  assert.equal(values.get('--dock-keyboard-offset'),'176px','a simultaneous layout resize must not cancel the Search keyboard position');
  viewport.scale=1.5;viewport.dispatchEvent(new Event('resize'));flush();
  assert.equal(values.has('--dock-keyboard-offset'),false,'pinch zoom is never treated as a keyboard');
  viewport.scale=1;win.dispatchEvent(new Event('pagehide'));
  assert.equal(values.has('--dock-keyboard-offset'),false,'pagehide clears keyboard offsets');
  dispose();viewport.dispatchEvent(new Event('resize'));assert.equal(frame,null);
});
test('standalone dock lets CSS handle viewport corrections after load settles',()=>{
  const win=new EventTarget(),viewport=new EventTarget(),input=new EventTarget(),values=new Map();
  viewport.height=720;viewport.offsetTop=0;viewport.scale=1;win.visualViewport=viewport;win.innerHeight=756;
  win.navigator={standalone:true};win.matchMedia=()=>({matches:true});
  let frame;win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>frame=null;
  win.setTimeout=()=>1;win.clearTimeout=()=>{};
  const dock={style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},classList:{contains:()=>false}};
  const doc={documentElement:{clientHeight:756},activeElement:null,visibilityState:'visible',querySelector:()=>dock,getElementById:id=>id==='history-search-field'?{hidden:true}:input,addEventListener(){},removeEventListener(){}};
  const flush=()=>{const next=frame;frame=null;next?.();};
  const dispose=bindDockViewport({win,doc});flush();
  assert.equal(values.has('--dock-shell-height'),false);
  win.innerHeight=812;doc.documentElement.clientHeight=812;win.dispatchEvent(new Event('load'));flush();
  assert.equal(values.has('--dock-shell-height'),false,'a later JS correction must not pin a pixel height either');
  dispose();
});

test('standalone dock follows the visible layout viewport instead of overshooting to physical screen height',()=>{
  const win=new EventTarget(),viewport=new EventTarget(),input=new EventTarget(),values=new Map();
  viewport.height=720;viewport.offsetTop=0;viewport.scale=1;win.visualViewport=viewport;win.innerHeight=756;
  win.screen={height:844,availHeight:844};win.navigator={standalone:true};win.matchMedia=()=>({matches:true});
  let frame;win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>frame=null;
  win.setTimeout=()=>1;win.clearTimeout=()=>{};
  const dock={style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},classList:{contains:()=>false}};
  const doc={documentElement:{clientHeight:756},activeElement:null,visibilityState:'visible',querySelector:()=>dock,getElementById:id=>id==='history-search-field'?{hidden:true}:input,addEventListener(){},removeEventListener(){}};
  const flush=()=>{const next=frame;frame=null;next?.();};
  const dispose=bindDockViewport({win,doc});flush();
  assert.equal(values.has('--dock-shell-height'),false,'neither physical nor JavaScript heights may override the CSS viewport');
  win.innerHeight=720;doc.documentElement.clientHeight=720;win.dispatchEvent(new Event('resize'));flush();
  assert.equal(values.has('--dock-shell-height'),false,'dock never keeps a stale pixel floor');
  dispose();
});
test('dock viewport enhancement is optional without VisualViewport',()=>{
  assert.doesNotThrow(()=>bindDockViewport({win:{},doc:{querySelector:()=>({}),getElementById:()=>({})}})());
});

test('Search keyboard clearance uses the chrome bounds even when innerHeight is stale',()=>{
  const win=new EventTarget(),viewport=new EventTarget(),input=new EventTarget(),values=new Map();
  win.innerHeight=756;viewport.height=530;viewport.offsetTop=14;viewport.scale=1;win.visualViewport=viewport;
  let frame;win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>{frame=null;};
  const style={setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)};
  const dock={style,classList:{contains:()=>true}};
  const chrome={style,getBoundingClientRect:()=>({bottom:844})};
  const doc={activeElement:input,visibilityState:'visible',querySelector:()=>dock,
    getElementById:id=>id==='app-chrome'?chrome:id==='history-search-field'?{hidden:false}:input,
    addEventListener(){},removeEventListener(){}};
  const dispose=bindDockViewport({win,doc});
  input.dispatchEvent(new Event('focus'));viewport.dispatchEvent(new Event('resize'));frame();
  assert.equal(values.get('--dock-keyboard-offset'),'300px');
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(values.has('--dock-keyboard-offset'),false);
  dispose();
});

test('standalone cold launches never pin the dock to stale JavaScript viewport heights',()=>{
  const win=new EventTarget(),input=new EventTarget(),viewport=new EventTarget(),values=new Map();
  win.innerHeight=756;win.navigator={standalone:true};win.visualViewport=viewport;
  viewport.height=720;viewport.offsetTop=0;viewport.scale=1;
  win.matchMedia=()=>({matches:true});
  win.requestAnimationFrame=fn=>{fn();return 1;};win.cancelAnimationFrame=()=>{};
  win.setTimeout=()=>1;win.clearTimeout=()=>{};
  const doc={documentElement:{clientHeight:756},activeElement:null,
    querySelector:()=>({style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)}}),
    getElementById:id=>id==='history-search-field'?{hidden:true}:input,
    addEventListener(){},removeEventListener(){}};
  const dispose=bindDockViewport({win,doc});
  assert.equal(values.has('--dock-shell-height'),false,'CSS viewport must own resting geometry even if JS remains stale for the entire session');
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(values.has('--dock-shell-height'),false);
  dispose();
});

function glassHarness({reduced=false}={}){
  const target=()=>{
    const listeners=new Map(),classes=new Set(),styles=new Map();
    return {
      classList:{add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},
      style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k),getPropertyValue:k=>styles.get(k)},
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
      fire(type,props={}){
        const event={type,target:this,button:0,pointerId:1,isPrimary:true,clientX:50,clientY:27,
          preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};
        for(const fn of listeners.get(type)||[])fn(event);return event;
      },
    };
  };
  const nav=target(),doc=target(),win=target(),selected=[];
  nav.getBoundingClientRect=()=>({left:0,right:400,top:0,bottom:54,width:400,height:54});
  nav.setPointerCapture=nav.releasePointerCapture=()=>{};
  const tabs=['process','history','guide','settings'].map((name,index)=>{
    const tab=target();tab.dataset={screen:name};tab.closest=()=>tab;
    tab.getBoundingClientRect=()=>({left:index*100,right:(index+1)*100,width:100});return tab;
  });
  let scheduled,frame;
  win.PointerEvent=function(){};
  win.matchMedia=()=>({matches:reduced});
  win.setTimeout=fn=>{scheduled=fn;return 1;};win.clearTimeout=()=>scheduled=null;
  win.requestAnimationFrame=fn=>{frame=fn;return 2;};win.cancelAnimationFrame=()=>frame=null;
  const dispose=bindTabGlass({nav,tabs,doc,win,select:name=>selected.push(name)});
  return {nav,tabs,doc,win,selected,dispose,flushFrame(){const next=frame;frame=null;next?.();},settle(){scheduled?.();scheduled=null;}};
}
test('glass lens previews a press with measured iOS27 geometry, then commits once and settles',()=>{
  const h=glassHarness();h.nav.fire('pointerdown',{target:h.tabs[1],clientX:150});
  assert.equal(h.nav.classList.contains('is-pressing'),true);
  assert.deepEqual(h.selected,[]);
  assert.equal(h.nav.style.getPropertyValue('--lens-offset'),'100px');
  assert.equal(Number(h.nav.style.getPropertyValue('--ios27-bar-held-scale')).toFixed(5),'1.03535');
  assert.equal(Number(h.nav.style.getPropertyValue('--ios27-lens-held-sx')).toFixed(2),'1.16');
  assert.equal(Number(h.nav.style.getPropertyValue('--ios27-lens-held-sy')).toFixed(5),'1.34783');
  h.doc.fire('pointerup',{clientX:150});
  assert.deepEqual(h.selected,['history']);
  assert.equal(h.nav.classList.contains('is-releasing'),true);
  h.settle();assert.equal(h.nav.classList.contains('is-releasing'),false);
  h.dispose();
});
test('dragging the lens commits the released tab, not a stale click on the starting tab',()=>{
  const h=glassHarness();h.nav.fire('pointerdown',{target:h.tabs[0]});
  h.doc.fire('pointermove',{clientX:270});assert.deepEqual(h.selected,[]);
  h.doc.fire('pointerup',{clientX:350});assert.deepEqual(h.selected,['settings']);
  const click=h.nav.fire('click',{target:h.tabs[0],detail:1});
  assert.equal(click.defaultPrevented,true);assert.equal(click.stopped,true);
  const keyboard=h.nav.fire('click',{target:h.tabs[2],detail:0});
  assert.equal(keyboard.defaultPrevented,undefined);
  h.dispose();
});
test('cancel, vertical scrolling, window blur and outside release do not navigate',()=>{
  const h=glassHarness();
  for(const action of ['pointercancel','vertical','blur','outside']){
    h.nav.fire('pointerdown',{target:h.tabs[0]});
    if(action==='vertical'){h.doc.fire('pointermove',{clientX:52,clientY:90});h.flushFrame();}
    else if(action==='blur')h.win.fire('blur');
    else h.doc.fire(action==='outside'?'pointerup':action,{clientX:action==='outside'?450:50});
    assert.equal(h.nav.classList.contains('is-pressing'),false);
  }
  assert.deepEqual(h.selected,[]);h.dispose();
});
test('reduced motion settles immediately; disposal removes gesture listeners',()=>{
  const h=glassHarness({reduced:true});
  h.nav.fire('pointerdown',{target:h.tabs[0]});h.doc.fire('pointerup');
  assert.equal(h.nav.classList.contains('is-releasing'),false);
  assert.deepEqual(h.selected,['process']);
  h.dispose();h.nav.fire('pointerdown',{target:h.tabs[2]});h.doc.fire('pointerup',{clientX:250});
  assert.deepEqual(h.selected,['process']);
});
