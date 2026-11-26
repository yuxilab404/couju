/**
 * 集成测试：真实的服务端 Rooms + 平台 RoomSession，进程内连线。
 * 验证建房、入座、开局、bot 补位、房主掉线后换人接着打。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, ServerMsg } from '@couju/protocol';
import { Db } from '@couju/server/db.ts';
import { Ratings } from '@couju/server/ratings.ts';
import { Rooms, type Conn } from '@couju/server/rooms.ts';
import { RoomSession, type Link } from '@couju/platform/session.ts';
import { toy } from '@couju/platform/toygame.test-helper.ts';

let nextConn = 1;

class Client implements Link {
  conn: Conn;
  private msgFns = new Set<(m: ServerMsg) => void>();
  private openFns = new Set<() => void>();
  online = false;
  constructor(public rooms: Rooms, public userId: number) {
    this.conn = this.makeConn();
  }
  private makeConn(): Conn {
    return {
      id: nextConn++,
      user: { id: this.userId, nickname: `u${this.userId}`, avatarUrl: null, rating: 1200 },
      send: (m) => queueMicrotask(() => this.online && this.msgFns.forEach((f) => f(m))),
      close: () => {},
    };
  }
  goOnline() {
    this.conn = this.makeConn();
    this.online = true;
    this.rooms.connect(this.conn);
    this.openFns.forEach((f) => f());
  }
  goOffline() {
    this.online = false;
    this.rooms.disconnect(this.conn);
  }
  send(msg: ClientMsg) {
    if (!this.online) return false;
    this.rooms.handle(this.conn, msg);
    return true;
  }
  onMessage(fn: (m: ServerMsg) => void) { this.msgFns.add(fn); return () => this.msgFns.delete(fn); }
  onOpen(fn: () => void) { this.openFns.add(fn); if (this.online) fn(); return () => this.openFns.delete(fn); }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const opts = { botDelayMs: [50, 50] as [number, number], random: () => 0.3 };

describe('房间 + 交接', () => {
  it('三人建房开局，房主掉线 15 秒后第二个人接手，局面延续', async () => {
    const rooms = new Rooms({ hostGraceMs: 15_000 });
    const a = new Client(rooms, 1), b = new Client(rooms, 2), c = new Client(rooms, 3);
    a.goOnline(); b.goOnline(); c.goOnline();

    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    const roomId = sa.state.get().roomId!;
    expect(roomId).toMatch(/^[a-z0-9]{6}$/);
    expect(sa.state.get().amHost).toBe(true);

    const sb = new RoomSession(b, 2, [toy], 'v1', roomId, opts);
    const sc = new RoomSession(c, 3, [toy], 'v1', roomId, opts);
    await tick();
    sa.engine!.setSeatCount(4);
    await tick();
    expect(sc.state.get().room!.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human', 'empty']);

    sa.engine!.start();
    await tick();
    expect(sb.state.get().room!.phase).toBe('playing');
    expect(sb.state.get().game!.seat).toBe(1);

    // 走几步：谁轮到谁加 1（bot 在 3 号位自己走）
    const sessions = [sa, sb, sc];
    for (let i = 0; i < 3; i++) {
      const turn = (sa.state.get().game!.view as { turn: number }).turn;
      if (turn < 3) sessions[turn].act({ add: 1 });
      await tick(60);
    }
    const seqBefore = sb.state.get().game!.seq;
    const nBefore = (sb.state.get().game!.view as { n: number }).n;
    expect(seqBefore).toBeGreaterThan(0);

    // 房主掉线
    a.goOffline();
    await tick(14_000);
    expect(sb.state.get().amHost).toBe(false);
    await tick(1_100);
    expect(sb.state.get().amHost).toBe(true);
    expect(sc.state.get().hostId).toBe(2);
    expect(sc.state.get().game!.seq).toBeGreaterThanOrEqual(seqBefore);
    expect((sc.state.get().game!.view as { n: number }).n).toBeGreaterThanOrEqual(nBefore);
    // 旧房主的座位由 bot 托管
    expect(sc.state.get().room!.hosted).toContain(0);

    // 打到结束
    for (let i = 0; i < 40 && sc.state.get().room!.phase === 'playing'; i++) {
      const turn = (sb.state.get().game!.view as { turn: number }).turn;
      if (turn === 1) sb.act({ add: 2 });
      if (turn === 2) sc.act({ add: 2 });
      await tick(60);
    }
    expect(sc.state.get().room!.phase).toBe('ended');
    expect(sc.state.get().game!.result).not.toBeNull();

    // 旧房主回来：成了普通成员，看到结算
    const sa2 = new RoomSession(a, 1, [toy], 'v1', roomId, opts);
    a.goOnline();
    await tick();
    expect(sa2.state.get().amHost).toBe(false);
    expect(sa2.state.get().room!.phase).toBe('ended');
    sa.dispose();
  });

  it('房主刷新页面（新会话）后从服务端快照恢复', async () => {
    const rooms = new Rooms({ hostGraceMs: 15_000 });
    const a = new Client(rooms, 1), b = new Client(rooms, 2);
    a.goOnline(); b.goOnline();
    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    const roomId = sa.state.get().roomId!;
    const sb = new RoomSession(b, 2, [toy], 'v1', roomId, opts);
    await tick();
    sa.engine!.start();
    await tick();
    const turn = (sa.state.get().game!.view as { turn: number }).turn;
    [sa, sb][turn].act({ add: 1 });
    await tick();
    const seq = sb.state.get().game!.seq;

    // 页面刷新：旧会话销毁、断线，新会话 2 秒内重连
    sa.dispose();
    a.goOffline();
    await tick(2_000);
    const sa2 = new RoomSession(a, 1, [toy], 'v1', roomId, opts);
    a.goOnline();
    await tick();
    expect(sa2.state.get().amHost).toBe(true);
    expect(sa2.state.get().game!.seq).toBe(seq);
    expect(sb.state.get().game!.seq).toBe(seq);
  });

  it('房主短暂断线期间推进的局面，重连后补发快照', async () => {
    const rooms = new Rooms({ hostGraceMs: 15_000 });
    const a = new Client(rooms, 1), b = new Client(rooms, 2);
    a.goOnline(); b.goOnline();
    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    const roomId = sa.state.get().roomId!;
    const sb = new RoomSession(b, 2, [toy], 'v1', roomId, opts);
    await tick();
    sa.engine!.start();
    await tick();
    if ((sa.state.get().game!.view as { turn: number }).turn !== 0) {
      sb.act({ add: 1 });
      await tick();
    }
    // 房主断网（没到交接时间），自己在本地出了一步
    a.goOffline();
    sa.act({ add: 1 });
    await tick();
    const local = sa.state.get().game!.seq;
    expect(JSON.parse(rooms.checkpointOf(roomId)!).game.seq).toBe(local - 1);
    a.goOnline();
    await tick();
    expect(JSON.parse(rooms.checkpointOf(roomId)!).game.seq).toBe(local);
  });

  it('重连时房间已经关了：提示房间已关闭，而不是停在旧局面', async () => {
    const rooms = new Rooms({ hostGraceMs: 15_000, emptyRoomMs: 60_000 });
    const a = new Client(rooms, 1);
    a.goOnline();
    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    expect(sa.state.get().status).toBe('in');
    a.goOffline();
    await tick(61_000);
    a.goOnline();
    await tick();
    expect(sa.state.get().status).toBe('gone');
    expect(sa.state.get().goneReason).toContain('不存在');
  });

  it('服务端重启（ADR-0006）：房间表交给新进程，大家重连后同一局接着打完；断线时点的操作不卡按钮', async () => {
    let rooms = new Rooms({ hostGraceMs: 15_000 });
    const clients = [new Client(rooms, 1), new Client(rooms, 2), new Client(rooms, 3)];
    clients.forEach((c) => c.goOnline());
    const [a, b, c] = clients;
    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    const roomId = sa.state.get().roomId!;
    const sb = new RoomSession(b, 2, [toy], 'v1', roomId, opts);
    const sc = new RoomSession(c, 3, [toy], 'v1', roomId, opts);
    await tick();
    sa.engine!.start();
    await tick();
    const sessions = [sa, sb, sc];
    const turnOf = () => (sa.state.get().game!.view as { turn: number }).turn;
    // 走到轮到成员（不是房主）为止
    for (let i = 0; i < 3 && turnOf() === 0; i++) {
      sa.act({ add: 1 });
      await tick();
    }
    const seq = sa.state.get().game!.seq;
    const mover = sessions[turnOf()];

    // 旧进程收到 SIGTERM：导出房间表，所有连接断开
    const handoff = JSON.parse(JSON.stringify(rooms.exportState()));
    clients.forEach((x) => x.goOffline());
    // 断开期间成员点了一下：发不出去，按钮不能卡在"处理中"
    mover.act({ add: 1 });
    expect(mover.state.get().pending).toBe(false);
    expect(mover.state.get().error).toContain('网络');

    // 新进程读回；成员先连上，房主后到（各自的重连退避不同）
    rooms = new Rooms({ hostGraceMs: 15_000 });
    rooms.importState(handoff);
    clients.forEach((x) => (x.rooms = rooms));
    await tick(1_000);
    b.goOnline();
    c.goOnline();
    await tick(2_000);
    a.goOnline();
    await tick();

    for (const s of sessions) {
      expect(s.state.get().status).toBe('in');
      expect(s.state.get().hostId).toBe(1);
      expect(s.state.get().game!.seq).toBe(seq);
      expect(s.state.get().room!.phase).toBe('playing');
    }
    expect(sa.state.get().amHost).toBe(true);

    // 同一局接着打完
    for (let i = 0; i < 40 && sa.state.get().room!.phase === 'playing'; i++) {
      const t = turnOf();
      if (t < 3) sessions[t].act({ add: 2 });
      await tick(60);
    }
    expect(sb.state.get().room!.phase).toBe('ended');
    expect(sc.state.get().game!.result).not.toBeNull();
  });

  it('两个真人打完一局：服务端记积分，大家在结算里看到变化，成员列表的积分也更新', async () => {
    const db = new Db(':memory:');
    for (const id of [1, 2]) db.run('INSERT INTO users(id, email, nickname, created_at) VALUES (?,?,?,?)', id, `u${id}@x`, `u${id}`, 0);
    const ratings = new Ratings(db);
    const rooms = new Rooms({ hostGraceMs: 15_000, ratings });
    const a = new Client(rooms, 1), b = new Client(rooms, 2);
    a.goOnline(); b.goOnline();
    const sa = new RoomSession(a, 1, [toy], 'v1', null, opts);
    await tick();
    const sb = new RoomSession(b, 2, [toy], 'v1', sa.state.get().roomId!, opts);
    await tick();
    sa.engine!.start();
    await tick();
    for (let i = 0; i < 20 && sb.state.get().room!.phase === 'playing'; i++) {
      const turn = (sb.state.get().game!.view as { turn: number }).turn;
      [sa, sb][turn].act({ add: 2 });
      await tick(60);
    }
    expect(sb.state.get().room!.phase).toBe('ended');
    const winner = sb.state.get().game!.result!.winners[0] + 1;
    const loser = 3 - winner;
    const rating = sb.state.get().game!.rating;
    expect(rating).toEqual({
      matchId: expect.any(String),
      changes: [{ userId: winner, before: 1200, after: 1216 }, { userId: loser, before: 1200, after: 1184 }],
    });
    expect(sa.state.get().game!.rating).toEqual(rating);
    expect(ratings.current([winner, loser])).toEqual(new Map([[winner, 1216], [loser, 1184]]));
    expect(sb.state.get().members.find((m) => m.id === winner)!.rating).toBe(1216);

    // 再来一局又是新的 matchId
    sa.engine!.rematch();
    await tick();
    expect(sb.state.get().game!.rating).toBeNull();
    sa.dispose(); sb.dispose();
  });
});
