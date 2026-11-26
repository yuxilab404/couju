/**
 * 账号：邮箱验证码登录、会话、白名单、资料（ADR-0004）。
 * 流程与参数照 yuxilab404/auto-tiandao-sign 的 web/auth.py。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Me, PublicUser } from '@couju/protocol';
import { AUTH, type Config } from './config.ts';
import { startOfDayCst, type Db } from './db.ts';
import { HttpError } from './errors.ts';
import { RATING_COL } from './ratings.ts';
import { invitationMail, loginCodeMail, type Mailer } from './mailer.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface UserRow {
  id: number;
  email: string;
  nickname: string;
  avatar_ver: number;
  has_avatar: number;
  is_admin: number;
  created_at: number;
  rating: number;
}

export interface WhitelistEntry {
  email: string;
  enabled: boolean;
  remark: string;
  addedBy: string;
  createdAt: number;
  /** 是否已经登录过 */
  registered: boolean;
  nickname: string | null;
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    nickname: u.nickname,
    // 相对地址，由页面的 <base href> 解析，站点挂在子路径下也能用
    // 版本号只增不减：删掉再传也不会复用旧的缓存地址
    avatarUrl: u.has_avatar ? `avatars/${u.id}?v=${u.avatar_ver}` : null,
    rating: u.rating,
  };
}

export function toMe(u: UserRow): Me {
  return { ...toPublic(u), email: u.email, isAdmin: !!u.is_admin };
}

const USER_COLS = `id, email, nickname, avatar_ver, (avatar IS NOT NULL) AS has_avatar, is_admin, created_at, ${RATING_COL}`;

export class Accounts {
  constructor(
    private db: Db,
    private cfg: Config,
    private mailer: Mailer,
    private now: () => number = Date.now,
  ) {}

  isAllowed(email: string): boolean {
    if (this.cfg.adminEmails.has(email)) return true;
    return !!this.db.get('SELECT 1 FROM allowed_emails WHERE email=? AND enabled=1', email);
  }

  async requestCode(rawEmail: unknown, ip: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确');
    // 防枚举：不在白名单时与成功返回一致，不发信
    if (!this.isAllowed(email)) return;
    const now = this.now();
    const today = startOfDayCst(now);
    const last = this.db.get<{ created_at: number }>(
      'SELECT created_at FROM login_codes WHERE email=? ORDER BY id DESC LIMIT 1',
      email,
    );
    if (last && now - last.created_at < AUTH.resendIntervalMs) throw new HttpError(429, '发送太频繁，请稍后再试');
    const count = (sql: string, ...p: unknown[]) => this.db.get<{ n: number }>(sql, ...p)!.n;
    if (count('SELECT COUNT(*) AS n FROM login_codes WHERE email=? AND created_at>=?', email, today) >= AUTH.codeDailyLimit)
      throw new HttpError(429, '该邮箱今日验证码次数已达上限');
    if (ip && count('SELECT COUNT(*) AS n FROM login_codes WHERE ip=? AND created_at>=?', ip, today) >= AUTH.ipDailyLimit)
      throw new HttpError(429, '请求过于频繁，请明天再试');
    if (count('SELECT COUNT(*) AS n FROM login_codes WHERE created_at>=?', today) >= AUTH.globalDailyLimit)
      throw new HttpError(429, '系统繁忙，请明天再试');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.db.run(
      'INSERT INTO login_codes(email, code, ip, expires_at, created_at) VALUES (?,?,?,?,?)',
      email, code, ip, now + AUTH.codeTtlMs, now,
    );
    const [subject, html] = loginCodeMail(code);
    // 发送失败必须让用户知道，不能假装成功
    if (!(await this.mailer.send(email, subject, html))) throw new HttpError(502, '验证码邮件发送失败，请稍后再试或联系管理员');
  }

  /** 校验通过返回新会话 token */
  verifyCode(rawEmail: unknown, rawCode: unknown): { token: string; user: UserRow } {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode ?? '').trim();
    const now = this.now();
    const row = this.db.get<{ id: number; code: string; expires_at: number; attempts: number }>(
      'SELECT id, code, expires_at, attempts FROM login_codes WHERE email=? AND used=0 ORDER BY id DESC LIMIT 1',
      email,
    );
    if (!row || row.expires_at < now) throw new HttpError(400, '验证码已过期，请重新获取');
    if (row.attempts >= AUTH.maxAttempts) throw new HttpError(429, '尝试次数过多，请重新获取验证码');
    if (row.code !== code) {
      this.db.run('UPDATE login_codes SET attempts=attempts+1 WHERE id=?', row.id);
      throw new HttpError(400, '验证码不正确');
    }
    this.db.run('UPDATE login_codes SET used=1 WHERE id=?', row.id);
    // 发码后被移出白名单的情况
    if (!this.isAllowed(email)) throw new HttpError(403, '该邮箱已不在白名单中');

