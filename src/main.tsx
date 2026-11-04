import React, {lazy,Suspense,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SOURCE, prepareParagraph, restoreTranslation, cacheKey} from './core';
import {samples} from './samples';
import {Directory} from './PaperDirectory';
import {googleTranslate} from './google';
import {paperUrl,fetchPaper,sourceLabel,paperPdfUrl} from './sources';
import {readConfiguration,activeSettings,writeConfiguration,type Configuration,type Settings} from './settings';
import {SettingsDialog} from './SettingsDialog';
import {PaperReader,type PaperReaderHandle} from './PaperReader';
import {parsePaper,clean,isTranslatable,untranslatedBlocks,type Block,type TranslationScope} from './paper';
import {modelRequest} from './modelApi';
import {FORMULA_PROMPT,formulaMessage,type FormulaTarget} from './formula';
const PaperLibrary=lazy(()=>import('./PaperLibrary').then(m=>({default:m.PaperLibrary})));
import {FloatingPanel} from './FloatingPanel';
import {SidebarResize} from './SidebarResize';
import {startAssistantBridge} from './assistant';
import {TranslationTasks,type TranslationTask} from './translationTasks';
import {TranslationTaskBar} from './TranslationTaskBar';
import {openSavedPaper,touchPaper,readNotes,savePaper,readTranslation,readCachedTranslations,saveTranslation,saveMissingTranslations,type Result,type Paper} from './library';
import './style.css';
import './refined.css';
const MathExplanation=lazy(()=>import('./MathExplanation').then(module=>({default:module.MathExplanation})));

type FormulaState={target:FormulaTarget;loading:boolean;result?:string;error?:string;model:string;cached?:boolean};

