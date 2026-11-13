// Result DOM and output lifetime. Processing is supplied by the controller.
import {describeInWorker} from '../../media/heic-processing.js';
import {formatBytes} from '../result-metadata.js';
import {confirmAction} from '../confirm-dialog.js';
export function createResultView({list,T,aiText,resultCleanups,resultUrls,aiCandidates,livePhotos,liveMovies,aiFeatures,refreshHistoryButton,shell,historyStore,previewEnabled=()=>true,preferences,updateReadyPhoto}){
  const detailIcon=key=>({
    'group.details':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/><circle cx="18" cy="17" r="2"/></svg>',
    'group.processing':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h7m4 0h5M4 12h3m4 0h9M4 17h9m4 0h3"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/></svg>',
    'group.photo':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>',
    'detail.save':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>',
    'meta.camera':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l1.4-2h5.2L16 7h4v11H4Z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
    'meta.dimensions':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    'meta.size':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v5h5"/></svg>',
    'meta.resources':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16Z"/></svg>',
    'meta.capture':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>'
  }[key]||'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/></svg>');
  function row(name,sourceFile,{historyId=(globalThis.crypto?.randomUUID?.()||`history-${Date.now()}-${Math.random().toString(16).slice(2)}`),restored=false,restoredPreview=null,restoredThumbnail=null}={}) {
    const el = document.createElement("div");
    el.className = "row";
    const previewSource=restoredPreview||sourceFile;
    const hasPreview=Boolean(previewEnabled()&&previewSource&&previewSource.type!=='video/quicktime');
    el.dataset.preview=hasPreview?'on':'off';
    el.innerHTML = `<div class="result-header"><div class="name"></div><div class="status"></div></div><div class="act"></div>`;
    el.querySelector(".name").textContent = name;
    el.querySelector(".name").title = name;
    list.appendChild(el);
    let previewSnapshot=restoredPreview||null,previewSnapshotPromise=Promise.resolve(previewSnapshot),persistedOutput=null,historyThumbnail=restoredThumbnail||null,lastOutput=null;
    const persistHistory=()=>persistedOutput&&historyStore?.save?.({
      id:historyId,name,file:persistedOutput,preview:previewSnapshot,thumbnail:historyThumbnail
    });
    const presentation=shell?.register(el,name,previewSource,{
      thumbnail:restoredThumbnail,
      onThumbnail:thumbnail=>{historyThumbnail=thumbnail;void persistHistory();}
    });
    el.querySelector('.status').setAttribute('role','status');
    const cleanups=new Set(),downloadedFiles=new WeakSet(),savedFiles=new WeakSet();let disposed=false;
    const syncReadyPhoto=()=>updateReadyPhoto?.(historyId,
      !disposed&&ui.resultState==='ready'&&!ui.outputPendingState?lastOutput:null);
    const ensureDetails=()=>{
      let details=el.querySelector('.result-details');
      if(details)return details;
      details=document.createElement('details');details.className='result-details';
      const summary=document.createElement('summary');
      const summaryIcon=document.createElement('span');summaryIcon.className='details-summary-icon';summaryIcon.innerHTML=detailIcon('group.details');
      const summaryLabel=document.createElement('span');summaryLabel.textContent=T('h.conversiondetails');
      summary.append(summaryIcon,summaryLabel);details.append(summary);
      el.insertBefore(details,el.querySelector('.act'));
      return details;
    };
    const ensureDetailGroup=(kind,labelKey,iconKey)=>{
      const details=ensureDetails();
      let group=details.querySelector(`[data-detail-group="${kind}"]`);
      if(group)return group.querySelector('.detail-group-body');
      group=document.createElement('section');group.className='detail-group';group.dataset.detailGroup=kind;
      const heading=document.createElement('h3');heading.className='detail-group-title';
      const icon=document.createElement('span');icon.className='detail-group-icon';icon.innerHTML=detailIcon(iconKey);
      const label=document.createElement('span');label.dataset.i18n=labelKey;label.textContent=T(labelKey);
      heading.append(icon,label);
      const body=document.createElement('div');body.className='detail-group-body';group.append(heading,body);
      const metadata=details.querySelector('[data-detail-group="metadata"]');
      if(kind==='processing'&&metadata)details.insertBefore(group,metadata);else details.append(group);
      return body;
    };
    const pruneDetailGroup=group=>{
      if(!group)return;
      const body=group.querySelector('.detail-group-body');
      if(body&&!body.children.length)group.remove();
      const details=el.querySelector('.result-details');
      if(details&&!details.querySelector('.detail-group'))details.remove();
    };
    if(hasPreview){
      const figure=document.createElement('figure');figure.className='source-preview';
      const image=document.createElement('img');image.alt=name;image.loading='lazy';image.decoding='async';
      if(!restoredPreview){
        previewSnapshotPromise=new Promise(resolve=>{
          image.addEventListener('load',()=>{
            try{
              const maxWidth=960,scale=Math.min(1,maxWidth/image.naturalWidth),canvas=document.createElement('canvas');
              canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
              canvas.getContext('2d')?.drawImage(image,0,0,canvas.width,canvas.height);
              canvas.toBlob?.(blob=>{canvas.width=canvas.height=0;resolve(blob||null);},'image/jpeg',.82);
              if(!canvas.toBlob){canvas.width=canvas.height=0;resolve(null);}
            }catch{resolve(null);}
          },{once:true});
          image.addEventListener('error',()=>resolve(null),{once:true});
        });
        previewSnapshotPromise.then(preview=>{previewSnapshot=preview;void persistHistory();});
      }
      image.addEventListener('error',()=>{figure.dataset.unavailable='true';figure.hidden=true;});
      const url=URL.createObjectURL(previewSource);image.src=url;resultUrls.add(url);
      const caption=document.createElement('figcaption');caption.dataset.i18n='shell.sourcepreview';caption.textContent=T('shell.sourcepreview');
      figure.append(image,caption);el.insertBefore(figure,el.querySelector('.act'));
      // Persist only a display-sized JPEG preview; full originals/results stay separate.
      cleanups.add(()=>{URL.revokeObjectURL(url);resultUrls.delete(url);});
    }
    const remove=document.createElement('button');remove.type='button';remove.className='result-remove';remove.disabled=true;
    remove.setAttribute('aria-label',T('btn.removeresult'));
    remove.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    const title=document.createElement('div');title.className='result-title';title.append(el.querySelector('.name'),remove);el.querySelector('.result-header').prepend(title);
    refreshHistoryButton();
    function actions(group) {
      let host=el.querySelector(`.output-actions[data-output="${group}"]`);
      if(!host){
        host=document.createElement('div');host.className='output-actions';host.dataset.output=group;
        el.querySelector('.act').append(host);
      }
      if(group==='depth'&&!host.querySelector('.output-label')){
        const label=document.createElement('span');label.className='output-label';label.textContent=aiText().depthLabel;
        host.append(label);
        const normal=el.querySelector('.output-actions[data-output="normal"]');
        if(normal&&!normal.querySelector('.output-label')){
          const text=document.createElement('span');text.className='output-label';text.textContent=aiText().normalLabel;normal.prepend(text);
        }
      }
      return host;
    }
    const ui={
      queued(){this.set(T('shell.queued'),'queued');},
      cleanup(fn){cleanups.add(fn);},
      progress(value){presentation?.progress?.(value);},
      dispose(){
        if(disposed)return;disposed=true;
        syncReadyPhoto();
        presentation?.dispose();
        void historyStore?.remove?.(historyId);
        for(const cleanup of cleanups)cleanup();cleanups.clear();resultCleanups.delete(ui.dispose);
        for(const a of el.querySelectorAll('a[href]')){URL.revokeObjectURL(a.href);resultUrls.delete(a.href);}
        for(let i=aiCandidates.length-1;i>=0;i--)if(aiCandidates[i].ui===ui){aiCandidates[i].controller?.abort();aiCandidates[i].state='removed';aiCandidates.splice(i,1);}
        for(let i=livePhotos.length-1;i>=0;i--)if(livePhotos[i].ui===ui)livePhotos.splice(i,1);
        for(const [id,movie]of liveMovies)if(movie.ui===ui)liveMovies.delete(id);
        el.remove();refreshHistoryButton();
      },
      async metadata(data, inputSize, {raster = false, raw = false, outputEpoch = null} = {}) {
        if(outputEpoch===null){this.inputSize=inputSize;this.metadataOptions={raster,raw};}
        let m;
        try { m = await describeInWorker(data); }
        catch (error) { console.warn('Metadata unavailable:', error); return; }
        if(disposed||outputEpoch!==null&&outputEpoch!==this.outputEpoch)return;
        const values = [['meta.camera', m.camera], ['meta.dimensions', `${m.width} × ${m.height}`],
          ['meta.size', `${formatBytes(inputSize)} → ${formatBytes(m.bytes)}`],
          ['meta.resources', [raster ? 'SDR' : m.hdr ? 'HDR' : 'SDR', ...(m.depth ? [T('meta.depth')] : []), ...(raw ? ['RAW → HEIC'] : [])].join(' · ')]];
        if (m.capture) values.push(['meta.capture', `${m.capture.date}${m.capture.subsec ? '.' + m.capture.subsec : ''}${m.capture.offset ? ' ' + m.capture.offset : ''}`]);
        // Reuse the compact native details control; metadata never includes GPS or face regions.
        const metadataBody=ensureDetailGroup('metadata','details.photo','group.photo');
        metadataBody.querySelector('.result-metadata')?.remove();
        const grid = document.createElement('dl'); grid.className = 'result-metadata';
        for (const [key, value] of values) {
          if (!value) continue;
          const field = document.createElement('div'), icon=document.createElement('span'), copy=document.createElement('span');
          const label = document.createElement('dt'), content = document.createElement('dd');
          field.className='result-meta-row';field.dataset.meta=key;
          icon.className='result-meta-icon';icon.innerHTML=detailIcon(key);
          copy.className='result-meta-copy';
          label.dataset.i18n = key; label.textContent = T(key); content.textContent = value;
          copy.append(label,content);field.append(icon,copy);grid.append(field);
        }
        metadataBody.append(grid);
      },
      aiState(text) {
        let state=el.querySelector('.ai-status');
        if(!state){state=document.createElement('p');state.className='ai-status';el.append(state);}
        state.textContent=text;
        if(text)presentation?.update('processing',text);
      },
      cancelAi(controller) {
        const button=document.createElement('button');button.type='button';button.className='dl alt ai-cancel';button.textContent=aiText().cancel;
        button.addEventListener('click',()=>controller.abort());el.append(button);
        return ()=>button.remove();
      },
      aiBusy(busy) {
        el.querySelector('.act').style.display=busy?'none':'';
        if(busy){this.readyNotice||=el.querySelector('.status').textContent;this.set(aiText().loading);}
        else if(this.readyNotice){this.set(this.readyNotice,'ok');this.readyNotice=null;}
      },
      aiView(visible) { const view=el.querySelector('.ai-details');if(view)view.style.display=visible?'':'none';const source=el.querySelector('.source-preview');if(source)source.hidden=visible||source.dataset.unavailable==='true'; },
      async portraitPreview(result,onSettings) {
        el.querySelector('.ai-details')?.remove();
        if(!previewEnabled()){this.note('','preview');return;}
        const {portraitPreview}=await import('../../portrait/ai-portrait-preview.js');
        const source=el.querySelector('.source-preview');if(source)source.hidden=true;
        const host=document.createElement('section');host.className='ai-details';host.setAttribute('aria-label',aiText().preview);
        el.insertBefore(host,el.querySelector('.act'));
        try{
          this.cleanup(portraitPreview(result,host,aiText(),onSettings,{onPending:pending=>{
            this.portraitPending=pending;if(aiFeatures.enabled('portrait'))this.outputPending(pending);refreshHistoryButton();
          }}));
        }catch(error){host.remove();if(source)source.hidden=source.dataset.unavailable==='true';this.note(aiText().previewFailed,'preview');throw error;}
      },
      outputPending(pending){
        presentation?.update(pending?'updating':this.resultState||'processing',pending?aiText().updating:this.resultStatus||'');
        this.outputPendingState=pending;el.querySelector('.act').setAttribute('aria-busy',String(pending));
        for(const button of el.querySelectorAll('.act button'))button.disabled=pending;
        for(const link of el.querySelectorAll('.act a')){link.setAttribute('aria-disabled',String(pending));link.tabIndex=pending?-1:0;}
        syncReadyPhoto();
      },
      output(file,{metadata=true,persist=true}={}) {
        if(disposed)return;
        lastOutput=file;
        const host=actions('normal');
        for(const a of host.querySelectorAll('a[href]')){URL.revokeObjectURL(a.href);resultUrls.delete(a.href);}
        host.replaceChildren();
        const canShare=Boolean(navigator.canShare?.({files:[file]}));
        const preferDownload=preferences?.get('saveAction')==='download'||!canShare;
        const quickDownload=()=>{
          downloadedFiles.add(file);
          const url=URL.createObjectURL(file),anchor=document.createElement('a');
          anchor.href=url;anchor.download=file.name;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        const quickShare=async()=>{
          try{await navigator.share({files:[file]});savedFiles.add(file);}
          catch(error){if(error?.name!=='AbortError')console.warn('Quick share unavailable',error);}
        };
        if(canShare){
          this.share(file,!!this.liveIdentifier);
          this.note(T('shell.sharehint'),'save');
        }else this.note('','save');
        const shareActions=canShare?[{kind:'share',label:T('shell.quickshare'),run:quickShare}]:[];
        const downloadAction={kind:'download',label:T('shell.quickdownload'),run:quickDownload};
        const quickActions=[
          ...(preferDownload?[downloadAction,...shareActions]:[...shareActions,downloadAction]),
          {kind:'delete',label:T('btn.removeresult'),danger:true,run:async()=>{if(await confirmAction({title:T('shell.remove'),detail:T('confirm.cannotundo'),confirmLabel:T('action.delete'),cancelLabel:T('action.cancel')}))ui.dispose();}},
        ];
        if(presentation?.quickActions)presentation.quickActions(quickActions);
        else presentation?.quickAction?.(quickActions[0].kind,quickActions[0].run,quickActions[0].label);
        this.link(file,file.name);
        const shareButton=host.querySelector('button'),downloadLink=host.querySelector('a');
        if(shareButton)shareButton.className=preferDownload?'dl alt':'dl';
        if(downloadLink){downloadLink.className=preferDownload?'dl':'dl alt';if(preferDownload)host.prepend(downloadLink);}
        presentation?.source?.(file);
        if(persist){persistedOutput=file;void persistHistory();}
        this.liveExporter?.setOutput(file);
        if(metadata){const outputEpoch=this.outputEpoch=(this.outputEpoch||0)+1;
          file.arrayBuffer().then(b=>this.metadata(new Uint8Array(b),this.inputSize||file.size,{...this.metadataOptions,outputEpoch})).catch(console.warn);}
        this.outputPending(Boolean(this.outputPendingState));
      },
      set(text, cls) {
        this.resultState=cls==='queued'?'queued':cls==='ok'?'ready':cls==='err'?'failed':cls==='info'?'info':'processing';
        syncReadyPhoto();
        this.resultStatus=cls==='ok'?T('st.ready'):text;
        presentation?.update(this.resultState,this.resultStatus);
        remove.disabled=!['ok','err','info'].includes(cls);
        const s = el.querySelector(".status");
        s.textContent = cls === 'ok' ? T("st.ready") : text;
        delete s.dataset.i18n;
        el.classList.toggle('is-ready', cls === 'ok');
        if (cls !== 'ok') this.note('','result');
        if (cls === 'info') {
          const icon = document.createElement('span');
          icon.className = 'status-info-icon'; icon.textContent = 'i'; icon.setAttribute('aria-hidden', 'true');
          s.prepend(icon);
        }
        if (cls === 'ok') {
          const label = document.createElement('span');
          label.dataset.i18n = 'st.ready'; label.textContent = T('st.ready');
          const detail=text.replace(`${T('st.ready')} — `,'').trim();
          s.replaceChildren(label);
          if(detail&&detail!==T('st.ready'))this.note(detail,'result');else this.note('','result');
        }
        s.className = `status ${cls || ""}`;
      },
      note(text, kind = "live") {
        let note = el.querySelector(`[data-note="${kind}"]`);
        if(!text){
          const group=note?.closest('.detail-group');
          note?.remove();
          pruneDetailGroup(group);
          return;
        }
        if (!note) {
          note = document.createElement("p");
          note.className = "live-note detail-note-row";
          note.dataset.note = kind;
          const icon=document.createElement('span');icon.className='detail-note-icon';icon.innerHTML=detailIcon(kind==='save'?'detail.save':undefined);
          const copy=document.createElement('span');copy.className='detail-note-copy';note.append(icon,copy);
          ensureDetailGroup('processing','details.processing','group.processing').appendChild(note);
        }
        const copy=note.querySelector('.detail-note-copy');
        if(copy)copy.textContent=text;else note.textContent=text;
      },
      link(blob, filename, key = "btn.download", group = 'normal') {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        resultUrls.add(a.href);
        a.download = filename;
        const label=document.createElement('span');
        const renderDownload=()=>{const downloaded=downloadedFiles.has(blob);a.dataset.downloadStarted=String(downloaded);label.dataset.i18n=downloaded?'btn.downloadagain':key;label.textContent=T(label.dataset.i18n);};
        a.className = group==='normal'&&!navigator.canShare?.({files:[blob]})?'dl':'dl alt';
        a.append(label);renderDownload();
        a.addEventListener('click',e=>{if(this.outputPendingState){e.preventDefault();return;}downloadedFiles.add(blob);renderDownload();});
        actions(group).appendChild(a);
      },
      compatibilityReport(entries) {
        const body=ensureDetailGroup('compatibility','details.compatibility','group.processing');
        body.querySelector('.compatibility-report')?.remove();
        const grid=document.createElement('dl');grid.className='result-metadata compatibility-report';
        for(const [key,value] of entries||[]){
          if(value===undefined||value===null||value==='')continue;
          const field=document.createElement('div'),copy=document.createElement('span');
          const label=document.createElement('dt'),content=document.createElement('dd');
          field.className='result-meta-row';field.dataset.meta=key;
          copy.className='result-meta-copy';label.dataset.i18n=key;label.textContent=T(key);content.textContent=String(value);
          copy.append(label,content);field.append(copy);grid.append(field);
        }
        body.append(grid);
      },
      portraitAdvice(text) {
        this.note(text,'portrait-advice');
      },
      adaptiveStyleAdvice(text) {
        let advice=el.querySelector('.adaptive-style-advice');
        if(!advice){
          advice=document.createElement('p');advice.className='adaptive-style-advice';
          advice.setAttribute('role','status');advice.setAttribute('aria-live','polite');
          el.insertBefore(advice,el.querySelector('.act'));
        }
        advice.textContent=text;
      },
      share(file, live = false, label = null, group = 'normal') {
        const b = document.createElement("button");
        b.className = "dl";
        b.type = "button";
        const text=document.createElement('span');
        const renderSave=()=>{const saved=savedFiles.has(file);text.dataset.i18n=saved?'shell.shareagain':label||'shell.share';text.textContent=T(text.dataset.i18n);};
        b.append(text);renderSave();
        b.addEventListener("click", async () => {
          if (b.disabled) return;
          b.disabled = true;
          try { await navigator.share({ files: [file] });if(!disposed){savedFiles.add(file);renderSave();} }
          catch (e) { if (e.name !== "AbortError") {text.dataset.i18n='btn.blocked';text.textContent=T('btn.blocked');} }
          finally { b.disabled = Boolean(this.outputPendingState); }
        });
        actions(group).prepend(b);
      },
    };
    if(preferences?.subscribe)cleanups.add(preferences.subscribe(key=>{
      if(key==='saveAction'&&lastOutput&&!disposed)ui.output(lastOutput,{metadata:false,persist:false});
    }));
    remove.addEventListener('click',async()=>{if(await confirmAction({title:T('shell.remove'),detail:T('confirm.cannotundo'),confirmLabel:T('action.delete'),cancelLabel:T('action.cancel')}))ui.dispose();});resultCleanups.add(ui.dispose);return ui;
  }

    return row;
}

