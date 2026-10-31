import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {formulaTarget,type FormulaTarget} from './formula';
import {isTranslatable} from './paper';

type Block={id:string;kind:string;text:string;level:number};
type Result={html:string;type:string};
export type PaperReaderHandle={jump:(id:string)=>void};
type Props={html:string;source:string;paperTitle:string;blocks:Block[];mode:string;font:number;dark:boolean;results:Record<string,Result>;busy:Record<string,boolean>;errors:Record<string,string>;importing:boolean;onTranslate:(id:string)=>void;onSelection:(text:string,id:string)=>void;onFormula:(target:FormulaTarget)=>void;onActive:(id:string)=>void};

export const PaperReader=forwardRef<PaperReaderHandle,Props>(function PaperReader(props,ref){
  const frame=useRef<HTMLIFrameElement>(null);
  const [loaded,setLoaded]=useState(0);
  const [height,setHeight]=useState(900);
  useImperativeHandle(ref,()=>({jump(id){
    const doc=frame.current?.contentDocument;
    const target=doc?.getElementById(id)||(id==='abstract'?doc?.querySelector('.ltx_abstract'):id==='references'?doc?.querySelector('.ltx_bibliography'):null);
    if(target&&frame.current){const top=window.scrollY+frame.current.getBoundingClientRect().top+target.getBoundingClientRect().top-110;window.scrollTo({top,behavior:'smooth'});}
  }}),[]);
  useEffect(()=>{
    const doc=frame.current?.contentDocument;if(!doc||!loaded)return;
    const resize=()=>{const content=doc.querySelector('.ltx_page_content');if(content)setHeight(Math.ceil(content.getBoundingClientRect().bottom)+8);};
    const observer=new ResizeObserver(resize);observer.observe(doc.body);resize();
    const click=(event:MouseEvent)=>{
      const target=event.target as Element;
      const action=target.closest<HTMLButtonElement>('button[data-translate]');
      if(action){event.preventDefault();props.onTranslate(action.dataset.translate!);return;}
      if(target.closest('math:not(.technical-literal)') && !frame.current?.contentWindow?.getSelection()?.toString().trim()){
        const formula=formulaTarget(target,props.source,props.paperTitle);
        if(formula){event.preventDefault();props.onFormula(formula);return;}
      }
      const link=target.closest<HTMLAnchorElement>('a[href^="#"]');
      if(link){event.preventDefault();const id=decodeURIComponent(link.getAttribute('href')!.slice(1));const node=doc.getElementById(id);if(node&&frame.current)window.scrollTo({top:window.scrollY+frame.current.getBoundingClientRect().top+node.getBoundingClientRect().top-100,behavior:'smooth'});}
    };
    const keydown=(event:KeyboardEvent)=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const target=event.target as Element;
      if(!target.matches('math:not(.technical-literal)'))return;
      const formula=formulaTarget(target,props.source,props.paperTitle);
      if(formula){event.preventDefault();props.onFormula(formula);}
    };
    const select=()=>{
      const selection=frame.current?.contentWindow?.getSelection();const text=selection?.toString().trim();if(!text||text.length<2)return;
      const node=selection?.anchorNode;const element=node?.nodeType===1?node as Element:node?.parentElement;
      if(element?.closest('.reader-translation,.reader-controls'))return;
      const paragraph=element?.closest('[data-reader-block]');if(paragraph)props.onSelection(text,paragraph.getAttribute('data-reader-block')!);
    };
    doc.addEventListener('click',click);doc.addEventListener('keydown',keydown);doc.addEventListener('mouseup',select);doc.addEventListener('touchend',select);
    const scroll=()=>{
      if(!frame.current)return;const offset=frame.current.getBoundingClientRect().top;
      let active='abstract';for(const b of props.blocks.filter(b=>b.kind==='heading')) {const node=doc.getElementById(b.id);if(node&&offset+node.getBoundingClientRect().top<170)active=b.id;}
      props.onActive(active);
    };
    window.addEventListener('scroll',scroll,{passive:true});
    return()=>{observer.disconnect();doc.removeEventListener('click',click);doc.removeEventListener('keydown',keydown);doc.removeEventListener('mouseup',select);doc.removeEventListener('touchend',select);window.removeEventListener('scroll',scroll);};
  },[loaded,props.blocks,props.source,props.paperTitle,props.onTranslate,props.onSelection,props.onFormula,props.onActive]);
  useEffect(()=>{
    const doc=frame.current?.contentDocument;if(!doc||!loaded)return;
    doc.documentElement.dataset.theme=props.dark?'dark':'light';doc.body.dataset.mode=props.mode;doc.documentElement.style.fontSize=props.font+'px';
    for(const block of props.blocks.filter(b=>b.kind!=='heading'))doc.getElementById(block.id)?.setAttribute('data-reader-block',block.id);
    for(const block of props.blocks.filter(isTranslatable)){
      const source=doc.getElementById(block.id);if(!source)continue;source.setAttribute('data-reader-block',block.id);
      let addon=doc.querySelector<HTMLElement>(`[data-reader-addon="${CSS.escape(block.id)}"]`);
      if(!addon){addon=doc.createElement('div');addon.className='reader-addon'+(block.kind==='caption'?' reader-caption-addon':'');addon.dataset.readerAddon=block.id;(source.tagName==='CAPTION'?source.closest('table')||source:source).after(addon);}
      const result=props.results[block.id];source.classList.toggle('reader-has-translation',!!result);
      addon.replaceChildren();
      if(result){const translation=doc.createElement('div');translation.className='reader-translation';const label=doc.createElement('div');label.className='reader-translation-label';label.textContent=result.type==='sample'?'示例译文':result.type==='google'?'Google 译文':'译文';const content=doc.createElement('div');content.innerHTML=result.html;translation.append(label,content);addon.append(translation);}
      const controls=doc.createElement('div');controls.className='reader-controls';const button=doc.createElement('button');button.dataset.translate=block.id;button.type='button';button.textContent=props.busy[block.id]?'翻译中…':block.kind==='caption'?(result?'重新翻译说明':'翻译图表说明'):(result?'重新翻译':'翻译此段');button.disabled=!!props.busy[block.id]||props.importing;controls.append(button);addon.append(controls);
      if(props.errors[block.id]){const error=doc.createElement('div');error.className='reader-error';error.setAttribute('role','alert');error.textContent=props.errors[block.id];addon.append(error);}
    }
    doc.querySelectorAll('math:not(.technical-literal)').forEach(math=>{
      math.setAttribute('tabindex','0');math.setAttribute('role','button');math.setAttribute('title','点击解释公式');
      const label=math.getAttribute('alttext')||math.textContent||'';
      math.setAttribute('aria-label','解释公式：'+label.slice(0,100));
    });
  },[loaded,props.blocks,props.mode,props.font,props.dark,props.results,props.busy,props.errors,props.importing]);
  const srcDoc=`<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/ar5iv/ar5iv.0.9.1.min.css"><link rel="stylesheet" href="/reader-native.css"></head><body><main class="ltx_page_main"><div class="ltx_page_content">${props.html}</div></main></body></html>`;
  return <iframe ref={frame} className="native-reader" title="论文原文与双语阅读" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} style={{height}} onLoad={()=>setLoaded(n=>n+1)}/>;
});