async function loadCached(key:string):Promise<Result|undefined> {
  try{const saved=await readTranslation(key);if(saved)return {...saved,html:clean(saved.html)};}catch{/* Legacy storage remains readable. */}
  return legacyCached(key);
}
function legacyCached(key:string):Result|undefined {
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

const receivingBackup=new URLSearchParams(location.hash.slice(1)).has('receive');
const sidebarPreference='reader-sidebar-collapsed';

function SidebarToggle({expanded,onToggle}:{expanded:boolean;onToggle:()=>void}){
  const label=expanded?'收起侧栏':'展开侧栏';
  return <button id="sidebar-toggle" className="sidebar-toggle" onClick={onToggle}
    aria-controls="reading-sidebar" aria-expanded={expanded} title={label}>
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.75" y="3.25" width="16.5" height="13.5" rx="2.25"/>
      <path d="M7 3.5v13" />
      <path d={expanded?'m13.5 7.5-2.5 2.5 2.5 2.5':'m11 7.5 2.5 2.5-2.5 2.5'} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    {label}
  </button>;
}

function App() {
  const readerRef=useRef<PaperReaderHandle>(null);
  const [paper,setPaper]=useState<ReturnType<typeof parsePaper>>();
  const [importValue,setImportValue]=useState('');
  const [showImport,setShowImport]=useState(true);
  const [importing,setImporting]=useState(false);
  const [importError,setImportError]=useState('');
  function closeImport(){
    setShowImport(false);
    const trigger=document.querySelector<HTMLButtonElement>('.open-import');
    const target=trigger?.getClientRects().length?trigger:document.querySelector<HTMLButtonElement>('.mode-switch button');
    target?.focus({preventScroll:true});
  }
  function toggleImport(){
    if(showImport)closeImport();
    else{setShowImport(true);window.scrollTo({top:0});}
  }
  const importController=useRef<AbortController|undefined>(undefined);
  const paperGeneration=useRef(0);
  const [mode,setMode]=useState('bilingual');
  const [results,setResults]=useState<Record<string,Result>>({});
  const [busy,setBusy]=useState<Record<string,boolean>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [configuration,setConfiguration]=useState<Configuration>(()=>{try{return readConfiguration(localStorage);}catch{return {version:1,activeId:'',profiles:[]};}});
  const [settings,setSettings]=useState(()=>activeSettings(configuration));
  const [dialog,setDialog]=useState(false);
  const [side,setSide]=useState(()=>{
    if(receivingBackup)return true;
    if(innerWidth<1100)return false;
    try{return localStorage.getItem(sidebarPreference)!=='true';}catch{return true;}
  });
  const focusSidebarToggle=useRef(false);
  function toggleSidebar(){
    focusSidebarToggle.current=true;
    setSide(!side);
    if(innerWidth>=1100){
      try{localStorage.setItem(sidebarPreference,String(side));}catch{/* Use the choice for this session. */}
    }
  }
  useLayoutEffect(()=>{
    if(focusSidebarToggle.current){
      focusSidebarToggle.current=false;
      document.getElementById('sidebar-toggle')?.focus({preventScroll:true});
    }
  },[side]);
  const [shelf,setShelf]=useState(receivingBackup);
  const [libraryRevision,setLibraryRevision]=useState(0);
  const storageWarning=useRef(false);
  const [active,setActive]=useState('abstract');
  const [font,setFont]=useState(()=>{
    try { const saved=Number(localStorage.getItem('reader-font-size')); if([16,17,18,19].includes(saved))return saved; } catch {}
    return 17;
  });
  const [dark,setDark]=useState(()=>{
    try { const saved=localStorage.getItem('reader-theme'); if(saved)return saved==='dark'; } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  function changeTheme(){
    const next=!dark;setDark(next);
    try{localStorage.setItem('reader-theme',next?'dark':'light');}catch{}
  }
  function changeFont(){
    const next=font===19?16:font+1;setFont(next);
    try{localStorage.setItem('reader-font-size',String(next));}catch{}
  }
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
    read:async source=>(await readNotes(source))?.results||{},cached:loadCached,
    translate:async(block,config,signal)=>({html:await requestUsing(config,block.input,block.tokens,signal),type:config.provider.startsWith('google')?'google':'api'}),
    save:async(source,id,key,result)=>{
      const {saved,results}=await saveMissingTranslations(source,[{id,key,result}]);const actual=results[id];
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
  useEffect(()=>{
    const blocked=()=>setImportError('正在等待论文库升级。请关闭同一浏览器中的其他旧版笺读标签页，升级会自动继续。');
    window.addEventListener('reader-library-blocked',blocked);
    return ()=>window.removeEventListener('reader-library-blocked',blocked);
  },[]);
  useEffect(()=>{if(receivingBackup)return;
    let previous=SOURCE;try{previous=localStorage.getItem('reader-last-source')||SOURCE;}catch{/* Browser storage can be disabled. */}
    void importPaper(previous,true);return()=>importController.current?.abort();},[]);
  useEffect(()=>{const theme=dark?'dark':'light';document.documentElement.dataset.theme=theme;
    (window as Window & {webkit?:{messageHandlers?:{readerAppearance?:{postMessage:(theme:string)=>void}}}}).webkit?.messageHandlers?.readerAppearance?.postMessage(theme);},[dark]);
  function storageFailed(){if(!storageWarning.current){storageWarning.current=true;toast('本地保存失败，请检查浏览器存储权限或空间；当前页面仍可阅读。');}}
  async function persistResult(source:string,block:Block,key:string,result:Result){
    try{await saveTranslation(source,block.id,key,result);setLibraryRevision(n=>n+1);}catch{storageFailed();}
  }
  async function restoreResults(next:Paper,saved:Record<string,Result>={}){
    const config=currentSettings.current;
    const missing=next.blocks.filter(block=>isTranslatable(block)&&!saved[block.id]).map(block=>({
      id:block.id,key:cacheKey(next.source,block.input,config.provider+':'+config.endpoint,config.model,config.glossary)
    }));
    const cached=missing.length?await readCachedTranslations(missing.map(item=>item.key)).catch(()=>new Map<string,Result>()):new Map<string,Result>();
    const hits=missing.flatMap(({id,key})=>{
      const result=cached.get(key)||legacyCached(key);
      return result?[{id,key,result:{...result,html:clean(result.html)}}]:[];
    });
    // Prefer concurrent assistant or background translations over cache recovery.
    let latest=saved;
    try{
      latest=hits.length?(await saveMissingTranslations(next.source,hits)).results:(await readNotes(next.source))?.results||saved;
    }catch{storageFailed();}
    const restored:Record<string,Result>=Object.fromEntries(hits.map(item=>[item.id,item.result]));
    for(const [id,result] of Object.entries(latest))restored[id]={...result,html:clean(result.html)};
    return restored;
  }
  async function importPaper(input:string,initial=false) {
    let target:string;
    try {target=paperUrl(input);}catch(e){setImportError(e instanceof Error?e.message:String(e));return;}
    importController.current?.abort();const controller=new AbortController();importController.current=controller;
    paperGeneration.current++;setBusy({});setSelection(undefined);closeFormula();setImporting(true);setImportError('');
    try {
      let saved;try{saved=await openSavedPaper(target);}catch{storageFailed();}
      if(controller.signal.aborted)return;
      const record=saved?.record;
      const loaded=record?undefined:target===SOURCE?{html:await fetch('/paper.html',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('论文加载失败');return r.text();}),source:SOURCE}:await fetchPaper(target,controller.signal);
      const next=record?(saved?.needsParse?parsePaper(record.paper.html,record.source):record.paper):parsePaper(loaded!.html,loaded!.source);
      if(!next.blocks.some(b=>b.kind==='paragraph'))throw Error('该 HTML 页面没有可识别的论文段落，请换一篇论文。');
      if(controller.signal.aborted)return;
      try{if(!record||saved?.needsParse)await savePaper(next);else await touchPaper(next.source);setLibraryRevision(n=>n+1);}catch{storageFailed();}
      const restored=await restoreResults(next,record?.results);
      if(controller.signal.aborted)return;
      currentPaper.current=next;setPaper(next);setResults(restored);setImportError('');setErrors({});setFatal('');setActive('abstract');setShowImport(false);setImportValue('');if(innerWidth<1100)setSide(false);
      try{localStorage.setItem('reader-last-source',next.source);}catch{/* Reading still works without storage. */}
      if(next.source!==SOURCE && currentSettings.current.provider==='demo') {
        setSettings(s=>({...s,provider:'llm'}));
        toast('论文已导入。请在「翻译设置」填写 API，随后翻译段落或全文。');
      } else toast(Object.keys(restored).length?`论文已打开，已恢复 ${Object.keys(restored).length} 段译文。`:record?'已从论文记录打开。':'论文已导入并保存到论文记录。');
      window.scrollTo({top:0});
    }catch(e){if(!controller.signal.aborted){setShowImport(true);setImportError(e instanceof Error?e.message:String(e));if(initial&&target!==SOURCE){toast('上次论文暂时无法加载，先打开示例论文。');void importPaper(SOURCE);}}}
    finally{if(importController.current===controller)setImporting(false);}
  }
  function jump(id:string) {readerRef.current?.jump(id);if(innerWidth<1100)setSide(false);}
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
    <header className="topbar"><a className="brand" href="#"><img width="32" height="32" alt="" src="/jiandu.svg"/><strong>笺读</strong><span className="brand-divider"/><span className="brand-sub">论文双语阅读</span></a><div className="header-actions"><button className="open-import" aria-expanded={showImport} aria-controls="paper-import" onClick={toggleImport}>＋ 导入论文</button><span className="local-status">{configuration.profiles.find(p=>p.id===configuration.activeId)?.name||'本地阅读'}</span><button className="settings-button" onClick={()=>setDialog(true)}>翻译设置</button></div></header>
    <aside id="reading-sidebar" className={'sidebar '+(side?'open':'')} aria-label="阅读导航">
      <div className="shelf-identity"><img src="/jiandu.svg" alt="" width="46" height="46"/><div><strong>笺读</strong><small>论文阅读室</small></div>{side&&<SidebarToggle expanded onToggle={toggleSidebar}/>}</div>
      <div className="shelf-switch" aria-label="侧栏视图">
        <button aria-pressed={!shelf} onClick={()=>setShelf(false)}>论文目录</button>
        <button aria-pressed={shelf} onClick={()=>setShelf(true)}>我的藏书</button>
      </div>
      <div hidden={shelf}><Directory paper={paper} settings={settings} active={active} importing={importing} onJump={jump}/></div>
      {shelf&&<Suspense fallback={<p>载入藏书…</p>}><PaperLibrary revision={libraryRevision} current={paper?.source} disabled={importing} onOpen={source=>void importPaper(source)} onError={toast}/></Suspense>}
    </aside>
    <SidebarResize open={side} onError={()=>toast('侧栏宽度已调整，但保存失败，请检查浏览器本地存储权限。')}/>
    <main className="main"><div className="reading-toolbar"><div className="breadcrumb">{!side&&<SidebarToggle expanded={false} onToggle={toggleSidebar}/>}<strong>阅读</strong>{paper&&<span className="source-stamp">{sourceLabel(paper.source)}</span>}</div><div className="reading-options"><div className="mode-switch">{[['original','原文'],['bilingual','双语'],['translated','译文']].map(([value,label])=><button className={mode===value?'selected':''} key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div><button className="icon-button font-control" aria-label="调整字号" title={`调整字号（当前 ${font} px）`} onClick={changeFont}>Aa</button><button className="icon-button" aria-label="切换深色模式" aria-pressed={dark} title={dark?"切换到浅色":"切换到深色"} onClick={changeTheme}>{dark?'☀':'☾'}</button></div></div>
      {showImport&&<section id="paper-import" className="import-panel" aria-label="导入论文 HTML" onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();closeImport();}}}><div className="import-panel-heading"><label htmlFor="arxiv-input">导入论文 HTML</label><button type="button" className="import-close" aria-label="收起导入论文" title="收起（Esc）" onClick={closeImport}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div><form onSubmit={e=>{e.preventDefault();void importPaper(importValue);}}><div className="import-input-row"><input id="arxiv-input" autoFocus value={importValue} onChange={e=>setImportValue(e.target.value)} placeholder="粘贴 arXiv / Nature / PMC / Frontiers 网址或 arXiv 编号" required/><button className="primary-button" type="submit" disabled={importing}>{importing?'正在导入…':'导入论文 →'}</button></div></form><p>支持 arXiv、Nature、PMC、Frontiers 的公开全文；同一论文的来源版本可在侧栏归并。<button onClick={()=>void importPaper(SOURCE)} disabled={importing}>打开示例论文</button></p>{importError&&<div className="inline-error" role="alert">{importError} {paper&&'当前论文仍可阅读。'}</div>}</section>}
      {fatal?<div className="error-banner">{fatal}</div>:!paper?<div className="loading">正在整理论文结构…</div>:<>
      <div className="article-wrap">
        <div className="reader-actions"><div className="reader-source"><span>{sourceLabel(paper.source)}: {paper.id}</span><a href={paper.source} target="_blank" rel="noreferrer">原网页 ↗</a>{paperPdfUrl(paper.source)&&<a href={paperPdfUrl(paper.source)} target="_blank" rel="noreferrer">PDF ↗</a>}<span className="formula-hint">点击公式可解释</span></div><select className="translate-menu" aria-label="批量翻译" value="" disabled={importing||taskBusy||Object.values(busy).some(Boolean)} onChange={e=>{if(e.target.value)void translateAll(e.target.value as TranslationScope);}}>
          <option value="" disabled>批量翻译…</option><option value="body">{settings.provider==='demo'?'载入示例译文':'翻译正文'}</option>
          <option value="captions">翻译图表说明</option><option value="all">翻译全文与图表</option>
        </select></div>
        <PaperReader ref={readerRef} html={paper.html} source={paper.source} paperTitle={paper.title} blocks={paper.blocks} mode={mode} font={font} dark={dark} results={results} busy={displayBusy} errors={displayErrors} importing={importing} onTranslate={id=>{const block=paper.blocks.find(b=>b.id===id);if(block)void translate(block,!!results[id]);}} onSelection={(text,block)=>{closeFormula();setSelection({text,block});}} onFormula={target=>void explainFormula(target)} onActive={setActive}/>
      </div>
      </>}
    </main>
    <div className="bottom-status"><span><i/> {paper?`${paper.blocks.filter(b=>b.kind==='paragraph').length} 个正文段落`:'加载中'} <b>·</b> 已显示 {count} 项译文</span><span>{tasks.some(t=>['running','queued','pausing'].includes(t.status))?'后台翻译任务运行中' :configuration.profiles.find(p=>p.id===configuration.activeId)?.name||'本地阅读'}</span></div>
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



