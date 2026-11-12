import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import type {Adapter,RoomMessage} from '../src/shared/types';

for(const nativeSteer of [true,false]){
  test(`desk supplements use ${nativeSteer?'the running turn':'the next turn'}, and an interrupt replaces the old queue`,async()=>{
    const data=await mkdtemp(path.join(os.tmpdir(),'airoom-desk-interruption-'));
    const started:string[]=[],steered:string[]=[];
    let finish:(()=>void)|undefined,stops=0;
    const adapter:Adapter={
      async probe(){return {id:'codex',name:'Fixture',available:true,runtimeReady:true,auth:'subscription',detail:'Fixture',capabilities:{steer:nativeSteer,cancel:'native',streaming:true,write:true,history:true}};},
      async start(ctx){
        const input=ctx.run.input;started.push(input);
        ctx.markDelivery('sent');
        ctx.emit('delta',`已输出：${input}`);
        if(input.startsWith('hold')){
          await new Promise<void>(resolve=>{finish=resolve;});
          finish=undefined;
        }
        ctx.markDelivery('confirmed');
        return {summary:''};
      },
      ...(nativeSteer?{async steer(text:string){steered.push(text);return true;}}:{}),
      async stop(){stops++;finish?.();},
    };
    const engine=new Engine(data,()=>{},()=>{},()=>adapter);
    try{
      const member=await engine.invoke('team.save',{member:{name:'Fixture',executor:'codex'}}) as {id:string};
      const roomId=`desk:${member.id}`;
      await engine.probe('codex');
      const {id:threadId}=await engine.invoke('room.archive',{roomId,title:'插话测试'}) as {id:string};
      const send=(text:string,interrupt=false)=>engine.invoke('room.send',{roomId,threadId,text,interrupt}) as Promise<{runId:string;delivery:string}>;
      const messages=async()=>((await engine.invoke('room.get',{roomId})) as {messages:RoomMessage[]}).messages;
      const run=(id:string)=>engine.snapshot().runs.find(r=>r.id===id);
      const until=async(check:()=>boolean)=>{
        const end=Date.now()+10000;
        while(!check()){
          assert.ok(Date.now()<end,`condition timed out; started: ${started.join(', ')}`);
          await new Promise(resolve=>setTimeout(resolve,15));
        }
      };
      const first=await send('hold first');
      await until(()=>started.includes('hold first'));
      await assert.rejects(engine.invoke('room.send',{roomId,threadId:'other-topic',text:'wrong topic',interrupt:true}),/话题已切换/);
      const supplement=await send('supplement');
      assert.deepEqual(started,['hold first']);
      assert.equal(stops,0);
      if(nativeSteer){
        assert.equal(supplement.delivery,'current');
        assert.equal(supplement.runId,first.runId);
        assert.deepEqual(steered,['supplement']);
      }else{
        assert.equal(supplement.delivery,'queued');
        assert.equal(run(supplement.runId)?.status,'queued');
      }
      assert.deepEqual((await messages()).filter(m=>m.author==='user').map(m=>m.text),['hold first','supplement']);
      finish?.();
      await until(()=>!['queued','running'].includes(run(supplement.runId)?.status??''));
      assert.deepEqual(started,nativeSteer?['hold first']:['hold first','supplement']);

      const second=await send('hold second');
      await until(()=>started.includes('hold second'));
      const queued=nativeSteer?undefined:await send('withdraw this');
      const replacement=await send('replacement',true);
      await until(()=>started.includes('replacement')&&!['queued','running'].includes(run(replacement.runId)?.status??''));
      assert.equal(stops,1);
      assert.equal(run(second.runId)?.status,'stopped');
      assert.equal(run(second.runId)?.sessionId,run(replacement.runId)?.sessionId);
      if(queued)assert.equal(run(queued.runId)?.delivery,'withdrawn');
      assert.ok(!started.includes('withdraw this'));
      const history=await messages();
      assert.ok(history.some(m=>m.author===member.id&&m.status==='stopped'&&m.text.includes('已输出：hold second')));
      assert.equal(history.filter(m=>m.author==='user'&&m.text==='replacement').length,1);
    }finally{
      finish?.();
      await engine.close();
      await rm(data,{recursive:true,force:true});
    }
  });
}
