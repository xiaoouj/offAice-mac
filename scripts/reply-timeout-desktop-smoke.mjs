import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {isolatedTestEnvironment} from './test-environment.mjs';

const root=process.cwd(),profile=isolatedTestEnvironment(process.env,root);
const binary=process.argv[2]??'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const output=path.resolve(process.argv[3]??'.test-cache/reply-timeout-desktop');
await mkdir(output,{recursive:true});
const env={...profile.env,HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};delete env.ELECTRON_RUN_AS_NODE;
const errors=[],results={scope:'Isolated desktop settings; no model request or real account.',checks:[]};let app;
const rpc=(page,method,params={})=>page.evaluate(({method,params})=>window.airoom.invoke(method,params),{method,params});
const launch=async()=>{
  app=await electron.launch({executablePath:path.resolve(binary),args:process.argv[2]?[]:[root],env,timeout:60000});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.body.innerText.includes('本机工作台已连接'),undefined,{timeout:45000});return page;
};
try{
  let page=await launch();
  assert.equal((await rpc(page,'snapshot')).settings.roomReplyIdleSeconds,300);
  await page.getByRole('button',{name:'设置与连接',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'WorkBuddy 实验连接',exact:true}).count(),0);
  await assert.rejects(rpc(page,'workbuddy.status'),/不允许的工作台请求/);
  results.checks.push('WorkBuddy experiment UI removed and former IPC endpoint rejected');
  await page.getByRole('button',{name:'工作台',exact:true}).click();
  const input=page.getByRole('spinbutton',{name:/聊天等待新输出/});
  assert.equal(await input.inputValue(),'300');
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'聊天等待设置.png'),animations:'disabled'});
  results.checks.push('fresh profile shows 300-second chat inactivity setting and bounded-wait explanation');
  await input.fill('720');await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.getByRole('heading',{name:'设置与成员连接',exact:true}).waitFor({state:'hidden'});
  assert.equal((await rpc(page,'snapshot')).settings.roomReplyIdleSeconds,720);
  await app.close();app=undefined;
  page=await launch();
  assert.equal((await rpc(page,'snapshot')).settings.roomReplyIdleSeconds,720);
  results.checks.push('custom chat inactivity value saves through UI and persists after app restart');
  await page.getByRole('button',{name:'设置与连接',exact:true}).click();
  await page.getByRole('button',{name:'网络',exact:true}).click();
  await page.getByText('请选择这台电脑实际可用的网络出口。系统代理与 TUN 是两种不同模式；仅开启系统代理时，请选择“使用显式代理”。',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);results.checks.push('network route guidance visible; no renderer exceptions');
  results.ok=true;console.log(JSON.stringify(results,null,2));
}catch(error){results.ok=false;results.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});results.rendererErrors=errors;await writeFile(path.join(output,'reply-timeout-desktop.json'),JSON.stringify(results,null,2));}
