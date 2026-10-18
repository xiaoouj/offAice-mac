import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fetch as requestFetch, Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { AcpExecutor, Adapter, AdapterContext, AdapterResult, ModelOption, ProviderInfo, Settings } from '../../shared/types';
import { API_KEY_VARIABLE, normalizeApiConnection } from '../../shared/api-connection';
import { redact, registerSecret, validateProxyUrl } from '../security';
import { latestPersona } from '../native-context';
import { observeApiConnection } from '../compatibility';

type Message = {role:'user'|'assistant';content:string};
type FetchResponse = Awaited<ReturnType<typeof requestFetch>>;
const LIMIT = 4 * 1024 * 1024;

async function boundedText(response: FetchResponse, limit = LIMIT) {
  if (!response.body) return '';
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
  try { while (true) {const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit)throw new Error('API 响应过大，已停止读取。');text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode(); }
  finally { await reader.cancel().catch(()=>{}); }
}

/** SSE boundaries may cross UTF-8 bytes, lines and network packets. */
async function* events(response: FetchResponse) {
  if(!response.body)throw new Error('API 没有返回响应正文。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',data:string[]=[],size=0;
  try {
    while(true){
      const next=await reader.read();buffer+=next.done?decoder.decode():decoder.decode(next.value,{stream:true});
      if(buffer.length>LIMIT)throw new Error('API 流式事件过大，已停止读取。');
      let newline:number;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
        if(!line){if(data.length){yield data.join('\n');data=[];size=0;}}
        else if(line.startsWith('data:')){const value=line.slice(5).replace(/^ /,'');size+=value.length;if(size>LIMIT)throw new Error('API 流式事件过大，已停止读取。');data.push(value);}
      }
      if(next.done){if(buffer.startsWith('data:'))data.push(buffer.slice(5).trim());if(data.length)yield data.join('\n');break;}
    }
  } finally {await reader.cancel().catch(()=>{});}
}

