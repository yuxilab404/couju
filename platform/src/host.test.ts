import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchReport, Member } from '@couju/protocol';
import { HostEngine, type HostIO } from './host.ts';
import { toy } from './toygame.test-helper.ts';
import type { Checkpoint, ToMember } from './wire.ts';

const member = (id: number, connected = true): Member => ({ id, nickname: `u${id}`, avatarUrl: null, rating: 1200, connected, joinedAt: id });

class IO implements HostIO {
  myId = 1;
  buildId = 'b1';
  inbox = new Map<number, ToMember[]>();
  checkpoint = '';
  meta: unknown = null;
  notices: string[] = [];
  reports: MatchReport[] = [];
  online = true;
  reportRating(r: MatchReport) { if (this.online) this.reports.push(r); return this.online; }
  sendTo(id: number, m: ToMember) { this.push(id, m); }
  deliverLocal(m: ToMember) { this.push(this.myId, m); }
  setMeta(m: unknown) { this.meta = m; }
  setCheckpoint(d: string) { this.checkpoint = d; }
  notice(m: string) { this.notices.push(m); }
  private push(id: number, m: ToMember) {
    if (!this.inbox.has(id)) this.inbox.set(id, []);
    this.inbox.get(id)!.push(m);
  }
  lastSync(id: number) {
    return [...(this.inbox.get(id) ?? [])].reverse().find((m) => m.k === 'sync') as Extract<ToMember, { k: 'sync' }> | undefined;
  }
  lastReject(id: number) {
    return [...(this.inbox.get(id) ?? [])].reverse().find((m) => m.k === 'reject') as Extract<ToMember, { k: 'reject' }> | undefined;
  }
}

let io: IO;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  io = new IO();
});
afterEach(() => vi.useRealTimers());

function engine(members = [member(1), member(2)], cp: Checkpoint | null = null) {
  return new HostEngine([toy], io, members, cp, { botDelayMs: [100, 100], hostedAfterMs: 30_000, random: () => 0.5, freeze: true, shuffleSeats: false });
}

