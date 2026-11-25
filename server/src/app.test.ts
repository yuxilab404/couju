import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMsg } from '@couju/protocol';
import { Accounts } from './accounts.ts';
import { attachWebSocket, createApp } from './app.ts';
import { Db } from './db.ts';
import { Rooms } from './rooms.ts';
import { FakeMailer, testConfig } from './testutil.ts';

let base = '';
let adminCookie = '';
let server: Server;
const mailer = new FakeMailer();

beforeAll(async () => {
  const web = mkdtempSync(join(tmpdir(), 'couju-web-'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>凑局</title>');
  const cfg = testConfig({ webDir: web });
  const accounts = new Accounts(new Db(':memory:'), cfg, mailer);
  const rooms = new Rooms();
  const app = createApp({ cfg, accounts, rooms });
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }) as Server;
  attachWebSocket(server, accounts, rooms);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminCookie = await loginCookie('admin@x.com');
});
afterAll(() => server.close());

async function loginCookie(email: string): Promise<string> {
  await fetch(`${base}/api/auth/code`, { method: 'POST', body: JSON.stringify({ email }), headers: { 'content-type': 'application/json' } });
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST', body: JSON.stringify({ email, code: mailer.lastCode(email) }), headers: { 'content-type': 'application/json' },
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

function openWs(cookie?: string): Promise<{ ws: WebSocket; msgs: ServerMsg[] } | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: cookie ? { cookie } : {} });
    const msgs: ServerMsg[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => setTimeout(() => resolve({ ws, msgs }), 50));
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
  });
}

describe('HTTP + WS', () => {
  it('health 不需要登录', async () => {
    const r = await (await fetch(`${base}/api/health`)).json();
    expect(r).toMatchObject({ ok: true, rooms: 0 });
  });

  it('未登录 /api/me 返回 401；页面返回 SPA 入口', async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    const page = await fetch(`${base}/room/abc`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('凑局');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('登录后拿到资料，能改昵称', async () => {
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: adminCookie } })).json();
    expect(me.me).toMatchObject({ email: 'admin@x.com', isAdmin: true });
    const r = await fetch(`${base}/api/me`, {
      method: 'PATCH', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '老大' }),
    });
    expect((await r.json()).me.nickname).toBe('老大');
  });

  it('管理员加白名单；被加的人能登录但不能管理白名单', async () => {
    const email = `f${Date.now()}@x.com`;
    const add = await fetch(`${base}/api/admin/whitelist`, {
      method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' }, body: JSON.stringify({ email, remark: '测试' }),
    });
    expect(await add.json()).toEqual({ mailSent: true });
    const friend = await loginCookie(email);
    expect((await fetch(`${base}/api/admin/whitelist`, { headers: { cookie: friend } })).status).toBe(403);
  });

  it('WebSocket 无 cookie 拒绝；有 cookie 收到 hello，能建房', async () => {
    expect(await openWs()).toBe(401);
    const r = await openWs(adminCookie);
    if (typeof r === 'number') throw new Error(`ws ${r}`);
    expect(r.msgs[0]).toMatchObject({ t: 'hello', me: { email: 'admin@x.com' } });
    r.ws.send(JSON.stringify({ t: 'room.create', meta: { title: 't' } }));
    await new Promise((res) => setTimeout(res, 50));
    expect(r.msgs.some((m) => m.t === 'room.state')).toBe(true);
    r.ws.close();
  });
});
