import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from 'react';
import {readSidebarWidth,fitSidebarWidth,sidebarWidthLimit,SIDEBAR_WIDTH_KEY,MIN_SIDEBAR_WIDTH,DEFAULT_SIDEBAR_WIDTH} from './sidebarWidth';

export function SidebarResize({open,onError}:{open:boolean;onError:()=>void}){
  const [preferred,setPreferred]=useState(()=>{try{return readSidebarWidth(localStorage);}catch{return DEFAULT_SIDEBAR_WIDTH;}}),[viewport,setViewport]=useState(innerWidth),[dragging,setDragging]=useState(false);
  const current=useRef(preferred),drag=useRef<{x:number;width:number}|undefined>(undefined);
  const width=fitSidebarWidth(preferred,viewport),max=sidebarWidthLimit(viewport);
  useLayoutEffect(()=>{document.documentElement.style.setProperty('--sidebar-width',width+'px');},[width]);
  useEffect(()=>{const resize=()=>setViewport(innerWidth);const observer=new ResizeObserver(resize);observer.observe(document.documentElement);window.addEventListener('resize',resize);return()=>{observer.disconnect();window.removeEventListener('resize',resize);};},[]);
  function adjust(next:number){const value=Math.max(MIN_SIDEBAR_WIDTH,fitSidebarWidth(next,innerWidth));current.current=value;setPreferred(value);}
  function save(){try{localStorage.setItem(SIDEBAR_WIDTH_KEY,String(current.current));}catch{onError();}}
  function start(event:PointerEvent<HTMLDivElement>){if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width};setDragging(true);}
  function finish(){if(!drag.current)return;drag.current=undefined;setDragging(false);save();}
  if(!open)return null;
  return <>{dragging&&<div className="sidebar-drag-cover"/>}<div className={'sidebar-resize '+(dragging?'dragging':'')} role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={Math.min(MIN_SIDEBAR_WIDTH,max)} aria-valuemax={max} aria-valuenow={width} aria-valuetext={width+' 像素，自动保存'} tabIndex={0} title={'拖动调整侧栏宽度，松开自动保存 · 当前 '+width+' px；也可使用左右方向键'} onPointerDown={start} onPointerMove={event=>{if(drag.current)adjust(drag.current.width+event.clientX-drag.current.x);}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    adjust(event.key==='Home'?MIN_SIDEBAR_WIDTH:event.key==='End'?max:width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:16));save();
  }}><span/></div>{dragging&&<div className="sidebar-width-hint" role="status">{width} px · 松开自动保存</div>}</>;
}
