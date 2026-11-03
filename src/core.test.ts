import {test} from 'node:test';
import {assistantResults,assistantSession} from './assistant.ts';
import {saveAssistantTranslations} from './library.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {modelEndpoint,modelRequest} from './modelApi.ts';
import {formulaTarget,formulaMessage,FORMULA_PROMPT} from './formula.ts';
import {renderMathText} from './mathText.ts';
import {parsePaper,PAPER_SANITIZE_OPTIONS,isTranslatable,untranslatedBlocks} from './paper.ts';
import {prepareParagraph,restoreTranslation,cacheKey,normalizeArticle} from './core.ts';
import {samples} from './samples.ts';
import 'fake-indexeddb/auto';
import {savePaper,readPaper,saveTranslation,readTranslation,saveGroup,movePaper,deleteGroup,listLibrary,saveDirectory} from './library.ts';
import {fitPanel} from './FloatingPanel.tsx';
import {importBackup,exportBackup,validateBackup} from './backup.ts';
import {splitHeading,knownHeading,parseDirectoryResponse} from './directory.ts';
import {readSidebarWidth,fitSidebarWidth,SIDEBAR_WIDTH_KEY} from './sidebarWidth.ts';
import {googleTranslate,googleTranslateBatch,splitBatch} from './google.ts';
import {arxivUrl,fetchArxiv} from './arxiv.ts';
import {paperUrl,sourceLabel,fetchPaper} from './sources.ts';
import {paperWorks,workKey,mergeWorks,detachVersion} from './library.ts';
import {readConfiguration,writeConfiguration,activeSettings,saveProfile,deleteProfile,defaults,CONFIG_KEY,type Configuration} from './settings.ts';
const doc=new JSDOM(readFileSync(new URL('../public/paper.html',import.meta.url),'utf8')).window.document;

test('conversation session survives reload and reports the exact failing paragraph',()=>{
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  const id=assistantSession(storage);assert.equal(assistantSession(storage),id);
  const parser=new (new JSDOM('').window.DOMParser)();
  const paper=parsePaper('<article class="ltx_document"><p class="ltx_p" id="precise-error">Value <math><mi>x</mi></math>.</p></article>','https://arxiv.org/html/9999.12346',parser,x=>x);
  const record={source:paper.source,paper,results:{},groupId:'',openedAt:0},block=paper.blocks.find(b=>b.id==='precise-error')!;
  assert.throws(()=>assistantResults(record,[{id:block.id,input:block.input,translation:'漏掉数学符号'}],doc),/precise-error.*占位符/);
  assert.throws(()=>assistantResults(record,[{id:block.id,input:'changed',translation:'译文'}],doc),/precise-error.*原文已改变/);
});

test('empty source paragraphs never become pending translation tasks',()=>{
  const blocks=[{id:'empty',kind:'paragraph',input:''},{id:'spaces',kind:'caption',input:' \n '},{id:'text',kind:'paragraph',input:'Text.'},{id:'math',kind:'paragraph',input:'⟦P0⟧'}];
  assert.deepEqual(untranslatedBlocks(blocks,{}).map(b=>b.id),['text','math']);
  assert.deepEqual(untranslatedBlocks(blocks,{},'captions'),[]);
  assert.equal(isTranslatable(blocks[0]),false);
});

test('conversation batches preserve math, reject invalid items and keep existing translations',async()=>{
  const parser=new (new JSDOM('').window.DOMParser)();
  const paper=parsePaper('<article class="ltx_document"><p class="ltx_p" id="assistant-p">Value <math><mi>x</mi></math>.</p><p class="ltx_p" id="assistant-q">Next.</p></article>','https://arxiv.org/html/9999.12345',parser,x=>x);
  await savePaper(paper);const record=(await readPaper(paper.source))!,block=paper.blocks.find(b=>b.id==='assistant-p')!;
  const item={id:block.id,input:block.input,translation:'数值 ⟦P0⟧。<script>text</script>'};
  const validated=assistantResults(record,[item],doc);
  assert.match(validated[0].result.html,/<math>/);assert.match(validated[0].result.html,/&lt;script&gt;/);
  assert.throws(()=>assistantResults(record,[{...item,translation:'缺失公式'}],doc));
  assert.throws(()=>assistantResults(record,[{...item,input:'过时原文'}],doc));
  assert.throws(()=>assistantResults(record,[item,item],doc));
  assert.throws(()=>assistantResults(record,[item,{id:'assistant-q',input:'Next.',translation:''}],doc));
  assert.deepEqual(await saveAssistantTranslations(paper.source,validated),[block.id]);
  assert.deepEqual(await saveAssistantTranslations(paper.source,validated),[]);
  assert.equal((await readPaper(paper.source))!.results[block.id].type,'assistant');
  await saveTranslation(paper.source,'assistant-q','keep-existing',{type:'api',html:'已有译文'});
  const q=paper.blocks.find(b=>b.id==='assistant-q')!;
  await saveAssistantTranslations(paper.source,assistantResults(record,[{id:q.id,input:q.input,translation:'新译文'}],doc));
  assert.equal((await readPaper(paper.source))!.results[q.id].html,'已有译文');
});

