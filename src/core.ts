export const SOURCE = 'https://arxiv.org/html/2602.04299v1';
export const PROTECTED = 'math,code,pre,.ltx_verbatim,.ltx_cite,a.ltx_ref';
export const TERMS = [
  ['motor imagery', '运动想象'], ['fNIRS', '功能性近红外光谱'], ['EEG', '脑电'],
  ['MIND', '保留原名'], ['.mat', '原样保留'], ['.csv', '原样保留'],
];

export function normalizeArticle(article: Element) {
  const doc=article.ownerDocument;
  article.querySelectorAll('math').forEach(math=>{
    const tex=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if(tex&&!math.getAttribute('alttext'))math.setAttribute('alttext',tex);
  });
  article.querySelectorAll('math[alttext]').forEach(math=>{
    const literal=(math.getAttribute('alttext') || '').replace(/\\_/g,'_');
    if(/^(?:\.[a-z]{2,8}(?:\.gz)?|[\w.-]+\.(?:md|mat|csv|txt)|[\w_]+\/)$/i.test(literal)) {
      const text=doc.createElementNS('http://www.w3.org/1998/Math/MathML','mtext');
      text.textContent=literal;
      math.replaceChildren(text);
      math.classList.add('technical-literal');
    }
  });
  // A listing can share a figure with other panels, images and captions.
  article.querySelectorAll('figure > :is(p,div,span)').forEach(listing=>{
    const rows=[...listing.querySelectorAll('.ltx_verbatim .ltx_p')].filter(row=>!row.querySelector('.ltx_p'));
    if(!rows.length)return;
    if(listing.querySelector('figure,figcaption,img,picture,svg,object,math,table'))return;
    const lines=rows.map(row=>row.textContent || '');
    if(lines.join('').replace(/\s/g,'')!==listing.textContent?.replace(/\s/g,''))return;
    const pre=doc.createElement('pre');pre.className='directory-tree ltx_verbatim';
    if(listing.id)pre.id=listing.id;
    pre.textContent=lines.join('\n');
    listing.replaceWith(pre);
  });
}

export function prepareParagraph(element: Element) {
  const clone = element.cloneNode(true) as Element;
  const tokens: Record<string,string> = {};
  // Protect outer nodes only: a reference inside a citation belongs to that citation.
  [...clone.querySelectorAll(PROTECTED)].filter(n => !n.parentElement?.closest(PROTECTED)).forEach((node, i) => {
    const key = `⟦P${i}⟧`;
    tokens[key] = node.outerHTML;
    node.replaceWith(clone.ownerDocument.createTextNode(key));
  });
  let text = clone.textContent || '';
  text = text.replace(/https?:\/\/[^\s<>⟦⟧]+|\b[\w-]+\.(?:nii\.gz|mat|csv|pkl|pth|pt|md|edf|set|snirf)\b|\.(?:nii\.gz|mat|csv|pkl|pth|pt|md|edf|set|snirf)\b/g, value => {
    let suffix='';
    if(/^https?:\/\//.test(value)){
      // Keep sentence punctuation and unmatched closing brackets outside URL tokens.
      while(value){
        const last=value.at(-1)!;const opening:Record<string,string>={')':'(',']':'[','}':'{'};
        if(/[.,;:!?，。；：！？]/.test(last)||(opening[last]&&value.split(last).length>value.split(opening[last]).length)){
          suffix=last+suffix;value=value.slice(0,-1);
        }else break;
      }
    }
    const key = `⟦P${Object.keys(tokens).length}⟧`;
    const code = clone.ownerDocument.createElement('code'); code.textContent = value;
    tokens[key] = code.outerHTML;
    return key+suffix;
  });
  return {text: text.replace(/\s+/g,' ').trim(), tokens};
}

export function restoreTranslation(text: string, tokens: Record<string,string>, doc: Document) {
  const occurrences = text.match(/⟦P\d+⟧/g) || [];
  if (occurrences.some(key => !(key in tokens)) || Object.keys(tokens).some(key => occurrences.filter(x=>x===key).length !== 1)) {
    throw new Error('译文中的公式、引用或文件名占位符不完整，请重试。');
  }
  // Treat model output as text, then restore only trusted source nodes.
  const holder = doc.createElement('div'); holder.textContent = text;
  return holder.innerHTML.replace(/⟦P\d+⟧/g, key => {
    const fragment=doc.createElement('template');fragment.innerHTML=tokens[key];
    fragment.content.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    return fragment.innerHTML;
  });
}

export function readableText(element: Element) {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('math').forEach(n => n.replaceWith(clone.ownerDocument.createTextNode(n.getAttribute('alttext') || n.textContent || '')));
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

export function cacheKey(source: string, text: string, endpoint: string, model: string, glossary: string) {
  return JSON.stringify([source, text, endpoint, model, glossary]);
}
