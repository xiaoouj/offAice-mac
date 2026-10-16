import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkBuddyLocal } from '../src/backend/workbuddy-local';
import { workBuddyTestActive } from '../src/shared/workbuddy';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const timing = { pollMs: 2, waitMs: 100, requestMs: 100 };
async function finished(client: WorkBuddyLocal) {
  const deadline = Date.now() + 1500;
  while (workBuddyTestActive(client.status().test) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(workBuddyTestActive(client.status().test), false, 'test must have bounded completion');
  return client.status();
}

test('WorkBuddy does no network I/O until configured and explicitly checked', async () => {
  let calls = 0;
  const client = new WorkBuddyLocal(async () => { calls++; return json({ code: 0, data: { online: true } }); });
  assert.equal(client.status().configured, false);
  await assert.rejects(client.check(), /Access Token/);
  assert.throws(() => client.startTest(), /Access Token/);
  client.configure('fake-test-credential');
  assert.equal(calls, 0);
  assert.equal((await client.check()).connection, 'online');
  assert.equal(calls, 1);
  assert.equal(client.status().test, undefined, 'checking must never send a model prompt');
  assert.ok(!JSON.stringify(client.status()).includes('fake-test-credential'));
});

test('WorkBuddy confirms only the fresh marker and never exposes shared assistant history', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let marker = '', polls = 0;
  const client = new WorkBuddyLocal(async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, 'https://www.workbuddy.cn');
    assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-token');
    if (!url.includes('/message')) return json({ code: 0, data: { online: true } });
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      marker = body.content.match(/AIROOM_WORKBUDDY_OK_[a-f0-9]{32}/)[0];
      assert.equal(body.msg_type, 'text'); assert.match(body.content, /不要调用任何工具/);
      return json({ code: 0, data: { message_id: 'new message/with?characters' } });
    }
    assert.equal(new URL(url).searchParams.get('message_id'), 'new message/with?characters');
    polls++;
    return json({ code: 0, data: { messages: polls === 1 ? [
      { role: 'assistant', msg_type: 'text', content: ['PRIVATE_OLD_CONVERSATION'] },
      { role: 'user', msg_type: 'text', content: [marker] },
    ] : [{ role: 'assistant', msg_type: 'text', content: [marker] }] } });
  }, timing);
  client.configure('test-token'); client.startTest();
  assert.throws(() => client.startTest(), /正在进行/);
  const result = await finished(client);
  assert.equal(result.test?.phase, 'confirmed'); assert.equal(result.test.reply, marker);
  assert.equal(result.test.delivery, 'accepted'); assert.equal(polls, 2);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_OLD_CONVERSATION'));
});

test('WorkBuddy HTTP success and unrelated replies cannot establish a successful round trip', async () => {
  let sends = 0;
  const client = new WorkBuddyLocal(async (url, init) => {
    if (!url.includes('/message')) return json({ data: { online: true } });
    if (init.method === 'POST') { sends++; return json({ data: { message_id: 'message-1' } }); }
    return json({ data: { messages: [{ role: 'assistant', msg_type: 'text', content: ['其他用户的回复'] }] } });
  }, { ...timing, waitMs: 30 });
  client.configure('test-token'); client.startTest();
  const result = await finished(client);
  assert.equal(result.test?.phase, 'unconfirmed'); assert.equal(result.test.reply, undefined);
  assert.match(result.test.detail, /未自动重发/); assert.equal(sends, 1);
});

test('WorkBuddy refuses unauthorized, offline and malformed online responses without sending a task', async () => {
  for (const [response, connection] of [
    [() => json({ token: 'DO_NOT_ECHO' }, 401), 'unauthorized'],
    [() => json({}, 403), 'unauthorized'],
    [() => json({ data: { online: false } }), 'offline'],
    [() => json({ code: 5, msg: 'DO_NOT_ECHO' }), 'error'],
    [() => json({ data: { online: 'true' } }), 'error'],
  ] as const) {
    let posts = 0;
    const client = new WorkBuddyLocal(async (_url, init) => { if (init.method === 'POST') posts++; return response(); }, timing);
    client.configure('test-token'); client.startTest();
    const result = await finished(client);
    assert.equal(result.connection, connection); assert.equal(posts, 0);
    assert.equal(result.test?.delivery, 'not-sent'); assert.equal(result.test?.phase, 'failed');
    assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO'));
  }
});

test('WorkBuddy lost send response remains uncertain, and a new token cannot receive stale results', async () => {
  let posts = 0;
  const failed = new WorkBuddyLocal(async (_url, init) => {
    if (init.method === 'POST') { posts++; throw new Error('Network failure containing test-token'); }
    return json({ data: { online: true } });
  }, timing);
  failed.configure('test-token'); failed.startTest();
  const state = await finished(failed);
  assert.equal(state.test?.phase, 'unconfirmed'); assert.equal(state.test.delivery, 'unknown');
  assert.equal(posts, 1); assert.ok(!JSON.stringify(state).includes('test-token'));

  let resolve!: (value: Response) => void;
  const client = new WorkBuddyLocal(() => new Promise(done => { resolve = done; }), timing);
  client.configure('old-token'); client.startTest();
  client.configure('new-token');
  resolve(json({ data: { online: true } }));
  await new Promise(done => setTimeout(done, 5));
  assert.equal(client.status().connection, 'unchecked'); assert.equal(client.status().test, undefined);
});

test('WorkBuddy cancellation stops polling without claiming to cancel the remote assistant', async () => {
  let calls = 0;
  const client = new WorkBuddyLocal(async (url, init) => {
    calls++;
    if (init.method === 'POST') return json({ data: { message_id: 'sent-1' } });
    return json({ data: url.includes('/message') ? { messages: [] } : { online: true } });
  }, { ...timing, pollMs: 30 });
  client.configure('test-token'); client.startTest();
  while (client.status().test?.phase !== 'waiting') await new Promise(resolve => setTimeout(resolve, 1));
  const result = client.cancel();
  assert.equal(result.test?.phase, 'cancelled'); assert.match(result.test.detail, /不能取消/);
  const count = calls; await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(calls, count);
  client.configure(''); assert.equal(client.status().configured, false);
  client.close(); assert.throws(() => client.configure('token'), /关闭/);
});
