import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@couju/protocol';
import { Rooms, type Conn } from './rooms.ts';

class FakeConn implements Conn {
  static n = 0;
  readonly id = ++FakeConn.n;
  inbox: ServerMsg[] = [];
  closed = false;
  constructor(public user: { id: number; nickname: string; avatarUrl: null }) {}
  send(m: ServerMsg) { this.inbox.push(m); }
  close() { this.closed = true; }
  last<T extends ServerMsg['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

const user = (id: number) => ({ id, nickname: `u${id}`, avatarUrl: null });
let rooms: Rooms;

beforeEach(() => {
  vi.useFakeTimers();
  rooms = new Rooms({ hostGraceMs: 15_000, emptyRoomMs: 60_000 });
});
afterEach(() => vi.useRealTimers());

function connect(id: number) {
  const c = new FakeConn(user(id));
  rooms.connect(c);
  return c;
}

function setup() {
  const a = connect(1), b = connect(2), c = connect(3);
  rooms.handle(a, { t: 'room.create', meta: { game: 'x' } });
  const roomId = a.last('room.state')!.roomId;
  rooms.handle(b, { t: 'room.join', roomId });
  rooms.handle(c, { t: 'room.join', roomId });
  return { a, b, c, roomId };
}

describe('Rooms', () => {
  it('建房者是房主，加入者看到成员列表', () => {
    const { a, c } = setup();
    const st = c.last('room.state')!;
    expect(st.hostId).toBe(1);
    expect(st.members.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(a.last('room.host')?.hostId).toBe(1);
  });

  it('relay 按 to 转发，包体原样', () => {
    const { a, b, c } = setup();
    rooms.handle(b, { t: 'relay', to: 'host', data: { x: 1 } });
    expect(a.last('relay')).toEqual({ t: 'relay', from: 2, data: { x: 1 } });
    expect(c.last('relay')).toBeUndefined();
    rooms.handle(a, { t: 'relay', to: [3], data: 'hi' });
    expect(c.last('relay')?.data).toBe('hi');
    expect(b.last('relay')).toBeUndefined();
    rooms.handle(a, { t: 'relay', to: 'all', data: 'all' });
    expect(b.last('relay')?.data).toBe('all');
    expect(c.last('relay')?.data).toBe('all');
  });

  it('只有房主能写快照和 meta', () => {
    const { a, b, roomId } = setup();
    rooms.handle(b, { t: 'room.checkpoint', data: 'evil' });
    expect(b.last('error')?.code).toBe('not_host');
    rooms.handle(a, { t: 'room.checkpoint', data: 'snap1' });
    expect(rooms.checkpointOf(roomId)).toBe('snap1');
  });

  it('房主掉线 15 秒后按入房顺序换人，新房主拿到快照', () => {
    const { a, b, c, roomId } = setup();
    rooms.handle(a, { t: 'room.checkpoint', data: 'snap' });
    rooms.disconnect(a);
    vi.advanceTimersByTime(14_000);
    expect(b.last('room.host')).toBeUndefined();
    vi.advanceTimersByTime(1_000);
    expect(b.last('room.host')).toEqual({ t: 'room.host', roomId, hostId: 2, checkpoint: 'snap' });
    expect(c.last('room.host')).toEqual({ t: 'room.host', roomId, hostId: 2 });
  });

  it('房主在宽限期内回来：不换人，并拿回快照', () => {
    const { a, b, roomId } = setup();
    rooms.handle(a, { t: 'room.checkpoint', data: 'snap' });
    rooms.disconnect(a);
    vi.advanceTimersByTime(5_000);
    const a2 = connect(1);
    rooms.handle(a2, { t: 'room.join', roomId });
    expect(a2.last('room.host')?.checkpoint).toBe('snap');
    vi.advanceTimersByTime(20_000);
    expect(b.last('room.host')).toBeUndefined();
  });

  it('房主主动离开立即换人', () => {
    const { a, b } = setup();
    rooms.handle(a, { t: 'room.leave' });
    expect(b.last('room.host')?.hostId).toBe(2);
    expect(b.last('room.state')!.members.map((m) => m.id)).toEqual([2, 3]);
  });

  it('同一个人开第二个标签页：旧的让位', () => {
    const { b, roomId } = setup();
    const b2 = connect(2);
    rooms.handle(b2, { t: 'room.join', roomId });
    expect(b.last('room.left')?.reason).toBe('replaced');
    expect(b2.last('room.state')!.members.find((m) => m.id === 2)?.connected).toBe(true);
  });

  it('全员掉线一段时间后关房；没人时宽限期过了，来的人当房主', () => {
    const { a, b, c, roomId } = setup();
    rooms.disconnect(a); rooms.disconnect(b); rooms.disconnect(c);
    vi.advanceTimersByTime(20_000);
    const c2 = connect(3);
    rooms.handle(c2, { t: 'room.join', roomId });
    expect(c2.last('room.host')?.hostId).toBe(3);
    rooms.disconnect(c2);
    vi.advanceTimersByTime(60_000);
    const b2 = connect(2);
    rooms.handle(b2, { t: 'room.join', roomId });
    expect(b2.last('error')?.code).toBe('not_found');
  });

  it('大厅订阅收到房间列表', async () => {
    const w = connect(9);
    rooms.handle(w, { t: 'lobby.watch' });
    expect(w.last('lobby.rooms')!.rooms).toHaveLength(0);
    setup();
    await Promise.resolve();
    const list = w.last('lobby.rooms')!.rooms;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ hostId: 1, hostName: 'u1', meta: { game: 'x' } });
  });

  it('限频', () => {
    const a = connect(1);
    for (let i = 0; i < 200; i++) rooms.handle(a, { t: 'ping' });
    expect(a.inbox.filter((m) => m.t === 'pong').length).toBeLessThanOrEqual(120);
    expect(a.last('error')?.code).toBe('rate_limited');
  });

  it('长时间无消息的连接被关闭', () => {
    const a = connect(1);
    vi.advanceTimersByTime(31_000);
    rooms.sweep();
    expect(a.closed).toBe(true);
  });
});

describe('重启交接（ADR-0006）', () => {
  function restart() {
    const h = JSON.parse(JSON.stringify(rooms.exportState()));
    rooms = new Rooms({ hostGraceMs: 15_000, emptyRoomMs: 60_000 });
    rooms.importState(h);
  }

  it('导出再导入：成员、房主、入房顺序、大厅摘要、快照都在，大家重连回到原房间', () => {
    const { a, roomId } = setup();
    rooms.handle(a, { t: 'room.checkpoint', data: 'cp-1' });
    restart();
    expect(rooms.checkpointOf(roomId)).toBe('cp-1');

    const b2 = connect(2);
    rooms.handle(b2, { t: 'room.join', roomId });
    const st = b2.last('room.state')!;
    expect(st.hostId).toBe(1);
    expect(st.meta).toEqual({ game: 'x' });
    expect(st.members.map((m) => [m.id, m.connected])).toEqual([[1, false], [2, true], [3, false]]);

    const a2 = connect(1);
    rooms.handle(a2, { t: 'room.join', roomId });
    expect(a2.last('room.host')).toMatchObject({ hostId: 1, checkpoint: 'cp-1' });
    vi.advanceTimersByTime(20_000);
    expect(b2.last('room.state')!.hostId).toBe(1); // 房主回来了，不换人

    // 新进程里再进来的人排在后面
    const d = connect(4);
    rooms.handle(d, { t: 'room.join', roomId });
    const order = d.last('room.state')!.members.map((m) => m.id);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('房主没回来：宽限期过后交给最早入房的在线成员，带上快照', () => {
    const { a, roomId } = setup();
    rooms.handle(a, { t: 'room.checkpoint', data: 'cp-2' });
    restart();
    const c2 = connect(3);
    rooms.handle(c2, { t: 'room.join', roomId });
    const b2 = connect(2);
    rooms.handle(b2, { t: 'room.join', roomId });
    vi.advanceTimersByTime(15_000);
    expect(b2.last('room.host')).toMatchObject({ hostId: 2, checkpoint: 'cp-2' });
  });

  it('谁都没回来：空房照常到点关闭', () => {
    const { roomId } = setup();
    restart();
    expect(rooms.stats().rooms).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(rooms.stats().rooms).toBe(0);
    const x = connect(5);
    rooms.handle(x, { t: 'room.join', roomId });
    expect(x.last('error')).toMatchObject({ code: 'not_found' });
  });
});
