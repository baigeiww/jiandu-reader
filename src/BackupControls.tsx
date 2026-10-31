import {useEffect,useRef,useState} from 'react';
import {exportBackup,importBackup} from './backup';

export function BackupControls(){
  const file=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(()=>{
    try{const report=JSON.parse(localStorage.getItem('reader-import-report')||'null');return report?`迁移已核对：${report.profiles} 组 API、${report.papers} 篇论文、${report.groups} 个分组、${report.paragraphs} 项译文。`:'';}catch{return '';}
  });
  useEffect(()=>{
    const token=new URLSearchParams(location.hash.slice(1)).get('receive');if(!token)return;
    // A short-lived, token-protected loopback relay is used only for browser migration.
    setBusy(true);setStatus('正在接收本机迁移数据…');
    void (async()=>{
      try{const response=await fetch('http://127.0.0.1:5174/',{headers:{'X-Reader-Transfer':token},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('本机迁移通道已过期，请重新导出或导入备份。');await importBackup(await response.json(),localStorage);history.replaceState(null,'',location.pathname);location.reload();}
      catch(error){setStatus(error instanceof Error?error.message:'迁移失败，请保留备份后重试。');setBusy(false);}
    })();
  },[]);
  async function download(){
    setBusy(true);try{const snapshot=await exportBackup(localStorage);const blob=new Blob([JSON.stringify(snapshot)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='jiandu-migration.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus('备份已导出，包含 API Key，请仅用于自己的浏览器迁移。');}catch{setStatus('导出失败，请检查浏览器本地存储。');}finally{setBusy(false);}
  }
  return <div className="backup-controls"><div><button disabled={busy} onClick={()=>void download()}>导出阅读数据</button><button disabled={busy} onClick={()=>file.current?.click()}>导入阅读数据</button></div><p>包含 API 配置、分组、论文与译文</p>{status&&<p role="status">{status}</p>}<input ref={file} type="file" accept=".json,application/json" aria-label="导入笺读备份文件" hidden onChange={async e=>{const selected=e.currentTarget.files?.[0];e.currentTarget.value='';if(!selected)return;setBusy(true);try{if(selected.size>100*1024*1024)throw Error('备份文件超过 100 MB。');await importBackup(JSON.parse(await selected.text()),localStorage);location.reload();}catch(error){setStatus(error instanceof Error?error.message:'导入失败，请保留备份后重试。');setBusy(false);}}}/></div>;
}
