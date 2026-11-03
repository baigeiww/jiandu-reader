import {restoreTranslation,cacheKey} from './core';
import {listLibrarySummaries,readPaper,saveAssistantTranslations,type PaperRecord,type Result} from './library';
import {untranslatedBlocks} from './paper';

export type AssistantItem={id:string;input:string;translation:string};
export function assistantSession(storage:Pick<Storage,'getItem'|'setItem'>){
  const key='reader-assistant-session';
  try{const saved=storage.getItem(key);if(saved)return saved;const id=crypto.randomUUID();storage.setItem(key,id);return id;}catch{return crypto.randomUUID();}
}
export function assistantResults(record:PaperRecord,items:AssistantItem[],doc:Document){
  if(!Array.isArray(items)||!items.length||items.length>20)throw Error('每批回填 1–20 项');
  const seen=new Set<string>();
  return items.map(item=>{
    const block=record.paper.blocks.find(b=>b.id===item.id);
    if(!block||!['paragraph','caption'].includes(block.kind))throw Error(`段落 ${item.id} 不存在或不支持翻译，请重新导出`);
    if(block.input!==item.input)throw Error(`段落 ${item.id} 原文已改变，请重新导出`);
    if(seen.has(item.id))throw Error(`段落 ${item.id} 重复，整批尚未保存`);
    seen.add(item.id);
    if(typeof item.translation!=='string'||!item.translation.trim()||item.translation.length>100000)throw Error(`段落 ${item.id} 译文为空或过长`);
    let html:string;
    try{html=restoreTranslation(item.translation.trim(),block.tokens,doc);}catch(error){throw Error(`段落 ${item.id}：${error instanceof Error?error.message:'占位符校验失败'}`);}
    const result:Result={html,type:'assistant'};
    return {id:block.id,key:cacheKey(record.source,block.input,'conversation','assistant',''),result};
  });
}

export function startAssistantBridge(onSaved:(source:string,results:Record<string,Result>)=>void){
  const session=assistantSession(sessionStorage);let stopped=false;let timer:ReturnType<typeof setTimeout>;
  let controller:AbortController|undefined;
  let completed:unknown[]=[];
  const handled=new Map<string,unknown>();
  const tick=async()=>{
    try{
      const library=await listLibrarySummaries();
      const papers=library.papers.map(p=>({source:p.source,title:p.paper.title,group:library.groups.find(g=>g.id===p.groupId)?.name||'未分组',remaining:p.remaining}));
      controller=new AbortController();
      const response=await fetch('/__assistant/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:2,visible:document.visibilityState==='visible',session,papers,completed}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
      if(!response.ok)throw Error('本地通道暂不可用');
      const data=await response.json();completed=[];
      for(const job of data.jobs){
        if(stopped)return;
        if(handled.has(job.id)){completed.push(handled.get(job.id));continue;}
        let result:unknown;
        try{
          const record=await readPaper(job.source);if(!record)throw Error('当前浏览器中未找到这篇论文');
          if(job.action==='export'){
            const pending=untranslatedBlocks(record.paper.blocks,record.results);
            result={id:job.id,source:record.source,title:record.paper.title,remaining:pending.length,instruction:'逐项翻译为简体中文。保留每个 ⟦Pn⟧ 恰好一次，不增加标记；保持术语准确。返回 items，每项含 id、原样 input、translation。',items:pending.slice(0,job.limit).map(b=>({id:b.id,input:b.input,kind:b.kind}))};
          }else{
            // Validate the entire batch before committing anything. Existing translations win.
            const validated=assistantResults(record,job.items,document);
            const saved=await saveAssistantTranslations(record.source,validated);
            if(saved.length){const latest=await readPaper(record.source);if(latest)onSaved(record.source,latest.results);}
            result={id:job.id,saved:saved.length,skipped:validated.length-saved.length};
          }
        }catch(error){result={id:job.id,error:error instanceof Error?error.message:'处理失败'};}
        handled.set(job.id,result);if(handled.size>100)handled.delete(handled.keys().next().value!);completed.push(result);
      }
      if(!stopped)void tick();
      return;
    }catch{/* Retry only connection failures; ordinary work is driven by long polling. */}
    if(!stopped)timer=setTimeout(tick,3000);
  };
  const wake=()=>{if(document.visibilityState==='visible')controller?.abort();};
  document.addEventListener('visibilitychange',wake);
  void tick();return()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',wake);};
}
