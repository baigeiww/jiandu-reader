import {useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';

export type PanelRect={x:number;y:number;width:number;height:number};
export function fitPanel(rect:PanelRect,width:number,height:number):PanelRect{
  const w=Math.max(1,width-16),h=Math.max(1,height-16);
  const size={width:Math.min(w,Math.max(Math.min(320,w),rect.width)),height:Math.min(h,Math.max(Math.min(240,h),rect.height))};
  return {...size,x:Math.max(8,Math.min(width-size.width-8,rect.x)),y:Math.max(8,Math.min(height-size.height-8,rect.y))};
}
function initial(){
  let saved:PanelRect|undefined;try{saved=JSON.parse(localStorage.getItem('reader-formula-window')||'null');}catch{/* Use default geometry. */}
  if(!saved||typeof saved!=='object'||![saved.x,saved.y,saved.width,saved.height].every(Number.isFinite))saved={x:innerWidth-544,y:Math.max(70,innerHeight*.15),width:520,height:Math.min(650,innerHeight*.8)};
  return fitPanel(saved,innerWidth,innerHeight);
}
function savePosition(rect:PanelRect){
  try{localStorage.setItem('reader-formula-window',JSON.stringify(rect));}catch{/* Geometry persistence is optional. */}
}
export function FloatingPanel({children,onClose}:{children:ReactNode;onClose:()=>void}){
  const [rect,setRect]=useState(initial),[maximized,setMaximized]=useState(false);
  const gesture=useRef<{kind:'move'|'resize';x:number;y:number;rect:PanelRect}|undefined>(undefined);
  const current=useRef(rect);current.current=rect;
  useEffect(()=>{const resize=()=>setRect(r=>fitPanel(r,innerWidth,innerHeight));window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{
    if(!gesture.current)savePosition(rect);
  },[rect]);
  function finish() {
    if(!gesture.current)return;
    gesture.current=undefined;
    savePosition(current.current);
  }
  function start(event:PointerEvent<HTMLElement>,kind:'move'|'resize'){
    if(event.button!==0||maximized||(event.target as Element).closest('button:not(.window-resize)'))return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);gesture.current={kind,x:event.clientX,y:event.clientY,rect:current.current};
  }
  function move(event:PointerEvent<HTMLElement>){const drag=gesture.current;if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    setRect(fitPanel(drag.kind==='move'?{...drag.rect,x:drag.rect.x+dx,y:drag.rect.y+dy}:{...drag.rect,width:drag.rect.width+dx,height:drag.rect.height+dy},innerWidth,innerHeight));
  }
  const style=maximized?{left:8,top:64,width:'calc(100vw - 16px)',height:'calc(100dvh - 101px)'}:{left:rect.x,top:rect.y,width:rect.width,height:rect.height};
  return <aside className="formula-panel floating-panel" role="dialog" aria-label="公式解析" style={style} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();onClose();}}}>
    <div className="selection-header window-drag" onPointerDown={e=>start(e,'move')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onDoubleClick={e=>{if(!(e.target as Element).closest('button'))setMaximized(v=>!v);}}>
      <strong>公式解析 <small>拖动标题栏移动</small></strong><div><button aria-label="缩小公式窗口" disabled={maximized} onClick={()=>setRect(r=>fitPanel({...r,width:r.width-80,height:r.height-60},innerWidth,innerHeight))}>−</button><button aria-label={maximized?'还原公式窗口':'放大公式窗口'} onClick={()=>setMaximized(v=>!v)}>{maximized?'❐':'□'}</button><button aria-label="关闭公式解析" onClick={onClose}>×</button></div>
    </div><div className="window-content">{children}</div>
    {!maximized&&<button className="window-resize" aria-label="调整公式窗口大小" title="拖动调整大小，也可使用方向键" onPointerDown={e=>start(e,'resize')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();setRect(r=>fitPanel({...r,width:r.width+(e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0),height:r.height+(e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0)},innerWidth,innerHeight));}}>◢</button>}
  </aside>;
}
