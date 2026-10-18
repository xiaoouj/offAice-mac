import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiAdapter } from '../src/backend/adapters/api';
import { normalizeApiConnection } from '../src/shared/api-connection';
import { DEFAULT_SETTINGS, normalizeExecutor } from '../src/shared/defaults';
import type { AcpExecutor, AdapterContext } from '../src/shared/types';
import { Engine } from '../src/backend/engine';

const key='airoom-local-fixture-secret-12345678';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(handler:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>){
  const instance=createServer((req,res)=>{void Promise.resolve(handler(req,res)).catch(()=>{res.writeHead(500);res.end();});});
  await new Promise<void>(resolve=>instance.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${(instance.address() as any).port}/v1`,close:async()=>{instance.closeAllConnections();await new Promise<void>(resolve=>instance.close(()=>resolve()));}};
}
async function body(req:IncomingMessage){let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);}
function executor(url:string,protocol:'openai'|'gemini'='openai'):AcpExecutor{return {id:'acp-apitest1234',name:'测试 API',api:{protocol,baseUrl:url,maxOutputTokens:2048},model:'fixture-model',command:'',args:[],env:{AIROOM_API_KEY:key},secretKeys:['AIROOM_API_KEY'],permissions:{commands:'deny',fileScope:'workspace',network:true},createdAt:new Date().toISOString()};}
function context(root:string){
  const events:{kind:string;text:string;data?:unknown}[]=[],deliveries:string[]=[],configs:unknown[]=[];
  const ctx={cwd:root,run:{id:'run-one'},session:{id:'session-one'},settings:{...DEFAULT_SETTINGS,networkMode:'tun',models:{}},env:{},emit:(kind:string,text:string,data?:unknown)=>events.push({kind,text,data}),markDelivery:(state:string)=>deliveries.push(state),recordConfig:(value:unknown)=>configs.push(value),persistNativeSession:()=>{},registerProcess:()=>{},approve:async()=>{throw new Error('No tools permitted');}} as unknown as AdapterContext;
  return {ctx,events,deliveries,configs};
}
function stream(res:ServerResponse,packets:unknown[]){res.writeHead(200,{'content-type':'text/event-stream'});for(const item of packets)res.write(`data: ${typeof item==='string'?item:JSON.stringify(item)}\n\n`);res.end();}

test('API endpoints reject embedded credentials and insecure remote HTTP; complete paths normalize',()=>{
  for(const baseUrl of ['http://remote.example/v1','https://user:secret@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#key','file:///tmp/key'])assert.throws(()=>normalizeApiConnection({protocol:'openai',baseUrl}));
  assert.equal(normalizeApiConnection({protocol:'openai',baseUrl:'https://example.com/prefix/v1/chat/completions'}).baseUrl,'https://example.com/prefix/v1');
  assert.throws(()=>normalizeApiConnection({protocol:'openai',baseUrl:'https://example.com',maxOutputTokens:NaN}));
  const api=normalizeExecutor({name:'API',api:{protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},undefined,'acp-12345678');assert.equal(api.command,'');assert.equal(api.permissions.commands,'deny');
});

test('OpenAI-compatible streaming survives byte splits, lists models without generation, and resumes completed history',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-api-'));const requests:any[]=[];
  const endpoint=await server(async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${key}`);
    if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
    requests.push(await body(req));const bytes=Buffer.from(`data: ${JSON.stringify({model:'fixture-model',choices:[{delta:{content:'连接正常'},finish_reason:null}]})}\r\n\r\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{total_tokens:4}})}\n\ndata: [DONE]\n\n`);
    res.writeHead(200,{'content-type':'text/event-stream'});for(let i=0;i<bytes.length;i+=2)res.write(bytes.subarray(i,i+2));res.end();
  });
  try{
    const adapter=new ApiAdapter(executor(endpoint.url),root);const c=context(root);
    assert.equal((await adapter.probe(c.ctx.settings)).available,true);assert.equal(requests.length,0);
    assert.equal((await adapter.start(c.ctx,'第一句')).unknown,undefined);assert.equal(c.events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'连接正常');assert.deepEqual(c.deliveries,['sent','confirmed']);
    c.ctx.run.id='run-two';await new ApiAdapter(executor(endpoint.url),root).start(c.ctx,'第二句');
    assert.deepEqual(requests[1].messages.slice(1).map((m:any)=>m.content),['第一句','连接正常','第二句']);assert.equal(requests[0].max_tokens,2048);assert.equal(requests[0].tools,undefined);
    const modern=executor(endpoint.url);modern.api!.tokenParameter='max_completion_tokens';c.ctx.run.id='run-three';await new ApiAdapter(modern,root).start(c.ctx,'新版参数');assert.equal(requests[2].max_completion_tokens,2048);assert.equal(requests[2].max_tokens,undefined);
    const history=await readdir(path.join(root,'api-history','acp-apitest1234'));assert.equal(history.length,1);assert.ok(!(await readFile(path.join(root,'api-history','acp-apitest1234',history[0]),'utf8')).includes(key));
  }finally{await endpoint.close();await rm(root,{recursive:true,force:true});}
});

