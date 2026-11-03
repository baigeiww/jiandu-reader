import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {modelRequest} from './modelApi';
import {defaults,saveProfile,deleteProfile,type Settings,type Configuration} from './settings';

export function SettingsDialog({configuration,settings,onCommit,onClose}:{configuration:Configuration;settings:Settings;onCommit:(next:Configuration)=>boolean;onClose:()=>void}) {
  const [selectedId,setSelectedId]=useState(configuration.activeId);
  const [name,setName]=useState(configuration.profiles.find(p=>p.id===configuration.activeId)?.name||'');
  const [draft,setDraft]=useState<Settings>({...settings});
  const [error,setError]=useState('');
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const probe=useRef<AbortController | null>(null);
  const backdropPress=useRef(false);
  useLayoutEffect(()=>{
    const sheet=dialog.current!;
    sheet.showModal();
    return ()=>sheet.close();
  },[]);
  useEffect(()=>{
    setTestResult('');setTesting(false);
    return ()=>probe.current?.abort();
  },[draft]);
  async function testConnection() {
    const attempt=new AbortController();
    probe.current=attempt;
    setTesting(true);setTestResult('');
    try {
      await modelRequest(draft,'Reply only with OK.','Connection test.',32,attempt.signal);
      if(!attempt.signal.aborted)setTestResult('连接成功');
    } catch(error) {
      if(!attempt.signal.aborted)setTestResult(error instanceof Error?error.message:String(error));
    } finally {
      if(!attempt.signal.aborted)setTesting(false);
    }
  }
  function selectProfile(id:string) {
    const profile=configuration.profiles.find(p=>p.id===id);
    setSelectedId(id);setName(profile?.name||'');setDraft(profile?{...profile}:{...defaults,provider:'llm'});setError('');
  }
  function save() {
    if(!name.trim()){setError('请给这组配置取一个名称。');return;}
    if(draft.provider==='llm'||draft.provider==='anthropic') {
      try{const url=new URL(draft.endpoint);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error();}
      catch{setError('请输入 HTTPS 接口地址；本机服务可使用 HTTP。');return;}
      if(!draft.model.trim()){setError('请填写模型名称。');return;}
    }
    const next=saveProfile(configuration,{...draft,endpoint:draft.endpoint.trim(),model:draft.model.trim(),key:draft.key.trim(),id:selectedId||crypto.randomUUID(),name:name.trim()});
    if(onCommit(next))onClose();else setError('浏览器无法保存配置，可能存储空间不足或被禁用。当前配置未更改，请重试。');
  }
  function remove() {
    const next=deleteProfile(configuration,selectedId);
    if(onCommit(next)) {
      const profile=next.profiles.find(p=>p.id===next.activeId);
      setSelectedId(next.activeId);setName(profile?.name||'');setDraft(profile?{...profile}:{...defaults,provider:'llm'});setError('');
    } else setError('删除未成功，请检查浏览器存储后重试。');
  }
  return <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title"
    onCancel={event=>{event.preventDefault();onClose();}}
    onPointerDown={event=>{backdropPress.current=event.target===event.currentTarget;}}
    onClick={event=>{if(backdropPress.current&&event.target===event.currentTarget)onClose();}}>
    <div className="dialog-header"><div><h2 id="settings-title">翻译设置</h2><p className="settings-description">选择服务，管理模型和术语表。</p></div><button aria-label="关闭设置" title="关闭（Esc）" onClick={onClose}>×</button></div>
    <div className="settings-fields">
    <div className="profile-picker"><label>已保存的配置<select aria-label="已保存的配置" value={selectedId} onChange={e=>selectProfile(e.target.value)}><option value="">新增配置</option>{configuration.profiles.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===configuration.activeId?' · 当前使用':''}</option>)}</select></label><button className="secondary-button" onClick={()=>selectProfile('')}>＋ 新增配置</button>{selectedId&&<button className="delete-profile" onClick={remove}>删除此配置</button>}</div>
    <form id="translation-settings-form" onSubmit={e=>{e.preventDefault();save();}}>
      <label>配置名称<input name="profileName" required value={name} onChange={e=>setName(e.target.value)} placeholder="例如：DeepSeek 日常阅读"/></label>
      <label>翻译服务<select name="provider" value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="demo">示例模式 · 无需联网翻译</option><option value="google">Google 翻译 · 免密钥试用</option><option value="google-cloud">Google Cloud · 官方 API</option><option value="llm">大模型 · Chat Completions API</option><option value="anthropic">Anthropic · Messages API（Bearer）</option></select></label>
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<><label>接口地址<input name="endpoint" type="url" required value={draft.endpoint} onChange={e=>setDraft({...draft,endpoint:e.target.value})} placeholder="https://api.example.com/v1"/></label><label>模型名称<input name="model" required value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}/></label></>}
      {(draft.provider==='llm'||draft.provider==='google-cloud'||draft.provider==='anthropic')&&<label>API Key <span className="field-hint">{draft.key?'已填写 · 将随配置保存':'尚未填写'}</span><input name="key" type="password" autoComplete="off" value={draft.key} onChange={e=>setDraft({...draft,key:e.target.value})} placeholder="保存后无需重复输入"/></label>}
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<label>术语表<span className="field-hint">一行一个术语或保留规则</span><textarea name="glossary" rows={4} value={draft.glossary} onChange={e=>setDraft({...draft,glossary:e.target.value})}/></label>}
      {draft.provider==='google'&&<p className="settings-note">Google 免密钥入口可能限流或无法连接。公式、引用和文件名仍由程序保护。</p>}
      {draft.provider==='anthropic'&&<p className="settings-note">使用 Messages 格式和 Bearer Token 鉴权。本机 7864 端口通过 Demo 的本地通道连接。</p>}
      {draft.key==='local-managed'&&draft.endpoint===location.origin+'/local-deepseek/v1'
        ?<p className="storage-note">此配置通过本机服务连接 DeepSeek，密钥由本机服务管理。</p>
        :<p className="storage-note">手动填写的密钥以明文保存在本机。清除应用数据会移除这些配置。</p>}
      {error&&<div className="inline-error" role="alert">{error}</div>}
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<div className="api-test"><button className="secondary-button" type="button" disabled={testing} onClick={testConnection}>{testing?'测试中…':'测试连接'}</button><span role="status">{testResult}</span></div>}
    </form></div>
    <div className="profile-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" form="translation-settings-form">保存并使用</button></div>
  </dialog>;
}
