import {VERSION} from '../app/version.js';

const sourceURL=new URL(`https://github.com/WanThinnn/stylio/blob/master/release_note/v${VERSION}.md`);

// The release document uses headings, paragraphs, lists, tables and inline
// emphasis/links. Build DOM nodes directly; Markdown HTML is never executed.
function inline(parent,text,doc,baseURL){
  const tokens=/\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<br\s*\/?>/gi;
  let offset=0;
  for(const match of text.matchAll(tokens)){
    parent.append(doc.createTextNode(text.slice(offset,match.index)));
    let node;
    if(match[1]){node=doc.createElement('strong');node.textContent=match[1];}
    else if(match[2]){node=doc.createElement('code');node.textContent=match[2];}
    else if(match[3]){
      let url;try{url=new URL(match[4],baseURL);}catch{}
      node=doc.createElement(url&&['https:','http:'].includes(url.protocol)?'a':'span');node.textContent=match[3];
      if(node.tagName.toLowerCase()==='a'){node.href=url.href;node.target='_blank';node.rel='noopener noreferrer';}
    }else node=doc.createElement('br');
    parent.append(node);offset=match.index+match[0].length;
  }
  parent.append(doc.createTextNode(text.slice(offset)));
}

export function renderReleaseMarkdown(markdown,{doc=document,baseURL=sourceURL}={}){
  const root=doc.createElement('article');root.className='release-document';
  const lines=markdown.replaceAll('\r\n','\n').split('\n');let i=0,container=root,number=0;
  const paragraph=()=>{
    const parts=[];
    while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,3} |[-*] |\|)/.test(lines[i]))parts.push(lines[i++].trim());
    return parts.join(' ');
  };
  while(i<lines.length){
    const line=lines[i].trim();if(!line){i++;continue;}
    if(line.startsWith('# ')){
      const hero=doc.createElement('header');hero.className='release-hero';
      const icon=doc.createElement('span');icon.className='release-app-icon';
      for(const theme of ['light','dark']){
        const image=doc.createElement('img');image.src=new URL(`../../icons/photographic-styles${theme==='dark'?'-dark':''}.svg`,import.meta.url).href;
        image.className=`release-icon-${theme}`;image.alt='';image.width=image.height=64;icon.append(image);
      }
      const title=doc.createElement('h1');title.textContent=line.slice(2);
      hero.append(icon,title);root.append(hero);container=hero;i++;continue;
    }
    if(/^#{2,3} /.test(line)){
      const section=doc.createElement('section');section.className='release-card';
      const title=doc.createElement('h2'),badge=doc.createElement('span');badge.className='release-section-number';badge.setAttribute('aria-hidden','true');badge.textContent=String(++number).padStart(2,'0');
      title.append(badge,doc.createTextNode(line.replace(/^#{2,3} /,'')));section.append(title);root.append(section);container=section;i++;continue;
    }
    if(/^[-*] /.test(line)){
      const list=doc.createElement('ul');
      while(i<lines.length&&/^[-*] /.test(lines[i].trim())){
        let text=lines[i++].trim().slice(2);
        while(i<lines.length&&lines[i].trim()&&!/^(?:[-*] |#{1,3} |\|)/.test(lines[i].trim()))text+=' '+lines[i++].trim();
        const item=doc.createElement('li');inline(item,text,doc,baseURL);list.append(item);
      }
      container.append(list);continue;
    }
    if(line.startsWith('|')){
      const wrap=doc.createElement('div');wrap.className='release-table-wrap';wrap.tabIndex=0;
      const table=doc.createElement('table'),head=doc.createElement('thead'),body=doc.createElement('tbody');let first=true;
      while(i<lines.length&&lines[i].trim().startsWith('|')){
        const cells=lines[i++].trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
        if(cells.every(x=>/^:?-+:?$/.test(x)))continue;
        const row=doc.createElement('tr');
        for(const text of cells){const cell=doc.createElement(first?'th':'td');if(first)cell.scope='col';inline(cell,text,doc,baseURL);row.append(cell);}
        (first?head:body).append(row);first=false;
      }
      table.append(head,body);wrap.append(table);container.append(wrap);continue;
    }
    const p=doc.createElement('p');inline(p,paragraph(),doc,baseURL);container.append(p);
  }
  return root;
}

export function createReleaseNotes({doc=document,win=window,translate,fetchMarkdown=async()=>{
  const response=await win.fetch(new URL(`../../release-notes/v${VERSION}.md`,import.meta.url),{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Release notes unavailable');return response.text();
}}={}){
  const content=doc.getElementById('release-notes-content'),status=doc.getElementById('release-notes-status'),retry=doc.getElementById('release-notes-retry');
  if(!content||!status||!retry)return null;
  let pending=null,loaded=false;
  const load=()=>{
    if(loaded)return Promise.resolve();if(pending)return pending;
    content.setAttribute('aria-busy','true');status.hidden=false;status.textContent=translate('release.loading');retry.hidden=true;
    pending=Promise.resolve().then(fetchMarkdown).then(markdown=>{
      if(!markdown.replaceAll('\r\n','\n').startsWith(`# Stylio v${VERSION}\n`))throw Error('Release note version mismatch');
      content.replaceChildren(renderReleaseMarkdown(markdown,{doc}));status.hidden=true;loaded=true;
    }).catch(()=>{status.hidden=false;status.textContent=translate('release.unavailable');retry.hidden=false;})
      .finally(()=>{content.setAttribute('aria-busy','false');pending=null;});
    return pending;
  };
  retry.addEventListener('click',()=>void load());
  return {load};
}