test('DOI followed immediately by a protected citation never swallows its placeholder or sentence punctuation',()=>{
  const p=doc.createElement('p');
  p.innerHTML='The entire MIND dataset is publicly available on the ScienceDB platform (<a href="https://doi.org/10.57760/sciencedb.34326">https://doi.org/10.57760/sciencedb.34326</a>)<sup><a class="ltx_ref" href="#CR23">23</a></sup>. The released data are licensed for non-commercial purposes.';
  const prepared=prepareParagraph(p);
  assert.match(prepared.text,/\(⟦P1⟧\)⟦P0⟧\./);
  assert.equal(prepared.tokens['⟦P1⟧'],'<code>https://doi.org/10.57760/sciencedb.34326</code>');
  assert.ok(Object.values(prepared.tokens).every(html=>!html.includes('⟦P')));
  const restored=restoreTranslation(prepared.text,prepared.tokens,doc);
  assert.match(restored,/sciencedb\.34326<\/code>\)<a class="ltx_ref" href="#CR23">23<\/a>\./);
  const balanced=doc.createElement('p');balanced.textContent='Read (https://example.org/a(b)), then https://example.org/data.csv。';
  const result=prepareParagraph(balanced);assert.equal(result.text,'Read (⟦P0⟧), then ⟦P1⟧。');
  assert.equal(result.tokens['⟦P0⟧'],'<code>https://example.org/a(b)</code>');
});

