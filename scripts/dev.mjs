#!/usr/bin/env node
/**
 * 本地开发：起服务端（COUJU_DEV=1，验证码打到日志）+ Vite。
 * 打开 http://127.0.0.1:5173 ，用 COUJU_ADMIN_EMAILS 里的邮箱登录（默认 dev@example.com）。
 */
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  COUJU_DEV: '1',
  COUJU_ADMIN_EMAILS: process.env.COUJU_ADMIN_EMAILS ?? 'dev@example.com',
  COUJU_DATA_DIR: process.env.COUJU_DATA_DIR ?? '.data',
};
const procs = [
  spawn('node', ['--watch', '--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/run-server.mjs'], { stdio: 'inherit', env }),
  spawn('npx', ['vite', 'web'], { stdio: 'inherit', env }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
