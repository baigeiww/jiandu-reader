import {useState} from 'react';
import type {TranslationTask} from './translationTasks';

const labels={queued:'排队中',running:'翻译中',pausing:'完成当前项后暂停',paused:'已暂停',completed:'已完成',cancelled:'已取消',failed:'存储异常'};
const scopes={body:'正文',captions:'图表说明',all:'全文＋图表'};
export function TranslationTaskBar({tasks,onPause,onResume,onCancel,onDismiss,onOpen}:{tasks:TranslationTask[];onPause:(source:string)=>void;onResume:(source:string)=>void;onCancel:(source:string)=>void;onDismiss:(source:string)=>void;onOpen:(source:string)=>void}){
  const [expanded,setExpanded]=useState(true);
  if(!tasks.length)return null;
  const active=tasks.filter(t=>!['completed','cancelled'].includes(t.status)).length;
  return <section className="translation-taskbar" aria-label="论文翻译任务">
    <button className="taskbar-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><strong>翻译任务</strong><span>{active?`${active} 个进行中`:'任务已结束'}</span><span>{expanded?'收起 ▾':'展开 ▴'}</span></button>
    {expanded&&<div className="taskbar-list">{tasks.map(task=><div className="translation-task" key={task.source}>
      <button className="task-paper" title={task.title} onClick={()=>onOpen(task.source)}>{task.title}</button>
      <div className="task-progress"><span>{scopes[task.scope]} · {task.status==='completed'&&task.failures?'已结束，有失败项':labels[task.status]}</span><span>{task.done}/{task.total}</span></div>
      <progress max={task.total||1} value={task.done} aria-label={`${task.title} 翻译进度`}/>
      <p className="task-detail">{task.model} · 本次保存 {task.saved} 项{task.failures?` · 失败 ${task.failures} 项`:''}</p>
      {task.error&&<p className="task-error">{task.error}{task.activeId?' · '+task.activeId:''}</p>}
      <div className="task-controls">
        {['queued','running'].includes(task.status)&&<button onClick={()=>onPause(task.source)}>暂停</button>}
        {task.status==='completed'&&task.failures>0&&<button onClick={()=>onResume(task.source)}>重试失败项</button>}
        {['paused','pausing','failed'].includes(task.status)&&<button onClick={()=>onResume(task.source)}>继续</button>}
        {!['completed','cancelled'].includes(task.status)?<button onClick={()=>onCancel(task.source)}>取消任务</button>:<button onClick={()=>onDismiss(task.source)}>移除记录</button>}
      </div>
    </div>)}</div>}
    {expanded&&<p className="taskbar-note">逐项连续请求 · 失败项记下后继续 · 切换论文继续运行<br/>暂停先保存当前项；取消保留译文；沿用启动时 API 配置</p>}
  </section>;
}
