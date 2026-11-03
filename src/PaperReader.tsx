import {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from 'react';
import {formulaTarget,type FormulaTarget} from './formula';
import {createReaderUpdates} from './readerDom';

type Block={id:string;kind:string;text:string;level:number};
type Result={html:string;type:string};
export type PaperReaderHandle={jump:(id:string)=>void};
type Props={html:string;source:string;paperTitle:string;blocks:Block[];mode:string;font:number;dark:boolean;results:Record<string,Result>;busy:Record<string,boolean>;errors:Record<string,string>;importing:boolean;onTranslate:(id:string)=>void;onSelection:(text:string,id:string)=>void;onFormula:(target:FormulaTarget)=>void;onActive:(id:string)=>void};

export const PaperReader=forwardRef<PaperReaderHandle,Props>(function PaperReader(props,ref){
  const frame=useRef<HTMLIFrameElement>(null);
  const latest=useRef(props);latest.current=props;
  const update=useRef<ReturnType<typeof createReaderUpdates>>(undefined);
  const [loaded,setLoaded]=useState(0);
  const [height,setHeight]=useState(900);
  useImperativeHandle(ref,()=>({jump(id){
    const doc=frame.current?.contentDocument;
    const target=doc?.getElementById(id)||(id==='abstract'?doc?.querySelector('.ltx_abstract'):id==='references'?doc?.querySelector('.ltx_bibliography'):null);
    if(target&&frame.current){const top=window.scrollY+frame.current.getBoundingClientRect().top+target.getBoundingClientRect().top-110;window.scrollTo({top,behavior:'smooth'});}
  }}),[]);
  useEffect(()=>{
    const doc=frame.current?.contentDocument;if(!doc||!loaded)return;
    update.current=createReaderUpdates(doc,props.blocks);
    update.current(latest.current.results,latest.current.busy,latest.current.errors,latest.current.importing);
    const resize=()=>{const content=doc.querySelector('.ltx_page_content');if(content)setHeight(Math.ceil(content.getBoundingClientRect().bottom)+8);};
    const observer=new ResizeObserver(resize);observer.observe(doc.body);resize();
    const click=(event:MouseEvent)=>{
      const target=event.target as Element;
      const action=target.closest<HTMLButtonElement>('button[data-translate]');
      if(action){event.preventDefault();latest.current.onTranslate(action.dataset.translate!);return;}
      if(target.closest('math:not(.technical-literal)') && !frame.current?.contentWindow?.getSelection()?.toString().trim()){
        const formula=formulaTarget(target,props.source,props.paperTitle);
        if(formula){event.preventDefault();latest.current.onFormula(formula);return;}
      }
      const link=target.closest<HTMLAnchorElement>('a[href^="#"]');
      if(link){event.preventDefault();const id=decodeURIComponent(link.getAttribute('href')!.slice(1));const node=doc.getElementById(id);if(node&&frame.current)window.scrollTo({top:window.scrollY+frame.current.getBoundingClientRect().top+node.getBoundingClientRect().top-100,behavior:'smooth'});}
    };
    const keydown=(event:KeyboardEvent)=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const target=event.target as Element;
      if(!target.matches('math:not(.technical-literal)'))return;
      const formula=formulaTarget(target,props.source,props.paperTitle);
      if(formula){event.preventDefault();latest.current.onFormula(formula);}
    };
    const select=()=>{
      const selection=frame.current?.contentWindow?.getSelection();const text=selection?.toString().trim();if(!text||text.length<2)return;
      const node=selection?.anchorNode;const element=node?.nodeType===1?node as Element:node?.parentElement;
      if(element?.closest('.reader-translation,.reader-controls'))return;
      const paragraph=element?.closest('[data-reader-block]');if(paragraph)latest.current.onSelection(text,paragraph.getAttribute('data-reader-block')!);
    };
    doc.addEventListener('click',click);doc.addEventListener('keydown',keydown);doc.addEventListener('mouseup',select);doc.addEventListener('touchend',select);
    const headings=props.blocks.filter(b=>b.kind==='heading').map(b=>({id:b.id,node:doc.getElementById(b.id)}));
    let scheduled=0;
    const readScroll=()=>{
      scheduled=0;
      if(!frame.current)return;const offset=frame.current.getBoundingClientRect().top;
      let active='abstract';for(const b of headings) {if(b.node&&offset+b.node.getBoundingClientRect().top<170)active=b.id;}
      latest.current.onActive(active);
    };
    const scroll=()=>{if(!scheduled)scheduled=requestAnimationFrame(readScroll);};
    window.addEventListener('scroll',scroll,{passive:true});
    return()=>{update.current=undefined;cancelAnimationFrame(scheduled);observer.disconnect();doc.removeEventListener('click',click);doc.removeEventListener('keydown',keydown);doc.removeEventListener('mouseup',select);doc.removeEventListener('touchend',select);window.removeEventListener('scroll',scroll);};
  },[loaded,props.blocks,props.source,props.paperTitle]);
  useEffect(()=>{
    const doc=frame.current?.contentDocument;if(!doc||!loaded)return;
    doc.documentElement.dataset.theme=props.dark?'dark':'light';doc.body.dataset.mode=props.mode;doc.documentElement.style.fontSize=props.font+'px';
  },[loaded,props.mode,props.font,props.dark]);
  useEffect(()=>{update.current?.(props.results,props.busy,props.errors,props.importing);},[loaded,props.blocks,props.results,props.busy,props.errors,props.importing]);
  const srcDoc=useMemo(()=>`<!doctype html><html lang="en" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/ar5iv/ar5iv.0.9.1.min.css"><link rel="stylesheet" href="/reader-native.css"></head><body><main class="ltx_page_main"><div class="ltx_page_content">${props.html}</div></main></body></html>`,[props.html]);
  return <iframe ref={frame} className="native-reader" title="论文原文与双语阅读" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} style={{height}} onLoad={()=>setLoaded(n=>n+1)}/>;
});
