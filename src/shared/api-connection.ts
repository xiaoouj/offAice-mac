export interface ApiConnection {
  protocol: 'openai' | 'gemini';
  baseUrl: string;
  maxOutputTokens: number;
  tokenParameter?: 'max_tokens' | 'max_completion_tokens';
}
export const API_KEY_VARIABLE = 'AIROOM_API_KEY';
export const API_PRESETS = [
  {id:'custom',name:'自定义 OpenAI 兼容服务',protocol:'openai',baseUrl:'',model:''},
  {id:'stepfun',name:'阶跃 StepFun',protocol:'openai',baseUrl:'https://api.stepfun.com/v1',model:''},
  {id:'deepseek',name:'DeepSeek',protocol:'openai',baseUrl:'https://api.deepseek.com',model:''},
  {id:'openai',name:'OpenAI',protocol:'openai',baseUrl:'https://api.openai.com/v1',model:''},
  {id:'gemini',name:'Google Gemini 原生 API',protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:''},
] as const;

/** Credentials belong in headers; remote connections require transport encryption. */
export function normalizeApiConnection(value: unknown): ApiConnection {
  const source = value as Partial<ApiConnection> | undefined;
  if (!source || !['openai','gemini'].includes(source.protocol!)) throw new Error('请选择 API 协议。');
  let url: URL;
  try { url = new URL(String(source.baseUrl ?? '').trim()); } catch { throw new Error('请填写完整的 API 服务地址。'); }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash)
    throw new Error('API 地址需要 HTTPS（本机服务可用 HTTP），且不能包含账户密码、密钥、查询参数或片段。');
  if (url.href.length > 2048) throw new Error('API 地址过长。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(source.protocol === 'openai' ? /\/(?:chat\/completions|models)$/ : /\/models$/, '');
  const max = source.maxOutputTokens ?? 4096;
  if (!Number.isInteger(max) || max < 128 || max > 32768) throw new Error('最大输出 Token 请填写 128–32768 之间的整数。');
  if(source.tokenParameter&&!['max_tokens','max_completion_tokens'].includes(source.tokenParameter))throw new Error('输出上限参数无效。');
  return {protocol:source.protocol!,baseUrl:url.toString().replace(/\/$/,''),maxOutputTokens:max,...(source.tokenParameter?{tokenParameter:source.tokenParameter}:{})};
}
