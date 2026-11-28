/** 固定上游 DanZero 的本地持久进程接口。只传递公开 View；出错直接失败。 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { interpret } from '../../../src/patterns.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const lab = process.env.DANZERO_LAB ?? fileURLToPath(new URL('../../../.baseline/external-danzero/', import.meta.url));
const fields = ['me', 'opts', 'phase', 'hand', 'counts', 'handNo', 'level', 'levelTeam', 'teamLevels', 'aFails', 'turn', 'lastPlay', 'recent', 'history', 'finished', 'tribute', 'ready', 'winnerTeam'];

export async function createOpponent() {
  const python = process.env.DANZERO_PYTHON ?? join(lab, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const child = spawn(python, ['-u', join(here, 'worker.py')], {
    cwd: here, windowsHide: true,
    env: { ...process.env, DANZERO_LAB: lab, PYTHONHASHSEED: '0', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let serial = 0, stderr = '', closed = false;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const rejectAll = (error) => {
    readyReject(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (s) => { stderr = (stderr + s).slice(-12000); });
  child.on('error', rejectAll);
  child.on('exit', (code, signal) => {
    if (!closed || pending.size) rejectAll(new Error(`DanZero worker exited (${code ?? signal}): ${stderr}`));
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { rejectAll(new Error(`Invalid DanZero JSON: ${line}`)); return; }
    if (value.ready) { readyResolve(value); return; }
    const entry = pending.get(value.id);
    if (!entry) return;
    pending.delete(value.id);
    if (value.error) entry.reject(new Error(`DanZero: ${value.error}\n${stderr}`));
    else entry.resolve(value);
  });
  const startupTimeout = setTimeout(() => { rejectAll(new Error(`DanZero startup timed out: ${stderr}`)); child.kill(); }, 60000);
  const info = await ready.finally(() => clearTimeout(startupTimeout));
  let stats = { decisions: 0, candidateCount: 0, ms: 0 };
  const request = async (v, enumerateOnly = false) => {
    if (closed) throw new Error('DanZero opponent is closed');
    // 按允许列表复制；即便调用者传入 State，也不会把其他人的手牌传给 Python。
    if ('hands' in v) throw new Error('DanZero accepts public View only');
    const publicView = Object.fromEntries(fields.map((key) => [key, v[key]]));
    const id = ++serial;
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, view: publicView, enumerateOnly }) + '\n', (err) => {
        if (err) { pending.delete(id); reject(err); }
      });
    });
  };
  return {
    info,
    get stats() { return stats; },
    async decide(v) {
      const result = await request(v);
      const a = result.action;
      if (a.type === 'play' && !interpret(a.cards, v.level, v.lastPlay, a.as)) throw new Error(`DanZero produced an incompatible action: ${JSON.stringify(a)}`);
      stats = { decisions: stats.decisions + 1, candidateCount: stats.candidateCount + result.candidateCount, ms: stats.ms + result.ms, last: result };
      return a;
    },
    async enumerate(v) { return (await request(v, true)).actions; },
    close() {
      closed = true;
      rejectAll(new Error('DanZero opponent closed'));
      child.stdin.end();
      child.kill();
      lines.close();
    },
  };
}
