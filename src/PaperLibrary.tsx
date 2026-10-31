import {useEffect,useState} from 'react';
import {listLibrary,saveGroup,deleteGroup,movePaper,paperWorks,mergeWorks,detachVersion,type PaperGroup,type PaperRecord} from './library';
import {sourceLabel} from './sources';
import {BackupControls} from './BackupControls';

export function PaperLibrary({revision,current,disabled,onOpen,onError}:{revision:number;current?:string;disabled:boolean;onOpen:(source:string)=>void;onError:(message:string)=>void}){
  const [papers,setPapers]=useState<PaperRecord[]>([]),[groups,setGroups]=useState<PaperGroup[]>([]);
  const [editing,setEditing]=useState<string>(),[name,setName]=useState('');
  async function refresh(){const library=await listLibrary();setPapers(library.papers);setGroups(library.groups);}
  useEffect(()=>{void refresh().catch(()=>onError('无法读取论文记录，请检查浏览器的本地存储权限。'));},[revision]);
  async function mutate(action:()=>Promise<void>){try{await action();await refresh();}catch{onError('论文记录保存失败，请检查本地存储空间。');}}
  function edit(id:string,value=''){setEditing(id);setName(value);}
  const works=paperWorks(papers);
  return <section className="paper-library" aria-label="论文记录">
    <div className="library-title"><strong>论文记录</strong><button onClick={()=>edit('new')}>＋ 新建分组</button></div>
    {editing!==undefined&&<form className="group-editor" onSubmit={e=>{e.preventDefault();const value=name.trim();if(!value)return;void mutate(()=>saveGroup({id:editing==='new'?crypto.randomUUID():editing,name:value}));setEditing(undefined);}}><input aria-label="分组名称" value={name} onChange={e=>setName(e.target.value)} autoFocus maxLength={60} placeholder="分组名称" required/><button type="submit">保存</button><button type="button" onClick={()=>setEditing(undefined)}>取消</button></form>}
    <div className="library-groups">{[{id:'',name:'未分组'},...groups].map(group=>{
      const items=works.filter(p=>p.groupId===group.id);
      return <details key={group.id} open className="library-group"><summary>{group.name}<span>{items.length}</span></summary>
        {group.id&&<div className="group-actions"><button onClick={()=>edit(group.id,group.name)}>重命名</button><button onClick={()=>void mutate(()=>deleteGroup(group.id))}>解散分组</button></div>}
        {items.map(work=><div className={'library-paper '+(work.versions.some(p=>current===p.source)?'selected':'')} key={work.id}>
          <strong className="library-work-title">{work.title}</strong>
          <div className="library-versions">{work.versions.map(record=><div className={'library-version '+(current===record.source?'active':'')} key={record.source}>
            <button className="library-open" disabled={disabled} onClick={()=>onOpen(record.source)} title={record.source}><strong>{sourceLabel(record.source)}{record.paper.journal?' · '+record.paper.journal:''}</strong><span>{record.paper.id} · 已译 {Object.keys(record.results).length} 项</span></button>
            {work.versions.length>1&&<button className="version-detach" disabled={disabled} onClick={()=>void mutate(()=>detachVersion(record.source))} title="保留该版本与译文，拆成独立论文">拆分</button>}
          </div>)}</div>
          <div className="work-options"><select disabled={disabled} aria-label={'移动论文分组：'+work.title} value={work.groupId} onChange={e=>void mutate(()=>movePaper(work.versions[0].source,e.target.value))}><option value="">未分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>
          <select disabled={disabled} aria-label={'归入同一论文：'+work.title} value="" onChange={e=>{if(e.target.value)void mutate(()=>mergeWorks(work.id,e.target.value));}}><option value="">归入同一论文…</option>{works.filter(w=>w.id!==work.id).map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></div>
        </div>)}
        {!items.length&&<p className="library-empty">暂无论文</p>}
      </details>;
    })}</div><p className="library-note">论文和译文自动保存在本机浏览器</p><BackupControls/>
  </section>;
}
