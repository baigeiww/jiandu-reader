import DOMPurify from 'dompurify';
import katex from 'katex';
import {sourceKind} from './sources';
import {SOURCE,normalizeArticle,prepareParagraph,readableText} from './core';

export type Block = {id:string; html?:string; text:string; level:number; kind:'heading'|'paragraph'|'caption'|'figure'|'table'|'other'; tokens:Record<string,string>; input:string};
export function isTranslatable(block:{kind:string;input?:string}){return (block.kind==='paragraph'||block.kind==='caption')&&(block.input===undefined||!!block.input.trim());}
export type TranslationScope='body'|'captions'|'all';
export function untranslatedBlocks<T extends {id:string;kind:string}>(blocks:T[],results:Record<string,{html:string}>,scope:TranslationScope='all'){
  return blocks.filter(b=>isTranslatable(b)&&(scope==='all'||b.kind===(scope==='body'?'paragraph':'caption'))&&!results[b.id]?.html.trim());
}

export const PAPER_SANITIZE_OPTIONS={ADD_ATTR:['target','alttext','intent'],ADD_FORBID_CONTENTS:['annotation','annotation-xml'],FORBID_TAGS:['style','form','input','button','iframe','script']};
export function clean(html:string) {return DOMPurify.sanitize(html,PAPER_SANITIZE_OPTIONS);}
export function parsePaper(html:string,source=SOURCE,parser:Pick<DOMParser,'parseFromString'>=new DOMParser(),sanitize:(html:string)=>string=clean): {blocks:Block[]; title:string; authors:string; source:string; id:string; html:string;doi?:string;journal?:string} {
  const doc = parser.parseFromString(html,'text/html');
  let article = doc.querySelector('article.ltx_document');
  if(!article&&sourceKind(source)!=='arxiv'){
    const kind=sourceKind(source),body=doc.querySelector(kind==='nature'?'.c-article-body':'.body.main-article-body');
    if(!body)throw Error('没有找到论文正文，网站可能要求浏览器验证，或这篇论文没有公开全文。');
    const meta=(name:string)=>doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content||'';
    article=doc.createElement('article');article.className='ltx_document reader-publisher';
    article.setAttribute('data-reader-doi',meta('citation_doi').replace(/^doi:/i,'').toLowerCase());
    article.setAttribute('data-reader-journal',meta('citation_journal_title'));
    const title=doc.createElement('h1');title.className='ltx_title_document';title.textContent=meta('citation_title')||doc.querySelector('h1')?.textContent||'';
    const authors=doc.createElement('div');authors.className='ltx_authors';
    doc.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]').forEach((author,i)=>{if(i)authors.append(', ');const name=doc.createElement('span');name.className='ltx_personname';name.textContent=author.content;authors.append(name);});
    article.append(title,authors,body);
    article.querySelectorAll('script,style,nav,button,.c-article-recommendations,.c-article-recommendations-container,.c-article-recommendations-card,[id="inline-recommendations"],.app-explore-related-subjects,.c-article-section__figure-link,.u-hide-print,.text-right.font-secondary').forEach(el=>el.remove());
    article.querySelectorAll('section.tw').forEach(el=>{
      const caption=el.querySelector('.caption');if(!caption)return;
      caption.classList.add('ltx_caption');const label=el.querySelector(':scope > .obj_head');if(label){caption.prepend(label.textContent+' ');label.remove();}
    });
    // Fold Nature's bottom captions and PMC's figure labels into one translatable caption.
    article.querySelectorAll('figure').forEach(figure=>{
      const caption=figure.querySelector('figcaption');if(!caption)return;
      const label=figure.querySelector(':scope > .obj_head');if(label){caption.prepend(label.textContent+' ');label.remove();}
      const description=figure.querySelector('.c-article-section__figure-description');if(description){caption.append(' ',...description.childNodes);description.remove();}
    });
    article.querySelectorAll('.mathjax-tex').forEach(el=>{
      const raw=el.textContent?.trim()||'',display=raw.startsWith('$$');
      const tex=raw.replace(/^\$\$?|\$\$?$/g,'').replace(/^\\[([]|\\[)\]]$/g,'');
      try{el.innerHTML=katex.renderToString(tex,{output:'mathml',displayMode:display,throwOnError:true,trust:false,maxExpand:1000});}catch{el.replaceChildren();const code=doc.createElement('code');code.textContent=raw;el.append(code);}
    });
    article.querySelectorAll('.c-article-equation,.disp-formula').forEach(el=>el.classList.add('ltx_equation'));
    article.querySelectorAll('.c-article-equation__number,.disp-formula .label').forEach(el=>el.classList.add('ltx_tag_equation'));
    article.querySelectorAll('a[href^="#ref"],a[href^="#CR"],a[href^="#B"],a[data-track-action="reference anchor"]').forEach(el=>el.classList.add('ltx_ref'));
    article.querySelectorAll('p').forEach(el=>{if(!el.closest('figure,table,figcaption,.ltx_caption,section.tw,#Bib1,[role="doc-bibliography"]'))el.classList.add('ltx_p');});
    article.querySelectorAll('h2,h3,h4,h5,h6').forEach((el,i)=>{if(!el.id)el.id='reader-heading-'+i;});
    article.querySelectorAll('picture source').forEach(el=>el.remove());
    article.querySelectorAll('img').forEach(el=>el.removeAttribute('srcset'));
  }
  if (!article) throw new Error('没有找到论文 HTML 正文。');
  if(sourceKind(source)!=='arxiv'){
    article.querySelectorAll('.c-article-share-box,.c-article-recommendations-card').forEach(el=>el.remove());
    article.querySelectorAll('#Bib1-section p').forEach(el=>el.classList.remove('ltx_p'));
    article.querySelectorAll('section.tw > .obj_head').forEach(label=>{const caption=label.parentElement?.querySelector('.ltx_caption');if(caption){caption.prepend(label.textContent+' ');label.remove();}});
  }
  normalizeArticle(article);
  article.querySelectorAll('object.ltx_graphics[data]').forEach(object=>{
    const image=doc.createElement('img');image.setAttribute('src',object.getAttribute('data')!);image.alt='原论文图表';
    if(object.id)image.id=object.id;object.replaceWith(image);
  });
  article.querySelectorAll('img').forEach(img=>{img.src=new URL(img.getAttribute('src') || '', source).href; img.loading='lazy';});
  article.querySelectorAll('a[href]').forEach(link=>{const href=link.getAttribute('href')!;if(!href.startsWith('#')){link.setAttribute('href',new URL(href,source).href);link.setAttribute('target','_blank');link.setAttribute('rel','noreferrer');}});
  // Duplicate IDs in a translation are removed separately; originals keep their anchors.
  const blocks:Block[]=[];
  function walk(parent:Element) {
    for(const el of parent.children) {
      if(el.matches('.ltx_authors,.ltx_title_document,.ltx_title_abstract,.ltx_dates,.ltx_note,.ltx_biblist,.ltx_TOC,.reader-source-note')) continue;
      if(parent===article && el.matches('.ltx_para') && el.querySelector('.ltx_ERROR')?.textContent==='\\reportnumber')continue;
      const heading = el.matches('h2,h3,h4,h5,h6');
      const kind = heading?'heading':el.matches('figure')?'figure':el.matches('table,.ltx_table')?'table':el.matches('p.ltx_p')?'paragraph':el.matches('pre,.ltx_equation,.ltx_equationgroup')?'other':null;
      if(kind) {
        const id = el.id || (kind==='paragraph'?`reader-p-${blocks.length}`:parent.id) || `block-${blocks.length}`;
        if((kind==='paragraph'||heading)&&!el.id)el.id=id;
        const prepared=kind==='paragraph'?prepareParagraph(el):{text:'',tokens:{}};
        blocks.push({id,kind,text:readableText(el),level:heading?Number(el.tagName.slice(1)):0,input:prepared.text,tokens:prepared.tokens});
      } else if(el.matches('.ltx_abstract')) {
        blocks.push({id:'abstract',kind:'heading',text:'Abstract',level:2,input:'',tokens:{}}); walk(el);
      } else if(el.matches('.ltx_bibliography')) {
        blocks.push({id:'references',kind:'heading',text:'References',level:2,input:'',tokens:{}});
        blocks.push({id:'reference-list',kind:'other',text:'',level:0,input:'',tokens:{}});
      } else walk(el);
    }
  }
  walk(article);
  // Append caption entries after the original index so existing paragraph IDs and caches stay stable.
  [...article.querySelectorAll('figcaption,caption,.ltx_caption')].filter(el=>!el.parentElement?.closest('figcaption,caption,.ltx_caption')).forEach((el,index)=>{
    const text=readableText(el);if(!text)return;
    const id=el.id||`reader-caption-${index}`;el.id=id;
    const prepared=prepareParagraph(el);
    blocks.push({id,kind:'caption',text,level:0,input:prepared.text,tokens:prepared.tokens});
  });
  return {html:sanitize(article.outerHTML),source,id:sourceKind(source)==='arxiv'?source.split('/html/')[1]:sourceKind(source)==='frontiers'?article.getAttribute('data-reader-doi')||source.split('/articles/')[1].replace(/\/full$/,''):new URL(source).pathname.split('/').filter(Boolean).at(-1)!,doi:article.getAttribute('data-reader-doi')||undefined,journal:article.getAttribute('data-reader-journal')||undefined,blocks,title:article.querySelector('h1')?.textContent?.trim() || '',authors:[...article.querySelectorAll('.ltx_personname')].map(a=>a.textContent?.trim()).join(', ')};
}
