/** SQLite 数据层（node:sqlite）。数据量是几十个用户，单连接同步调用足够。 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  avatar BLOB,
  avatar_type TEXT NOT NULL DEFAULT '',
  avatar_ver INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS allowed_emails (
  email TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  remark TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_codes_created ON login_codes(created_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export type Row = Record<string, unknown>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.raw.exec(SCHEMA);
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...(params as never[]));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }
}

/** 北京时间当天 0 点的 UTC 毫秒，用于"每日上限" */
export function startOfDayCst(now: number): number {
  const offset = 8 * 3_600_000;
  return Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset;
}
