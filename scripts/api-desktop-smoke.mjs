import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isolatedTestEnvironment} from './test-environment.mjs';

const root=process.cwd(),profile=isolatedTestEnvironment(process.env,root),output=path.resolve(process.argv[3]??'.test-cache/api-desktop');
await mkdir(output,{recursive:true});
const key='local-api-desktop-fixture-secret-789123',errors=[],requests=[],results={scope:'Isolated desktop and loopback API fixtures; no real API account or paid request.',checks:[]};
const server=createServer(async(req,res)=>{
  if(req.headers.authorization!==`Bearer ${key}`&&req.headers['x-goog-api-key']!==key){res.writeHead(401);res.end();return;}
  const gemini=req.url.startsWith('/gemini');
  if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify(gemini?{models:[{name:'models/fixture-model',displayName:'Fixture Gemini',supportedGenerationMethods:['generateContent']}]}:{data:[{id:'fixture-model'}]}));return;}
  let text='';for await(const chunk of req)text+=chunk;requests.push({gemini,body:JSON.parse(text)});
  res.writeHead(200,{'content-type':'text/event-stream'});
  const packet=gemini?{modelVersion:'fixture-model',candidates:[{content:{parts:[{text:'Gemini fixture connected'}]},finishReason:'STOP'}]}:{model:'fixture-model',choices:[{delta:{content:'OpenAI fixture connected'},finish_reason:'stop'}]};
  res.end(`data: ${JSON.stringify(packet)}\n\n${gemini?'':'data: [DONE]\n\n'}`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const env={...profile.env,HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};delete env.ELECTRON_RUN_AS_NODE;
const binary=path.resolve(process.argv[2]??'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');let app;
const rpc=(page,method,params={})=>page.evaluate(({method,params})=>window.airoom.invoke(method,params),{method,params});
async function launch(){app=await electron.launch({executablePath:binary,args:process.argv[2]?[]:[root],env,timeout:60000});const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>document.body.innerText.includes('本机工作台已连接'),undefined,{timeout:45000});return page;}
async function settings(page){await page.getByRole('button',{name:'设置与连接',exact:true}).click();await page.getByRole('button',{name:'连接与版本',exact:true}).click();}
async function add(page,name,protocol){
  await settings(page);await page.getByRole('button',{name:'添加 API 连接',exact:true}).click();
  await page.getByLabel('API 服务预设',{exact:true}).selectOption(protocol==='gemini'?'gemini':'stepfun');
  assert.equal(await page.getByLabel('API 服务地址',{exact:true}).inputValue(),protocol==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.stepfun.com/v1');
  await page.getByLabel('API 连接名称',{exact:true}).fill(name);
  await page.getByLabel('API 服务地址',{exact:true}).fill(`${base}/${protocol==='gemini'?'gemini':'openai'}`);
  await page.getByLabel('API 连接密钥',{exact:true}).fill(key);
  await page.getByLabel('API 默认模型',{exact:true}).fill('fixture-model');
  if(protocol==='openai')await page.screenshot({path:path.join(output,'API连接编辑器.png'),animations:'disabled'});
  await page.getByRole('button',{name:'保存 API 连接',exact:true}).click();
  await page.getByLabel('名字',{exact:true}).fill(name);
  await page.getByRole('button',{name:'保存人物卡',exact:true}).click();
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  const snapshot=await rpc(page,'snapshot'),executor=snapshot.executors.find(item=>item.name===name);
  assert.ok(executor.api);assert.ok(!JSON.stringify(snapshot).includes(key));assert.deepEqual(executor.env,{});
  return executor;
}
async function chat(page,name,answer){
  await page.getByRole('button',{name:`${name} 的工位`,exact:true}).click();await page.getByRole('button',{name:'开新话题',exact:true}).click();
  await page.getByLabel('新话题名称',{exact:true}).fill('API connection test');await page.getByRole('button',{name:'开始新话题',exact:true}).click();
  await page.getByRole('textbox',{name:'在工位里说话',exact:true}).fill('Reply with a connection test result. Do not use tools.');
  await page.getByRole('button',{name:'发送到工位',exact:true}).click();await page.getByText(answer,{exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'开新话题',exact:true}).waitFor({state:'visible'});
}
try{
  let page=await launch();const openai=await add(page,'Test API','openai');await chat(page,'Test API','OpenAI fixture connected');
  const gemini=await add(page,'Test Gemini API','gemini');await chat(page,'Test Gemini API','Gemini fixture connected');
  results.checks.push('StepFun and Gemini presets; save API connection and create member entirely through UI','Both API protocols send and render a real loopback streaming response through the engine');
  await settings(page);const card=page.getByRole('region',{name:'Test API 的 API 连接',exact:true});await card.getByRole('button',{name:'设置',exact:true}).click();
  assert.equal(await page.getByLabel('API 连接密钥',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'保存 API 连接',exact:true}).isEnabled(),true);
  const field=page.getByLabel('API 服务地址',{exact:true}),old=await field.inputValue();await field.fill(`${old}/changed`);assert.equal(await page.getByRole('button',{name:'保存 API 连接',exact:true}).isEnabled(),false);await field.fill(old);await page.getByLabel('API 默认模型',{exact:true}).fill('fixture-model');await page.getByRole('button',{name:'保存 API 连接',exact:true}).click();
  await card.getByRole('button',{name:'检查并读取模型',exact:true}).click();await card.getByText(/已读取 1 个模型/).waitFor();
  results.checks.push('Existing key stays masked and survives editing; changing destination requires a key; model listing works without generation');
  await app.close();app=undefined;page=await launch();await settings(page);
  const snap=await rpc(page,'snapshot');assert.equal(snap.executors.filter(item=>item.api).length,2);assert.ok(!JSON.stringify(snap).includes(key));
  const savedCard=page.getByRole('region',{name:'Test API 的 API 连接',exact:true});await savedCard.getByRole('button',{name:'检查并读取模型',exact:true}).click();await savedCard.getByText(/已读取 1 个模型/).waitFor();
  for(const executor of [openai,gemini]){const bytes=await readFile(path.join(env.AIROOM_DATA_DIR,'secrets',`${executor.id}.secret`));assert.ok(bytes.length>0);assert.ok(!bytes.includes(Buffer.from(key)));}
  for(const name of (await readdir(env.AIROOM_DATA_DIR)).filter(name=>/sqlite/.test(name))){assert.ok(!(await readFile(path.join(env.AIROOM_DATA_DIR,name))).includes(Buffer.from(key)));}
  assert.deepEqual(errors,[]);assert.equal(requests.filter(item=>item.gemini).length,1);assert.equal(requests.filter(item=>!item.gemini).length,1);
  results.checks.push('Restart restores connections and encrypted credentials; no key in snapshot, SQLite or encrypted file; no renderer exceptions');
  await page.screenshot({path:path.join(output,'API连接列表.png'),animations:'disabled'});results.ok=true;console.log(JSON.stringify(results,null,2));
}catch(error){results.ok=false;results.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));results.rendererErrors=errors;await writeFile(path.join(output,'api-desktop-results.json'),JSON.stringify(results,null,2));}
