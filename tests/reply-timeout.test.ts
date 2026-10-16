import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RoomReplyWatchdog, RoomReplyTimeoutError } from '../src/backend/room-reply-watchdog';
import { replyIdleSeconds } from '../src/shared/reply-timeout';
import { CodexAdapter } from '../src/backend/adapters/codex';
import { Engine } from '../src/backend/engine';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('chat timeout defaults migrate to five minutes, stay bounded, and persist custom settings', async () => {
  for (const invalid of [undefined, null, '90', NaN, Infinity]) assert.equal(replyIdleSeconds(invalid), 300);
  assert.equal(replyIdleSeconds(-1), 30); assert.equal(replyIdleSeconds(99999), 1800);
  const root = await mkdtemp(path.join(os.tmpdir(), 'airoom-reply-settings-'));
  let engine: Engine | undefined;
  try {
    engine = new Engine(root, () => {}, () => {}, undefined, { maintenanceOnly: true });
    assert.equal(engine.snapshot().settings.roomReplyIdleSeconds, 300);
    await engine.invoke('settings.save', { settings: { roomReplyIdleSeconds: 720 } });
    await engine.close(); engine = undefined;
    engine = new Engine(root, () => {}, () => {}, undefined, { maintenanceOnly: true });
    assert.equal(engine.snapshot().settings.roomReplyIdleSeconds, 720);
    await engine.invoke('settings.save', { settings: { roomReplyIdleSeconds: Infinity } });
    assert.equal(engine.snapshot().settings.roomReplyIdleSeconds, 300);
    assert.match(new RoomReplyTimeoutError(720000).message, /720 秒/);
    assert.match(new RoomReplyTimeoutError().message, /300 秒/);
  } finally { await engine?.close(); await rm(root, { recursive: true, force: true }); }
});

test('chat inactivity expires once without replaying the original task', async () => {
  let starts = 0, expired = 0;
  const watchdog = new RoomReplyWatchdog(20, () => { expired++; });
  const keepAlive = setTimeout(() => {}, 200);
  try {
    await assert.rejects(watchdog.run(async () => { starts++; return new Promise(() => {}); }), RoomReplyTimeoutError);
    await sleep(30);
    assert.equal(starts, 1); assert.equal(expired, 1);
    watchdog.progress(); await sleep(30); assert.equal(expired, 1, 'finished watchdog must remain closed');
  } finally { clearTimeout(keepAlive); }
});

test('content progress extends a slow reply and waiting for approval pauses inactivity', async () => {
  let expired = 0;
  const watchdog = new RoomReplyWatchdog(50, () => { expired++; });
  const result = await watchdog.run(async () => {
    await sleep(20); watchdog.progress();
    await sleep(20); watchdog.waitForUser();
    await sleep(100); watchdog.userAnswered();
    await sleep(20); watchdog.progress();
    await sleep(20); return 'complete';
  });
  assert.equal(result, 'complete'); assert.equal(expired, 0);
  await sleep(60); assert.equal(expired, 0);
});

test('Codex reconnect notices are warnings, not fresh content or requests to replay a turn', () => {
  const events: { kind: string; text: string }[] = []; let progress = 0, completed = 0;
  const adapter = new CodexAdapter() as any;
  adapter.context = { roomRuntime: true, emit: (kind: string, text: string) => events.push({ kind, text }), progress: () => { progress++; }, markDelivery: () => { completed++; } };
  adapter.threadId = 'thread-1'; adapter.turnId = 'turn-1'; adapter.delivered = true;
  const retry = { threadId: 'thread-1', turnId: 'turn-1', error: { message: 'Reconnecting... 2/5', additionalDetails: 'request timed out' }, willRetry: true };
  adapter.notification('error', { ...retry, threadId: 'other-thread' });
  assert.equal(events.length, 0);
  adapter.notification('error', retry);
  assert.equal(events[0].kind, 'warning'); assert.match(events[0].text, /显式代理/);
  assert.equal(progress, 0); assert.equal(completed, 0);
  adapter.notification('item/started', { threadId: 'thread-1', turnId: 'old-turn', item: { id: 'reasoning-old', type: 'reasoning' } });
  assert.equal(progress, 0);
  adapter.notification('item/started', { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'reasoning-1', type: 'reasoning' } });
  assert.equal(progress, 1);
  adapter.notification('error', { ...retry, willRetry: false });
  assert.equal(events.at(-1)?.kind, 'error');
});