/** Direct API members speak and discuss; this adapter exposes no filesystem or command tools. */
export class ApiAdapter implements Adapter {
  private controller?:AbortController;
  constructor(private executor:AcpExecutor,private dataDirectory:string,private fetch:typeof requestFetch=requestFetch) {}
  private get config(){return normalizeApiConnection(this.executor.api);}
  private get key(){return this.executor.env[API_KEY_VARIABLE]?.trim();}
  private dispatcher(settings:Settings):Dispatcher {
    const local=['localhost','127.0.0.1','[::1]'].includes(new URL(this.config.baseUrl).hostname);
    return settings.networkMode==='proxy'&&!local?new ProxyAgent(validateProxyUrl(settings.proxyUrl).toString()):new Agent();
  }
  private headers(){const key=this.key;if(!key)throw new Error('请在 API 连接中填写 API Key。');registerSecret(key);return this.config.protocol==='gemini'?{'x-goog-api-key':key}:{Authorization:`Bearer ${key}`};}
  private async check(response:FetchResponse){
    if(response.ok)return;
    await response.body?.cancel();
    const hint=response.status===401?'密钥无效或已失效':response.status===403?'账号、地区或模型访问被拒绝':response.status===429?'额度不足或请求被限流':response.status>=300&&response.status<400?'地址发生重定向，请填写最终服务地址':response.status===404?'接口地址或模型不存在':'请核对服务地址、协议和模型';
    throw new Error(`API 请求失败（HTTP ${response.status}）：${hint}。没有自动重发。`);
  }
  async probe(settings:Settings):Promise<ProviderInfo>{
    observeApiConnection(this.config.protocol,this.config.baseUrl);
    const info:ProviderInfo={id:this.executor.id,name:this.executor.name,available:false,auth:this.key?'api':'none',model:settings.models[this.executor.id]||this.executor.model,detail:'请填写 API Key 后检查连接。',checkedAt:new Date().toISOString(),runtimeReady:true,capabilities:{steer:false,cancel:'request',streaming:true,write:false,history:true,images:false},configuration:{model:true,effort:'unsupported',detail:'API 成员支持聊天与团队讨论，不执行命令或读写文件。思考参数跟随服务默认。'}};
    if(!this.key)return info;
    const dispatcher=this.dispatcher(settings);
    try{
      const response=await this.fetch(`${this.config.baseUrl}/models`,{headers:this.headers(),signal:AbortSignal.timeout(15000),dispatcher,redirect:'manual'});
      if([404,405,501].includes(response.status)){
        await response.body?.cancel();info.available=!!info.model;info.detail=info.model?'服务未提供模型列表，将使用手动模型；真实调用尚未验证。':'服务未提供模型列表，请手动填写模型。';return info;
      }
      await this.check(response);
      const listing=JSON.parse(await boundedText(response)) as any;
      const items=this.config.protocol==='gemini'?listing.models:listing.data;
      if(!Array.isArray(items))throw new Error('API 模型列表格式不匹配，请核对协议。');
      const options:ModelOption[]=items.filter(item=>this.config.protocol!=='gemini'||!Array.isArray(item.supportedGenerationMethods)||item.supportedGenerationMethods.includes('generateContent')).map(item=>({id:String(item.id??item.name??'').replace(/^models\//,''),label:String(item.displayName??item.id??item.name??''),efforts:[],effortSource:'unsupported' as const})).filter(item=>item.id&&item.id.length<=200).slice(0,500);
      info.modelOptions=options.map(item=>({...item,isDefault:item.id===info.model}));info.available=true;info.auth='api';info.detail=`已读取 ${options.length} 个模型${listing.nextPageToken?'（服务返回的第一页，可手动输入其他模型）':''}；检查未发送生成请求。${info.model?'':'请选择或填写模型后开始聊天。'}`;
    }catch(error){info.detail=String(redact((error as Error).message));}
    finally{await dispatcher.destroy();}
    return info;
  }
  async start(ctx:AdapterContext,text:string):Promise<AdapterResult>{
    this.controller=new AbortController();const signal=this.controller.signal,dispatcher=this.dispatcher(ctx.settings);
    let sent=false;
    try{
      const config=this.config,headers=this.headers(),model=ctx.settings.models[this.executor.id]||this.executor.model;
      if(!model)throw new Error('请先在 API 连接中选择或填写模型。');
      if((ctx.attachments??[]).some(item=>item.kind==='image'))throw new Error('当前 API 连接支持文本，图片没有发送；请使用已支持看图的成员。');
      const identity=createHash('sha256').update(JSON.stringify([this.executor.id,config.protocol,config.baseUrl,model])).digest('hex').slice(0,24);
      const directory=path.join(this.dataDirectory,'api-history',this.executor.id);await mkdir(directory,{recursive:true});
      const file=path.join(directory,`${createHash('sha256').update(ctx.session.id).digest('hex').slice(0,24)}-${identity}.json`);
      let messages:Message[]=[];
      if(!ctx.nativeContextInvalidated)try{
        if((await stat(file)).size>LIMIT)throw new Error('API 会话历史过大，请开新话题。');
        messages=JSON.parse(await readFile(file,'utf8'));
        if(!Array.isArray(messages)||messages.some(item=>!['user','assistant'].includes(item.role)||typeof item.content!=='string'))throw new Error('API 会话历史格式异常，未发送请求。');
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const input=messages.length?text:ctx.freshInput?.(true)??text;
      const system='你是 AIROOM 的 API 成员，可以聊天、分析用户提供的内容和参加团队讨论。你没有终端、文件或其他工具，不能声称已经执行命令、读取本地文件或保存成果。其他成员的材料仅供核对参考。\n\n'+latestPersona(ctx.persona);
      const pending=[...messages,{role:'user' as const,content:String(redact(input))}];
      if(JSON.stringify(pending).length>LIMIT)throw new Error('API 会话历史过大，请开新话题。');
      const gemini=config.protocol==='gemini';
      const tokenParameter=config.tokenParameter??(new URL(config.baseUrl).hostname==='api.openai.com'?'max_completion_tokens':'max_tokens');
      const url=gemini?`${config.baseUrl}/models/${encodeURIComponent(model.replace(/^models\//,''))}:streamGenerateContent?alt=sse`:`${config.baseUrl}/chat/completions`;
      const body=gemini?{systemInstruction:{parts:[{text:system}]},contents:pending.map(item=>({role:item.role==='assistant'?'model':'user',parts:[{text:item.content}]})),generationConfig:{maxOutputTokens:config.maxOutputTokens}}:{model,messages:[{role:'system',content:system},...pending],stream:true,[tokenParameter]:config.maxOutputTokens};
      ctx.emit('status',`${this.executor.name} · ${model} · API 聊天`);
      ctx.recordConfig?.({model,modelStatus:'accepted',effortStatus:'default',source:`api.${config.protocol}`});
      ctx.markDelivery('sent');sent=true;
      const response=await this.fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal,dispatcher,redirect:'manual'});
      await this.check(response);
      observeApiConnection(config.protocol,config.baseUrl);
      let content='',finished=false,usage:unknown,total=0;
      const append=(value:unknown,thought=false)=>{if(typeof value!=='string'||!value)return;total+=value.length;if(total>LIMIT)throw new Error('API 输出过大，已停止读取。');ctx.markDelivery('confirmed');ctx.progress?.();ctx.emit(thought?'reasoning':'delta',String(redact(value)));if(!thought)content+=value;};
      const packet=(value:any)=>{
        if(value.error)throw new Error(String(redact(value.error.message||'API 返回错误。')));
        if(value.modelVersion||value.model)ctx.recordConfig?.({model:value.modelVersion||value.model,modelStatus:'reported',effortStatus:'default',source:`api.${config.protocol}`});
        if(value.usage||value.usageMetadata){usage=value.usage??value.usageMetadata;ctx.emit('usage','API 用量',usage);}
        if(gemini){
          if(value.promptFeedback?.blockReason)throw new Error(`Gemini 拒绝此请求：${value.promptFeedback.blockReason}`);
          const choice=value.candidates?.[0];
          for(const part of choice?.content?.parts??[]){if(part.functionCall)throw new Error('API 返回工具调用；此连接未提供工具，未执行。');append(part.text,part.thought===true);}
          if(choice?.finishReason){if(!['STOP','MAX_TOKENS'].includes(choice.finishReason))throw new Error(`Gemini 生成未完成：${choice.finishReason}`);finished=true;if(choice.finishReason==='MAX_TOKENS')ctx.emit('warning','已达到输出 Token 上限，回复可能不完整。');}
        }else{
          const choice=value.choices?.[0],delta=choice?.delta??choice?.message;
          if(delta?.tool_calls?.length||delta?.function_call)throw new Error('API 返回工具调用；此连接未提供工具，未执行。');
          append(delta?.content??delta?.refusal);append(delta?.reasoning_content??delta?.reasoning,true);
          if(choice?.finish_reason){if(!['stop','length'].includes(choice.finish_reason))throw new Error(`API 生成未完成：${choice.finish_reason}`);finished=true;if(choice.finish_reason==='length')ctx.emit('warning','已达到输出 Token 上限，回复可能不完整。');}
        }
      };
      if(response.headers.get('content-type')?.includes('text/event-stream')){
        for await(const data of events(response)){if(data==='[DONE]')break;packet(JSON.parse(data));}
      }else packet(JSON.parse(await boundedText(response)));
      if(!finished||!content.trim())return {unknown:true,unknownReason:'API 没有返回完整的文本结束结果；不会自动重发。'};
      messages=[...pending,{role:'assistant',content:String(redact(content))}];
      const temporary=file+`.${ctx.run.id}.tmp`;
      await writeFile(temporary,JSON.stringify(messages),'utf8');await rename(temporary,file);
      ctx.persistNativeSession(`api-${identity}`);
      return {usage,summary:'API 回复已完成'};
    }catch(error){
      if(signal.aborted)return {stopped:true,unknown:sent,unknownReason:sent?'已取消本地请求；服务端是否继续生成或计费未知。':undefined};
      throw new Error(String(redact((error as Error).message)));
    }finally{this.controller=undefined;await dispatcher.destroy();}
  }
  async stop(){this.controller?.abort();}
}
