import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {TranslationTasks} from './translationTasks';
import {RateLimitError} from './modelApi';
import type {Paper,Result} from './library';
import type {Settings} from './settings';

const settings:Settings={provider:'llm',endpoint:'https://example.org/v1',model:'test-model',key:'fixture-only',glossary:''};
function paper(source:string,kinds:('paragraph'|'caption')[]=['paragraph']):Paper{
  return {source,title:source,id:source,html:'',authors:'',blocks:kinds.map((kind,i)=>({id:source+'-'+i,kind,input:'Original '+i,text:'Original '+i,tokens:{},html:'',level:0}))};
}
async function until(check:()=>boolean){for(let i=0;i<200;i++){if(check())return;await setImmediate();}assert.fail('任务状态未按预期变化');}
function fixture(){

  const store=new Map<string,Record<string,Result>>(),calls:{source:string;id:string;model:string;at:number}[]=[];
  let handler:((signal:AbortSignal)=>Promise<Result>)|undefined;
  const queue=new TranslationTasks({
    read:async source=>({...store.get(source)}),cached:async()=>undefined,
    translate:async(block,config,signal)=>{calls.push({source:block.id.split('-')[0],id:block.id,model:config.model,at:Date.now()});return handler?handler(signal):{html:'译文',type:'api'};},
    save:async(source,id,_key,result)=>{const results=store.get(source)||{};const existing=results[id];if(!existing?.html.trim())results[id]=result;store.set(source,results);return {result:results[id],saved:!existing?.html.trim()};},result:()=>{},
  });
  return {queue,store,calls,setHandler:(fn?:typeof handler)=>{handler=fn;}};
}

test('paper tasks keep source and API snapshot, pause after saving, and resume only missing content',async()=>{
  const f=fixture();let release!:(value:Result)=>void;
  f.setHandler(()=>new Promise(resolve=>{release=resolve;}));
  const a=paper('A',['paragraph','paragraph','caption']),b=paper('B'),config={...settings};
  f.queue.start(a,config,'all',{});f.queue.start(b,settings,'body',{});config.model='changed-after-start';
  await until(()=>f.calls.length===1);f.queue.pause('A');assert.equal(f.queue.active('A')?.status,'pausing');
  f.setHandler();release({html:'A已保存',type:'api'});
  await until(()=>f.queue.snapshot().find(t=>t.source==='B')?.status==='completed');
  assert.equal(f.queue.active('A')?.status,'paused');assert.equal(f.store.get('A')?.['A-0'].html,'A已保存');
  assert.equal(f.calls[0].model,'test-model');assert.equal(f.store.get('B')?.['B-0'].html,'译文');
  f.store.get('A')!['A-1']={html:'其他途径已翻译',type:'assistant'};
  f.queue.resume('A');await until(()=>f.queue.snapshot().find(t=>t.source==='A')?.status==='completed');
  assert.deepEqual(f.calls.map(c=>c.id),['A-0','B-0','A-2']);
  assert.equal(f.queue.snapshot().find(t=>t.source==='A')?.done,3);

});

test('body and caption scopes stay separate while combined tasks include both',async()=>{
  for(const [scope,expected] of [['body',['P-0']],['captions',['P-1']],['all',['P-0','P-1']]] as const){
    const f=fixture();f.queue.start(paper('P',['paragraph','caption']),settings,scope,{});
    await until(()=>f.queue.snapshot()[0].status==='completed');assert.deepEqual(f.calls.map(c=>c.id),expected);
  }
});

