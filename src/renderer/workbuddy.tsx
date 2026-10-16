import { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle, Plug, RefreshCw } from 'lucide-react';
import type { WorkBuddyStatus } from '../shared/workbuddy';
import { workBuddyTestActive } from '../shared/workbuddy';
import type { Invoke } from './ui';

/** Deliberately separate from team members until task isolation is verified. */
export function WorkBuddyConnection({ invoke, available }: { invoke: Invoke; available: boolean }) {
  const [status, setStatus] = useState<WorkBuddyStatus>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void invoke<WorkBuddyStatus>('workbuddy.status').then(value => { if (mounted.current) setStatus(value); }).catch(() => { if (mounted.current) setError('未能读取 WorkBuddy 连接状态，请重新打开设置。'); });
    return () => { mounted.current = false; };
  }, [invoke]);
  const active = workBuddyTestActive(status?.test);
  useEffect(() => {
    if (!active) return;
    let pending = false, live = true;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void invoke<WorkBuddyStatus>('workbuddy.status').then(value => { if (live) setStatus(value); }).catch(() => { if (live) setError('暂时无法读取测试状态，请稍后检查。'); }).finally(() => { pending = false; });
    }, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [active, invoke]);
  async function act(method: string, params?: unknown) {
    setBusy(true); setError('');
    try { const value = await invoke<WorkBuddyStatus>(method, params); if (mounted.current) setStatus(value); }
    catch { if (mounted.current) setError('操作未完成，请查看工作台提示后重试。'); }
    finally { if (mounted.current) setBusy(false); }
  }
  function save() { const value = token; setToken(''); void act('workbuddy.saveToken', { value }); }
  function test() {
    if (!window.confirm('向 WorkBuddy 本地助理发送一句话测试，要求仅回复随机标识，不使用工具或文件。此次调用可能消耗账号额度。是否继续？')) return;
    void act('workbuddy.test', { confirm: true });
  }
  return <section className="provider-settings workbuddy-connection" aria-label="WorkBuddy 实验连接">
    <div className="provider-settings-heading">
      <span className="acp-icon"><Plug size={20} /></span>
      <div><strong>WorkBuddy <em className="acp-badge">实验连接</em></strong><span>{status?.detail ?? '正在读取连接状态…'}</span></div>
    </div>
    <p className="provider-detail">连接已登录的 WorkBuddy 本地助理。当前验证授权、在线状态和一句话回复；团队成员、并发任务和文件写回尚未开放。</p>
    <label className="field compact">开放平台 Access Token
      <input type="password" autoComplete="off" aria-label="WorkBuddy Access Token" spellCheck={false} maxLength={16384} value={token} onChange={event => setToken(event.target.value)} placeholder={status?.configured ? '令牌已加密保存；填写新令牌可替换' : '填写经 OAuth 授权获得的 Access Token'} />
      <small>需要 user.localassistant.readable 和 user.localassistant.invokable 权限。令牌保存在这台 Mac 的系统加密存储中，不读取 WorkBuddy 桌面登录资料。过期后需重新获取；此版不保存应用 Client Secret。</small>
    </label>
    <div className="acp-editor-actions">
      <button className="button small primary" disabled={!available || busy || active || !token.trim()} onClick={save}><KeyRound size={13} />保存令牌</button>
      {status?.configured && <button className="button small quiet danger" disabled={!available || busy || active} onClick={() => { if (window.confirm('清除 AIROOM 保存的 WorkBuddy 授权令牌？')) void act('workbuddy.saveToken', { value: '' }); }}>清除令牌</button>}
      <button className="button small secondary" disabled={!available || busy || active || !status?.configured} onClick={() => void act('workbuddy.check')}><RefreshCw size={13} />检查在线状态</button>
      <button className="button small secondary" disabled={!available || busy || active || !status?.configured} onClick={test}>发送一句话测试</button>
      {active && <button className="button small quiet" disabled={busy} onClick={() => void act('workbuddy.cancel')}>停止等待</button>}
      <button className="button small quiet" onClick={() => void invoke('workbuddy.openDocs').catch(() => {})}>查看授权文档</button>
    </div>
    <p className="provider-detail">先在 WorkBuddy 开放平台创建并授权应用，再填写 Access Token。检查在线状态不会发送模型任务。测试消息会进入本地助理；停止等待只结束 AIROOM 的轮询，请在 WorkBuddy 中核对已发送的消息。</p>
    {error && <p className="provider-detail" role="alert">{error}</p>}
    {status?.test && <div role="status" aria-live="polite" className="info-card">
      {active ? <LoaderCircle size={17} className="spin" /> : <Plug size={17} />}
      <div><p>{status.test.detail}</p>{status.test.reply && <p>已核对本次回复：<code>{status.test.reply}</code></p>}</div>
    </div>}
  </section>;
}