test('full translation resumes at the first missing item, skips completed gaps and includes unfinished captions',()=>{
  const blocks=[{id:'h',kind:'heading'},{id:'p1',kind:'paragraph'},{id:'p2',kind:'paragraph'},{id:'p3',kind:'paragraph'},{id:'p4',kind:'paragraph'},{id:'c1',kind:'caption'},{id:'c2',kind:'caption'}];
  const results={p1:{html:'已译第一段'},p3:{html:'已译第三段'},p4:{html:'  '},c1:{html:'已译图题'}};
  assert.deepEqual(untranslatedBlocks(blocks,results).map(b=>b.id),['p2','p4','c2']);
  assert.deepEqual(untranslatedBlocks(blocks,results,'captions').map(b=>b.id),['c2']);
  const finished={...results,p2:{html:'第二段完成'},p4:{html:'第四段完成'},c2:{html:'图题完成'}};
  assert.deepEqual(untranslatedBlocks(blocks,finished),[]);
});
test('sidebar restores saved width, rejects invalid storage and constrains narrow screens without replacing the preference',()=>{
  assert.equal(readSidebarWidth({getItem:()=>null}),312);
  assert.equal(readSidebarWidth({getItem:()=> '512'}),512);
  for(const value of ['bad','Infinity','0','200','800'])assert.equal(readSidebarWidth({getItem:()=>value}),312);
  assert.equal(readSidebarWidth({getItem:()=>{throw Error('denied');}}),312);
  const storage={getItem:(key:string)=>key===SIDEBAR_WIDTH_KEY?'600':null};
  assert.equal(fitSidebarWidth(readSidebarWidth(storage),2000),600);
  assert.equal(fitSidebarWidth(readSidebarWidth(storage),1100),540);
  assert.equal(fitSidebarWidth(readSidebarWidth(storage),390),370);
  assert.equal(readSidebarWidth(storage),600);
  assert.equal(fitSidebarWidth(readSidebarWidth(storage),2000),600);
  assert.equal(fitSidebarWidth(100,1600),280);assert.equal(fitSidebarWidth(1000,2000),720);assert.equal(fitSidebarWidth(440,250),230);
});
test('directory translations retain section identifiers and validate complete response mapping',()=>{
  assert.equal(knownHeading('1 Introduction'),'1 引言');assert.equal(knownHeading('Appendix A Methods'),'附录 A 研究方法');
  assert.deepEqual(splitHeading('A.2 ChineseEEG'),{prefix:'A.2 ',text:'ChineseEEG'});
  const items=[{id:'s1',text:'2.1 Semantic Decomposer'},{id:'a1',text:'Appendix A Public Dataset'},{id:'a2',text:'A.1 Chisco'}];
  assert.deepEqual(parseDirectoryResponse('```json\n'+JSON.stringify([{id:'a2',translation:'Chisco'},{id:'s1',translation:'9.1 语义分解器'},{id:'a1',translation:'公开数据集'}])+'\n```',items),{s1:'2.1 语义分解器',a1:'附录 A 公开数据集',a2:'A.1 Chisco'});
  assert.throws(()=>parseDirectoryResponse('[]',items),/条目/);
  assert.deepEqual(parseDirectoryResponse(JSON.stringify([{id:'paper',translation:'额外的上下文标题'},{id:'a2',translation:'Chisco'},{id:'s1',translation:'语义分解器'},{id:'a1',translation:'公开数据集'}]),items),{s1:'2.1 语义分解器',a1:'附录 A 公开数据集',a2:'A.1 Chisco'});
  assert.throws(()=>parseDirectoryResponse(JSON.stringify([{id:'s1',translation:'甲'},{id:'s1',translation:'乙'},{id:'a2',translation:'丙'}]),items),/条目/);
});
test('backup migration verifies saved profiles and translations, keeps destination data, and remaps conflicting IDs',async()=>{
  const win=new JSDOM('',{url:'http://127.0.0.1:5173'}).window;
  const previous=globalThis.DOMParser;globalThis.DOMParser=win.DOMParser;
  Object.assign(createDOMPurify,createDOMPurify(win));
  try{
    const destination={...defaults,id:'conflict',name:'Destination',key:'fixture-destination'};
    const incoming={...defaults,id:'conflict',name:'Source',key:'fixture-source'};
    writeConfiguration(win.localStorage,{version:1,activeId:'conflict',profiles:[destination]});
    await saveGroup({id:'group-conflict',name:'Destination group'});
    const source='https://arxiv.org/html/2602.04299v1';
    const paper=parsePaper('<article class="ltx_document"><h1>Backup paper</h1><p class="ltx_p" id="backup-p">Original</p></article>',source);
    const result={html:'<p>已保存译文</p>',type:'api' as const};
    const headings={__paper_title__:{original:'Backup paper',translated:'备份论文'}};
    const backup={format:'jiandu-backup',version:1,configuration:{version:1,activeId:'conflict',profiles:[incoming]},preferences:{'reader-last-source':source,'reader-sidebar-width':'512'},library:{groups:[{id:'group-conflict',name:'Source group'}],papers:[{source,paper,workId:'https://arxiv.org/html/2602.04299v1',groupId:'group-conflict',openedAt:1,results:{'backup-p':result},headings}],translations:[['backup-cache',result]]}};
    const report=await importBackup(backup,win.localStorage);assert.equal(report.paragraphs,1);assert.equal(report.profiles,1);assert.equal(readSidebarWidth(win.localStorage),512);
    const config=readConfiguration(win.localStorage);assert.equal(config.profiles.length,2);assert.notEqual(config.activeId,'conflict');assert.equal(activeSettings(config).key,'fixture-source');
    const saved=await readPaper(source);assert.equal(saved?.workId,source);assert.deepEqual(saved?.headings,headings);assert.deepEqual(saved?.results['backup-p'],result);assert.notEqual(saved?.groupId,'group-conflict');assert.deepEqual(await readTranslation('backup-cache'),result);
    win.localStorage.setItem('translation:legacy-key',JSON.stringify(result));
    const exported=await exportBackup(win.localStorage);assert.ok(exported.library.translations.some(([key])=>key==='legacy-key'));assert.equal(exported.configuration.profiles.length,2);
    assert.throws(()=>validateBackup({format:'other'}),/有效/);
    assert.throws(()=>validateBackup({...backup,configuration:{version:1,activeId:'bad',profiles:[{}]}}),/API/);
  }finally{globalThis.DOMParser=previous;win.close();}
});
test('library preserves partial translations across reopening, concurrent writes, grouping and group removal',async()=>{
  const paper={source:'https://arxiv.org/html/2501.12948v1',title:'Saved paper',id:'2501.12948v1',authors:'',html:'<article></article>',blocks:[]};
  const first={html:'第一段译文',type:'api' as const},second={html:'第二段译文',type:'google' as const};
  await savePaper(paper);await saveGroup({id:'reading',name:'阅读中'});await movePaper(paper.source,'reading');
  await Promise.all([saveTranslation(paper.source,'p1','key-1',first),saveTranslation(paper.source,'p2','key-2',second)]);
  const headings={s1:{original:'1 Introduction',translated:'1 引言'}};await saveDirectory(paper.source,headings);
  await savePaper({...paper,title:'Reopened paper'});
  const restored=await readPaper(paper.source);
  assert.equal(restored?.paper.title,'Reopened paper');assert.equal(restored?.groupId,'reading');
  assert.deepEqual(restored?.headings,headings);assert.deepEqual(restored?.results,{p1:first,p2:second});assert.deepEqual(await readTranslation('key-2'),second);
  await saveGroup({id:'reading',name:'已重命名'});assert.equal((await listLibrary()).groups.find(g=>g.id==='reading')?.name,'已重命名');
  await deleteGroup('reading');assert.equal((await readPaper(paper.source))?.groupId,'');assert.ok(!(await listLibrary()).groups.some(g=>g.id==='reading'));
  assert.deepEqual((await readPaper(paper.source))?.results,{p1:first,p2:second});assert.equal(await readPaper('missing'),undefined);
});
test('formula window remains within viewport when moved, resized or opened on a small screen',()=>{
  assert.deepEqual(fitPanel({x:-100,y:900,width:800,height:700},400,500),{x:8,y:8,width:384,height:484});
  assert.deepEqual(fitPanel({x:100,y:100,width:50,height:50},900,800),{x:100,y:100,width:320,height:240});
  const tiny=fitPanel({x:0,y:0,width:500,height:600},250,200);assert.equal(tiny.width,234);assert.equal(tiny.height,184);
});
test('explanation renders legacy nested TeX symbols and subscripts with surrounding Chinese intact',()=>{
  const text=String.raw`符号与构成：
- \mathcal{L}_{\mathrm{match}}：匹配损失。
- \hat{\sigma}：最优排列。
- y_i：第 i 个目标。
- \hat{y}_{\sigma(i)}：对应预测。`;
  const document=new JSDOM(renderMathText(text)).window.document;
  assert.equal(document.querySelectorAll('.katex').length,4);assert.equal(document.querySelectorAll('.math-fallback').length,0);
  assert.ok(document.querySelector('msub'));assert.ok(document.querySelector('mover'));
  assert.ok(document.body.textContent?.includes('匹配损失。'));
  for(const visible of document.querySelectorAll('.katex-html'))assert.ok(!visible.textContent?.includes('\\'));
});
test('explanation supports standard inline and display delimiters',()=>{
  const text=String.raw`行内 \(x_i\) 与 $\hat{y}$。
\[\sum_{i=1}^{K} x_i\]
$$\frac{a}{b}$$`;
  const document=new JSDOM(renderMathText(text)).window.document;
  assert.equal(document.querySelectorAll('.katex').length,4);assert.equal(document.querySelectorAll('.display-math').length,2);
  assert.ok(document.querySelector('mfrac'));
});
test('explanation preserves invalid math and never executes API-provided HTML or trusted TeX commands',()=>{
  const text=String.raw`<img src=x onerror=alert(1)> \(\href{javascript:alert(1)}{x}\) \(\includegraphics{https://example.com/x.png}\) 错误 \frac{`;
  const document=new JSDOM(renderMathText(text)).window.document;
  assert.equal(document.querySelectorAll('img,script,a,iframe').length,0);
  assert.ok(document.body.textContent?.includes('<img src=x onerror=alert(1)>'));
  assert.equal(document.querySelector('.math-fallback')?.textContent,'\\frac{');
});
test('explanation leaves currency and non-math code intact, but renders code-wrapped TeX',()=>{
  const text='价格 $5 and $10；`model_name`；`\\mathcal{L}_{\\mathrm{match}}`。';
  const document=new JSDOM(renderMathText(text)).window.document;
  assert.equal(document.querySelectorAll('.katex').length,1);assert.ok(document.body.textContent?.includes('$5 and $10'));
  assert.equal(document.querySelector('code')?.textContent,'model_name');
});
test('formula explanation preserves LaTeX and identifies the full numbered equation and section',()=>{
  const document=new JSDOM(`<article><h1>Paper title</h1><section id="S2"><h2>2 Method</h2><p><math alttext="x"><mi>x</mi></math></p><section id="S2.1"><h3>2.1 Objective</h3><div class="ltx_equation" id="S2.E1"><span class="ltx_tag_equation">(1)</span><math id="S2.E1.m1" alttext="fallback"><semantics><mrow><mi>L</mi><mo>=</mo><mn>0</mn></mrow><annotation encoding="application/x-tex">L=0</annotation></semantics></math><math alttext="x=1"><mi>x</mi></math></div></section></section></article>`).window.document;
  const target=formulaTarget(document.querySelector('#S2\\.E1\\.m1 mi')!,'https://arxiv.org/html/2501.12948v1','Paper title')!;
  assert.equal(target.expression,'L=0\nx=1');assert.equal(target.format,'LaTeX');
  assert.deepEqual(target.location.sections,['2 Method','2.1 Objective']);assert.equal(target.location.label,'(1)');assert.equal(target.location.anchor,'S2.E1');assert.equal(target.location.ordinal,2);
  const message=JSON.parse(formulaMessage(target));assert.deepEqual(Object.keys(message),['公式','位置','论文HTML网址']);assert.equal(message.公式.内容,'L=0\nx=1');assert.equal(message.论文HTML网址,'https://arxiv.org/html/2501.12948v1');assert.ok(FORMULA_PROMPT.length<120);
});
test('translated formula resolves to original anchor and technical filenames are excluded',()=>{
  const document=new JSDOM(`<article><section id="S1"><h2>Introduction</h2><p id="p1" data-reader-block="p1"><math id="m1" alttext="x_i"><msub><mi>x</mi><mi>i</mi></msub></math><math class="technical-literal" alttext=".mat"><mtext>.mat</mtext></math></p><div class="reader-addon" data-reader-addon="p1"><math alttext="x_i"><msub><mi>x</mi><mi>i</mi></msub></math></div></section></article>`).window.document;
  const translated=document.querySelector('.reader-addon math')!;
  const target=formulaTarget(translated,'https://arxiv.org/html/1234.56789','Title')!;
  assert.equal(target.location.anchor,'m1');assert.equal(target.location.ordinal,1);assert.equal(target.expression,'x_i');
  assert.equal(formulaTarget(document.querySelector('.technical-literal')!,'url','title'),null);
});
test('formula without TeX keeps MathML structure and omits reader UI attributes',()=>{
  const document=new JSDOM('<article><p id="p"><math role="button" tabindex="0" aria-label="解释公式"><mfrac><mi>a</mi><mi>b</mi></mfrac></math></p></article>').window.document;
  const target=formulaTarget(document.querySelector('math')!,'https://arxiv.org/html/1234.56789','Title')!;
  assert.equal(target.format,'MathML');assert.match(target.expression,/<mfrac>/);assert.doesNotMatch(target.expression,/role=|tabindex=|aria-label=/);assert.equal(target.location.anchor,'p');
});
test('repeated translated symbols report their paragraph rather than an invented unique position',()=>{
  const document=new JSDOM('<article><p id="p"><math id="m1" alttext="x"><mi>x</mi></math><math id="m2" alttext="x"><mi>x</mi></math></p><div data-reader-addon="p" class="reader-addon"><math alttext="x"><mi>x</mi></math></div></article>').window.document;
  const target=formulaTarget(document.querySelector('.reader-addon math')!,'https://arxiv.org/html/1234.56789','Title')!;
  assert.equal(target.location.anchor,'p');assert.equal(target.location.ordinal,0);
});
test('local Anthropic gateway uses fixed proxy, requested model and Messages format',async()=>{
  const settings={...defaults,provider:'anthropic',endpoint:'http://127.0.0.1:7864/',model:'deepseek-v4.1-flash',key:'test-token-only'};
  assert.equal(modelEndpoint(settings),'/local-anthropic/v1/messages');
  assert.equal(modelEndpoint({...settings,endpoint:'http://localhost:7864/v1'}),'/local-anthropic/v1/messages');
  assert.equal(modelEndpoint({...settings,endpoint:'http://127.0.0.1:7864/v1/messages'}),'/local-anthropic/v1/messages');
  assert.equal(modelEndpoint({...settings,provider:'llm',endpoint:'https://example.com/v1'}),'https://example.com/v1/chat/completions');
  assert.throws(()=>modelEndpoint({...settings,endpoint:'http://remote.example.com'}),/HTTPS/);
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'/local-anthropic/v1/messages');
      const headers=options?.headers as Record<string,string>;assert.equal(headers.Authorization,'Bearer test-token-only');assert.equal(headers['anthropic-version'],'2023-06-01');
      const body=JSON.parse(options?.body as string);assert.equal(body.model,'deepseek-v4.1-flash');assert.equal(body.system,'system');assert.equal(body.messages[0].role,'user');assert.equal(body.max_tokens,64);assert.equal(body.stream,false);
      return new Response(JSON.stringify({content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'翻译'},{type:'text',text:'成功'}],stop_reason:'end_turn'}));
    };
    assert.equal(await modelRequest(settings,'system','text',64),'翻译成功');
    globalThis.fetch=async()=>new Response(JSON.stringify({content:[{type:'text',text:'partial'}],stop_reason:'max_tokens'}));
    await assert.rejects(()=>modelRequest(settings,'system','text'),/长度限制/);
    globalThis.fetch=async()=>new Response('denied',{status:401});await assert.rejects(()=>modelRequest(settings,'system','text'),/401/);
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'invalid parameter; credential=test-token-only'}}),{status:400});
    await assert.rejects(()=>modelRequest(settings,'system','text'),error=>error instanceof Error&&error.message.includes('invalid parameter')&&!error.message.includes('test-token-only'));
  }finally{globalThis.fetch=original;}
});
test('native paper keeps section nesting, original headings, authors, references and table cells',()=>{
  const html=readFileSync(new URL('../public/paper.html',import.meta.url),'utf8');
  const window=new JSDOM('').window;
  const purifier=createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
  const paper=parsePaper(html,'https://arxiv.org/html/2602.04299v1',new window.DOMParser(),value=>purifier.sanitize(value,PAPER_SANITIZE_OPTIONS));
  const native=new JSDOM(paper.html).window.document;
  assert.ok(native.querySelector('article.ltx_document > .ltx_authors'));
  assert.ok(native.querySelector('section section'));
  assert.ok(native.querySelector('.ltx_bibliography .ltx_biblist'));
  for(const selector of ['section','h2','h3','figure','table','td','th','math'])assert.equal(native.querySelectorAll(selector).length,doc.querySelector('article')!.querySelectorAll(selector).length,selector);
  assert.deepEqual([...native.querySelectorAll('section')].map(e=>e.id),[...doc.querySelectorAll('article section')].map(e=>e.id));
  assert.equal(native.querySelectorAll('script,iframe,form').length,0);
  assert.ok(native.getElementById('Sx1.p1.1')?.closest('section'));
});
test('figure and table captions are translatable without changing original paragraph IDs, table cells or protected content',()=>{
  const window=new JSDOM('').window,purifier=createDOMPurify(window);
  const parse=(html:string)=>parsePaper(html,'https://arxiv.org/html/2602.04299v1',new window.DOMParser(),value=>purifier.sanitize(value,PAPER_SANITIZE_OPTIONS));
  const html='<article class="ltx_document"><h1>Title</h1><p class="ltx_p">First paragraph.</p><figure id="figure7"><img src="plot.png"><figcaption class="ltx_caption"><span class="ltx_tag">Figure 7:</span> Four MI tasks in the <math alttext="alpha"><mi>α</mi></math> band. <cite class="ltx_cite">[1]</cite></figcaption></figure><p class="ltx_p">Second paragraph.</p><table id="table1"><caption>Table 1: Scores in .csv files.</caption><tbody><tr><td>Original cell</td></tr></tbody></table></article>';
  const paper=parse(html),withoutCaptions=parse(html.replace(/<figcaption[\s\S]*?<\/figcaption>|<caption>[\s\S]*?<\/caption>/g,''));
  assert.deepEqual(paper.blocks.filter(b=>b.kind==='paragraph').map(b=>b.id),withoutCaptions.blocks.filter(b=>b.kind==='paragraph').map(b=>b.id));
  const captions=paper.blocks.filter(b=>b.kind==='caption');assert.equal(captions.length,2);assert.ok(captions.every(isTranslatable));assert.equal(paper.blocks.filter(isTranslatable).length,4);
  assert.ok(captions[0].input.includes('Figure 7:'));assert.equal(Object.keys(captions[0].tokens).length,2);assert.equal(Object.keys(captions[1].tokens).length,1);
  const output=restoreTranslation('图 7：四类运动想象任务的 ⟦P0⟧ 频段曲线。⟦P1⟧',captions[0].tokens,window.document);
  const translated=new JSDOM(output).window.document;assert.ok(translated.querySelector('math'));assert.equal(translated.querySelector('.ltx_cite')?.textContent,'[1]');
  const document=new JSDOM(paper.html).window.document;assert.equal(document.querySelector('td')?.textContent,'Original cell');assert.equal(document.querySelectorAll('figcaption,caption').length,2);assert.ok(captions.every(b=>document.getElementById(b.id)));
  assert.deepEqual(parse(paper.html).blocks.filter(b=>b.kind==='caption').map(b=>b.id),captions.map(b=>b.id));
});
test('hidden TeX annotations do not become duplicate visible formula text after sanitizing',()=>{
  const window=new JSDOM('').window;const purifier=createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
  const paper=parsePaper('<article class="ltx_document"><h1>Title</h1><p class="ltx_p" id="p"><math><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></p></article>','https://arxiv.org/html/1234.56789',new window.DOMParser(),value=>purifier.sanitize(value,PAPER_SANITIZE_OPTIONS));
  const document=new JSDOM(paper.html).window.document;const math=document.querySelector('math')!;
  assert.equal(math.getAttribute('alttext'),'\\frac{a}{b}');assert.equal(math.textContent,'ab');
  const target=formulaTarget(math,paper.source,paper.title)!;assert.equal(target.expression,'\\frac{a}{b}');
  const preview=new JSDOM(purifier.sanitize(target.html,PAPER_SANITIZE_OPTIONS)).window.document;
  assert.equal(preview.querySelector('math')?.textContent,'ab');assert.ok(preview.querySelector('mfrac'));
});
test('multiple API profiles retain separate keys and restore the selected profile',()=>{
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  let config:Configuration={version:1,activeId:'',profiles:[]};
  config=saveProfile(config,{...defaults,provider:'llm',id:'a',name:'第一组',key:'test-key-a'});
  config=saveProfile(config,{...defaults,provider:'llm',id:'b',name:'第二组',key:'test-key-b',endpoint:'https://example.com/v1'});
  writeConfiguration(storage,config);
  const restored=readConfiguration(storage);
  assert.equal(restored.profiles.length,2);assert.equal(restored.activeId,'b');assert.equal(activeSettings(restored).key,'test-key-b');
  const updated=saveProfile(restored,{...restored.profiles[0],name:'改名后',model:'different-model'});
  assert.equal(updated.profiles.length,2);assert.equal(activeSettings(updated).key,'test-key-a');
  const deleted=deleteProfile(updated,'a');writeConfiguration(storage,deleted);
  assert.equal(activeSettings(readConfiguration(storage)).key,'test-key-b');
  const empty=deleteProfile(deleted,'b');writeConfiguration(storage,empty);
  data.set('reader-settings',JSON.stringify({...defaults,key:'old-key'}));
  assert.equal(readConfiguration(storage).profiles.length,0);assert.equal(activeSettings(readConfiguration(storage)).key,'');
  assert.ok(data.has(CONFIG_KEY));
});
test('profile storage migrates old settings, tolerates broken storage and surfaces failed saves',()=>{
  const legacy=readConfiguration({getItem:key=>key==='reader-settings'?JSON.stringify({...defaults,model:'custom-model'}):null});
  assert.equal(legacy.profiles.length,1);assert.equal(activeSettings(legacy).model,'custom-model');
  const broken=readConfiguration({getItem:()=>{throw Error('blocked');}});assert.equal(broken.profiles.length,0);
  assert.throws(()=>writeConfiguration({setItem:()=>{throw Error('quota');}},legacy),/quota/);
});
test('arXiv importer accepts supported links, pins supplied versions and rejects other hosts',()=>{
  for(const input of ['2501.12948v1','https://arxiv.org/abs/2501.12948v1','https://arxiv.org/html/2501.12948v1#S1','https://arxiv.org/pdf/2501.12948v1.pdf?download=1'])assert.equal(arxivUrl(input),'https://arxiv.org/html/2501.12948v1');
  assert.equal(arxivUrl('hep-th/9901001'),'https://arxiv.org/html/hep-th/9901001');
  for(const input of ['https://evil.test/abs/2501.12948','https://arxiv.org.evil.test/html/2501.12948','https://user:pass@arxiv.org/html/2501.12948','file:///paper.html','../../secret','https://arxiv.org/search','123'])assert.throws(()=>arxivUrl(input));
});
test('arXiv fetch reports missing HTML and preserves resolved source URL',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('no html',{status:404});
    await assert.rejects(()=>fetchArxiv('2501.12948'),/没有可用/);
    globalThis.fetch=async()=>new Response('<article>paper</article>',{status:200});
    const loaded=await fetchArxiv('2501.12948v1');assert.equal(loaded.source,'https://arxiv.org/html/2501.12948v1');assert.match(loaded.html,/paper/);
  }finally{globalThis.fetch=original;}
});
test('real arXiv MathML suffixes and nested citations survive sample translation',()=>{
  for(const id of ['Sx2.SSx3.SSSx2.p1.1','Sx2.SSx3.SSSx2.p2.1']) {
    const source=doc.getElementById(id)!;
    const prepared=prepareParagraph(source);
    const html=restoreTranslation(samples[id],prepared.tokens,doc);
    assert.match(html,/alttext="\.(mat|csv)"/);
    assert.match(html,/href="#bib.bib39"/);
    assert.equal(new JSDOM(html).window.document.querySelectorAll('math').length,source.querySelectorAll('math').length);
    assert.ok(!html.includes('⟦P'));
  }
});
test('rejects omitted, duplicate, and invented placeholders',()=>{
  for(const output of ['丢失','⟦P0⟧⟦P0⟧','⟦P0⟧⟦P1⟧']) assert.throws(()=>restoreTranslation(output,{'⟦P0⟧':'<code>.csv</code>'},doc));
});
test('filenames stay whole and model HTML remains text',()=>{
  const p=doc.createElement('p');p.textContent='Read dataset_description.md and subject.nii.gz.';
  const prep=prepareParagraph(p);assert.equal(Object.keys(prep.tokens).length,2);
  const html=restoreTranslation('<img src=x onerror=alert(1)> '+prep.text,prep.tokens,doc);
  assert.match(html,/&lt;img/);assert.match(html,/<code>subject.nii.gz<\/code>/);
});
test('cache distinguishes version, model and glossary',()=>{
  const base=cacheKey('v1','text','endpoint','model','terms');
  assert.notEqual(base,cacheKey('v2','text','endpoint','model','terms'));
  assert.notEqual(base,cacheKey('v1','text','endpoint','other','terms'));
  assert.notEqual(base,cacheKey('v1','text','endpoint','model','new terms'));
});
test('arXiv directory rows become a readable code block without changing filenames',()=>{
  const clone=doc.querySelector('article')!.cloneNode(true) as Element;
  normalizeArticle(clone);
  const tree=clone.querySelector('#Sx3\\.F5 pre.directory-tree')!;
  assert.ok(tree);assert.match(tree.textContent!,/│   │   ├─ 0926-001.csv/);
  assert.ok(tree.textContent!.split('\n').length>30);
  assert.equal(clone.querySelector('math[alttext=".mat"]')?.textContent,'.mat');
  assert.equal(clone.querySelector('math[alttext=".csv"]')?.textContent,'.csv');
});
test('Google adapter joins segments, handles official response and reports rejection',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify([[['脑电数据','EEG data'],['已导出。','were exported.']]]),{status:200});
    assert.equal(await googleTranslate('EEG data were exported.'),'脑电数据已导出。');
    globalThis.fetch=async()=>new Response(JSON.stringify({data:{translations:[{translatedText:'官方接口译文'}]}}),{status:200});
    assert.equal(await googleTranslate('text','test-only-key'),'官方接口译文');
    globalThis.fetch=async()=>new Response('Rejected',{status:429});
    await assert.rejects(()=>googleTranslate('text'),/429/);
  } finally {globalThis.fetch=original;}
});

