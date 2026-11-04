import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {frontiersArticle} from './frontiers';
import {parsePaper,PAPER_SANITIZE_OPTIONS} from './paper';
import {paperUrl,paperPdfUrl,sourceLabel,fetchPaper} from './sources';
import {formulaTarget} from './formula';

const source='https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2012.00055/full';
// Mirrors Frontiers' JATS + server-rendered page structure, including equations
// absent from the HTML and TIFF graphics exposed as web images in the page.
const xml=`<article xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:xlink="http://www.w3.org/1999/xlink">
<front><journal-meta><journal-title>Frontiers in Neuroscience</journal-title></journal-meta><article-meta>
<article-id pub-id-type="doi">10.3389/fnins.2012.00055</article-id><title-group><article-title>Example competition review</article-title></title-group>
<contrib-group><contrib contrib-type="author"><name><surname>Reader</surname><given-names>A.</given-names></name></contrib></contrib-group>
<abstract><p>Abstract text.</p></abstract><permissions><copyright-statement>Author credit.</copyright-statement></permissions></article-meta></front>
<body><sec id="s1"><label>1</label><title>Introduction</title><p id="p1">Use data.csv and <xref ref-type="bibr" rid="B1">2020</xref><xref ref-type="fn" rid="fn1"><sup>1</sup></xref>.</p>
<disp-formula id="E1"><label>(1)</label><mml:math id="M1"><mml:mfrac><mml:mi>x</mml:mi><mml:mi>y</mml:mi></mml:mfrac><mml:mfenced><mml:mi>a</mml:mi><mml:mi>b</mml:mi></mml:mfenced></mml:math></disp-formula>
<fig id="F1"><label>Figure 1</label><caption><p><bold>Complete image.</bold> See <xref rid="B1">2020</xref>.</p></caption><graphic xlink:href="test-g001.tif"/></fig>
<table-wrap id="T1"><label>Table 1</label><caption><p>Table caption.</p></caption><table><thead><tr><th colspan="2">Channels</th></tr></thead><tbody><tr><td>EEG</td><td>64</td></tr></tbody></table><table-wrap-foot><p>Table footnote.</p></table-wrap-foot></table-wrap>
<sec><label>1.1</label><title>Method</title><p>Inline <inline-formula><mml:math><mml:mi>z</mml:mi></mml:math></inline-formula>.</p><list><list-item><p>List item.</p></list-item></list></sec></sec></body>
<back><app-group><app id="A1"><label>A</label><title>Appendix</title><preformat>line 1\nline 2</preformat></app></app-group><ref-list><title>References</title><ref id="B1"><citation>Reference text.</citation></ref></ref-list><fn-group><fn id="fn1"><p>Footnote text.</p></fn></fn-group></back></article>`;
const page='<script>throw Error("publisher scripts must be discarded")</script><div class="ArticleContent"><div id="F1" class="ArticleFigure"><button><figure><img src="https://www.frontiersin.org/files/Articles/123/xml-images/test-g001.webp"></figure></button></div><span></span></div>';

test('Frontiers URLs and PDF destinations accept article routes and reject arbitrary hosts or paths',()=>{
  for(const suffix of ['full','abstract','pdf'])assert.equal(paperUrl(source.replace('/full','/'+suffix)+'?tracking=1#F1'),source);
  assert.equal(paperUrl('https://frontiersin.org/articles/10.3389/fnins.2012.00055/full/'),'https://www.frontiersin.org/articles/10.3389/fnins.2012.00055/full');
  assert.equal(sourceLabel(source),'Frontiers');assert.equal(paperPdfUrl(source),source.replace('/full','/pdf'));
  for(const url of [source.replace('www.frontiersin.org','www.frontiersin.org.evil.test'),source.replace('https://','https://user:secret@'),source.replace('/full','/xml'),source.replace('/full','/full/extra'),source.replace('10.3389','10.9999')])assert.throws(()=>paperUrl(url));
});

