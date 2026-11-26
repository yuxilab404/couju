import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from './db.ts';
import { eloDeltas, parseReport, Ratings, ReportError } from './ratings.ts';

let db: Db;
let ratings: Ratings;
let t = 1000;

function addUser(id: number) {
  db.run('INSERT INTO users(id, email, nickname, created_at) VALUES (?,?,?,?)', id, `u${id}@x.com`, `u${id}`, 0);
}

beforeEach(() => {
  db = new Db(':memory:');
  ratings = new Ratings(db, () => t++);
  for (const id of [1, 2, 3, 4]) addUser(id);
});

const p = (id: number, rating = 1200) => ({ id, rating });

describe('eloDeltas', () => {
  it('1v1 水平相当：赢 +16，输 -16', () => {
    expect([...eloDeltas([p(1)], [p(2)], 1)]).toEqual([[1, 16], [2, -16]]);
  });

  it('斗地主 1v2：地主赢两个农民拿双份，零和', () => {
    const d = eloDeltas([p(1)], [p(2), p(3)], 1);
    expect(d.get(1)).toBe(21);
    expect(d.get(2)).toBe(-11);
    expect(d.get(3)).toBe(-11);
    // 农民赢：每个农民赢地主一场
    const f = eloDeltas([p(2), p(3)], [p(1)], 1);
    expect(f.get(2)).toBe(11);
    expect(f.get(1)).toBe(-21);
  });

  it('2v2：每人 ±16', () => {
    expect([...eloDeltas([p(1), p(2)], [p(3), p(4)], 1).values()]).toEqual([16, 16, -16, -16]);
  });

  it('分高的人赢分低的人拿得少，输了丢得多', () => {
    const win = eloDeltas([p(1, 1400)], [p(2, 1200)], 1).get(1)!;
    const lose = eloDeltas([p(2, 1200)], [p(1, 1400)], 1).get(1)!;
    expect(win).toBeLessThan(16);
    expect(-lose).toBeGreaterThan(16);
  });

  it('分量按比例放大；0 或没有对手不计分', () => {
    expect(eloDeltas([p(1)], [p(2)], 2).get(1)).toBe(32);
    expect(eloDeltas([p(1)], [p(2)], 0).size).toBe(0);
    expect(eloDeltas([p(1)], [], 1).size).toBe(0);
  });
});

describe('parseReport', () => {
  const ok = { matchId: 'abcdef0123456789', gameId: 'doudizhu', weight: 1, winners: [1], losers: [2] };
  it('合法的原样通过，分量夹到 [0, 3]', () => {
    expect(parseReport(ok)).toEqual(ok);
    expect(parseReport({ ...ok, weight: 99 }).weight).toBe(3);
    expect(parseReport({ ...ok, weight: -1 }).weight).toBe(0);
  });
  it('形状不对就拒绝', () => {
    for (const bad of [null, { ...ok, matchId: 'x' }, { ...ok, gameId: '' }, { ...ok, weight: 'a' }, { ...ok, winners: 'x' },
      { ...ok, winners: [1], losers: [1] }, { ...ok, losers: Array.from({ length: 13 }, (_, i) => i + 10) }]) {
      expect(() => parseReport(bad)).toThrow(ReportError);
    }
  });
});

describe('Ratings', () => {
  const report = (matchId: string, winners: number[], losers: number[], weight = 1) => ({ matchId, gameId: 'toy', weight, winners, losers });

  it('新账号 1200；记一局后积分、历史、局数跟着变', () => {
    expect(ratings.current([1, 2])).toEqual(new Map([[1, 1200], [2, 1200]]));
    const r = ratings.record(report('m-00000001', [1], [2]));
    expect(r).toEqual({ matchId: 'm-00000001', changes: [{ userId: 1, before: 1200, after: 1216 }, { userId: 2, before: 1200, after: 1184 }] });
    expect(ratings.current([1, 2])).toEqual(new Map([[1, 1216], [2, 1184]]));
    ratings.record(report('m-00000002', [2], [1]));
    const h = ratings.history(1);
    expect(h.map((x) => [x.won, x.before, x.after])).toEqual([[false, 1216, 1199], [true, 1200, 1216]]);
    expect(ratings.stats(1)).toEqual({ games: 2, wins: 1 });
  });

  it('同一个 matchId 只记一次，重报回第一次的结果', () => {
    const first = ratings.record(report('m-00000001', [1], [2]));
    ratings.record(report('m-00000002', [1], [2]));
    expect(ratings.record(report('m-00000001', [1], [2]))).toEqual(first);
    expect(ratings.stats(1).games).toBe(2);
  });

  it('不存在的用户略过，其他人照常计分', () => {
    const r = ratings.record(report('m-00000001', [1], [2, 99]));
    expect(r.changes.map((c) => c.userId)).toEqual([1, 2]);
    expect(r.changes[0].after).toBe(1216);
  });
});