    const isAdmin = this.cfg.adminEmails.has(email) ? 1 : 0;
    let user = this.db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email=?`, email);
    if (!user) {
      const nickname = email.split('@')[0].slice(0, 16) || '新朋友';
      const { lastId } = this.db.run(
        'INSERT INTO users(email, nickname, is_admin, created_at) VALUES (?,?,?,?)',
        email, nickname, isAdmin, now,
      );
      user = this.userById(lastId)!;
    } else if (user.is_admin !== isAdmin) {
      // 管理员只认配置：配置变了就跟着变
      this.db.run('UPDATE users SET is_admin=? WHERE id=?', isAdmin, user.id);
      user = this.userById(user.id)!;
    }
    const token = randomBytes(32).toString('base64url');
    this.db.run(
      'INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)',
      hashToken(token), user.id, now + AUTH.sessionTtlMs, now,
    );
    return { token, user };
  }

  userBySession(token: string | undefined): UserRow | null {
    if (!token) return null;
    const row = this.db.get<{ user_id: number; expires_at: number }>(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash=?',
      hashToken(token),
    );
    if (!row || row.expires_at < this.now()) return null;
    const user = this.userById(row.user_id);
    if (!user || !this.isAllowed(user.email)) return null;
    // 管理员只认当前配置：配置改了，已有会话立即跟着变
    const isAdmin = this.cfg.adminEmails.has(user.email) ? 1 : 0;
    if (user.is_admin !== isAdmin) {
      this.db.run('UPDATE users SET is_admin=? WHERE id=?', isAdmin, user.id);
      user.is_admin = isAdmin;
    }
    return user;
  }

  logout(token: string | undefined): void {
    if (token) this.db.run('DELETE FROM sessions WHERE token_hash=?', hashToken(token));
    this.onSessionsRevoked?.();
  }

  /** 有会话被撤销时调用（停用白名单、退出登录），WebSocket 层据此断开失效的连接 */
  onSessionsRevoked?: () => void;

  userById(id: number): UserRow | undefined {
    return this.db.get<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id=?`, id);
  }

  setNickname(userId: number, raw: unknown): UserRow {
    const nickname = String(raw ?? '').trim().replace(/\s+/g, ' ');
    const len = [...nickname].length;
    if (len < 1 || len > 16) throw new HttpError(400, '昵称需要 1–16 个字');
    this.db.run('UPDATE users SET nickname=? WHERE id=?', nickname, userId);
    return this.userById(userId)!;
  }

  setAvatar(userId: number, data: Uint8Array | null): UserRow {
    if (data === null) {
      this.db.run("UPDATE users SET avatar=NULL, avatar_type='' WHERE id=?", userId);
      return this.userById(userId)!;
    }
    if (data.byteLength > 64 * 1024) throw new HttpError(413, '头像不能超过 64 KB');
    const type = sniffImage(data);
    if (!type) throw new HttpError(415, '头像只支持 WebP、PNG 或 JPEG');
    this.db.run(
      'UPDATE users SET avatar=?, avatar_type=?, avatar_ver=avatar_ver+1 WHERE id=?',
      data, type, userId,
    );
    return this.userById(userId)!;
  }

  avatar(userId: number): { data: Uint8Array; type: string } | null {
    const row = this.db.get<{ avatar: Uint8Array | null; avatar_type: string }>(
      'SELECT avatar, avatar_type FROM users WHERE id=?',
      userId,
    );
    return row?.avatar ? { data: row.avatar, type: row.avatar_type } : null;
  }

  // ---- 白名单（管理员） ----

  whitelist(): WhitelistEntry[] {
    return this.db
      .all<{ email: string; enabled: number; remark: string; added_by: string; created_at: number; nickname: string | null }>(
        `SELECT a.email, a.enabled, a.remark, a.added_by, a.created_at, u.nickname
         FROM allowed_emails a LEFT JOIN users u ON u.email = a.email ORDER BY a.created_at`,
      )
      .map((r) => ({
        email: r.email,
        enabled: !!r.enabled,
        remark: r.remark,
        addedBy: r.added_by,
        createdAt: r.created_at,
        registered: r.nickname !== null,
        nickname: r.nickname,
      }));
  }

  /** 加入白名单并发邀请邮件；返回邮件是否发出 */
  async addToWhitelist(rawEmail: unknown, rawRemark: unknown, admin: UserRow): Promise<{ mailSent: boolean }> {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确');
    const remark = String(rawRemark ?? '').trim().slice(0, 100);
    this.db.run(
      `INSERT INTO allowed_emails(email, enabled, remark, added_by, created_at) VALUES (?,1,?,?,?)
       ON CONFLICT(email) DO UPDATE SET enabled=1, remark=CASE WHEN excluded.remark<>'' THEN excluded.remark ELSE allowed_emails.remark END`,
      email, remark, admin.email, this.now(),
    );
    const [subject, html] = invitationMail(this.cfg.baseUrl);
    return { mailSent: await this.mailer.send(email, subject, html) };
  }

  updateWhitelist(rawEmail: unknown, patch: { enabled?: unknown; remark?: unknown }): void {
    const email = normalizeEmail(rawEmail);
    if (!this.db.get('SELECT 1 FROM allowed_emails WHERE email=?', email)) throw new HttpError(404, '白名单里没有这个邮箱');
    if (patch.remark !== undefined) {
      this.db.run('UPDATE allowed_emails SET remark=? WHERE email=?', String(patch.remark).trim().slice(0, 100), email);
    }
    if (patch.enabled !== undefined) {
      const enabled = patch.enabled ? 1 : 0;
      this.db.run('UPDATE allowed_emails SET enabled=? WHERE email=?', enabled, email);
      if (!enabled) {
        // 停用 = 立即踢掉所有会话
        this.db.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)', email);
        this.onSessionsRevoked?.();
      }
    }
  }

  /** 定期清理过期数据 */
  sweep(): void {
    const now = this.now();
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    this.db.run('DELETE FROM login_codes WHERE created_at < ?', now - 7 * 86_400_000);
  }
}

function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (b.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (b.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length > 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  return null;
}
