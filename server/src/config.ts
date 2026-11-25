/** 运行配置：全部走环境变量，敏感项不落库不落代码。 */
import { resolve } from 'node:path';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  baseUrl: string;
  /** 对外路径前缀，以 / 结尾，例如 '/game/'；由 baseUrl 推出 */
  basePath: string;
  adminEmails: Set<string>;
  resendApiKey: string;
  mailFrom: string;
  dev: boolean;
  buildId: string;
}

export function loadConfig(): Config {
  const dataDir = resolve(env('COUJU_DATA_DIR', '.data'));
  const baseUrl = env('COUJU_BASE_URL', 'http://127.0.0.1:8790').replace(/\/+$/, '');
  return {
    host: env('COUJU_HOST', '127.0.0.1'),
    port: Number(env('COUJU_PORT', '8790')),
    dataDir,
    webDir: resolve(env('COUJU_WEB_DIR', 'dist/web')),
    baseUrl,
    basePath: basePathOf(baseUrl),
    adminEmails: new Set(
      env('COUJU_ADMIN_EMAILS')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    resendApiKey: env('RESEND_API_KEY'),
    mailFrom: env('MAIL_FROM', '凑局 <no-reply@example.com>'),
    dev: env('COUJU_DEV') === '1',
    buildId: env('COUJU_BUILD_ID', 'dev'),
  };
}

export function basePathOf(baseUrl: string): string {
  const p = new URL(baseUrl).pathname.replace(/\/+$/, '');
  return `${p}/`;
}

/** 验证码与会话参数，沿用 auto-tiandao-sign（ADR-0004） */
export const AUTH = {
  codeTtlMs: 10 * 60_000,
  resendIntervalMs: 60_000,
  codeDailyLimit: 10,
  ipDailyLimit: 20,
  globalDailyLimit: 50,
  maxAttempts: 5,
  sessionTtlMs: 30 * 86_400_000,
  cookieName: 'couju_session',
} as const;