test('cancel aborts the in-flight request, preserves saved results and prevents queued requests',async()=>{
  const f=fixture();f.store.set('A',{'A-0':{html:'已有译文',type:'api'}});
  f.setHandler(signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  f.queue.start(paper('A',['paragraph','paragraph']),settings,'all',{});f.queue.start(paper('B'),settings,'all',{});
  await until(()=>f.calls.length===1);f.queue.pause('B');f.queue.resume('B');f.queue.cancel('B');f.queue.cancel('A');
  await setImmediate();assert.equal(f.queue.snapshot().find(t=>t.source==='A')?.status,'cancelled');
  assert.equal(f.calls.length,1);assert.equal(f.store.get('A')?.['A-0'].html,'已有译文');
  f.setHandler();f.queue.start(paper('B'),settings,'all',{});await until(()=>f.queue.snapshot().find(t=>t.source==='B')?.status==='completed');
});

test('rate limits are recorded per item without waiting, pausing or automatic retries',async()=>{
  const f=fixture();let attempts=0;const seen:string[]=[];
  f.queue.subscribe(()=>seen.push(f.queue.snapshot()[0]?.status));
  f.setHandler(async()=>{if(++attempts===1)throw new RateLimitError('限流',120000);return {html:'成功',type:'api'};});
  f.queue.start(paper('A',['paragraph','caption']),settings,'all',{});f.queue.start(paper('B'),settings,'all',{});
  await until(()=>f.queue.snapshot().every(t=>t.status==='completed'));
  assert.deepEqual(f.calls.map(c=>c.id),['A-0','A-1','B-0']);
  assert.ok(!seen.includes('paused')&&!seen.includes('waiting'));
  const task=f.queue.snapshot().find(t=>t.source==='A')!;
  assert.equal(task.done,1);assert.equal(task.failures,1);assert.match(task.error!,/A-0.*限流/);
  f.queue.resume('A');await until(()=>f.queue.snapshot().find(t=>t.source==='A')?.failures===0&&f.queue.snapshot().find(t=>t.source==='A')?.status==='completed');
  assert.deepEqual(f.calls.map(c=>c.id),['A-0','A-1','B-0','A-0']);
});

test('ordinary API errors also continue through the paper, and manual retry fills failures only',async()=>{
  const f=fixture();f.setHandler(async()=>{throw Error('模型名称无效');});
  f.queue.start(paper('A',['paragraph','caption']),settings,'all',{});await until(()=>f.queue.snapshot()[0].status==='completed');
  assert.equal(f.calls.length,2);assert.equal(f.queue.snapshot()[0].failures,2);assert.equal(f.queue.snapshot()[0].done,0);
  assert.match(f.queue.snapshot()[0].error!,/A-1.*模型名称/);
  f.setHandler();f.queue.resume('A');await until(()=>f.queue.snapshot()[0].status==='completed'&&f.queue.snapshot()[0].failures===0);
  assert.equal(f.queue.snapshot()[0].saved,2);assert.equal(f.calls.length,4);
});

test('manual Pause remains available even if the current API request fails',async()=>{
  const f=fixture();let reject!:(error:Error)=>void;
  f.setHandler(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  f.queue.start(paper('P',['paragraph','caption']),settings,'all',{});await until(()=>f.calls.length===1);
  f.queue.pause('P');reject(new RateLimitError('限流'));await until(()=>f.queue.snapshot()[0].status==='paused');
  assert.equal(f.calls.length,1);assert.equal(f.queue.snapshot()[0].failures,1);
  f.setHandler();f.queue.resume('P');await until(()=>f.queue.snapshot()[0].status==='completed');
  assert.equal(f.queue.snapshot()[0].done,2);
});

test('cancel during an in-progress save preserves its result and keeps the cancelled status',async()=>{
  let finishSave!:(value:{result:Result;saved:boolean})=>void;
  let saved=false;
  const queue=new TranslationTasks({read:async()=>({}),cached:async()=>undefined,
    translate:async()=>({html:'已完成的译文',type:'api'}),
    save:()=>new Promise(resolve=>{finishSave=value=>{saved=true;resolve(value);};}),result:()=>{}});
  queue.start(paper('P'),settings,'body',{});
  await until(()=>!!finishSave);
  queue.cancel('P');assert.equal(queue.snapshot()[0].status,'cancelled');
  finishSave({result:{html:'已完成的译文',type:'api'},saved:true});await setImmediate();
  assert.equal(saved,true);assert.equal(queue.snapshot()[0].status,'cancelled');
  assert.equal(queue.snapshot()[0].saved,1);assert.equal(queue.snapshot()[0].activeId,undefined);
  queue.dismiss('P');assert.equal(queue.snapshot().length,0);
});