test('Frontiers JATS retains formulas, figures, table structure, anchors and independently translatable captions',()=>{
  const window=new JSDOM('').window,parser=new window.DOMParser(),purify=createDOMPurify(window);
  const html=frontiersArticle(xml,page,source,parser),sanitize=(value:string)=>purify.sanitize(value,PAPER_SANITIZE_OPTIONS);
  const paper=parsePaper(html,source,parser,sanitize),doc=parser.parseFromString(paper.html,'text/html');
  assert.equal(paper.title,'Example competition review');assert.equal(paper.authors,'A. Reader');assert.equal(paper.id,'10.3389/fnins.2012.00055');assert.equal(paper.journal,'Frontiers in Neuroscience');
  assert.equal(doc.querySelectorAll('math').length,2);assert.equal(doc.querySelector('math')?.namespaceURI,'http://www.w3.org/1998/Math/MathML');
  assert.ok(doc.querySelector('mfrac'));assert.ok(!paper.html.includes('mml:'));assert.ok(!doc.querySelector('mfenced'));
  const target=formulaTarget(doc.querySelector('#M1')!,source,paper.title)!;assert.equal(target.location.anchor,'E1');assert.equal(target.location.label,'(1)');
  assert.equal(doc.querySelector('figure img')?.getAttribute('src'),'https://www.frontiersin.org/files/Articles/123/xml-images/test-g001.webp');
  assert.equal(doc.querySelectorAll('table td').length,2);assert.equal(doc.querySelector('th')?.getAttribute('colspan'),'2');
  assert.ok(doc.querySelector('#T1')?.textContent?.includes('Table footnote.'));assert.equal(doc.querySelector('pre')?.textContent,'line 1\nline 2');
  assert.ok(!doc.querySelector('script,button,iframe'));assert.ok(!paper.html.includes('publisher scripts'));
  for(const link of doc.querySelectorAll('a[href^="#"]'))assert.ok(doc.getElementById(link.getAttribute('href')!.slice(1)));
  assert.deepEqual(paper.blocks.filter(b=>b.kind==='heading').slice(0,3).map(b=>[b.level,b.text]),[[2,'Abstract'],[2,'1 Introduction'],[3,'1.1 Method']]);
  assert.equal(paper.blocks.filter(b=>b.kind==='caption').length,2);
  assert.ok(!paper.blocks.some(b=>b.kind==='paragraph'&&/caption|Reference text|Author credit|Table footnote|Complete image/.test(b.text)));
  const p=paper.blocks.find(b=>b.id==='p1')!;assert.ok(Object.values(p.tokens).some(value=>value.includes('#B1')));assert.ok(Object.values(p.tokens).some(value=>value.includes('data.csv')));
  const again=parsePaper(paper.html,source,parser,sanitize);assert.deepEqual(again.blocks,paper.blocks);
  assert.throws(()=>frontiersArticle('<html>blocked</html>',page,source,parser),/全文数据不完整/);
  assert.throws(()=>frontiersArticle(xml.replace('10.3389/fnins.2012.00055','10.3389/fnins.2026.11111'),page,source,parser),/另一篇论文/);
});

test('Frontiers imports combine official XML with image URLs from the full page',async()=>{
  const oldFetch=globalThis.fetch,oldParser=globalThis.DOMParser,paths:string[]=[];
  globalThis.DOMParser=new JSDOM('').window.DOMParser;
  globalThis.fetch=async(input)=>{const path=String(input);paths.push(path);return new Response(path.endsWith('/xml')?xml:page);};
  try{const paper=await fetchPaper(source);assert.equal(paper.source,source);assert.ok(paper.html.includes('<math'));assert.equal(paths.length,2);assert.ok(paths.includes('/paper-frontiers'+new URL(source).pathname.replace('/full','/xml')));}
  finally{globalThis.fetch=oldFetch;globalThis.DOMParser=oldParser;}
});
