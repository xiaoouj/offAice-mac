import { useState } from 'react';
import { API_KEY_VARIABLE, API_PRESETS, type ApiConnection } from '../shared/api-connection';
import { SECRET_PLACEHOLDER } from '../shared/defaults';
import type { AcpExecutor, ProviderInfo, Snapshot, Settings } from '../shared/types';
import type { Invoke, Notify } from './ui';

export function ApiConnectionEditor({existing,info,invoke,onSaved,onCancel}:{existing?:AcpExecutor;info?:ProviderInfo;invoke:Invoke;onSaved:(executor:AcpExecutor)=>void;onCancel:()=>void}){
  const [name,setName]=useState(existing?.name??''),[protocol,setProtocol]=useState<ApiConnection['protocol']>(existing?.api?.protocol??'openai'),[baseUrl,setBaseUrl]=useState(existing?.api?.baseUrl??''),[model,setModel]=useState(existing?.model??''),[key,setKey]=useState(''),[tokens,setTokens]=useState(existing?.api?.maxOutputTokens??4096),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const unchanged=baseUrl===existing?.api?.baseUrl&&protocol===existing?.api?.protocol;
  const [tokenParameter,setTokenParameter]=useState<ApiConnection['tokenParameter']>(existing?.api?.tokenParameter);
  const keepKey=unchanged&&existing?.secretKeys?.includes(API_KEY_VARIABLE);
  const apply=(id:string)=>{const preset=API_PRESETS.find(item=>item.id===id)!;setProtocol(preset.protocol);setBaseUrl(preset.baseUrl);setName(preset.id==='custom'?'':preset.name);setModel('');setKey('');};
  async function save(){setBusy(true);setError('');try{
    const executor=await invoke<AcpExecutor>('executor.save',{executor:{id:existing?.id,name,api:{protocol,baseUrl,maxOutputTokens:tokens,tokenParameter},model,env:{[API_KEY_VARIABLE]:key.trim()||(keepKey?SECRET_PLACEHOLDER:'')}}});setKey('');onSaved(executor);
  }catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <section className="catalog-detail acp-fields" aria-label="API 连接编辑器">
    {!existing&&<label className="field">服务预设<select aria-label="API 服务预设" defaultValue="custom" onChange={event=>apply(event.target.value)}>{API_PRESETS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label className="field">连接名称<input aria-label="API 连接名称" value={name} maxLength={40} onChange={event=>setName(event.target.value)} placeholder="例如：阶跃、Gemini API、我的中转"/></label>
    <label className="field">接口协议<select aria-label="API 接口协议" value={protocol} onChange={event=>{setProtocol(event.target.value as ApiConnection['protocol']);setKey('');}}><option value="openai">OpenAI 兼容（Chat Completions）</option><option value="gemini">Gemini 原生（Generate Content）</option></select></label>
    <label className="field">服务地址<input aria-label="API 服务地址" value={baseUrl} maxLength={2048} onChange={event=>{setBaseUrl(event.target.value);setKey('');}} placeholder={protocol==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://你的服务/v1'} spellCheck={false}/><small>填写基础地址，程序自动补全接口路径。密钥只发送到此地址；更换地址或协议后需要重新填写密钥。</small></label>
    <label className="field">API Key<input type="password" autoComplete="new-password" aria-label="API 连接密钥" value={key} onChange={event=>setKey(event.target.value)} placeholder={keepKey?'已加密保存；留空保留':'填写此服务的 API Key'}/><small>密钥由本机系统凭据加密保存，保存后不显示原文。API 的额度与账号订阅分别计算。</small></label>
    <label className="field">默认模型<input aria-label="API 默认模型" list={`api-models-${existing?.id??'new'}`} value={model} maxLength={200} onChange={event=>setModel(event.target.value)} placeholder="先保存并读取列表，或手动填写模型 ID" spellCheck={false}/><datalist id={`api-models-${existing?.id??'new'}`}>{info?.modelOptions?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</datalist><small>连接检查只读取模型列表，不发送生成请求。不提供列表的服务可手动输入模型。</small></label>
    <label className="field">最大输出 Token<input type="number" aria-label="API 最大输出 Token" value={tokens} min={128} max={32768} onChange={event=>setTokens(Number(event.target.value))}/><small>每次生成的输出上限，实际用量和费用由服务商计算。</small></label>
    {protocol==='openai'&&<label className="field">输出上限兼容方式<select aria-label="API 输出上限兼容方式" value={tokenParameter??'auto'} onChange={event=>setTokenParameter(event.target.value==='auto'?undefined:event.target.value as ApiConnection['tokenParameter'])}><option value="auto">自动（OpenAI 官方使用新版，其他服务使用通用参数）</option><option value="max_tokens">通用兼容 · max_tokens</option><option value="max_completion_tokens">新版 OpenAI 推理模型 · max_completion_tokens</option></select><small>服务提示输出参数不支持时，可按该服务文档调整。</small></label>}
    <p className="provider-detail">支持文字聊天和团队讨论；此连接不执行终端命令或读写文件。支持 Chat Completions 的服务可自定义地址；仅提供 Responses 或其他协议的服务暂不兼容。</p>
    {error&&<p role="alert" className="provider-detail">{error}</p>}
    <div className="catalog-actions"><button type="button" className="button primary" disabled={busy||!name.trim()||!baseUrl.trim()||!key.trim()&&!keepKey} onClick={()=>void save()}>{busy?'保存中…':'保存 API 连接'}</button><button type="button" className="button quiet" disabled={busy} onClick={onCancel}>取消</button></div>
  </section>;
}

export function ApiConnectionCard({executor,info,snapshot,invoke,notify,setSettings}:{executor:AcpExecutor;info?:ProviderInfo;snapshot:Snapshot;invoke:Invoke;notify:Notify;setSettings:(update:(previous:Settings)=>Settings)=>void}){
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
  const used=snapshot.members?.some(member=>member.executor===executor.id);
  return <section className="provider-settings acp-connection" aria-label={`${executor.name} 的 API 连接`}>
    <div className="provider-settings-heading"><div><strong>{executor.name} <em className="acp-badge">API 直连</em></strong><span>{info?.available?'已配置':info?.detail??'等待检查'}</span></div><button type="button" className="button small secondary" disabled={busy||!snapshot.backendReady} onClick={()=>{setBusy(true);void invoke('provider.probe',{provider:executor.id}).catch(()=>{}).finally(()=>setBusy(false));}}>{busy?'读取中…':'检查并读取模型'}</button><button type="button" className="button small quiet" onClick={()=>setEditing(!editing)}>{editing?'收起':'设置'}</button></div>
    <p className="provider-detail">{executor.api?.protocol==='gemini'?'Gemini 原生 API':'OpenAI 兼容 API'} · {executor.api?.baseUrl}</p>
    <p className="provider-detail">默认模型：{snapshot.settings.models[executor.id]||executor.model||'尚未选择'}。{info?.detail}</p>
    <p className="provider-detail">文字聊天与团队讨论；不执行命令或读写文件。</p>
    {editing&&<ApiConnectionEditor existing={{...executor,model:snapshot.settings.models[executor.id]||executor.model}} info={info} invoke={invoke} onCancel={()=>setEditing(false)} onSaved={saved=>{setSettings(previous=>({...previous,models:{...previous.models,[saved.id]:saved.model}}));setEditing(false);notify('API 连接已保存。');}}/>}
    <button type="button" className="button small quiet danger" disabled={busy||used} title={used?'先删除或切换使用此连接的人物卡':undefined} onClick={()=>{if(window.confirm(`删除 API 连接「${executor.name}」？历史聊天会保留，已保存的密钥会移除。`))void invoke('executor.delete',{id:executor.id}).catch(()=>{});}}>删除连接及密钥</button>
  </section>;
}
