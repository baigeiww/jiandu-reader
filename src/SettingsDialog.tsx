import {useState} from 'react';
import {modelRequest} from './modelApi';
import {defaults,saveProfile,deleteProfile,type Settings,type Configuration} from './settings';

export function SettingsDialog({configuration,settings,onCommit,onClose}:{configuration:Configuration;settings:Settings;onCommit:(next:Configuration)=>boolean;onClose:()=>void}) {
  const [selectedId,setSelectedId]=useState(configuration.activeId);
  const [name,setName]=useState(configuration.profiles.find(p=>p.id===configuration.activeId)?.name||'');
  const [draft,setDraft]=useState<Settings>({...settings});
  const [error,setError]=useState('');
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState('');
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
  return <div className="modal-backdrop" onClick={onClose}><div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e=>e.stopPropagation()}>
    <div className="dialog-header"><div><span className="tiny-label">API PROFILES</span><h2 id="settings-title">你的翻译配置，随时切换。</h2></div><button aria-label="关闭设置" onClick={onClose}>×</button></div>
    <p className="settings-description">每组配置分别保存服务、地址、模型、Key 和术语表。刷新后会恢复上次选用的配置。</p>
    <div className="profile-picker"><label>已保存的配置<select aria-label="已保存的配置" value={selectedId} onChange={e=>selectProfile(e.target.value)}><option value="">新增配置</option>{configuration.profiles.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===configuration.activeId?' · 当前使用':''}</option>)}</select></label><button className="secondary-button" onClick={()=>selectProfile('')}>＋ 新增配置</button>{selectedId&&<button className="delete-profile" onClick={remove}>删除此配置</button>}</div>
    <form onSubmit={e=>{e.preventDefault();save();}}>
      <label>配置名称<input name="profileName" required value={name} onChange={e=>setName(e.target.value)} placeholder="例如：DeepSeek 日常阅读"/></label>
      <label>翻译服务<select name="provider" value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="demo">示例模式 · 无需联网翻译</option><option value="google">Google 翻译 · 免密钥试用</option><option value="google-cloud">Google Cloud · 官方 API</option><option value="llm">大模型 · Chat Completions API</option><option value="anthropic">Anthropic · Messages API（Bearer）</option></select></label>
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<><label>接口地址<input name="endpoint" type="url" required value={draft.endpoint} onChange={e=>setDraft({...draft,endpoint:e.target.value})} placeholder="https://api.example.com/v1"/></label><label>模型名称<input name="model" required value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}/></label></>}
      {(draft.provider==='llm'||draft.provider==='google-cloud'||draft.provider==='anthropic')&&<label>API Key <span className="field-hint">{draft.key?'已填写 · 将随配置保存':'尚未填写'}</span><input name="key" type="password" autoComplete="off" value={draft.key} onChange={e=>setDraft({...draft,key:e.target.value})} placeholder="保存后无需重复输入"/></label>}
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<label>术语表<span className="field-hint">一行一个术语或保留规则</span><textarea name="glossary" rows={4} value={draft.glossary} onChange={e=>setDraft({...draft,glossary:e.target.value})}/></label>}
      {draft.provider==='google'&&<p className="settings-note">Google 免密钥入口可能限流或无法连接。公式、引用和文件名仍由程序保护。</p>}
      {draft.provider==='anthropic'&&<p className="settings-note">使用 Messages 格式和 Bearer Token 鉴权。本机 7864 端口通过 Demo 的本地通道连接。</p>}
      <p className="storage-note">Key 保存在当前浏览器本地，未经加密，不会同步到其他设备。请在自己的电脑上使用；清除网站数据会删除已保存的配置。翻译时，Key 只随请求发往你选定的服务。</p>
      {error&&<div className="inline-error" role="alert">{error}</div>}
      {(draft.provider==='llm'||draft.provider==='anthropic')&&<div className="api-test"><button className="secondary-button" type="button" disabled={testing} onClick={async()=>{setTesting(true);setTestResult('');try{await modelRequest(draft,'Reply only with OK.','Connection test.',32);setTestResult('连接成功：接口已返回有效文本。');}catch(e){setTestResult(e instanceof Error?e.message:String(e));}finally{setTesting(false);}}}>{testing?'测试中…':'测试连接'}</button><span role="status">{testResult}</span></div>}
      <div className="profile-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存并使用</button></div>
    </form>
  </div></div>;
}
