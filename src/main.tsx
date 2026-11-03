import React, {lazy,Suspense,useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SOURCE, prepareParagraph, restoreTranslation, cacheKey} from './core';
import {samples} from './samples';
import {Directory} from './PaperDirectory';
import {googleTranslate} from './google';
import {paperUrl,fetchPaper,sourceLabel,sourceKind} from './sources';
import {readConfiguration,activeSettings,writeConfiguration,type Configuration,type Settings} from './settings';
import {SettingsDialog} from './SettingsDialog';
import {PaperReader,type PaperReaderHandle} from './PaperReader';
import {parsePaper,clean,isTranslatable,untranslatedBlocks,type Block,type TranslationScope} from './paper';
import {modelRequest} from './modelApi';
import {FORMULA_PROMPT,formulaMessage,type FormulaTarget} from './formula';
import {PaperLibrary} from './PaperLibrary';
import {FloatingPanel} from './FloatingPanel';
import {SidebarResize} from './SidebarResize';
import {startAssistantBridge} from './assistant';
import {TranslationTasks,type TranslationTask} from './translationTasks';
import {TranslationTaskBar} from './TranslationTaskBar';
import {readPaper,savePaper,readTranslation,saveTranslation,saveAssistantTranslations,type Result,type Paper} from './library';
import './style.css';
import './refined.css';
const MathExplanation=lazy(()=>import('./MathExplanation').then(module=>({default:module.MathExplanation})));

type FormulaState={target:FormulaTarget;loading:boolean;result?:string;error?:string;model:string;cached?:boolean};
const icons = {book:'◫',arrow:'↗',settings:'⚙',close:'×'};
async function loadCached(key:string):Promise<Result|undefined> {
  try{const saved=await readTranslation(key);if(saved)return {...saved,html:clean(saved.html)};}catch{/* Legacy storage remains readable. */}
  try{const saved=JSON.parse(localStorage.getItem('translation:'+key)||'null');return saved?{...saved,html:clean(saved.html)}:undefined;}catch{return undefined;}
}
async function requestUsing(settings:Settings,text:string,tokens:Record<string,string>,signal?:AbortSignal,context=''){
  if(settings.provider==='google'||settings.provider==='google-cloud'){
    if(settings.provider==='google-cloud'&&!settings.key.trim())throw Error('Google Cloud 官方接口需要 API Key。');
    try{return clean(restoreTranslation(await googleTranslate(text,settings.provider==='google-cloud'?settings.key:'',signal),tokens,document));}
    catch(error){if(error instanceof TypeError)throw Error('无法连接 Google，请检查网络或跨域设置。');throw error;}
  }
  const output=await modelRequest(settings,`你是学术论文翻译助手。忠实翻译成简体中文，只返回译文，不返回解释或 Markdown 代码围栏。所有 ⟦P数字⟧ 占位符必须原样保留且各出现一次，不增删。保留数字、语气与条件。术语表：\n${settings.glossary}`,context?`上下文（仅供理解，不翻译）：${context}\n\n待译选区：${text}`:text,8192,signal);
  return clean(restoreTranslation(output,tokens,document));
}

