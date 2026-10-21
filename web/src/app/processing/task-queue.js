import {waitForVisiblePage} from '../../ui/processing-scheduler.js';

// Share this function with the iframe lane, not a second instance of the
// budget. Waiting jobs hold no codec heaps, model bytes or GPU sessions.
export function createProcessingBudget({concurrency=1}={}){
  let active=0;
  const waiting=[];
  function pump(){
    while(active<concurrency&&waiting.length){
      const job=waiting.shift();job.signal?.removeEventListener('abort',job.abort);
      active++;let released=false;
      job.resolve(()=>{if(released)return;released=true;active--;pump();});
    }
  }
  return function acquire({signal,onWait}={}){
    if(signal?.aborted)return Promise.reject(signal.reason||new DOMException('Cancelled','AbortError'));
    return new Promise((resolve,reject)=>{
      const job={resolve,reject,signal,abort(){
        const index=waiting.indexOf(job);if(index<0)return;
        waiting.splice(index,1);signal.removeEventListener('abort',job.abort);
        reject(signal.reason||new DOMException('Cancelled','AbortError'));
      }};
      waiting.push(job);signal?.addEventListener('abort',job.abort,{once:true});
      if(active>=concurrency)onWait?.();
      pump();
    });
  };
}

// One FIFO shared by picker, drop and optional reprocessing. A lane never runs
// two jobs at once; changing the limit affects the next start, not an active job.
export function createTaskQueue({run,concurrency=()=>1,onChange=()=>{},waitUntilVisible=waitForVisiblePage}={}){
  const waiting=[],active=new Set();
  let scheduled=false;
  const snapshot=()=>({active:active.size,queued:waiting.length,pending:active.size+waiting.length});
  const notify=()=>onChange(snapshot());
  function pump(){
    scheduled=false;
    const limit=concurrency()===2?2:1;
    while(active.size<limit&&waiting.length){
      const index=waiting.findIndex(job=>job.lane===undefined||!active.has(job.lane));
      if(index<0)break;
      const job=waiting.splice(index,1)[0];
      const lane=job.lane??([0,1].find(index=>!active.has(index)));
      active.add(lane);notify();
      Promise.resolve().then(waitUntilVisible).then(()=>run(job.value,lane))
        .then(job.resolve,job.reject).finally(()=>{active.delete(lane);notify();schedule();});
    }
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(pump);}}
  return {
    enqueue(values){
      const jobs=values.map(value=>new Promise((resolve,reject)=>{
        waiting.push({value,lane:value.lane,resolve,reject});
      }));
      notify();schedule();return Promise.all(jobs);
    },
    refresh:schedule,
    snapshot,
  };
}
