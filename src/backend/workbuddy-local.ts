import { randomUUID } from 'node:crypto';
import type { WorkBuddyConnection, WorkBuddyStatus, WorkBuddyTest } from '../shared/workbuddy';
import { workBuddyTestActive } from '../shared/workbuddy';

// Fixed official destination: tokens cannot be redirected to a user-supplied URL.
const ENDPOINT = 'https://www.workbuddy.cn/openapi/v2/localassistant';
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
class ApiError extends Error {
  constructor(message: string, readonly connection: WorkBuddyConnection = 'error') { super(message); }
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;

/** No desktop credential scraping, arbitrary prompts, tools or shared-chat import. */
export class WorkBuddyLocal {
  private token = '';
  private state: WorkBuddyStatus = { configured: false, connection: 'unconfigured', detail: '尚未配置 WorkBuddy 开放平台 Access Token。' };
  private operation?: AbortController;
  private generation = 0;
  private closed = false;
  constructor(private readonly fetcher: Fetcher = fetch, private readonly timing = { pollMs: 1500, waitMs: 60_000, requestMs: 12_000 }) {}

  status(): WorkBuddyStatus { return structuredClone(this.state); }
  configure(value: string) {
    if (this.closed) throw new Error('WorkBuddy 连接已关闭。');
    const token = value.trim();
    if (token.length > 16_384 || /[\r\n\s]/.test(token)) throw new Error('Access Token 格式不正确。');
    this.cancel();
    this.token = token;
    this.state = { configured: !!token, connection: token ? 'unchecked' : 'unconfigured', detail: token ? '令牌已保存，尚未检查。' : '尚未配置 WorkBuddy 开放平台 Access Token。' };
    return this.status();
  }
  private requireToken() {
    if (this.closed) throw new Error('WorkBuddy 连接已关闭。');
    if (!this.token) throw new Error('请先填写具有本地助理读取、调用权限的 Access Token。');
    if (this.operation) throw new Error('WorkBuddy 检查或测试正在进行，请稍候。');
  }
  private async request(suffix: string, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetcher(ENDPOINT + suffix, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timing.requestMs)]),
    });
    if (response.status === 401) { await response.body?.cancel(); throw new ApiError('授权无效或已过期，请重新获取 Access Token。', 'unauthorized'); }
    if (response.status === 403) { await response.body?.cancel(); throw new ApiError('当前授权缺少本地助理权限，请检查应用授权范围。', 'unauthorized'); }
    if (response.status === 429) { await response.body?.cancel(); throw new ApiError('WorkBuddy 请求过于频繁，请稍后手动重试。'); }
    if (!response.ok) { await response.body?.cancel(); throw new ApiError(`WorkBuddy 服务返回 HTTP ${response.status}，请稍后重试。`); }
    // Bound even a chunked response, and never surface raw error bodies or history.
    if (!response.body) throw new ApiError('WorkBuddy 响应为空。');
    const reader = response.body.getReader();
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new ApiError('WorkBuddy 响应超过限制。');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('WorkBuddy 未返回有效 JSON。'); }
    if (!isObject(payload)) throw new ApiError('WorkBuddy 响应格式不匹配。');
    if (payload.code !== undefined && payload.code !== 0 && payload.code !== 'success') throw new ApiError('WorkBuddy 拒绝了本次请求，请核对授权和客户端状态。');
    return isObject(payload.data) ? payload.data : payload;
  }
  private async online(signal: AbortSignal) {
    const data = await this.request('', signal);
    if (typeof data.online !== 'boolean') throw new ApiError('WorkBuddy 未返回有效的在线状态。');
    return data.online;
  }
  private failure(error: unknown) {
    return error instanceof ApiError ? error : new ApiError('WorkBuddy 网络请求未完成，请检查网络后手动重试。');
  }
  async check() {
    this.requireToken();
    const operation = new AbortController(), generation = ++this.generation;
    this.operation = operation;
    try {
      const online = await this.online(operation.signal);
      if (generation === this.generation) this.state = { ...this.state, connection: online ? 'online' : 'offline', detail: online ? '官方接口确认本地助理在线；尚未验证消息往返。' : '授权可用，本地助理离线。请打开 WorkBuddy 并连接本地助理。', checkedAt: new Date().toISOString() };
    } catch (error) {
      if (generation === this.generation) { const failure = this.failure(error); this.state = { ...this.state, connection: failure.connection, detail: failure.message, checkedAt: new Date().toISOString() }; }
    } finally { if (this.operation === operation) this.operation = undefined; }
    return this.status();
  }
  startTest() {
    this.requireToken();
    const operation = new AbortController(), generation = ++this.generation;
    this.operation = operation;
    this.state.test = { id: randomUUID(), phase: 'checking', detail: '正在检查本地助理状态…', startedAt: new Date().toISOString(), delivery: 'not-sent' };
    void this.test(operation, generation);
    return this.status();
  }
  private async test(operation: AbortController, generation: number) {
    const deadline = AbortSignal.timeout(this.timing.waitMs);
    const signal = AbortSignal.any([operation.signal, deadline]);
    const current = () => generation === this.generation;
    const update = (patch: Partial<WorkBuddyTest>) => { if (current() && this.state.test) Object.assign(this.state.test, patch); };
    try {
      const online = await this.online(signal);
      if (!current()) return;
      this.state.connection = online ? 'online' : 'offline'; this.state.checkedAt = new Date().toISOString();
      this.state.detail = online ? '本地助理在线，正在验证消息往返。' : '本地助理离线。';
      if (!online) throw new ApiError('本地助理离线，请先打开 WorkBuddy 并连接本地助理。', 'offline');
      const marker = `AIROOM_WORKBUDDY_OK_${randomUUID().replace(/-/g, '')}`;
      const prompt = `这是一条 AIROOM 连接测试。请仅原样回复：${marker}。不要调用任何工具，不要读写文件，也不要执行其他任务。`;
      update({ phase: 'sending', detail: '正在发送一句话连接测试…', delivery: 'unknown' });
      const sent = await this.request('/message', signal, { content: prompt, msg_type: 'text' });
      if (!current()) return;
      if (!validId(sent.message_id)) throw new ApiError('WorkBuddy 未返回消息 ID；投递状态待核对，请勿直接重发。');
      const cursor = sent.message_id;
      update({ phase: 'waiting', delivery: 'accepted', detail: '消息已接收，正在等待带本次标识的回复…' });
      while (!signal.aborted) {
        const result = await this.request(`/message?message_id=${encodeURIComponent(cursor)}`, signal);
        if (!current()) return;
        if (!Array.isArray(result.messages)) throw new ApiError('WorkBuddy 未返回有效消息列表。');
        // Only the fresh random reply is exposed; unrelated shared-assistant history stays private.
        const confirmed = result.messages.some(item => isObject(item) && item.role === 'assistant' && item.msg_type === 'text' && Array.isArray(item.content) && item.content.some(part => typeof part === 'string' && part.trim() === marker));
        if (confirmed) {
          update({ phase: 'confirmed', detail: '消息往返验证通过。此结果只确认本次测试回复，不代表工具、文件或多人任务可用。', reply: marker, finishedAt: new Date().toISOString() });
          this.state.detail = '本地助理在线，已完成一次带独立标识的消息往返。';
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, this.timing.pollMs);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      throw signal.reason;
    } catch (error) {
      if (current()) {
        const failure = this.failure(error), delivery = this.state.test!.delivery;
        if (!deadline.aborted) { this.state.connection = failure.connection; this.state.detail = failure.message; }
        update({ phase: delivery === 'not-sent' ? 'failed' : 'unconfirmed', detail: deadline.aborted ? '等待已超时，未确认本次回复；测试消息可能仍在 WorkBuddy 中处理，未自动重发。' : `${failure.message}${delivery !== 'not-sent' ? ' 已停止等待，测试消息可能仍在 WorkBuddy 中处理，未自动重发。' : ''}`, finishedAt: new Date().toISOString() });
      }
    } finally { if (this.operation === operation) this.operation = undefined; }
  }
  cancel() {
    ++this.generation;
    this.operation?.abort(); this.operation = undefined;
    if (workBuddyTestActive(this.state.test)) Object.assign(this.state.test!, { phase: 'cancelled', detail: '已停止等待。此接口不能取消 WorkBuddy 中已投递的任务；请在 WorkBuddy 中核对。', finishedAt: new Date().toISOString() });
    return this.status();
  }
  close() { this.cancel(); this.token = ''; this.closed = true; }
}