function App() {
  const readerRef=useRef<PaperReaderHandle>(null);
  const [paper,setPaper]=useState<ReturnType<typeof parsePaper>>();
  const [importValue,setImportValue]=useState('');
  const [importing,setImporting]=useState(false);
  const [importError,setImportError]=useState('');
  const importController=useRef<AbortController|undefined>(undefined);
  const paperGeneration=useRef(0);
  const [mode,setMode]=useState('bilingual');
  const [results,setResults]=useState<Record<string,Result>>({});
  const [busy,setBusy]=useState<Record<string,boolean>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [configuration,setConfiguration]=useState<Configuration>(()=>{try{return readConfiguration(localStorage);}catch{return {version:1,activeId:'',profiles:[]};}});
  const [settings,setSettings]=useState(()=>activeSettings(configuration));
  const [dialog,setDialog]=useState(false);
  const [side,setSide]=useState(()=>innerWidth>=1100);
  const [libraryRevision,setLibraryRevision]=useState(0);
  const storageWarning=useRef(false);
  const [active,setActive]=useState('abstract');
  const [font,setFont]=useState(17);
  const [dark,setDark]=useState(false);
  const [notice,setNotice]=useState('');
  const [selection,setSelection]=useState<{text:string; block:string; result?:string; loading?:boolean}>();
  const [formula,setFormula]=useState<FormulaState>();
  const formulaController=useRef<AbortController|undefined>(undefined);
  const formulaCache=useRef(new Map<string,string>());
  const [fatal,setFatal]=useState('');
  const currentSettings=useRef(settings); currentSettings.current=settings;
  const currentPaper=useRef(paper);currentPaper.current=paper;
  const taskQueue=useRef<TranslationTasks|undefined>(undefined);
  const [tasks,setTasks]=useState<TranslationTask[]>([]);
  if(!taskQueue.current)taskQueue.current=new TranslationTasks({
    read:async source=>(await readPaper(source))?.results||{},cached:loadCached,
    translate:async(block,config,signal)=>({html:await requestUsing(config,block.input,block.tokens,signal),type:config.provider.startsWith('google')?'google':'api'}),
    save:async(source,id,key,result)=>{
      const saved=await saveAssistantTranslations(source,[{id,key,result}]);const actual=(await readPaper(source))?.results[id];
      if(!actual)throw Error('译文未能保存，请检查浏览器存储权限或空间。');return {result:actual,saved:saved.includes(id)};
    },
    result:(source,id,result)=>{if(currentPaper.current?.source===source){setResults(x=>({...x,[id]:result}));setErrors(x=>({...x,[id]:''}));}setLibraryRevision(n=>n+1);}
  });
  useEffect(()=>{const queue=taskQueue.current!;const unsubscribe=queue.subscribe(()=>setTasks(queue.snapshot()));return()=>{unsubscribe();queue.stop();};},[]);
  useEffect(()=>startAssistantBridge((source,saved)=>{
    if(currentPaper.current?.source===source){setResults(saved);setErrors({});}
    setLibraryRevision(n=>n+1);toast('对话译文已保存到论文记录。');
  }),[]);
  const isSample=paper?.source===SOURCE;
  const sampleFor=(id:string)=>isSample?samples[id]:undefined;
  useEffect(()=>()=>formulaController.current?.abort(),[]);
  useEffect(()=>{if(new URLSearchParams(location.hash.slice(1)).has('receive'))return;
    let previous=SOURCE;try{previous=localStorage.getItem('reader-last-source')||SOURCE;}catch{/* Browser storage can be disabled. */}
    void importPaper(previous,true);return()=>importController.current?.abort();},[]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
  function storageFailed(){if(!storageWarning.current){storageWarning.current=true;toast('本地保存失败，请检查浏览器存储权限或空间；当前页面仍可阅读。');}}
  async function persistResult(source:string,block:Block,key:string,result:Result){
    try{await saveTranslation(source,block.id,key,result);setLibraryRevision(n=>n+1);}catch{storageFailed();}
  }
  async function restoreResults(next:Paper,saved:Record<string,Result>={}){
    const restored:Record<string,Result>={};
    await Promise.all(next.blocks.filter(isTranslatable).map(async block=>{
      const config=currentSettings.current;
      const key=cacheKey(next.source,block.input,config.provider+':'+config.endpoint,config.model,config.glossary);
      const result=saved[block.id]||await loadCached(key);
      if(result){restored[block.id]={...result,html:clean(result.html)};if(!saved[block.id])await persistResult(next.source,block,key,restored[block.id]);}
    }));
    return restored;
  }
  async function importPaper(input:string,initial=false) {
    let target:string;
    try {target=paperUrl(input);}catch(e){setImportError(e instanceof Error?e.message:String(e));return;}
    importController.current?.abort();const controller=new AbortController();importController.current=controller;
    paperGeneration.current++;setBusy({});setSelection(undefined);closeFormula();setImporting(true);setImportError('');
    try {
      let record;try{record=await readPaper(target);}catch{storageFailed();}
      if(controller.signal.aborted)return;
      const loaded=record?undefined:target===SOURCE?{html:await fetch('/paper.html',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('论文加载失败');return r.text();}),source:SOURCE}:await fetchPaper(target,controller.signal);
      const next=record?parsePaper(record.paper.html,record.source):parsePaper(loaded!.html,loaded!.source);
      if(!next.blocks.some(b=>b.kind==='paragraph'))throw Error('该 HTML 页面没有可识别的论文段落，请换一篇论文。');
      if(controller.signal.aborted)return;
      try{await savePaper(next);setLibraryRevision(n=>n+1);}catch{storageFailed();}
      const restored=await restoreResults(next,(await readPaper(target).catch(()=>{storageFailed();return undefined;}))?.results||record?.results);
      if(controller.signal.aborted)return;
      const latest=await readPaper(target).catch(()=>{storageFailed();return undefined;});if(controller.signal.aborted)return;
      currentPaper.current=next;setPaper(next);setResults({...restored,...latest?.results});setErrors({});setFatal('');setActive('abstract');setImportValue(next.source);if(innerWidth<1100)setSide(false);
      try{localStorage.setItem('reader-last-source',next.source);}catch{/* Reading still works without storage. */}
      if(next.source!==SOURCE && currentSettings.current.provider==='demo') {
        setSettings(s=>({...s,provider:'llm'}));
        toast('论文已导入。请在「翻译设置」填写 API，随后翻译段落或全文。');
      } else toast(Object.keys(restored).length?`论文已打开，已恢复 ${Object.keys(restored).length} 段译文。`:record?'已从论文记录打开。':'论文已导入并保存到论文记录。');
      window.scrollTo({top:0});
    }catch(e){if(!controller.signal.aborted){setImportError(e instanceof Error?e.message:String(e));if(initial&&target!==SOURCE){toast('上次论文暂时无法加载，先打开示例论文。');void importPaper(SOURCE);}}}
    finally{if(importController.current===controller)setImporting(false);}
  }
  function jump(id:string) {readerRef.current?.jump(id);}
  function toast(text:string) {setNotice(text);setTimeout(()=>setNotice(''),4000);}
  function closeFormula(){formulaController.current?.abort();formulaController.current=undefined;setFormula(undefined);}
  async function explainFormula(target:FormulaTarget,force=false){
    if(importing)return;
    formulaController.current?.abort();
    const controller=new AbortController();formulaController.current=controller;
    const config=currentSettings.current;const generation=paperGeneration.current;
    setSelection(undefined);
    const state:FormulaState={target,loading:false,model:config.model};
    if(!['llm','anthropic'].includes(config.provider)){
      setFormula({...state,error:'公式解释需要大模型 API。请在翻译设置中选择 Chat Completions 或 Anthropic 配置，再点击公式。'});return;
    }
    const message=formulaMessage(target);
    const key=JSON.stringify([config.provider,config.endpoint,config.model,FORMULA_PROMPT,message]);
    const cached=force?undefined:formulaCache.current.get(key);
    if(cached){setFormula({...state,result:cached,cached:true});return;}
    setFormula({...state,loading:true});
    try{
      const result=await modelRequest(config,FORMULA_PROMPT,message,2048,controller.signal);
      if(controller!==formulaController.current||generation!==paperGeneration.current||config!==currentSettings.current)return;
      formulaCache.current.set(key,result);if(formulaCache.current.size>32)formulaCache.current.delete(formulaCache.current.keys().next().value!);setFormula({...state,result});
    }catch(error){
      if(controller.signal.aborted||controller!==formulaController.current||generation!==paperGeneration.current||config!==currentSettings.current)return;
      setFormula({...state,error:error instanceof Error?error.message:String(error)});
    }
  }
  async function request(text:string,tokens:Record<string,string>,context=''){return requestUsing(settings,text,tokens,undefined,context);}
  async function translate(block:Block,force=false) {
    if(busy[block.id])return false;
    const task=taskQueue.current!.active(paper!.source);
    if(task&&['queued','running','pausing'].includes(task.status)){toast('这篇论文正在执行翻译任务，请先在任务栏暂停。');return false;}
    const config=currentSettings.current;const generation=paperGeneration.current;
    setBusy(x=>({...x,[block.id]:true}));setErrors(x=>({...x,[block.id]:''}));
    try {
      const key=cacheKey(paper!.source,block.input,settings.provider+':'+settings.endpoint,settings.model,settings.glossary);
      let result:Result|undefined=force?undefined:results[block.id]||await loadCached(key);
      if(result&&!result.html.trim())result=undefined;
      if(!result) {
        if(settings.provider==='demo' && sampleFor(block.id)) result={html:clean(restoreTranslation(sampleFor(block.id)!,block.tokens,document)),type:'sample'};
        else if(settings.provider==='demo')throw Error('本段没有预置译文，请在翻译设置中选择 Google 翻译或其他 API。');
        else result={html:await request(block.input,block.tokens),type:settings.provider.startsWith('google')?'google':'api'};
      }
      await persistResult(paper!.source,block,key,result);
      if(config===currentSettings.current && generation===paperGeneration.current)setResults(x=>({...x,[block.id]:result!}));
      return true;
    } catch(e) {if(generation===paperGeneration.current)setErrors(x=>({...x,[block.id]:e instanceof Error?e.message:String(e)}));return false;}
    finally {if(generation===paperGeneration.current)setBusy(x=>({...x,[block.id]:false}));}
  }
  async function translateAll(scope:TranslationScope='body') {
    if(!paper||importing)return;
    const blocks=untranslatedBlocks(paper.blocks,results,scope);
    if(!blocks.length){toast('所选范围已全部翻译，无需重复请求。');return;}
    if(settings.provider==='demo'){
      if(scope==='captions'){toast('请先在翻译设置中选择 API。');return;}
      for(const block of blocks.filter(b=>sampleFor(b.id)))await translate(block);
      toast('已载入可用的示例译文；其他内容需配置翻译服务。');return;
    }
    if(taskQueue.current!.start(paper,settings,scope,results))toast('翻译任务已加入队列，切换论文后仍会继续。');
    else toast('这篇论文已有任务，可在右下角暂停、继续或取消后重新创建。');
  }
  async function translateSelection() {
    if(!selection)return; const original=selection;const generation=paperGeneration.current;const config=currentSettings.current;
    setSelection({...original,loading:true});
    try {
      const p=document.createElement('p');p.textContent=original.text; const prepared=prepareParagraph(p);
      const match=paper?.blocks.find(b=>b.id===original.block);
      if(settings.provider==='demo') {
        if(match && sampleFor(match.id) && original.text.replace(/\s+/g,' ').length >= match.text.length-4) {
          const whole=clean(restoreTranslation(sampleFor(match.id)!,match.tokens,document));
          setSelection({...original,result:whole});
        } else setSelection({...original,result:'请在右上角「翻译设置」选择 Google 或其他 API，即可尝试翻译任意选区。示例模式不会为未预置的句子生成译文。'});
      } else {const result=await request(prepared.text,prepared.tokens,match?.text.slice(0,2400));if(generation===paperGeneration.current&&config===currentSettings.current)setSelection({...original,result});}
    }catch(e){if(generation===paperGeneration.current&&config===currentSettings.current)setSelection({...original,result:e instanceof Error?e.message:String(e)});}
  }
  const count=Object.keys(results).length;
  const paperTask=tasks.find(t=>t.source===paper?.source);
  const taskBusy=!!paperTask&&['queued','running','pausing'].includes(paperTask.status);
  const displayBusy={...busy,...(paperTask?.activeId&&taskBusy?{[paperTask.activeId]:true}:{})};
  const displayErrors={...errors,...(paperTask?.error&&paperTask.status==='failed'&&paperTask.activeId?{[paperTask.activeId]:paperTask.error}:{})};
  return <div className={'app'+(side?' sidebar-visible':'')}>
    <header className="topbar"><button className="mobile-menu icon-button" aria-label="打开目录" onClick={()=>setSide(!side)}>☰</button><a className="brand" href="#"><span className="brand-mark">{icons.book}</span><strong>笺读</strong><span className="brand-divider"/><span className="brand-sub">论文双语阅读</span></a><div className="header-actions"><span className="local-status">{configuration.profiles.find(p=>p.id===configuration.activeId)?.name||'本地阅读'}</span><button className="settings-button" onClick={()=>setDialog(true)}>{icons.settings} <span>翻译设置</span></button></div></header>
    <aside className={'sidebar '+(side?'open':'')}><PaperLibrary revision={libraryRevision} current={paper?.source} disabled={importing} onOpen={source=>void importPaper(source)} onError={toast}/><Directory paper={paper} settings={settings} active={active} importing={importing} onJump={jump}/><div className="sidebar-bottom"><div className="protected-icon">⌁</div><div><strong>保留每一个细节</strong><p>公式、引用与文件名原样保护</p></div><span className="green-dot"/></div></aside>
    <SidebarResize open={side} onError={()=>toast('侧栏宽度已调整，但保存失败，请检查浏览器本地存储权限。')}/>
    <main className="main"><div className="reading-toolbar"><div className="breadcrumb">我的阅读 <span>/</span> {paper?sourceLabel(paper.source):'HTML'} 论文 <span>/</span> <b>{paper?.id||'导入论文'}</b></div><div className="reading-options"><div className="mode-switch">{[['original','原文'],['bilingual','双语'],['translated','译文']].map(([value,label])=><button className={mode===value?'selected':''} key={value} onClick={()=>setMode(value)}>{label}</button>)}</div><button className="icon-button font-control" aria-label="调整字号" onClick={()=>setFont(font===19?16:font+1)}>Aa</button><button className="icon-button" aria-label="切换深色模式" onClick={()=>setDark(!dark)}>{dark?'☀':'☾'}</button></div></div>
      <section className="import-panel" aria-label="导入论文 HTML"><form onSubmit={e=>{e.preventDefault();void importPaper(importValue);}}><label htmlFor="arxiv-input">导入论文 HTML</label><div className="import-input-row"><input id="arxiv-input" value={importValue} onChange={e=>setImportValue(e.target.value)} placeholder="粘贴 arXiv / Nature / PMC 网址或 arXiv 编号" required/><button className="primary-button" type="submit" disabled={importing}>{importing?'正在导入…':'导入论文 →'}</button></div></form><p>支持 arXiv、Nature、PMC 的公开 HTML 全文；同一论文的来源版本可在侧栏归并。<button onClick={()=>void importPaper(SOURCE)} disabled={importing}>打开示例论文</button></p>{importError&&<div className="inline-error" role="alert">{importError} {paper&&'当前论文仍可阅读。'}</div>}</section>
      {fatal?<div className="error-banner">{fatal}</div>:!paper?<div className="loading">正在整理论文结构…</div>:<>
      <div className="article-wrap">
        <div className="reader-actions"><div className="reader-source"><span>{sourceLabel(paper.source)}: {paper.id}</span><a href={paper.source} target="_blank" rel="noreferrer">原网页 ↗</a>{sourceKind(paper.source)!=='pmc'&&<a href={sourceKind(paper.source)==='arxiv'?paper.source.replace('/html/','/pdf/'):paper.source+'.pdf'} target="_blank" rel="noreferrer">PDF ↗</a>}<span className="formula-hint">点击公式可解释</span></div><div className="reader-translate-actions"><button className="secondary-button" onClick={()=>void translateAll('body')} disabled={importing||taskBusy||Object.values(busy).some(Boolean)}>{settings.provider==='demo'?'载入示例译文':'翻译正文'}</button><button className="secondary-button" onClick={()=>void translateAll('captions')} disabled={importing||taskBusy||Object.values(busy).some(Boolean)}>翻译图表说明</button><button className="primary-button" onClick={()=>void translateAll('all')} disabled={importing||taskBusy||Object.values(busy).some(Boolean)}>全文＋图表</button></div></div>
        <PaperReader ref={readerRef} html={paper.html} source={paper.source} paperTitle={paper.title} blocks={paper.blocks} mode={mode} font={font} dark={dark} results={results} busy={displayBusy} errors={displayErrors} importing={importing} onTranslate={id=>{const block=paper.blocks.find(b=>b.id===id);if(block)void translate(block,!!results[id]);}} onSelection={(text,block)=>{closeFormula();setSelection({text,block});}} onFormula={target=>void explainFormula(target)} onActive={setActive}/>
        <footer className="article-footer">{sourceLabel(paper.source)}: {paper.id}<span>保留论文结构 · 独立版本缓存</span></footer>
      </div>
      </>}
    </main>
    <div className="bottom-status"><span><i/> {paper?`${paper.blocks.filter(b=>b.kind==='paragraph').length} 个正文段落`:'加载中'} <b>·</b> 已显示 {count} 项译文</span><span>{tasks.some(t=>['running','queued','pausing'].includes(t.status))?'后台翻译任务运行中':'原文可随时核对'}<span className="desktop-only"> · arXiv / Nature / PMC</span></span></div>
    <TranslationTaskBar tasks={tasks} onPause={source=>taskQueue.current!.pause(source)} onResume={source=>taskQueue.current!.resume(source)} onCancel={source=>taskQueue.current!.cancel(source)} onDismiss={source=>taskQueue.current!.dismiss(source)} onOpen={source=>void importPaper(source)}/>
    {notice&&<div className="toast" role="status">{notice}</div>}
    {selection&&<div className="selection-panel" role="dialog" aria-label="划句翻译"><div className="selection-header"><strong>划句翻译</strong><button aria-label="关闭划句翻译" onClick={()=>setSelection(undefined)}>×</button></div><p className="selected-text">{selection.text}</p>{selection.result?<div className="selection-result" dangerouslySetInnerHTML={{__html:clean(selection.result)}}/>:<p className="selection-helper">将结合所在段落理解这段文字，文件名保持原样。</p>}<button className="primary-button" disabled={selection.loading} onClick={translateSelection}>{selection.loading?'正在翻译…':'翻译选区 →'}</button></div>}
    {formula&&<FloatingPanel onClose={closeFormula}>
      <div className="formula-location">{formula.target.location.sections.join(' › ')||'正文'}{formula.target.location.label?' · '+formula.target.location.label:''}</div>
      <div className="formula-preview" dangerouslySetInnerHTML={{__html:clean(formula.target.html)}}/>
      <div className="formula-meta"><a href={formula.target.source+(formula.target.location.anchor?'#'+encodeURIComponent(formula.target.location.anchor):'')} target="_blank" rel="noreferrer">查看原文位置 ↗</a><span>AI 解释{formula.cached?' · 本次阅读缓存':''}</span></div>
      {formula.loading&&<p className="formula-loading" role="status">正在解释公式的构成与论文中的作用…</p>}
      {formula.result&&<Suspense fallback={<p className="formula-loading">正在排版数学符号…</p>}><MathExplanation text={formula.result}/></Suspense>}
      {formula.error&&<div className="inline-error" role="alert">{formula.error}</div>}
      <details className="formula-payload"><summary>查看发送内容</summary><p>{FORMULA_PROMPT}</p><pre>{formulaMessage(formula.target)}</pre></details>
      <div className="formula-actions"><span>{formula.model}</span><button className="secondary-button" onClick={()=>setDialog(true)}>API 设置</button><button className="primary-button" disabled={formula.loading} onClick={()=>void explainFormula(formula.target,true)}>{formula.error?'重试':'重新解释'}</button></div>
    </FloatingPanel>}
    {dialog&&<SettingsDialog configuration={configuration} settings={settings} onClose={()=>setDialog(false)} onCommit={next=>{
      try{writeConfiguration(localStorage,next);}catch{return false;}
      paperGeneration.current++;setBusy({});setSelection(undefined);closeFormula();setConfiguration(next);setSettings(activeSettings(next));setErrors({});
      toast('配置已保存到本机浏览器，刷新后仍可使用。');return true;
    }}/>}

  </div>;
}

async function start(){
  if(navigator.userAgent.includes('Electron/'))document.documentElement.dataset.desktop='true';
  try{
    const config=readConfiguration(localStorage);
    if(!config.profiles.length){
      const response=await fetch('/local-reader-config',{signal:AbortSignal.timeout(3000)});
      const local=response.ok?await response.json():undefined;
      if(local?.enabled)writeConfiguration(localStorage,{version:1,activeId:'mac-deepseek',profiles:[{
        id:'mac-deepseek',name:'DeepSeek · 本机',provider:'llm',endpoint:location.origin+'/local-deepseek/v1',
        model:local.model,key:'local-managed',glossary:activeSettings(config).glossary
      }]});
    }
  }catch{/* Optional local configuration must not block reading. */}
  createRoot(document.getElementById('root')!).render(<App/>);
}
void start();



