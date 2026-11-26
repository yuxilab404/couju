import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANDOFF_MAX_AGE_MS, loadHandoff, saveHandoff } from './handoff.ts';
import type { RoomsHandoff } from './rooms.ts';

const h = (writtenAt: number): RoomsHandoff => ({ v: 1, writtenAt, joinSeq: 3, rooms: [] });
const file = () => join(mkdtempSync(join(tmpdir(), 'couju-handoff-')), 'rooms-handoff.json');

describe('交接文件', () => {
  it('写盘只给自己读；读回后立刻删除，第二次读不到', () => {
    const p = file();
    saveHandoff(p, h(1000));
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(loadHandoff(p, 2000)).toEqual(h(1000));
    expect(existsSync(p)).toBe(false);
    expect(loadHandoff(p, 2000)).toBeNull();
  });

  it('太旧、版本不认得、坏文件都丢弃，并删掉', () => {
    for (const content of [JSON.stringify(h(0)), JSON.stringify({ ...h(1000), v: 2 }), '{oops']) {
      const p = file();
      writeFileSync(p, content);
      expect(loadHandoff(p, HANDOFF_MAX_AGE_MS + 1)).toBeNull();
      expect(existsSync(p)).toBe(false);
    }
  });

  it('没有文件就是正常冷启动', () => {
    expect(loadHandoff(file(), 0)).toBeNull();
  });
});
