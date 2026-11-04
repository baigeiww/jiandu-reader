import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {TranslationTaskBar,taskSummary,type TaskPanelMode} from './TranslationTaskBar';
import type {TranslationTask,TaskStatus} from './translationTasks';

function task(source:string,status:TaskStatus):TranslationTask{return {source,title:source,scope:'all',status,total:5,done:2,saved:2,failures:0,model:'fixture'};}
async function mount(initial:TranslationTask[]){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const calls:{action:string;source?:string}[]=[];
  let set!:React.Dispatch<React.SetStateAction<TranslationTask[]>>;
  function Harness(){
    const [tasks,update]=useState(initial);set=update;
    const [mode,onMode]=useState<TaskPanelMode>('expanded');
    const action=(action:string)=>(source:string)=>{calls.push({action,source});};
    return <><button onClick={()=>onMode('expanded')}>底栏恢复</button><TranslationTaskBar tasks={tasks} mode={mode} onMode={onMode} onPause={action('pause')} onResume={action('resume')} onCancel={action('cancel')} onDismiss={action('dismiss')} onOpen={action('open')} onNotice={()=>{}}/></>;
  }
  const root=createRoot(document.getElementById('root')!);
  await act(async()=>root.render(<Harness/>));
  const button=(label:string)=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label)!;
  return {calls,button,click:async(label:string)=>{assert.ok(button(label),label+' missing');await act(async()=>button(label).click());},set:async(tasks:TranslationTask[])=>act(async()=>set(tasks)),close:async()=>{await act(async()=>root.unmount());dom.window.close();}};
}

test('minimize and restore keep all task states; closing finished tasks only removes records',async()=>{
  const ui=await mount([task('done','completed'),task('cancelled','cancelled')]);
  try{
    await ui.click('最小化翻译任务面板');assert.ok(document.querySelector('.taskbar-minimized'));assert.equal(document.querySelector('.taskbar-list'),null);assert.equal(ui.calls.length,0);
    await ui.click('底栏恢复');assert.ok(document.querySelector('.taskbar-list'));
    await ui.click('关闭翻译任务面板');assert.equal(document.querySelector('.translation-taskbar'),null);
    assert.deepEqual(ui.calls,[{action:'dismiss',source:'done'},{action:'dismiss',source:'cancelled'}]);
  }finally{await ui.close();}
});

test('closing running tasks requires an explicit choice; hiding leaves requests untouched',async()=>{
  const ui=await mount([task('running','running'),task('waiting','queued')]);
  try{
    await ui.click('关闭翻译任务面板');assert.equal(ui.calls.length,0);
    await ui.click('返回');assert.equal(document.querySelector('.taskbar-close-options'),null);
    await ui.click('关闭翻译任务面板');await ui.click('隐藏面板，保持后台翻译');
    assert.equal(document.querySelector('.translation-taskbar'),null);assert.equal(ui.calls.length,0);
    await ui.click('底栏恢复');assert.ok(document.querySelector('.taskbar-list'));
    await ui.click('关闭翻译任务面板');await ui.click('暂停任务并关闭面板');
    assert.deepEqual(ui.calls,[{action:'pause',source:'running'},{action:'pause',source:'waiting'}]);
  }finally{await ui.close();}
});

test('paused and failed tasks can be hidden and resumed; cancellation targets unfinished tasks only',async()=>{
  const ui=await mount([task('paused','paused'),task('failed','failed'),task('done','completed')]);
  try{
    assert.equal(taskSummary([task('paused','paused')]),'1 个已暂停');
    await ui.click('关闭翻译任务面板');assert.equal(ui.button('暂停任务并关闭面板'),undefined);
    await ui.click('隐藏面板，保留任务');assert.equal(ui.calls.length,0);
    await ui.click('底栏恢复');await ui.click('继续');assert.equal(ui.calls[0].action,'resume');
    await ui.click('关闭翻译任务面板');await ui.click('取消任务并关闭面板');
    assert.deepEqual(ui.calls.slice(1),[{action:'cancel',source:'paused'},{action:'cancel',source:'failed'}]);
  }finally{await ui.close();}
});

test('a task finishing while the close choices are open is dismissed without cancellation',async()=>{
  const ui=await mount([task('A','running')]);
  try{
    await ui.click('关闭翻译任务面板');await ui.set([task('A','completed')]);
    assert.equal(ui.button('取消任务并关闭面板'),undefined);
    await ui.click('移除记录并关闭');assert.deepEqual(ui.calls,[{action:'dismiss',source:'A'}]);
  }finally{await ui.close();}
});
