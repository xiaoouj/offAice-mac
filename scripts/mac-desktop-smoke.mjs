import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {isolatedTestEnvironment} from './test-environment.mjs';

const root=process.cwd(),profile=isolatedTestEnvironment(process.env,root);
const binary=path.resolve(process.argv[2]??'release-mac/mac-arm64/AIROOM Mac Beta.app/Contents/MacOS/AIROOM Mac Beta');
const output=path.resolve(process.argv[3]??'.test-cache/mac-desktop');
await mkdir(output,{recursive:true});
// Finder launches without the developer's Node installation or npm wrappers.
// macOS resolves the login keychain via HOME. Isolate application data and CLI
// homes, while leaving the OS login keychain path intact.
const env={...profile.env,HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[],results={profile:profile.directory,binary,checks:[]};
const launch=async()=>{
  app=await electron.launch({executablePath:binary,env,timeout:60000});
  console.log('Electron connected');
  app.process().stderr?.on('data',data=>console.error(String(data)));
  const page=await app.firstWindow();
  console.log('Window connected');
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.body.innerText.includes('本机工作台已连接'),undefined,{timeout:45000});
  return page;
};
const rpc=(page,method,params={})=>page.evaluate(({method,params})=>window.airoom.invoke(method,params),{method,params});
try{
  let page=await launch();
  results.checks.push('packaged app and backend ready with Finder PATH');
  await page.screenshot({path:path.join(output,'AIROOM-Mac-Beta.png'),animations:'disabled'});
  const catalog=await rpc(page,'catalog.list');
  assert.equal(catalog.node.version,'26.6.0');
  assert.ok(catalog.items.some(item=>item.entry.id==='codex'));
  assert.ok(!catalog.items.some(item=>item.entry.distribution));
  results.checks.push('bundled standard Node.js and platform-filtered catalog');
  const runtime=await app.evaluate(({app,Menu})=>({version:app.getVersion(),packaged:app.isPackaged,menu:Menu.getApplicationMenu().items.map(item=>item.label)}));
  assert.equal(runtime.packaged,true);assert.equal(runtime.version,JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root,'package.json'),'utf8')).version);assert.ok(runtime.menu.includes('编辑'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await app.evaluate(({app})=>app.emit('activate'));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  results.checks.push('native menu, close to menu bar, Dock activate');
  const version=await rpc(page,'app.version');assert.ok(version.sourceCommit);results.version=version;
  console.log('Installing Codex using packaged runtime...');
  const installed=await rpc(page,'catalog.install',{id:'codex',version:'0.160.1',agree:true,revision:catalog.revision});
  assert.equal(installed.selectedVersion,'0.160.1');
  const snapshot=await rpc(page,'snapshot');const info=snapshot.providers.find(item=>item.id==='codex');
  assert.equal(info.runtimeReady,true);assert.equal(info.auth,'none');
  results.checks.push('official Codex download, integrity verification, app-server connection, signed-out state');
  results.codex={version:info.version,auth:info.auth,runtimeReady:info.runtimeReady};
  const backup=await rpc(page,'backup.create');results.backup=backup;
  const backups=await rpc(page,'backup.list');assert.ok(backups.length>0);
  await rpc(page,'backup.preview',{id:backups[0].id});
  results.checks.push('backup creation and restore preview');
  await app.close();app=undefined;
  page=await launch();
  const persisted=await rpc(page,'catalog.list');
  assert.equal(persisted.items.find(item=>item.entry.id==='codex').selectedVersion,'0.160.1');
  results.checks.push('clean quit, restart and saved connection persistence');
  assert.deepEqual(errors,[]);results.checks.push('no renderer exceptions');
  results.ok=true;console.log(JSON.stringify(results,null,2));
}catch(error){results.ok=false;results.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});results.rendererErrors=errors;await writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify(results,null,2));}
