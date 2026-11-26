/**
 * 重启交接文件（ADR-0006）：收到 SIGTERM 时把房间表写盘，下一个进程启动时读回并立刻删除。
 * 读不懂、太旧、坏了都直接丢弃，退回"重启房间就没了"。
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { RoomsHandoff } from './rooms.ts';

/** 超过这么久的交接文件不认：不是刚才那次重启留下的 */
export const HANDOFF_MAX_AGE_MS = 120_000;

export function saveHandoff(path: string, h: RoomsHandoff): void {
  const tmp = `${path}.tmp`;
  // 里面有快照（所有人的手牌），只给自己读
  writeFileSync(tmp, JSON.stringify(h), { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadHandoff(path: string, now: number, log: (m: string) => void = () => {}): RoomsHandoff | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  rmSync(path, { force: true });
  try {
    const h = JSON.parse(raw) as RoomsHandoff;
    if (h?.v !== 1 || typeof h.writtenAt !== 'number' || !Array.isArray(h.rooms)) {
      log('[handoff] 格式不认得，丢弃');
      return null;
    }
    const age = now - h.writtenAt;
    if (age < 0 || age > HANDOFF_MAX_AGE_MS) {
      log(`[handoff] 文件是 ${Math.round(age / 1000)} 秒前写的，太旧，丢弃`);
      return null;
    }
    return h;
  } catch {
    log('[handoff] 文件坏了，丢弃');
    return null;
  }
}
