import {useRef,useState} from 'react';
import type {TranslationTask} from './translationTasks';

export type TaskPanelMode='expanded'|'minimized'|'hidden';
const labels={queued:'排队中',running:'翻译中',pausing:'完成当前项后暂停',paused:'已暂停',completed:'已完成',cancelled:'已取消',failed:'存储异常'};
const scopes={body:'正文',captions:'图表说明',all:'全文＋图表'};
const unfinished=(task:TranslationTask)=>!['completed','cancelled'].includes(task.status);
const working=(task:TranslationTask)=>['queued','running','pausing'].includes(task.status);
export function taskSummary(tasks:TranslationTask[]){
  const running=tasks.filter(working).length,paused=tasks.filter(t=>t.status==='paused').length,failed=tasks.filter(t=>t.status==='failed').length;
  return [running&&`${running} 个运行中`,paused&&`${paused} 个已暂停`,failed&&`${failed} 个需处理`].filter(Boolean).join(' · ')||'任务已结束';
}
export function TranslationTaskBar({tasks,mode,onMode,onPause,onResume,onCancel,onDismiss,onOpen,onNotice}:{tasks:TranslationTask[];mode:TaskPanelMode;onMode:(mode:TaskPanelMode)=>void;onPause:(source:string)=>void;onResume:(source:string)=>void;onCancel:(source:string)=>void;onDismiss:(source:string)=>void;onOpen:(source:string)=>void;onNotice:(text:string)=>void}){
  const [confirming,setConfirming]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  if(!tasks.length||mode==='hidden')return null;
  const pending=tasks.filter(unfinished),running=tasks.some(working),expanded=mode==='expanded';
  function hide(){setConfirming(false);onMode('hidden');}
  function closeFinished(){tasks.forEach(task=>onDismiss(task.source));hide();onNotice('已移除任务记录，论文与已保存译文保留。');}
  function requestClose(){if(pending.length)setConfirming(true);else closeFinished();}
  function back(){setConfirming(false);closeRef.current?.focus();}
  return <section className={'translation-taskbar'+(!expanded?' taskbar-minimized':'')} aria-label="论文翻译任务">
    <div className="taskbar-header"><button className="taskbar-toggle" aria-expanded={expanded} onClick={()=>{setConfirming(false);onMode(expanded?'minimized':'expanded');}}><strong>翻译任务</strong><span>{taskSummary(tasks)}</span></button>
      <div className="taskbar-window-controls">{expanded&&<button aria-label="最小化翻译任务面板" title="最小化，任务状态保持不变" onClick={()=>{setConfirming(false);onMode('minimized');}}>−</button>}<button ref={closeRef} aria-label="关闭翻译任务面板" title="关闭任务面板" onClick={requestClose}>×</button></div>
    </div>
    {confirming?<div className="taskbar-close-options" role="group" aria-label="选择关闭任务面板的方式" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();back();}}}>
      <strong>关闭任务面板</strong><p>{pending.length?running?'还有任务未结束，请选择关闭后的状态。':'暂停或异常任务可以保留，稍后继续。':'任务已结束，可以移除记录。'}已保存的译文都会保留。</p>
      <div className="taskbar-close-actions">
        {pending.length?<><button autoFocus onClick={()=>{hide();onNotice(running?'任务面板已关闭，翻译继续在后台运行。可从底栏「翻译任务」查看。':'任务面板已关闭，暂停和异常状态保持不变。可从底栏「翻译任务」继续处理。');}}>{running?'隐藏面板，保持后台翻译':'隐藏面板，保留任务'}</button>
          {running&&<button onClick={()=>{pending.filter(task=>['queued','running'].includes(task.status)).forEach(task=>onPause(task.source));hide();onNotice('任务面板已关闭；当前项保存后暂停，排队任务立即暂停。可从底栏继续。');}}>暂停任务并关闭面板</button>}
          <button className="taskbar-cancel-all" onClick={()=>{pending.forEach(task=>onCancel(task.source));hide();onNotice('任务已取消并关闭面板，已保存译文保留。之后可重新发起翻译，补齐未完成内容。');}}>取消任务并关闭面板</button></>:<button autoFocus onClick={closeFinished}>移除记录并关闭</button>}
        <button onClick={back}>返回</button>
      </div>
    </div>:expanded&&<><div className="taskbar-list">{tasks.map(task=><div className="translation-task" key={task.source}>
      <button className="task-paper" title={task.title} onClick={()=>onOpen(task.source)}>{task.title}</button>
      <div className="task-progress"><span>{scopes[task.scope]} · {task.status==='completed'&&task.failures?'已结束，有失败项':labels[task.status]}</span><span>{task.done}/{task.total}</span></div>
      <progress max={task.total||1} value={task.done} aria-label={`${task.title} 翻译进度`}/>
      <p className="task-detail">{task.model} · 本次保存 {task.saved} 项{task.failures?` · 失败 ${task.failures} 项`:''}</p>
      {task.error&&<p className="task-error">{task.error}{task.activeId?' · '+task.activeId:''}</p>}
      <div className="task-controls">
        {['queued','running'].includes(task.status)&&<button onClick={()=>onPause(task.source)}>暂停</button>}
        {task.status==='completed'&&task.failures>0&&<button onClick={()=>onResume(task.source)}>重试失败项</button>}
        {['paused','pausing','failed'].includes(task.status)&&<button onClick={()=>onResume(task.source)}>继续</button>}
        {unfinished(task)?<button onClick={()=>onCancel(task.source)}>取消任务</button>:<button onClick={()=>onDismiss(task.source)}>移除记录</button>}
      </div>
    </div>)}</div><p className="taskbar-note">最小化不改变任务状态 · 关闭时可选择隐藏、暂停或取消<br/>暂停先保存当前项；取消保留已存译文；底栏可重新打开<br/>关闭面板不退出应用；退出后可重新发起补齐未译项</p></>}
  </section>;
}
