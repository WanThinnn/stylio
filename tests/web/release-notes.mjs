import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {VERSION} from '../../web/src/app/version.js';
import {createReleaseNotes,renderReleaseMarkdown} from '../../web/src/ui/release-notes.js';
import {syncReleaseInfo} from '../../tools/sync-release-info.mjs';
import {buildWebRelease} from '../../tools/build-web-release.mjs';

function documentFixture(){
  class Node extends EventTarget{
    constructor(tag,text=''){super();this.tagName=tag;this.children=[];this.text=text;this.attrs=new Map();this.hidden=false;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    set textContent(value){this.text=value;this.children=[];}
    get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
    setAttribute(key,value){this.attrs.set(key,value);}
    getAttribute(key){return this.attrs.get(key);}
  }
  const nodes=new Map(['release-notes-content','release-notes-status','release-notes-retry'].map(id=>[id,new Node('div')]));
  const doc={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text),getElementById:id=>nodes.get(id)};
  return {doc,nodes};
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);

test('release Markdown becomes semantic cards, lists and tables with safe links and inert HTML',()=>{
  const {doc}=documentFixture();
  const output=renderReleaseMarkdown('# Stylio v1.1.0\n\n## Changes\n\n- Keep **Styles**\n  and `HDR`.\n- [Guide](../docs/web/processing-guide.md)\n\n| Tier | Depth |\n| --- | --- |\n| Pro | V3 |\n\n<img src=x onerror=alert(1)> [Bad](javascript:alert)\n',{doc});
  const all=descendants(output);
  assert.equal(all.filter(n=>n.className==='release-card').length,1);
  assert.equal(all.filter(n=>n.tagName==='li').length,2);
  assert.equal(all.filter(n=>n.tagName==='table').length,1);
  assert.ok(output.textContent.includes('Keep Styles and HDR.'));
  assert.ok(output.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(all.filter(n=>n.tagName==='img').length,2,'only the app theme icons are images');
  const links=all.filter(n=>n.tagName==='a');assert.equal(links.length,1);
  assert.equal(links[0].href,'https://github.com/WanThinnn/stylio/blob/master/docs/web/processing-guide.md');
  assert.equal(links[0].rel,'noopener noreferrer');
});

test('release-note loading deduplicates requests, retries failures and retains loaded content',async()=>{
  const {doc,nodes}=documentFixture();let calls=0;
  const viewer=createReleaseNotes({doc,win:{},translate:key=>key,fetchMarkdown:async()=>{
    calls++;if(calls===1)throw Error('offline');return `# Stylio v${VERSION}\n\n## Fixes\n\n- HDR\n`;
  }});
  const first=viewer.load();assert.equal(viewer.load(),first);await first;
  assert.equal(calls,1);assert.equal(nodes.get('release-notes-retry').hidden,false);
  assert.equal(nodes.get('release-notes-status').textContent,'release.unavailable');
  await viewer.load();assert.equal(calls,2);assert.equal(nodes.get('release-notes-status').hidden,true);
  assert.ok(nodes.get('release-notes-content').textContent.includes('HDR'));
  await viewer.load();assert.equal(calls,2);
});

test('version mismatch never renders a stale document under the current app version',async()=>{
  const {doc,nodes}=documentFixture();
  const viewer=createReleaseNotes({doc,win:{},translate:key=>key,fetchMarkdown:async()=> '# Stylio v0.0.0\n\nWrong release'});
  await viewer.load();assert.equal(nodes.get('release-notes-content').children.length,0);
  assert.equal(nodes.get('release-notes-retry').hidden,false);
});

test('VERSION drives source synchronization, release packaging and the offline document entry',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'stylio-release-info-'));
  try{
    const web=join(temp,'web'),notes=join(temp,'release_note'),output=join(temp,'out');
    await mkdir(web);await mkdir(notes);
    await writeFile(join(web,'VERSION'),'2.3.4\n');await writeFile(join(notes,'v2.3.4.md'),'# Stylio v2.3.4\n\n## New\n\n- Updated\n');
    await writeFile(join(web,'sw.js'),'const APP_SHELL=["./release-notes/v0.0.0.md"];');
    await syncReleaseInfo(web);await syncReleaseInfo(web,web,{check:true});
    await writeFile(join(notes,'v2.3.4.md'),'# Stylio v2.3.4\n\nLatest content\n');
    await assert.rejects(syncReleaseInfo(web,web,{check:true}),/Stale release asset/);
    await buildWebRelease(web,output,'abcdef1234567');
    assert.ok((await readFile(join(output,'src/app/version.js'),'utf8')).includes('"2.3.4"'));
    assert.equal(await readFile(join(output,'release-notes/v2.3.4.md'),'utf8'),'# Stylio v2.3.4\n\nLatest content\n');
    assert.ok((await readFile(join(output,'sw.js'),'utf8')).includes('./release-notes/v2.3.4.md'));
  }finally{
    assert.ok(resolve(temp).startsWith(resolve(tmpdir())+sep+'stylio-release-info-'));
    await rm(temp,{recursive:true,force:true});
  }
});

test('checked-in web assets are synchronized with the editable VERSION and Markdown',async()=>{
  await syncReleaseInfo(fileURLToPath(new URL('../../web/',import.meta.url)),undefined,{check:true});
});