test('Google 批量适配器按顺序返回并在格式异常时退回单条',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(input:any)=>{const qs=new URL(String(input)).searchParams.getAll('q');return new Response(JSON.stringify(qs.map(q=>`译:${q}`)),{status:200});};
    assert.deepEqual(await googleTranslateBatch(['a','b','c']),['译:a','译:b','译:c']);
    assert.deepEqual(await googleTranslateBatch(['solo']),['译:solo']);
    globalThis.fetch=async(input:any)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith('/translate_a/t')&&url.searchParams.getAll('q').length>1)return new Response(JSON.stringify(['only-one']),{status:200});
      const q=url.searchParams.get('q')||'';
      return new Response(JSON.stringify([[['译:'+q,q]]]),{status:200});
    };
    assert.deepEqual(await googleTranslateBatch(['p','q']),['译:p','译:q']);
  } finally {globalThis.fetch=original;}
});
test('Google 批量入口按编码后的长度切分',()=>{
  const chunks=splitBatch(['a'.repeat(100),'b'.repeat(100),'c'.repeat(100)],250,10);
  assert.equal(chunks.length,2);
  assert.equal(chunks.flat().length,3);
});


test('multi-site URLs normalize only supported article routes and reject credentials or unrelated hosts',()=>{
  assert.equal(paperUrl('https://nature.com/articles/s41597-026-07807-x?utm=test'),'https://www.nature.com/articles/s41597-026-07807-x');
  assert.equal(paperUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC13458765'),'https://pmc.ncbi.nlm.nih.gov/articles/PMC13458765/');
  assert.equal(paperUrl('2602.04299v1'),arxivUrl('2602.04299v1'));
  for(const value of ['https://nature.com.evil.test/articles/abc','https://user:secret@www.nature.com/articles/abc','https://www.nature.com/articles/abc/figures/1','https://pmc.ncbi.nlm.nih.gov/elsewhere'])assert.throws(()=>paperUrl(value));
  assert.equal(sourceLabel('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/'),'PMC');
});

test('publisher adapters retain formulas, captions, table cells and metadata across cached reparsing',()=>{
  const Parser=new JSDOM('').window.DOMParser,domParser=new Parser();
  const meta='<meta name="citation_title" content="Example paper"><meta name="citation_author" content="Feng, Lufeng"><meta name="citation_doi" content="10.1038/example"><meta name="citation_journal_title" content="Scientific Data">';
  const nature=meta+'<h1>Example paper</h1><div class="c-article-body"><section><div><h2 id="Sec1">Methods</h2></div><div><h3>Processing</h3></div><p>Read data.csv and <span class="mathjax-tex">\\(x_i\\)</span>.</p><div class="c-article-equation" id="Equ1"><div class="c-article-equation__content"><span class="mathjax-tex">$$x_i=1$$</span></div><div class="c-article-equation__number">(1)</div></div><figure><figcaption>Fig. 1</figcaption><img src="/image.png"><div class="c-article-section__figure-description"><p>EEG results.</p></div></figure><div class="c-article-table"><figure><figcaption>Table 1 Results</figcaption><table><tr><td>42</td></tr></table></figure></div></section></div>';
  const pmc=meta+'<section class="body main-article-body"><section id="Sec1"><h2>Methods</h2><p id="Par1">Value <math><mi>x</mi></math>.</p><section class="tw" id="Tab1"><h3 class="obj_head">Table 1.</h3><div class="caption"><p>EEG results.</p></div><div class="tbl-box"><table><tr><td>42</td></tr></table></div></section></section></section>';
  for(const [raw,source] of [[nature,'https://www.nature.com/articles/example'],[pmc,'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/']]){
    const paper=parsePaper(raw,source,domParser,x=>x),again=parsePaper(paper.html,source,domParser,x=>x);
    assert.equal(paper.doi,'10.1038/example');assert.equal(paper.journal,'Scientific Data');
    assert.deepEqual(again.blocks.map(b=>[b.id,b.kind,b.input]),paper.blocks.map(b=>[b.id,b.kind,b.input]));
    assert.equal(paper.blocks.filter(b=>b.kind==='paragraph').length,1);
    assert.ok(paper.blocks.some(b=>b.kind==='caption'&&b.text.includes('EEG results.')));
    const d=domParser.parseFromString(paper.html,'text/html');assert.equal(d.querySelector('td')?.textContent,'42');assert.ok(d.querySelector('math'));
    const math=d.querySelector('.ltx_equation math');if(math){const target=formulaTarget(math,source,paper.title)!;assert.equal(target.location.anchor,'Equ1');assert.equal(target.location.label,'(1)');assert.equal(target.format,'LaTeX');assert.deepEqual(target.location.sections,['Methods','Processing']);}
  }
});

test('paper versions share grouping but retain independent cached translations when merged and detached',async()=>{
  const parser=new (new JSDOM('').window.DOMParser)();
  const raw='<article class="ltx_document" data-reader-doi="10.1234/versions"><h1>Versions</h1><p class="ltx_p" id="v-p">Original</p></article>';
  const a=parsePaper(raw,'https://www.nature.com/articles/version-test',parser,x=>x),b=parsePaper(raw,'https://pmc.ncbi.nlm.nih.gov/articles/PMC998877/',parser,x=>x);
  await savePaper(a);await savePaper(b);await saveTranslation(a.source,'v-p','versions-a',{html:'A译文',type:'api'});await saveTranslation(b.source,'v-p','versions-b',{html:'B译文',type:'api'});
  assert.equal(workKey((await readPaper(a.source))!),workKey((await readPaper(b.source))!));
  await movePaper(a.source,'');assert.equal((await readPaper(b.source))!.groupId,'');
  await detachVersion(a.source);assert.notEqual(workKey((await readPaper(a.source))!),workKey((await readPaper(b.source))!));
  await mergeWorks(workKey((await readPaper(a.source))!),workKey((await readPaper(b.source))!));
  const records=[(await readPaper(a.source))!,(await readPaper(b.source))!];assert.equal(paperWorks(records).length,1);assert.equal(records[0].results['v-p'].html,'A译文');assert.equal(records[1].results['v-p'].html,'B译文');
  await savePaper(a);assert.equal(workKey((await readPaper(a.source))!),workKey(records[1]));
});