describe('HostEngine', () => {
  it('房主和成员自动入座，大厅 meta 与快照随变化更新', async () => {
    engine();
    await flush();
    const sync = io.lastSync(2)!;
    expect(sync.room.seats).toEqual([{ kind: 'human', userId: 1 }, { kind: 'human', userId: 2 }]);
    expect(io.meta).toMatchObject({ gameId: 'toy', seats: 2, humans: 2, phase: 'waiting' });
    expect(JSON.parse(io.checkpoint).phase).toBe('waiting');
  });

  it('开局后每人只看到自己的秘密数；旁观者看不到', async () => {
    const h = engine([member(1), member(2), member(3)]);
    h.setSeatCount(2);
    await flush();
    h.start();
    await flush();
    const s1 = io.lastSync(1)!.game!, s2 = io.lastSync(2)!.game!, s3 = io.lastSync(3)!.game!;
    expect(s1.seat).toBe(0);
    expect(s2.seat).toBe(1);
    expect(s3.seat).toBeNull();
    expect((s3.view as { mySecret: null }).mySecret).toBeNull();
    const state = JSON.parse(io.checkpoint).game.state;
    expect((s1.view as { mySecret: number }).mySecret).toBe(state.secrets[0]);
    expect(JSON.stringify(io.inbox.get(2))).not.toContain(String(state.secrets[0]));
  });

  it('空座开局补 bot，bot 自己走；不轮到你时操作被拒', async () => {
    const h = engine([member(1)]);
    h.setSeatCount(3);
    h.start();
    await flush();
    const cp = () => JSON.parse(io.checkpoint);
    expect(cp().seats.map((s: { kind: string }) => s.kind)).toEqual(['human', 'bot', 'bot']);
    // 一直跑到结束：真人每次轮到就加 2
    for (let i = 0; i < 50 && cp().phase === 'playing'; i++) {
      const g = io.lastSync(1)!.game!;
      if ((g.view as { turn: number }).turn === 0) h.onRelay(1, { k: 'act', seq: i, action: { add: 2 } });
      else {
        h.onRelay(1, { k: 'act', seq: 999, action: { add: 1 } });
        expect(io.lastReject(1)?.reason).toBe('还没轮到你');
      }
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(cp().phase).toBe('ended');
    const sync = io.lastSync(1)!;
    expect(sync.game!.result).not.toBeNull();
    expect(Object.values(sync.room.scoreboard).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('不合法动作返回游戏给的原因', async () => {
    const h = engine();
    h.start();
    await flush();
    const turn = (io.lastSync(1)!.game!.view as { turn: number }).turn;
    const who = turn === 0 ? 1 : 2;
    h.onRelay(who, { k: 'act', seq: 1, action: { add: 5 } });
    expect(io.lastReject(who)).toEqual({ k: 'reject', seq: 1, reason: '只能加 1 或 2' });
  });

  it('真人掉线 30 秒后托管，回来后收回', async () => {
    const h = engine();
    h.start();
    await flush();
    h.membersChanged([member(1), member(2, false)]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(io.lastSync(1)!.room.hosted).toEqual([1]);
    h.membersChanged([member(1), member(2)]);
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
  });

  it('上一局的掉线计时器不会把下一局同座位的人交给 bot', async () => {
    const h = engine([member(1), member(2), member(3)]);
    h.setSeatCount(2);
    h.start();
    await flush();
    // 2 号用户掉线，宽限期内这局就结束了
    h.membersChanged([member(1), member(2, false), member(3)]);
    await vi.advanceTimersByTimeAsync(5_000);
    for (let i = 0; i < 20 && io.lastSync(1)!.room.phase === 'playing'; i++) {
      const turn = (io.lastSync(1)!.game!.view as { turn: number }).turn;
      // 掉线的 2 号在服务端看来已离线，但他的操作消息在路上，房主照常处理（不动掉线计时器）
      h.onRelay(turn === 0 ? 1 : 2, { k: 'act', seq: i, action: { add: 2 } });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(io.lastSync(1)!.room.phase).toBe('ended');
    h.backToRoom();
    await flush();
    h.onRelay(3, { k: 'sit', seat: 1 });
    h.start();
    await flush();
    expect(io.lastSync(1)!.room.seats[1]).toEqual({ kind: 'human', userId: 3 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
  });

  it('超时由 bot 代打', async () => {
    const h = engine();
    h.start();
    await flush();
    const seq0 = io.lastSync(1)!.game!.seq;
    expect(io.lastSync(1)!.game!.timer?.remainingMs).toBe(10_000);
    await vi.advanceTimersByTimeAsync(10_001);
    // 计时器 seats 为空：玩具游戏的计时不指定座位，不代打
    expect(io.lastSync(1)!.game!.seq).toBe(seq0);
  });

  it('游戏声明的停顿：bot 停完才出手，倒计时顺延', async () => {
    // 真人出过手、轮到 1 号座位时停 3 秒（像唬牌翻完牌）
    const paused = { ...toy, turn: { ...toy.turn, pause: (s: { n: number; turn: number }) => (s.n > 0 && s.turn === 1 ? 3000 : 0) } };
    const h = new HostEngine([paused], io, [member(1)], null, { botDelayMs: [100, 100], random: () => 0.5, freeze: true, shuffleSeats: false });
    h.setSeatCount(2);
    h.start();
    await flush();
    const g = () => io.lastSync(1)!.game!;
    const turn = () => (g().view as { turn: number; n: number }).turn;
    // 1 号座位是 bot：先轮到它就等它出一手
    if (turn() === 1) await vi.advanceTimersByTimeAsync(150);
    expect(turn()).toBe(0);
    h.onRelay(1, { k: 'act', seq: 1, action: { add: 2 } });
    await flush();
    expect(g().timer?.remainingMs).toBe(13_000);
    const seq = g().seq;
    await vi.advanceTimersByTimeAsync(3050);
    expect(g().seq).toBe(seq);
    await vi.advanceTimersByTimeAsync(100);
    expect(g().seq).toBe(seq + 1);
  });

  it('从快照恢复：新房主接着跑，掉线的旧房主立即托管', async () => {
    const h = engine();
    h.start();
    await flush();
    const turn = (io.lastSync(1)!.game!.view as { turn: number }).turn;
    h.onRelay(turn === 0 ? 1 : 2, { k: 'act', seq: 1, action: { add: 1 } });
    await flush();
    const cp: Checkpoint = JSON.parse(io.checkpoint);
    h.dispose();

    io = new IO();
    io.myId = 2;
    engine([member(1, false), member(2)], cp);
    await flush();
    const sync = io.lastSync(2)!;
    expect(sync.room.phase).toBe('playing');
    expect(sync.room.hosted).toEqual([0]);
    expect(sync.game!.seq).toBe(1);
    expect(JSON.parse(io.checkpoint).game.state).toEqual(cp.game!.state);
  });

  it('快照里的游戏版本不一致：回到等人并提示', async () => {
    const h = engine();
    h.start();
    await flush();
    const cp: Checkpoint = JSON.parse(io.checkpoint);
    cp.game!.gameVersion = 999;
    h.dispose();
    io = new IO();
    engine([member(1), member(2)], cp);
    await flush();
    expect(io.lastSync(1)!.room.phase).toBe('waiting');
    expect(io.notices.join()).toContain('版本');
  });

  it('等人阶段：放 bot、请人下座、离开的人让出座位', async () => {
    const h = engine([member(1), member(2), member(3)]);
    h.setSeatCount(3);
    await flush();
    h.onRelay(3, { k: 'sit', seat: 2 });
    await flush();
    expect(io.lastSync(3)!.room.seats[2]).toEqual({ kind: 'human', userId: 3 });
    h.setSlot(1, { kind: 'bot' });
    await flush();
    expect(io.lastSync(1)!.room.seats).toEqual([{ kind: 'human', userId: 1 }, { kind: 'bot' }, { kind: 'human', userId: 3 }]);
    h.setSlot(2, { kind: 'empty' });
    await flush();
    expect(io.lastSync(1)!.room.seats[2]).toEqual({ kind: 'empty' });
    h.onRelay(3, { k: 'sit', seat: 2 });
    h.membersChanged([member(1), member(2)]);
    await flush();
    expect(io.lastSync(1)!.room.seats[2]).toEqual({ kind: 'empty' });
  });
});

describe('HostEngine 开局随机排座', () => {
  /** 用一串固定的随机数代替 Math.random，循环取 */
  const seq = (xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };

  it('开局和再来一局都重新随机排座，人和 bot 都跟着动；等人时的座位不算数', async () => {
    const h = new HostEngine([toy], io, [member(1), member(2)], null, {
      botDelayMs: [100, 100], freeze: true, random: seq([0.99, 0.0, 0.0, 0.5, 0.7, 0.1]),
    });
    h.setSeatCount(4);
    await flush();
    expect(io.lastSync(1)!.room.seats).toEqual([{ kind: 'human', userId: 1 }, { kind: 'human', userId: 2 }, { kind: 'empty' }, { kind: 'empty' }]);
    h.start();
    await flush();
    const seats = () => io.lastSync(1)!.room.seats;
    const first = seats();
    // 同样两个真人、两个 bot，只是换了位置
    expect(first.filter((s) => s.kind === 'bot')).toHaveLength(2);
    expect(first.filter((s) => s.kind === 'human').map((s) => (s as { userId: number }).userId).sort()).toEqual([1, 2]);
    expect(first).not.toEqual([{ kind: 'human', userId: 1 }, { kind: 'human', userId: 2 }, { kind: 'bot' }, { kind: 'bot' }]);
    // 每人拿到的视图跟着新座位走
    const seatOf = (id: number) => first.findIndex((s) => s.kind === 'human' && s.userId === id);
    expect(io.lastSync(1)!.game!.seat).toBe(seatOf(1));
    expect(io.lastSync(2)!.game!.seat).toBe(seatOf(2));
    // 开局时记下的座位归属（结算、积分用）也是新座位
    expect(JSON.parse(io.checkpoint).game.seatKeys[seatOf(2)]).toBe('u2');
  });

  /** 全桌都由 bot 出（真人已托管），等它打完 */
  async function playOut() {
    for (let i = 0; i < 40 && io.lastSync(1)!.room.phase === 'playing'; i++) await vi.advanceTimersByTimeAsync(150);
  }

  it('再来一局：没有队伍的游戏重新随机排座；有队伍的游戏座位不变', async () => {
    const teamed = { ...toy, id: 'toyteam', teams: (n: number) => Array.from({ length: n }, (_, i) => i % 2) };
    for (const [def, keep] of [[toy, false], [teamed, true]] as const) {
      io = new IO();
      // 只有一个真人、其他都是 bot：bot 自己打完
      const h = new HostEngine([def], io, [member(1)], null, { botDelayMs: [100, 100], freeze: true });
      h.setSeatCount(4);
      const layouts = new Set<string>();
      h.start();
      await flush();
      const first = JSON.stringify(io.lastSync(1)!.room.seats);
      for (let i = 0; i < 12; i++) {
        // 真人也托管，整局让 bot 打完
        h.onRelay(1, { k: 'auto', on: true });
        await playOut();
        expect(io.lastSync(1)!.room.phase).toBe('ended');
        h.rematch();
        await flush();
        layouts.add(JSON.stringify(io.lastSync(1)!.room.seats));
      }
      if (keep) expect([...layouts]).toEqual([first]);
      else expect(layouts.size).toBeGreaterThan(1);
    }
  });

  it('多次开局座位分布不总一样', async () => {
    const h = new HostEngine([toy], io, [member(1), member(2), member(3)], null, { botDelayMs: [100, 100], freeze: true });
    h.setSeatCount(3);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      h.backToRoom();
      h.start();
      await flush();
      seen.add(JSON.stringify(io.lastSync(1)!.room.seats));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('HostEngine 手动托管', () => {
  const g = () => io.lastSync(1)!.game!;
  const turn = () => (g().view as { turn: number }).turn;
  /** 两个真人开局，并让 0 号座位（用户 1）先等到轮到自己 */
  async function startedAtSeat0() {
    const h = engine();
    h.start();
    await flush();
    if (turn() !== 0) h.onRelay(2, { k: 'act', seq: 0, action: { add: 1 } });
    await flush();
    expect(turn()).toBe(0);
    return h;
  }

  it('在线的人点托管：bot 替他出；取消后收回，不再替他出', async () => {
    const h = await startedAtSeat0();
    h.onRelay(1, { k: 'auto', on: true });
    await flush();
    expect(io.lastSync(2)!.room.hosted).toEqual([0]);
    const seq = g().seq;
    await vi.advanceTimersByTimeAsync(150);
    expect(g().seq).toBe(seq + 1);
    // 托管不会因为"人在线"被成员变化收回
    h.membersChanged([member(1), member(2), member(3)]);
    await flush();
    expect(g().view).toMatchObject({ turn: 1 });
    expect(io.lastSync(1)!.room.hosted).toEqual([0]);

    h.onRelay(2, { k: 'act', seq: 1, action: { add: 1 } });
    await flush();
    expect(turn()).toBe(0);
    h.onRelay(1, { k: 'auto', on: false });
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
    const seq2 = g().seq;
    await vi.advanceTimersByTimeAsync(500);
    expect(g().seq).toBe(seq2);
  });

  it('取消时 bot 正在想：这一手不出', async () => {
    const h = await startedAtSeat0();
    h.onRelay(1, { k: 'auto', on: true });
    await vi.advanceTimersByTimeAsync(50);
    h.onRelay(1, { k: 'auto', on: false });
    const seq = g().seq;
    await vi.advanceTimersByTimeAsync(200);
    expect(g().seq).toBe(seq);
  });

  it('托管中自己出一手：托管结束', async () => {
    const h = await startedAtSeat0();
    const n = (g().view as { n: number }).n;
    h.onRelay(1, { k: 'auto', on: true });
    h.onRelay(1, { k: 'act', seq: 1, action: { add: 2 } });
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
    expect(g().view).toMatchObject({ n: n + 2, turn: 1 });
  });

  it('旁观者和等人阶段点托管没有效果', async () => {
    const h = engine([member(1), member(2), member(3)]);
    h.setSeatCount(2);
    h.onRelay(1, { k: 'auto', on: true });
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
    h.start();
    await flush();
    h.onRelay(3, { k: 'auto', on: true });
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([]);
  });

  it('托管跟着快照交给新房主；这局结束后清掉', async () => {
    const h = await startedAtSeat0();
    h.onRelay(2, { k: 'auto', on: true });
    await flush();
    const cp: Checkpoint = JSON.parse(io.checkpoint);
    expect(cp.manual).toEqual([1]);
    h.dispose();

    io = new IO();
    io.myId = 2;
    const h2 = engine([member(1), member(2)], cp);
    await flush();
    expect(io.lastSync(2)!.room.hosted).toEqual([1]);
    // 1 号用户一直加 2，2 号座位由 bot 加 1，打到结束
    for (let i = 0; i < 20 && io.lastSync(2)!.room.phase === 'playing'; i++) {
      if ((io.lastSync(2)!.game!.view as { turn: number }).turn === 0) h2.onRelay(1, { k: 'act', seq: i, action: { add: 2 } });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(io.lastSync(2)!.room.phase).toBe('ended');
    expect(io.lastSync(2)!.room.hosted).toEqual([]);
    h2.rematch();
    await flush();
    expect(io.lastSync(2)!.room.hosted).toEqual([]);
    expect(JSON.parse(io.checkpoint).manual).toEqual([]);
  });

  it('托管中掉线：不等宽限，一直托管；回来也不收回', async () => {
    const h = await startedAtSeat0();
    h.onRelay(2, { k: 'auto', on: true });
    h.membersChanged([member(1), member(2, false)]);
    await vi.advanceTimersByTimeAsync(31_000);
    h.membersChanged([member(1), member(2)]);
    await flush();
    expect(io.lastSync(1)!.room.hosted).toEqual([1]);
  });
});

describe('HostEngine 积分上报', () => {
  /** 两个真人轮流加 2，打到结束 */
  async function playOut(h: HostEngine, users: number[]) {
    for (let i = 0; i < 20 && io.lastSync(1)!.room.phase === 'playing'; i++) {
      const turn = (io.lastSync(1)!.game!.view as { turn: number }).turn;
      const slot = io.lastSync(1)!.room.seats[turn];
      if (slot.kind === 'human') h.onRelay(users[turn], { k: 'act', seq: i, action: { add: 2 } });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(io.lastSync(1)!.room.phase).toBe('ended');
  }

  it('两个真人：结束时报一次输赢，收到回执后大家看到积分变化', async () => {
    const h = engine();
    h.start();
    await flush();
    expect(io.lastSync(2)!.game!.rating).toBeNull();
    await playOut(h, [1, 2]);
    expect(io.reports).toHaveLength(1);
    const r = io.reports[0];
    const winnerSeat = io.lastSync(1)!.game!.result!.winners[0];
    expect(r).toMatchObject({ gameId: 'toy', weight: 1, winners: [winnerSeat + 1], losers: [2 - winnerSeat] });
    expect(r.matchId).toMatch(/^[0-9a-f]{16}$/);
    expect(io.lastSync(2)!.game!.rating).toBe('pending');
    // 有别的变化也不重复报
    h.membersChanged([member(1), member(2), member(3)]);
    await flush();
    expect(io.reports).toHaveLength(1);

    const result = { matchId: r.matchId, changes: [{ userId: 1, before: 1200, after: 1216 }, { userId: 2, before: 1200, after: 1184 }] };
    h.onRatingResult({ ...result, matchId: 'other' }); // 别的局的回执不算
    await flush();
    expect(io.lastSync(2)!.game!.rating).toBe('pending');
    h.onRatingResult(result);
    await flush();
    expect(io.lastSync(2)!.game!.rating).toEqual(result);
    expect(JSON.parse(io.checkpoint).game.rating).toEqual(result);
  });

  it('只有一个真人（其他都是 bot）不计分', async () => {
    const h = engine([member(1)]);
    h.start();
    await flush();
    await playOut(h, [1, 0]);
    expect(io.reports).toHaveLength(0);
    expect(io.lastSync(1)!.game!.rating).toBeNull();
  });

  it('断线时没发出去：重连后补发', async () => {
    const h = engine();
    h.start();
    await flush();
    io.online = false;
    await playOut(h, [1, 2]);
    expect(io.reports).toHaveLength(0);
    io.online = true;
    h.linkReset();
    await flush();
    expect(io.reports).toHaveLength(1);
  });

  it('新房主从已结束、没回执的快照恢复：再报一次（服务端按 matchId 去重）', async () => {
    const h = engine();
    h.start();
    await flush();
    await playOut(h, [1, 2]);
    const first = io.reports[0];
    const cp: Checkpoint = JSON.parse(io.checkpoint);
    h.dispose();

    io = new IO();
    io.myId = 2;
    engine([member(1, false), member(2)], cp);
    await flush();
    expect(io.reports).toEqual([first]);
  });
});

describe('HostEngine 积分上报跨交接', () => {
  it('断线时打完、没报出去就开了下一局：未确认的上报进快照，新房主接着报', async () => {
    const h = engine();
    h.start();
    await flush();
    io.online = false;
    for (let i = 0; i < 20 && io.lastSync(1)!.room.phase === 'playing'; i++) {
      const turn = (io.lastSync(1)!.game!.view as { turn: number }).turn;
      h.onRelay(turn + 1, { k: 'act', seq: i, action: { add: 2 } });
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(io.lastSync(1)!.room.phase).toBe('ended');
    const oldMatch = JSON.parse(io.checkpoint).game.matchId;
    h.rematch();
    await flush();
    expect(io.reports).toHaveLength(0);
    const cp: Checkpoint = JSON.parse(io.checkpoint);
    h.dispose();

    io = new IO();
    io.myId = 2;
    const h2 = engine([member(1, false), member(2)], cp);
    await flush();
    expect(io.reports.map((r) => r.matchId)).toEqual([oldMatch]);
    expect(JSON.parse(io.checkpoint).unrated.map((r: { matchId: string }) => r.matchId)).toEqual([oldMatch]);
    // 收到回执后从快照里去掉
    h2.onRatingResult({ matchId: oldMatch, changes: [] });
    await flush();
    expect(JSON.parse(io.checkpoint).unrated).toEqual([]);
  });
});
