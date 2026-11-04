import katex from 'katex';

const mathNamespace='http://www.w3.org/1998/Math/MathML';
const xlinkNamespace='http://www.w3.org/1999/xlink';

// Convert the publisher's public JATS into a small, script-free reading document.
// No publisher runtime, fonts, hydration state or tracking widgets are retained.
export function frontiersArticle(xml:string,page:string,source:string,parser=new DOMParser()){
  const data=parser.parseFromString(xml,'application/xml');
  if(data.querySelector('parsererror')||data.documentElement.localName!=='article'||!data.querySelector('body > sec'))throw Error('Frontiers 全文数据不完整，暂时无法读取这篇论文，请稍后重试。');
  const original=parser.parseFromString(page,'text/html');
  const doc=original.implementation.createHTMLDocument('');
  const article=doc.createElement('article');article.className='ltx_document reader-publisher reader-frontiers';
  const meta=data.querySelector('article-meta');
  const doi=meta?.querySelector('article-id[pub-id-type="doi"]')?.textContent?.trim().toLowerCase()||'';
  if(doi&&!new URL(source).pathname.toLowerCase().includes('/'+doi+'/'))throw Error('Frontiers 返回了另一篇论文的全文，请检查网址后重试。');
  article.dataset.readerDoi=doi;
  article.dataset.readerJournal=data.querySelector('journal-meta > journal-title, journal-title-group > journal-title')?.textContent?.trim()||'';
  const heading=doc.createElement('h1');heading.className='ltx_title_document';heading.textContent=meta?.querySelector('title-group > article-title')?.textContent?.trim()||'';
  const authors=doc.createElement('div');authors.className='ltx_authors';
  meta?.querySelectorAll('contrib-group > contrib[contrib-type="author"]').forEach((author,index)=>{
    const name=author.querySelector('name'),label=doc.createElement('span');label.className='ltx_personname';
    label.textContent=name?[name.querySelector('given-names')?.textContent,name.querySelector('surname')?.textContent].filter(Boolean).join(' '):author.querySelector('collab')?.textContent||'';
    if(index)authors.append(', ');authors.append(label);
  });
  article.append(heading,authors);
  const images=new Map<string,string>();
  function imageKey(value:string){return value.split('/').at(-1)!.split('?')[0].replace(/\.(?:tiff?|jpe?g|png|gif|webp|svg)$/i,'').toLowerCase();}
  original.querySelectorAll<HTMLImageElement>('.ArticleContent img, .fulltext-view img').forEach(image=>{
    const href=image.getAttribute('src');if(!href)return;
    const url=new URL(href,source);if(url.protocol==='https:')images.set(imageKey(url.pathname),url.href);
  });
  let sectionIndex=0;
  const direct=(element:Element,tag:string)=>[...element.children].find(child=>child.localName===tag);
  function element(tag:string,node?:Element){const out=doc.createElement(tag);if(node?.id)out.id=node.id;return out;}
  function children(node:Node,parent:Node,level:number){for(const child of node.childNodes)parent.appendChild(render(child,level));}
  function render(node:Node,level=2):Node{
    if(node.nodeType===3||node.nodeType===4)return doc.createTextNode(node.textContent||'');
    if(node.nodeType!==1)return doc.createTextNode('');
    const input=node as Element,tag=input.localName;
    if(input.namespaceURI===mathNamespace){
      // Recreate unprefixed MathML. XML's mml: prefixes do not render in HTML.
      if(tag==='mfenced'){
        const row=doc.createElementNS(mathNamespace,'mrow');
        const fence=(text:string)=>{const mo=doc.createElementNS(mathNamespace,'mo');mo.textContent=text;return mo;};
        row.append(fence(input.getAttribute('open')??'('));
        const separators=(input.getAttribute('separators')??',').replace(/\s/g,'');
        [...input.children].forEach((child,index)=>{if(index&&separators)row.append(fence(separators[Math.min(index-1,separators.length-1)]));row.append(render(child,level));});
        row.append(fence(input.getAttribute('close')??')'));return row;
      }
      const out=doc.createElementNS(mathNamespace,tag);
      for(const attr of input.attributes)if(!attr.name.includes(':')&&!/^on/i.test(attr.name))out.setAttribute(attr.name,attr.value);
      children(input,out,level);return out;
    }
    if(['script','style','object','iframe'].includes(tag))return doc.createTextNode('');
    if(tag==='tex-math'){
      const out=element('span'),tex=input.textContent||'';
      try{out.innerHTML=katex.renderToString(tex,{output:'mathml',throwOnError:true,trust:false,maxExpand:1000});}catch{const code=element('code');code.textContent=tex;out.append(code);}return out;
    }
    if(['sec','app','abstract','ack','fn-group','ref-list'].includes(tag)){
      const section=element('section',input),title=direct(input,'title'),label=direct(input,'label');
      if(!section.id)section.id=tag==='abstract'?'abstract':tag==='ref-list'?'references':'frontiers-section-'+sectionIndex++;
      const h=element('h'+Math.min(level,6));h.id=section.id+'-title';
      h.textContent=[label?.textContent,title?.textContent||({abstract:'Abstract',ack:'Acknowledgments','fn-group':'Footnotes','ref-list':'References'} as Record<string,string>)[tag]].filter(Boolean).join(' ');
      if(h.textContent)section.append(h);
      if(tag==='ref-list')section.className='reader-bibliography';
      for(const child of input.childNodes)if(child!==title&&child!==label)section.append(render(child,level+1));
      return section;
    }
    if(tag==='fig'||tag==='table-wrap'){
      const figure=element('figure',input);figure.className=tag==='fig'?'ltx_figure':'ltx_table';
      const label=direct(input,'label'),caption=direct(input,'caption');
      for(const child of input.childNodes)if(child!==label&&child!==caption)figure.append(render(child,level));
      if(label||caption){const text=element('figcaption',caption);text.className='ltx_caption';if(label){const b=element('strong');b.textContent=label.textContent+' · ';text.append(b);}if(caption)children(caption,text,level);figure.append(text);}
      return figure;
    }
    if(tag==='graphic'||tag==='inline-graphic'){
      const href=input.getAttributeNS(xlinkNamespace,'href')||input.getAttribute('href')||'';
      const url=images.get(imageKey(href))||(/^https:\/\//i.test(href)?href:undefined);
      const label=input.closest('fig')?.querySelector('label')?.textContent||'原论文图片';
      if(!url){const link=element('a');link.setAttribute('href',source);link.textContent=label+'（请在原网页查看）';return link;}
      const image=doc.createElement('img');image.src=url;image.alt=label;image.loading='lazy';return image;
    }
    if(tag==='disp-formula'||tag==='inline-formula'){
      const out=element(tag==='disp-formula'?'div':'span',input);if(tag==='disp-formula')out.className='ltx_equation';
      const math=direct(input,'math'),alternatives=direct(input,'alternatives');
      const content=math||alternatives?.querySelector('math')||direct(input,'tex-math');
      if(content){const result=render(content,level);if(result.nodeType===1&&(result as Element).localName==='math')(result as Element).setAttribute('display',tag==='disp-formula'?'block':'inline');out.append(result);}
      else for(const child of input.childNodes)if(child!==direct(input,'label'))out.append(render(child,level));
      const label=direct(input,'label');if(label){const number=element('span');number.className='ltx_tag_equation';number.textContent=label.textContent;out.append(number);}return out;
    }
    if(tag==='xref'){
      const out=element('a',input);out.className='ltx_ref';out.setAttribute('href','#'+(input.getAttribute('rid')||'').split(/\s+/)[0]);children(input,out,level);return out;
    }
    if(tag==='ext-link'||tag==='uri'||tag==='email'){
      const out=element('a',input);out.setAttribute('href',input.getAttributeNS(xlinkNamespace,'href')||((tag==='email'?'mailto:':'')+input.textContent?.trim()));children(input,out,level);return out;
    }
    if(tag==='list'){const out=element(/^(?:order|ordered|alpha|roman)/.test(input.getAttribute('list-type')||'')?'ol':'ul',input);children(input,out,level);return out;}
    const names:Record<string,string>={p:'p','list-item':'li',bold:'strong',italic:'em',monospace:'code',preformat:'pre',code:'pre',strike:'s',underline:'u',sup:'sup',sub:'sub',table:'table',thead:'thead',tbody:'tbody',tfoot:'tfoot',tr:'tr',th:'th',td:'td',hr:'hr',break:'br',ref:'div',fn:'div',source:'em',label:'span'};
    if(names[tag]){
      const out=element(names[tag],input);
      if(tag==='p'&&!input.closest('fig,table-wrap,ref-list'))out.className='ltx_p';
      if(tag==='ref')out.className='reader-reference';
      if(tag==='table'){const scroll=element('div');scroll.className='tbl-box';children(input,out,level);scroll.append(out);return scroll;}
      for(const attr of ['colspan','rowspan','align'])if(input.hasAttribute(attr))out.setAttribute(attr,input.getAttribute(attr)!);
      children(input,out,level);return out;
    }
    const fragment=doc.createDocumentFragment();children(input,fragment,level);return fragment;
  }
  meta?.querySelectorAll(':scope > abstract').forEach(node=>article.append(render(node)));
  const body=data.querySelector('body')!;children(body,article,2);
  const back=data.querySelector('back');
  if(back){for(const child of back.children)if(child.localName!=='app-group')article.append(render(child));for(const app of back.querySelectorAll(':scope > app-group > app'))article.append(render(app));}
  const permissions=meta?.querySelector('permissions');if(permissions){const credit=element('footer');credit.className='reader-source-note';children(permissions,credit,2);article.append(credit);}
  return article.outerHTML;
}
