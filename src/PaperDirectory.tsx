import {useEffect,useState} from 'react';
import {sourceLabel} from './sources';
import {modelRequest} from './modelApi';
import {googleTranslate,googleTranslateBatch} from './google';
import {readNotes,saveDirectory,type Paper,type DirectoryLabels} from './library';
import type {Settings} from './settings';
import {knownHeading,splitHeading,parseDirectoryResponse,type DirectoryItem} from './directory';

export function Directory({paper,settings,active,importing,onJump}:{paper?:Paper;settings:Settings;active:string;importing:boolean;onJump:(id:string)=>void}){
  const [labels,setLabels]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!paper||importing)return;const controller=new AbortController();let live=true;
    const items:DirectoryItem[]=[{id:'__paper_title__',text:paper.title},...paper.blocks.filter(b=>b.kind==='heading').map(b=>({id:b.id,text:b.text}))];
    setLabels({});setError('');setBusy(true);
    void (async()=>{
      try{
        const record=await readNotes(paper.source);if(!live)return;
        const restored:Record<string,string>={};const pending:DirectoryItem[]=[];
        for(const item of items){const saved=record?.headings?.[item.id];const known=knownHeading(item.text);if(saved?.original===item.text)restored[item.id]=saved.translated;else if(known)restored[item.id]=known;else pending.push(item);}
        setLabels(restored);
        if(settings.provider==='demo'){if(pending.length)setError('配置翻译 API 后可翻译完整目录。');return;}
        for(let offset=0;offset<pending.length;offset+=20){
          if(!live)return;const batch=pending.slice(offset,offset+20);let translated:Record<string,string>;
          if(settings.provider==='google'||settings.provider==='google-cloud'){
            const texts=batch.map(item=>splitHeading(item.text).text);
            const output=settings.provider==='google'?await googleTranslateBatch(texts):await Promise.all(texts.map(text=>googleTranslate(text,settings.key)));
            if(!output||output.length!==batch.length)throw Error('目录翻译失败，请重试或更换 API。');
            translated=Object.fromEntries(batch.map((item,i)=>[item.id,splitHeading(item.text).prefix+output[i]]));
          }else{
            const wireItems=batch.map((item,i)=>({...item,id:'h'+i}));
            const output=await modelRequest(settings,'只将 items 数组中的标题逐项译成简体中文，context 仅供理解，不翻译或输出。简洁忠实，保留 EEG、SEEG、BrainMosaic 等名称和缩写。仅返回 JSON 数组 [{"id":"原id","translation":"中文译文"}]，每项一次，不增加编号。术语表：'+settings.glossary,JSON.stringify({context:{paperTitle:paper.title},items:wireItems.map(item=>({id:item.id,text:splitHeading(item.text).text}))}),4096,controller.signal);
            const parsed=parseDirectoryResponse(output,wireItems);
            translated=Object.fromEntries(batch.map((item,i)=>[item.id,parsed['h'+i]]));
          }
          if(!live)return;
          setLabels(value=>({...value,...translated}));
          const saved:DirectoryLabels=Object.fromEntries(batch.map(item=>[item.id,{original:item.text,translated:translated[item.id]}]));
          try{await saveDirectory(paper.source,saved);}catch{throw Error('目录已翻译，但本地保存失败，请检查存储空间。');}
        }
      }catch(error){if(live)setError(error instanceof Error?error.message:String(error));}
      finally{if(live)setBusy(false);}
    })();
    return()=>{live=false;controller.abort();};
  },[paper,settings,importing,retry]);
  const headings=paper?.blocks.filter(b=>b.kind==='heading')||[];
  return <><div className="paper-card">
    <span className="tiny-label">正在阅读</span>
    <h3 title={paper?.title}>{labels.__paper_title__||paper?.title||'载入论文中…'}</h3>
    {paper&&<a className="paper-id" href={paper.source} title={paper.source} target="_blank" rel="noreferrer">{sourceLabel(paper.source)} · {paper.id} ↗</a>}
    </div>
    <div className="workspace-label directory-title">章节 <span>{busy?'翻译目录中…':headings.length}</span></div>
    {error&&<div className="directory-error" role="status">{error}<button disabled={busy||importing} onClick={()=>setRetry(n=>n+1)}>重试</button></div>}
    <nav aria-label="论文中文目录">{headings.map(h=><button key={h.id} title={h.text} aria-current={active===h.id?"location":undefined} className={(active===h.id?'active ':'')+(h.level>2?'sub':'')} onClick={()=>onJump(h.id)}><span className="nav-dot"/>{labels[h.id]||knownHeading(h.text)||h.text}</button>)}</nav>
  </>;
}
