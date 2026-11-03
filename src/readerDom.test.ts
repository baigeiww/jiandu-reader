import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createReaderUpdates} from './readerDom';

test('只更新变化的译文，保留其他段落、选区和公式 DOM',()=>{
  const doc=new JSDOM('<div class="ltx_authors"><span class="ltx_personname">Author</span><span>Institute</span></div><p id="p">Original</p><p id="q">Next</p><table><caption id="c">Caption</caption></table>').window.document;
  const blocks=[{id:'p',kind:'paragraph'},{id:'q',kind:'paragraph'},{id:'c',kind:'caption'}];
  const update=createReaderUpdates(doc,blocks);
  assert.match(doc.querySelector('.reader-authors summary')!.textContent!,/Author/);assert.match(doc.querySelector('.reader-authors .ltx_authors')!.textContent!,/Institute/);
  const result={html:'译文 <math><mi>x</mi></math>',type:'api'};
  update({p:result},{},{},false);
  const p=doc.querySelector('[data-reader-addon="p"]')!,translation=p.querySelector('.reader-translation')!,math=p.querySelector('math');
  assert.equal(math?.getAttribute('role'),'button');
  const range=doc.createRange();range.selectNodeContents(translation);doc.getSelection()!.addRange(range);
  const selection=doc.getSelection()!.toString();
  update({p:{...result},q:{html:'第二段',type:'api'}},{p:true},{p:'稍后重试'},false);
  assert.equal(p.querySelector('.reader-translation'),translation);assert.equal(p.querySelector('math'),math);
  assert.equal(doc.getSelection()!.toString(),selection);assert.equal(p.querySelector('button')!.disabled,true);
  assert.equal(p.querySelector('.reader-error')!.textContent,'稍后重试');
  assert.equal(doc.querySelector('table')!.nextElementSibling?.getAttribute('data-reader-addon'),'c');
  update({p:result},{},{},true);assert.equal(p.querySelector('.reader-error'),null);assert.equal(p.querySelector('button')!.disabled,true);
  createReaderUpdates(doc,blocks)({p:result},{},{},false);assert.equal(doc.querySelectorAll('[data-reader-addon]').length,3);assert.equal(doc.querySelectorAll('.reader-authors').length,1);
});
