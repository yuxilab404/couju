import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '@couju/protocol';
import { HostEngine, type HostIO } from './host.ts';
import { toy } from './toygame.test-helper.ts';
import type { Checkpoint, ToMember } from './wire.ts';

const member = (id: number, connected = true): Member => ({ id, nickname: `u${id}`, avatarUrl: null, connected, joinedAt: id });

class IO implements HostIO {
  myId = 1;
  buildId = 'b1';
  inbox = new Map<number, ToMember[]>();
  checkpoint = '';
  meta: unknown = null;
  notices: string[] = [];
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
  return new HostEngine([toy], io, members, cp, { botDelayMs: [100, 100], hostedAfterMs: 30_000, random: () => 0.5, freeze: true });
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

  it('等人阶段：换座、请人下座、离开的人让出座位', async () => {
    const h = engine([member(1), member(2), member(3)]);
    h.setSeatCount(3);
    await flush();
    h.onRelay(3, { k: 'sit', seat: 2 });
    await flush();
    expect(io.lastSync(3)!.room.seats[2]).toEqual({ kind: 'human', userId: 3 });
    h.swapSeats(0, 2);
    h.setSlot(1, { kind: 'bot' });
    await flush();
    expect(io.lastSync(1)!.room.seats).toEqual([{ kind: 'human', userId: 3 }, { kind: 'bot' }, { kind: 'human', userId: 1 }]);
    h.membersChanged([member(1), member(2)]);
    await flush();
    expect(io.lastSync(1)!.room.seats[0]).toEqual({ kind: 'empty' });
  });
});
