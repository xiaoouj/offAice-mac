import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {spawnOwned,stopOwned} from '../src/backend/process-supervisor';
import {npmLaunch,npmEntryForNode,nodeRuntimeEnvironment} from '../src/backend/node-runtime';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {supportsCatalogPlatform,catalogEntry} from '../src/shared/executor-catalog';
import {copyProductionDependencies} from '../scripts/runtime-dependencies.mjs';
import {Engine} from '../src/backend/engine';
import {createBackup} from '../src/backend/backup';
import type {Adapter,Project,Session} from '../src/shared/types';

test('Mac runtime supports Unix npm layout and paths with spaces without Electron Node mode',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'AIROOM Mac runtime '));
  try{
    await mkdir(path.join(root,'bin'));await mkdir(path.join(root,'lib/node_modules/npm/bin'),{recursive:true});
    const node=path.join(root,'bin/node'),cli=path.join(root,'lib/node_modules/npm/bin/npm-cli.js');
    await symlink(process.execPath,node);
    await writeFile(cli,"console.log(JSON.stringify({args:process.argv.slice(2),electronMode:process.env.ELECTRON_RUN_AS_NODE??null}))");
    assert.equal(npmEntryForNode(node),cli);
    const launch=npmLaunch({...process.env,AIROOM_NODE_EXE:node,AIROOM_NODE_SOURCE:'local',ELECTRON_RUN_AS_NODE:'1'},root);
    const result=spawnSync(launch.command,[...launch.prefix,'value with spaces'],{env:launch.env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{args:['value with spaces'],electronMode:null});
    const env=nodeRuntimeEnvironment(DEFAULT_SETTINGS,{PATH:'/usr/bin',AIROOM_BUNDLED_NODE_EXE:node,AIROOM_BUNDLED_NODE_VERSION:process.versions.node});
    assert.equal(env.PATH?.split(path.delimiter)[0],path.dirname(node));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Mac beta excludes Windows-only installers and retains npm installers',()=>{
  for(const id of ['cursor','qoder','qodercn','zcode'])assert.equal(supportsCatalogPlatform(catalogEntry(id),'darwin'),false);
  for(const id of ['codex','claude','dsh'])assert.equal(supportsCatalogPlatform(catalogEntry(id),'darwin'),true);
});

test('stopping a task kills a resistant grandchild after the direct child has exited',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-process-'));
  let grandchild:number|undefined;
  const code=`const cp=require('node:child_process');const c=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});c.stdout.pipe(process.stdout);setInterval(()=>{},1000);`;
  const child=spawnOwned(process.execPath,['-e',code],{cwd:root,env:{...process.env}});
  try{
    grandchild=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child startup timeout')),5000);child.stdout!.once('data',data=>{clearTimeout(timer);resolve(Number(String(data).trim()));});child.once('error',reject);});
    assert.ok(grandchild>0);
    await stopOwned(child,200);
    const remaining=spawnSync('/bin/ps',['-p',String(grandchild),'-o','stat='],{encoding:'utf8'});
    assert.ok(remaining.status===1||(remaining.status===0&&remaining.stdout.trim().startsWith('Z')),'grandchild must be exited, even if the OS has not reaped it yet');
  }finally{
    if(grandchild)try{process.kill(grandchild,'SIGKILL');}catch{}
    await rm(root,{recursive:true,force:true});
  }
});

test('packaged dependencies include the verified Mac arm64 7zip binary',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'airoom-deps-'));
  try{
    await mkdir(path.join(root,'dist'));
    const result=await copyProductionDependencies(root,'darwin','arm64');assert.ok(result.packages>0);
    const manifest=JSON.parse(await readFile(path.join(root,'dist/runtime-dependencies.json'),'utf8'));
    assert.equal(manifest.platform,'darwin');assert.equal(manifest.arch,'arm64');
    assert.equal(manifest.equivalentFiles[0].path,'node_modules/7zip-bin/mac/arm64/7za');
    const exe=path.join(root,manifest.equivalentFiles[0].path);
    assert.equal(spawnSync(exe,['i'],{encoding:'utf8'}).status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('task work copies preserve original files until apply, then undo restores them; backups verify',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'AIROOM task 项目 ')),directory=path.join(root,'project');
  await mkdir(directory);await writeFile(path.join(directory,'hello.txt'),'original');
  const adapter:Adapter={
    async probe(){return {id:'codex',name:'Test fixture',available:true,runtimeReady:true,auth:'subscription',detail:'local fixture',capabilities:{steer:false,cancel:'process',streaming:true,write:true,history:true}};},
    async start(ctx){ctx.markDelivery('sent');await writeFile(path.join(ctx.cwd,'hello.txt'),'updated');ctx.emit('message','Local fixture complete',undefined,'native');ctx.markDelivery('confirmed');return {summary:'Local fixture complete'};},
    async stop(){},
  };
  const engine=new Engine(path.join(root,'data'),()=>{},()=>{},()=>adapter,undefined,undefined,async(data,reason)=>{await createBackup(data,reason);});
  try{
    await engine.probe('codex');
    const project=await engine.invoke('project.create',{directory}) as Project;
    const session=await engine.invoke('session.create',{projectId:project.id,provider:'codex',writeMode:true}) as Session;
    const sent=await engine.invoke('session.send',{sessionId:session.id,text:'Update hello.txt'}) as {runId:string};
    const deadline=Date.now()+15000;
    while(Date.now()<deadline&&['queued','running'].includes(engine.snapshot().runs.find(run=>run.id===sent.runId)?.status??''))await new Promise(resolve=>setTimeout(resolve,50));
    const run=engine.snapshot().runs.find(run=>run.id===sent.runId)!;
    assert.equal(run.status,'ended',JSON.stringify(run));
    assert.equal(await readFile(path.join(directory,'hello.txt'),'utf8'),'original');
    const applied=await engine.invoke('workspace.apply',{sessionId:session.id}) as {conflicts:string[]};
    assert.equal(applied.conflicts.length,0);
    assert.equal(await readFile(path.join(directory,'hello.txt'),'utf8'),'updated');
    await engine.invoke('workspace.undo',{sessionId:session.id,runId:sent.runId});
    assert.equal(await readFile(path.join(directory,'hello.txt'),'utf8'),'original');
    await engine.invoke('backup.create');
    const backups=await engine.invoke('backup.list') as {id:string}[];
    assert.ok(backups.length);await engine.invoke('backup.preview',{id:backups[0].id});
  }finally{await engine.close();await rm(root,{recursive:true,force:true});}
});
