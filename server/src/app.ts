/** HTTP 路由 + WebSocket 接入。 */
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS, WS_PATH, type ClientMsg, type ServerMsg } from '@couju/protocol';
import { Accounts, toMe, toPublic, type UserRow } from './accounts.ts';
import { AUTH, type Config } from './config.ts';
import { HttpError } from './errors.ts';
import { Rooms, type Conn } from './rooms.ts';

type Env = { Variables: { user: UserRow; ip: string } };

export interface AppDeps {
  cfg: Config;
  accounts: Accounts;
  rooms: Rooms;
  /** 仅开发模式：取最近一封邮件里的验证码 */
  devOutbox?: Map<string, string>;
}

function clientIp(c: Context, fallback = ''): string {
  // 只监听 127.0.0.1，前面一定是 Caddy；取 X-Forwarded-For 最后一跳（Caddy 追加的那个）
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',').pop()!.trim();
  return fallback;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, '请求格式不正确');
  }
}

export function createApp({ cfg, accounts, rooms, devOutbox }: AppDeps) {
  const app = new Hono<Env>();
  const secure = cfg.baseUrl.startsWith('https://');

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error('[http]', err);
    return c.json({ error: '服务器出错了' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, build: cfg.buildId, ...rooms.stats() }));

  if (cfg.dev && devOutbox) {
    app.get('/api/dev/last-code', (c) => {
      const html = devOutbox.get(String(c.req.query('email') ?? '').toLowerCase()) ?? '';
      return c.json({ code: /(\d{6})/.exec(html)?.[1] ?? null });
    });
  }

  app.post('/api/auth/code', async (c) => {
    const b = await body(c);
    await accounts.requestCode(b.email, clientIp(c));
    return c.json({ ok: true });
  });

  app.post('/api/auth/verify', async (c) => {
    const b = await body(c);
    const { token, user } = accounts.verifyCode(b.email, b.code);
    setCookie(c, AUTH.cookieName, token, {
      httpOnly: true, sameSite: 'Lax', secure, path: cfg.basePath, maxAge: AUTH.sessionTtlMs / 1000,
    });
    return c.json({ me: toMe(user) });
  });

  app.post('/api/auth/logout', (c) => {
    accounts.logout(getCookie(c, AUTH.cookieName));
    deleteCookie(c, AUTH.cookieName, { path: cfg.basePath });
    return c.json({ ok: true });
  });

  // 以下全部要求登录
  const login = createMiddleware<Env>(async (c, next) => {
    const user = accounts.userBySession(getCookie(c, AUTH.cookieName));
    if (!user) throw new HttpError(401, '未登录');
    c.set('user', user);
    await next();
  });
  const adminOnly = createMiddleware<Env>(async (c, next) => {
    if (!c.get('user').is_admin) throw new HttpError(403, '需要管理员权限');
    await next();
  });

  app.get('/api/me', login, (c) => c.json({ me: toMe(c.get('user')) }));

  app.patch('/api/me', login, async (c) => {
    const b = await body(c);
    const user = accounts.setNickname(c.get('user').id, b.nickname);
    rooms.updateUser(toPublic(user));
    return c.json({ me: toMe(user) });
  });

  app.put('/api/me/avatar', login, async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > 64 * 1024) throw new HttpError(413, '头像不能超过 64 KB');
    const data = new Uint8Array(await c.req.arrayBuffer());
    const user = accounts.setAvatar(c.get('user').id, data);
    rooms.updateUser(toPublic(user));
    return c.json({ me: toMe(user) });
  });

  app.delete('/api/me/avatar', login, (c) => {
    const user = accounts.setAvatar(c.get('user').id, null);
    rooms.updateUser(toPublic(user));
    return c.json({ me: toMe(user) });
  });

  app.get('/avatars/:id', login, (c) => {
    const a = accounts.avatar(Number(c.req.param('id')));
    if (!a) throw new HttpError(404, '没有头像');
    return c.body(new Uint8Array(a.data), 200, {
      'Content-Type': a.type,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  const WL = '/api/admin/whitelist';
  app.get(WL, login, adminOnly, (c) => c.json({ entries: accounts.whitelist(), admins: [...cfg.adminEmails] }));
  app.post(WL, login, adminOnly, async (c) => {
    const b = await body(c);
    return c.json(await accounts.addToWhitelist(b.email, b.remark, c.get('user')));
  });
  app.patch(`${WL}/:email`, login, adminOnly, async (c) => {
    const b = await body(c);
    accounts.updateWhitelist(decodeURIComponent(c.req.param('email')), { enabled: b.enabled, remark: b.remark });
    return c.json({ ok: true });
  });

  // 静态文件：前端在挂载目录里，换文件不重启（ADR-0005）
  app.get('*', (c) => serveStatic(c, cfg.webDir, cfg.basePath));

  // 站点可以挂在子路径下（例如 https://miao.zyzl.link/game/）：带前缀的请求先去掉前缀；
  // 不带前缀的也照常处理，方便本机健康检查
  const prefix = cfg.basePath.replace(/\/$/, '');
  return {
    fetch(req: Request): Response | Promise<Response> {
      if (!prefix) return app.fetch(req);
      const url = new URL(req.url);
      // 用相对地址跳转：前面是 Caddy，服务端看到的是 http，拼绝对地址会把 https 降成 http
      if (url.pathname === prefix) return new Response(null, { status: 308, headers: { Location: `${prefix}/${url.search}` } });
      if (url.pathname.startsWith(prefix + '/')) {
        url.pathname = url.pathname.slice(prefix.length);
        return app.fetch(new Request(url, req));
      }
      return app.fetch(req);
    },
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(c: Context, root: string, basePath: string): Promise<Response> {
  const path = decodeURIComponent(new URL(c.req.url).pathname);
  if (path.startsWith('/api/') || path === WS_PATH) return c.json({ error: '不存在' }, 404);
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root) + sep) && file !== normalize(root)) return c.text('forbidden', 403);
  try {
    const st = await stat(file);
    if (st.isFile() && !file.endsWith(`${sep}index.html`)) {
      const hashed = path.startsWith('/assets/');
      return c.body(new Uint8Array(await readFile(file)), 200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    }
  } catch {
    /* 落到 SPA 入口 */
  }
  if (path.startsWith('/assets/')) return c.text('not found', 404);
  try {
    // 页面里的资源和接口都用相对地址，靠 <base href> 指到站点前缀
    const html = (await readFile(join(root, 'index.html'), 'utf8')).replace('<base href="/" />', `<base href="${basePath}" />`);
    return c.body(html, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  } catch {
    return c.text('前端还没有部署', 503);
  }
}

/**
 * 把 WebSocket 接到 http server 的 upgrade 上，用登录 cookie 鉴权。
 * 返回 revalidate()：重新检查每条连接的会话，失效的（停用白名单、退出登录、过期）立即断开。
 */
export function attachWebSocket(
  server: Server,
  accounts: Accounts,
  rooms: Rooms,
  basePath = '/',
): { wss: WebSocketServer; revalidate: () => void } {
  const wsPaths = new Set([WS_PATH, basePath.replace(/\/$/, '') + WS_PATH]);
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMessageBytes });
  const live = new Map<WebSocket, { token: string; conn: Conn }>();
  let nextId = 1;

  const revalidate = () => {
    for (const [ws, { token, conn }] of live) {
      if (accounts.userBySession(token)) continue;
      live.delete(ws);
      rooms.disconnect(conn);
      // 4401：登录已失效，前端会转去登录页
      ws.close(4401, 'unauthorized');
    }
  };

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!wsPaths.has(url.pathname)) return socket.destroy();
    const token = parseCookie(req.headers.cookie ?? '')[AUTH.cookieName];
    const user = accounts.userBySession(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const conn: Conn = {
        id: nextId++,
        user: toPublic(user),
        send(msg: ServerMsg) {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        },
        close() {
          ws.terminate();
        },
      };
      live.set(ws, { token: token!, conn });
      rooms.connect(conn);
      conn.send({ t: 'hello', me: toMe(user) });
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return conn.send({ t: 'error', code: 'bad_request', message: '不是 JSON' });
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') {
          return conn.send({ t: 'error', code: 'bad_request', message: '缺少 t' });
        }
        rooms.handle(conn, msg);
      });
      const gone = () => {
        live.delete(ws);
        rooms.disconnect(conn);
      };
      ws.on('close', gone);
      ws.on('error', gone);
    });
  });
  return { wss, revalidate };
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
