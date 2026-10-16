import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {isolatedTestEnvironment} from './test-environment.mjs';

const root=process.cwd(),profile=isolatedTestEnvironment(process.env,root);
const output=path.resolve(process.argv[3]??'.test-cache/workbuddy-desktop');
const binary=process.argv[2]??'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
await mkdir(output,{recursive:true});
const env={...profile.env,HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};delete env.ELECTRON_RUN_AS_NODE;
const errors=[],results={profile:profile.directory,scope:'Isolated desktop and mock official API; no real WorkBuddy authorization or model call.',checks:[]};
let app;
const rpc=(page,method,params={})=>page.evaluate(({method,params})=>window.airoom.invoke(method,params),{method,params});
const launch=async()=>{
  app=await electron.launch({executablePath:path.resolve(binary),args:process.argv[2]?[]:[root],env,timeout:60000});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.body.innerText.includes('本机工作台已连接'),undefined,{timeout:45000});
  return page;
};
try{
  let page=await launch();
  await page.getByRole('button',{name:'设置与连接',exact:true}).click();
  await page.getByRole('button',{name:'连接与版本',exact:true}).click();
  const panel=page.getByRole('region',{name:'WorkBuddy 实验连接',exact:true});
  await panel.waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="WorkBuddy 实验连接"]')?.textContent.includes('尚未配置'));
  assert.equal((await rpc(page,'workbuddy.status')).configured,false);
  assert.equal(await panel.getByRole('button',{name:'发送一句话测试',exact:true}).isDisabled(),true);
  await assert.rejects(rpc(page,'workbuddy.test',{confirm:true}),/Access Token/);
  results.checks.push('fresh packaged profile shows unconfigured state, disables test and never requests a keychain for an absent token');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'WorkBuddy-待授权.png'),animations:'disabled'});

  // Fixture interception lives only in this test process and is never shipped.
  await app.evaluate(({net})=>{
    const original=net.fetch.bind(net);let marker;
    net.fetch=async(input,options={})=>{
      const url=String(input);
      if(!url.startsWith('https://www.workbuddy.cn/openapi/v2/localassistant'))return original(input,options);
      if(options.headers?.Authorization!=='Bearer airoom-workbuddy-desktop-fixture')throw Error('Unexpected test credential');
      let data;
      if(options.method==='POST'){
        marker=JSON.parse(options.body).content.match(/AIROOM_WORKBUDDY_OK_[a-f0-9]{32}/)[0];data={message_id:'fixture-message'};
      }else data=url.includes('/message?')?{messages:[{role:'assistant',msg_type:'text',content:[marker]}]}:{online:true};
      return new Response(JSON.stringify({code:0,data}),{status:200,headers:{'Content-Type':'application/json'}});
    };
  });
  await panel.getByLabel('WorkBuddy Access Token',{exact:true}).fill('airoom-workbuddy-desktop-fixture');
  await panel.getByRole('button',{name:'保存令牌',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="WorkBuddy 实验连接"]')?.textContent.includes('尚未检查'));
  assert.equal(await panel.getByLabel('WorkBuddy Access Token',{exact:true}).inputValue(),'');
  const secret=await readFile(path.join(profile.env.AIROOM_DATA_DIR,'secrets/workbuddy-access.secret'));
  assert.ok(!secret.includes(Buffer.from('airoom-workbuddy-desktop-fixture')));
  assert.ok(!JSON.stringify(await rpc(page,'snapshot')).includes('airoom-workbuddy-desktop-fixture'));
  results.checks.push('token input clears immediately, persisted secret is encrypted, snapshots exclude credentials');
  await app.close();app=undefined;
  page=await launch();
  assert.equal((await rpc(page,'workbuddy.status')).configured,true);
  results.checks.push('encrypted token reloads after restarting the isolated app');
  // Reapply mock after restart; no real request is made with the fixture token.
  await app.evaluate(({net})=>{
    const original=net.fetch.bind(net);let marker;
    net.fetch=async(input,options={})=>{
      if(!String(input).startsWith('https://www.workbuddy.cn/openapi/v2/localassistant'))return original(input,options);
      let data;
      if(options.method==='POST'){marker=JSON.parse(options.body).content.match(/AIROOM_WORKBUDDY_OK_[a-f0-9]{32}/)[0];data={message_id:'fixture-2'};}
      else data=String(input).includes('/message?')?{messages:[{role:'assistant',msg_type:'text',content:[marker]}]}:{online:true};
      return new Response(JSON.stringify({code:0,data}),{status:200});
    };
  });
  assert.equal((await rpc(page,'workbuddy.check')).connection,'online');
  await assert.rejects(rpc(page,'workbuddy.test'),/确认/);
  await page.getByRole('button',{name:'设置与连接',exact:true}).click();
  await page.getByRole('button',{name:'连接与版本',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('region',{name:'WorkBuddy 实验连接'}).getByRole('button',{name:'发送一句话测试',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="WorkBuddy 实验连接"]')?.textContent.includes('消息往返验证通过'),undefined,{timeout:15000});
  const status=await rpc(page,'workbuddy.status');assert.equal(status.test.phase,'confirmed');
  assert.match(status.test.reply,/^AIROOM_WORKBUDDY_OK_/);
  results.checks.push('UI confirmation, IPC allowlist, online check and marker-confirmed mock round trip');
  assert.equal((await rpc(page,'workbuddy.saveToken',{value:''})).configured,false);
  assert.deepEqual(errors,[]);results.checks.push('token clear and no renderer exceptions');
  results.ok=true;console.log(JSON.stringify(results,null,2));
}catch(error){results.ok=false;results.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});results.rendererErrors=errors;await writeFile(path.join(output,'workbuddy-desktop.json'),JSON.stringify(results,null,2));}