test('Gemini native uses header authentication and native history schema, not OpenAI payloads',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-gemini-'));let posted:any;
  const endpoint=await server(async(req,res)=>{
    assert.equal(req.headers['x-goog-api-key'],key);assert.equal(req.headers.authorization,undefined);assert.ok(!req.url!.includes(key));
    if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'models/fixture-model',displayName:'Fixture',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}));return;}
    assert.equal(req.url,'/v1/models/fixture-model:streamGenerateContent?alt=sse');posted=await body(req);
    stream(res,[{candidates:[{content:{parts:[{text:'思考',thought:true}]}}]},{modelVersion:'fixture-model',candidates:[{content:{parts:[{text:'Gemini 正常'}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:8}}]);
  });
  try{const adapter=new ApiAdapter(executor(endpoint.url,'gemini'),root),c=context(root);assert.equal((await adapter.probe(c.ctx.settings)).modelOptions!.length,1);await adapter.start(c.ctx,'测试');assert.equal(posted.messages,undefined);assert.equal(posted.contents[0].role,'user');assert.equal(posted.generationConfig.maxOutputTokens,2048);assert.equal(c.events.find(e=>e.kind==='delta')?.text,'Gemini 正常');assert.ok(c.events.some(e=>e.kind==='usage'));}
  finally{await endpoint.close();await rm(root,{recursive:true,force:true});}
});

test('API errors, redirects and incomplete streams never resend a generation or commit incomplete history',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-api-failure-'));let count=0,mode='redirect',leaks=0;
  const other=await server((_req,res)=>{leaks++;res.end('{}');});
  const endpoint=await server((_req,res)=>{count++;if(mode==='redirect'){res.writeHead(307,{location:other.url});res.end();}else if(mode==='limit'){res.writeHead(429);res.end(key);}else stream(res,[{choices:[{delta:{content:'部分'},finish_reason:null}]}]);});
  try{
    const c=context(root);await assert.rejects(new ApiAdapter(executor(endpoint.url),root).start(c.ctx,'测试'),/重定向/);assert.equal(leaks,0);assert.equal(count,1);
    mode='limit';await assert.rejects(new ApiAdapter(executor(endpoint.url),root).start(c.ctx,'测试'),/429/);assert.equal(count,2);
    mode='partial';assert.equal((await new ApiAdapter(executor(endpoint.url),root).start(c.ctx,'测试')).unknown,true);assert.equal(count,3);
    assert.deepEqual(await readdir(path.join(root,'api-history','acp-apitest1234')),[]);
  }finally{await endpoint.close();await other.close();await rm(root,{recursive:true,force:true});}
});

test('API cancellation aborts an active stream without replay or a false completed history',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-api-cancel-'));let count=0,ready!:()=>void;const started=new Promise<void>(r=>ready=r);
  const endpoint=await server((_req,res)=>{count++;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting\n\n');ready();});
  try{const c=context(root),adapter=new ApiAdapter(executor(endpoint.url),root);const task=adapter.start(c.ctx,'测试');await started;await adapter.stop();const result=await task;assert.equal(result.stopped,true);assert.equal(result.unknown,true);await sleep(10);assert.equal(count,1);assert.deepEqual(await readdir(path.join(root,'api-history','acp-apitest1234')),[]);}
  finally{await endpoint.close();await rm(root,{recursive:true,force:true});}
});

test('changing an API destination or model does not reuse another destination\'s local transcript',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-api-isolation-'));const bodies:any[]=[];
  const endpoint=await server(async(req,res)=>{bodies.push(await body(req));stream(res,[{choices:[{delta:{content:'完成'},finish_reason:'stop'}]},'[DONE]']);});
  try{const c=context(root);await new ApiAdapter(executor(endpoint.url),root).start(c.ctx,'只属于第一个模型');const other=executor(endpoint.url);other.model='other-model';c.ctx.run.id='run-next';await new ApiAdapter(other,root).start(c.ctx,'新的模型');assert.equal(bodies[1].messages.length,2);assert.ok(!JSON.stringify(bodies[1]).includes('只属于第一个模型'));}
  finally{await endpoint.close();await rm(root,{recursive:true,force:true});}
});

test('API connection metadata persists while secrets remain outside snapshots and the SQLite database',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-api-engine-'));let engine:Engine|undefined;
  try{
    engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
    const saved=await engine.invoke('executor.save',{executor:{name:'我的 API',api:{protocol:'openai',baseUrl:'https://example.com/v1'},model:'my-model'},secrets:{AIROOM_API_KEY:key}}) as AcpExecutor;
    assert.equal(saved.api?.protocol,'openai');assert.ok(!JSON.stringify(engine.snapshot()).includes(key));await engine.close();engine=undefined;
    assert.ok(!(await readFile(path.join(root,'airoom.sqlite'))).includes(Buffer.from(key)));
    engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});const loaded=engine.snapshot().executors!.find(e=>e.id===saved.id)!;assert.equal(loaded.api?.baseUrl,'https://example.com/v1');assert.deepEqual(loaded.secretKeys,['AIROOM_API_KEY']);assert.equal(loaded.env.AIROOM_API_KEY,undefined);
  }finally{await engine?.close();await rm(root,{recursive:true,force:true});}
});
