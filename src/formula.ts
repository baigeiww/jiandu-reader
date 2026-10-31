import {readableText} from './core';

export type FormulaTarget={
  expression:string;
  format:'LaTeX'|'MathML';
  html:string;
  location:{paperTitle:string;sections:string[];label:string;anchor:string;ordinal:number};
  source:string;
};

export const FORMULA_PROMPT='用中文简要解释公式的符号与构成，以及在论文主题中的意义和用意。数学符号用 \\(…\\)，独立公式用 \\[…\\]。只依据已给信息，不假定已读网址；信息不足时说明。';

function mathSource(math:Element) {
  return math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()||math.getAttribute('alttext')?.trim()||'';
}

function mathMarkup(math:Element) {
  const clone=math.cloneNode(true) as Element;
  for(const attribute of ['id','role','tabindex','aria-label','title'])clone.removeAttribute(attribute);
  clone.querySelectorAll('[id]').forEach(child=>child.removeAttribute('id'));
  return clone.outerHTML;
}

export function formulaTarget(clicked:Element,source:string,paperTitle:string):FormulaTarget|null {
  let math=clicked.closest('math');
  if(!math||math.classList.contains('technical-literal'))return null;
  const doc=math.ownerDocument;
  let ambiguousAnchor='';
  // Translated inline formulas have no IDs. Recover their original location
  // from the paragraph they were restored from, rather than numbering copies.
  const addon=math.closest<HTMLElement>('[data-reader-addon]');
  if(addon){
    const original=doc.getElementById(addon.dataset.readerAddon!);
    const signature=mathSource(math)||readableText(math);
    const matches=[...original?.querySelectorAll('math')||[]].filter(node=>(mathSource(node)||readableText(node))===signature);
    if(matches.length>1)ambiguousAnchor=original?.id||addon.dataset.readerAddon!;
    math=matches[0]||math;
  }
  const equation=math.closest('.ltx_equation')||math.closest('.ltx_eqn_row');
  const scope=equation||math;
  const maths=equation?[...equation.querySelectorAll('math')]:[math];
  const latex=maths.map(mathSource);
  const expression=latex.every(Boolean)?latex.join('\n'):maths.map(mathMarkup).join('\n');
  const sections:string[]=[];
  let section=scope.closest('section');
  while(section){
    const heading=[...section.children].find(node=>/^H[1-6]$/.test(node.tagName));
    if(heading)sections.unshift(readableText(heading));
    section=section.parentElement?.closest('section')||null;
  }
  if(scope.closest('.reader-publisher')){
    // Publisher subheadings often sit in wrappers rather than direct section children.
    const path:{level:number;text:string}[]=[];
    for(const heading of doc.querySelectorAll('article h2,article h3,article h4,article h5,article h6')){
      if(!(heading.compareDocumentPosition(scope)&4))continue;
      const level=Number(heading.tagName.slice(1));while(path.length&&path.at(-1)!.level>=level)path.pop();
      path.push({level,text:readableText(heading)});
    }
    sections.splice(0,sections.length,...path.map(h=>h.text));
  }
  const label=equation?.querySelector('.ltx_tag_equation,.ltx_tag')?.textContent?.trim()||'';
  const paragraph=math.closest('[data-reader-block],.ltx_para,p');
  const anchor=ambiguousAnchor||equation?.id||math.id||paragraph?.id||addon?.dataset.readerAddon||scope.closest('section')?.id||'';
  const originals=[...doc.querySelectorAll('article math')].filter(node=>!node.closest('.reader-addon')&&!node.classList.contains('technical-literal'));
  const ordinal=ambiguousAnchor?0:originals.indexOf(math)+1;
  return {expression,format:latex.every(Boolean)?'LaTeX':'MathML',html:maths.map(mathMarkup).join(''),location:{paperTitle,sections,label,anchor,ordinal},source};
}

export function formulaMessage(target:FormulaTarget) {
  return JSON.stringify({
    公式:{格式:target.format,内容:target.expression},
    位置:{论文标题:target.location.paperTitle,章节:target.location.sections,公式编号:target.location.label||'未编号',HTML锚点:target.location.anchor,原文公式序号:target.location.ordinal||'无法确定'},
    论文HTML网址:target.source,
  },null,2);
}
