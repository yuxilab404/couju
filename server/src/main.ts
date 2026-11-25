/** 入口：读配置、开库、起 HTTP + WebSocket。 */
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { Accounts } from './accounts.ts';
import { attachWebSocket, createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { createMailer } from './mailer.ts';
import { Rooms } from './rooms.ts';

const cfg = loadConfig();
if (cfg.dev && cfg.baseUrl.startsWith('https://')) {
  // 开发模式会开放取验证码的接口，绝不能在线上开
  console.error('[couju] COUJU_DEV=1 不能和 https 的 COUJU_BASE_URL 一起用，拒绝启动');
  process.exit(1);
}
const db = new Db(join(cfg.dataDir, 'couju.db'));
const mailer = createMailer(cfg);
const accounts = new Accounts(db, cfg, mailer);
const rooms = new Rooms({ log: console.log });
const app = createApp({ cfg, accounts, rooms, devOutbox: mailer.devOutbox });

const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  console.log(`[couju] build=${cfg.buildId} 监听 ${info.address}:${info.port}，前端 ${cfg.webDir}`);
  if (cfg.adminEmails.size === 0) console.warn('[couju] 没有配置 COUJU_ADMIN_EMAILS，没人能管理白名单');
}) as Server;
const ws = attachWebSocket(server, accounts, rooms, cfg.basePath);
accounts.onSessionsRevoked = ws.revalidate;
// 会话过期也要断开，每分钟查一次（几十条连接，开销可以忽略）
setInterval(ws.revalidate, 60_000).unref();

setInterval(() => rooms.sweep(), 5_000).unref();
setInterval(() => accounts.sweep(), 3_600_000).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[couju] 收到 ${sig}，退出`);
    server.close();
    db.raw.close();
    process.exit(0);
  });
}
