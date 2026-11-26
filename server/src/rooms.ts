/**
 * 大厅、房间成员、房主选举与中继（ARCHITECTURE.md §4–5，ADR-0003）。
 * 只看外层字段：meta、checkpoint、relay.data 原样存、原样转发，不解析。
 */
import { randomBytes } from 'node:crypto';
import {
  LIMITS,
  type ClientMsg,
  type Member,
  type PublicUser,
  type RoomSummary,
  type ServerMsg,
  type UserId,
} from '@couju/protocol';
import { parseReport, ReportError, type Ratings } from './ratings.ts';

export interface Conn {
  readonly id: number;
  user: PublicUser;
  send(msg: ServerMsg): void;
  close(): void;
}

interface MemberState {
  user: PublicUser;
  conn: Conn | null;
  joinedAt: number;
}

interface Room {
  id: string;
  hostId: UserId;
  members: Map<UserId, MemberState>;
  meta: unknown;
  checkpoint: string | null;
  createdAt: number;
  hostTimer: ReturnType<typeof setTimeout> | null;
  emptyTimer: ReturnType<typeof setTimeout> | null;
}

interface ConnState {
  conn: Conn;
  roomId: string | null;
  watchingLobby: boolean;
  lastSeen: number;
  bucket: number;
  bucketAt: number;
  warnedAt: number;
}

/**
 * 优雅重启时交给下一个进程的房间表（ADR-0006）。只是同一份事实跨进程搬运：
 * 新进程读回后立刻删文件，成员一律当作掉线，由重连接回。
 */
export interface RoomsHandoff {
  v: 1;
  writtenAt: number;
  joinSeq: number;
  rooms: {
    id: string;
    hostId: UserId;
    createdAt: number;
    meta: unknown;
    checkpoint: string | null;
    members: { user: PublicUser; joinedAt: number }[];
  }[];
}

export interface RoomsOptions {
  now?: () => number;
  hostGraceMs?: number;
  /** 房间里一个在线的人都没有多久后关闭 */
  emptyRoomMs?: number;
  log?: (msg: string) => void;
  /** 积分（ADR-0007）；不给则忽略房主的上报 */
  ratings?: Ratings;
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private conns = new Map<number, ConnState>();
  private lobbyDirty = false;
  private readonly now: () => number;
  private readonly hostGraceMs: number;
  private readonly emptyRoomMs: number;
  private readonly log: (msg: string) => void;
  private readonly ratings: Ratings | null;
  private joinSeq = 0;

  constructor(opts: RoomsOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.hostGraceMs = opts.hostGraceMs ?? LIMITS.hostGraceMs;
    this.emptyRoomMs = opts.emptyRoomMs ?? 5 * 60_000;
    this.log = opts.log ?? (() => {});
    this.ratings = opts.ratings ?? null;
  }

  // ---------- 连接 ----------

  connect(conn: Conn): void {
    const now = this.now();
    this.conns.set(conn.id, {
      conn, roomId: null, watchingLobby: false, lastSeen: now,
      bucket: LIMITS.maxMessagesPerSecond, bucketAt: now, warnedAt: 0,
    });
  }

  disconnect(conn: Conn): void {
    const cs = this.conns.get(conn.id);
    if (!cs) return;
    this.conns.delete(conn.id);
    if (cs.roomId) this.detach(cs.roomId, conn, false);
  }

  /** 关闭长时间无消息的连接；由外部定时调用 */
  sweep(): void {
    const dead = this.now() - LIMITS.deadAfterMs;
    for (const cs of [...this.conns.values()]) {
      if (cs.lastSeen < dead) {
        cs.conn.close();
        this.disconnect(cs.conn);
      }
    }
  }

  /** 昵称或头像变了 */
  updateUser(user: PublicUser): void {
    for (const cs of this.conns.values()) if (cs.conn.user.id === user.id) cs.conn.user = user;
    for (const room of this.rooms.values()) {
      const m = room.members.get(user.id);
      if (m) {
        m.user = user;
        this.pushRoomState(room);
      }
    }
  }

  stats(): { rooms: number; activeRooms: number; connections: number } {
    let active = 0;
    for (const r of this.rooms.values()) if ([...r.members.values()].some((m) => m.conn)) active++;
    return { rooms: this.rooms.size, activeRooms: active, connections: this.conns.size };
  }

  // ---------- 重启交接 ----------

  exportState(): RoomsHandoff {
    return {
      v: 1,
      writtenAt: this.now(),
      joinSeq: this.joinSeq,
      rooms: [...this.rooms.values()].map((r) => ({
        id: r.id,
        hostId: r.hostId,
        createdAt: r.createdAt,
        meta: r.meta,
        checkpoint: r.checkpoint,
        members: [...r.members.values()].map((m) => ({ user: m.user, joinedAt: m.joinedAt })),
      })),
    };
  }

  /** 读回上一个进程的房间表：所有人当作同时掉线，房主照常有宽限期，空房照常到点关闭 */
  importState(h: RoomsHandoff): number {
    this.joinSeq = Math.max(this.joinSeq, h.joinSeq);
    let n = 0;
    for (const r of h.rooms) {
      if (this.rooms.has(r.id) || r.members.length === 0) continue;
      const room: Room = {
        id: r.id,
        hostId: r.hostId,
        members: new Map(r.members.map((m) => [m.user.id, { user: m.user, conn: null, joinedAt: m.joinedAt }])),
        meta: r.meta,
        checkpoint: r.checkpoint,
        createdAt: r.createdAt,
        hostTimer: null,
        emptyTimer: null,
      };
      room.hostTimer = setTimeout(() => this.electHost(room), this.hostGraceMs);
      room.emptyTimer = setTimeout(() => this.close(room), this.emptyRoomMs);
      this.rooms.set(room.id, room);
      n++;
    }
    return n;
  }

  // ---------- 消息 ----------

  handle(conn: Conn, msg: ClientMsg): void {
    const cs = this.conns.get(conn.id);
    if (!cs) return;
    const now = this.now();
    cs.lastSeen = now;
    if (!this.takeToken(cs, now)) return;

    switch (msg.t) {
      case 'ping':
        conn.send({ t: 'pong' });
        return;
      case 'lobby.watch':
        cs.watchingLobby = true;
        conn.send({ t: 'lobby.rooms', rooms: this.summaries() });
        return;
      case 'lobby.unwatch':
        cs.watchingLobby = false;
        return;
      case 'room.create':
        return this.create(cs, msg.meta);
      case 'room.join':
        return this.join(cs, String(msg.roomId));
      case 'room.leave':
        if (cs.roomId) {
          const id = cs.roomId;
          cs.roomId = null;
          this.detach(id, conn, true);
          conn.send({ t: 'room.left', roomId: id, reason: 'leave' });
        }
        return;
      case 'room.meta': {
        const room = this.hostRoom(cs);
        if (!room) return;
        room.meta = msg.meta;
        this.pushRoomState(room);
        return;
      }
      case 'room.checkpoint': {
        const room = this.hostRoom(cs);
        if (!room) return;
        room.checkpoint = typeof msg.data === 'string' ? msg.data : null;
        return;
      }
      case 'relay':
        return this.relay(cs, msg.to, msg.data);
      case 'rating.report':
        return this.reportRating(cs, msg.report);
      default:
        conn.send({ t: 'error', code: 'bad_request', message: '未知消息' });
    }
  }

  private takeToken(cs: ConnState, now: number): boolean {
    const rate = LIMITS.maxMessagesPerSecond;
    cs.bucket = Math.min(rate, cs.bucket + ((now - cs.bucketAt) / 1000) * rate);
    cs.bucketAt = now;
    if (cs.bucket >= 1) {
      cs.bucket -= 1;
      return true;
    }
    if (now - cs.warnedAt > 1000) {
      cs.warnedAt = now;
      cs.conn.send({ t: 'error', code: 'rate_limited', message: '消息太频繁' });
    }
    return false;
  }

  // ---------- 房间 ----------

  private newRoomId(): string {
    for (;;) {
      // 6 位小写字母数字，便于口头报房号
      const id = randomBytes(6).toString('base64url').replace(/[-_]/g, '').toLowerCase().slice(0, 6);
      if (id.length === 6 && !this.rooms.has(id)) return id;
    }
  }

  private create(cs: ConnState, meta: unknown): void {
    if (cs.roomId) {
      const old = cs.roomId;
      cs.roomId = null;
      this.detach(old, cs.conn, true);
    }
    const room: Room = {
      id: this.newRoomId(),
      hostId: cs.conn.user.id,
      members: new Map(),
      meta,
      checkpoint: null,
      createdAt: this.now(),
      hostTimer: null,
      emptyTimer: null,
    };
    this.rooms.set(room.id, room);
    this.log(`[rooms] ${cs.conn.user.nickname} 建房 ${room.id}`);
    this.attach(room, cs);
  }

  private join(cs: ConnState, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      cs.conn.send({ t: 'error', code: 'not_found', message: '房间不存在或已关闭' });
      return;
    }
    if (cs.roomId && cs.roomId !== roomId) {
      const old = cs.roomId;
      cs.roomId = null;
      this.detach(old, cs.conn, true);
    }
    this.attach(room, cs);
  }

  private attach(room: Room, cs: ConnState): void {
    const user = cs.conn.user;
    let m = room.members.get(user.id);
    if (m?.conn && m.conn.id !== cs.conn.id) {
      // 同一个人在别的标签页里，旧的让位
      const old = this.conns.get(m.conn.id);
      if (old) old.roomId = null;
      m.conn.send({ t: 'room.left', roomId: room.id, reason: 'replaced' });
    }
    if (!m) {
      m = { user, conn: null, joinedAt: ++this.joinSeq };
      room.members.set(user.id, m);
    }
    m.user = user;
    m.conn = cs.conn;
    cs.roomId = room.id;
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    if (room.hostId === user.id) {
      if (room.hostTimer) {
        clearTimeout(room.hostTimer);
        room.hostTimer = null;
      }
    }
    // 房主早已掉线、宽限期过了却没人可接：现在有人来了，交给他
    if (!room.members.get(room.hostId)?.conn && !room.hostTimer) return this.electHost(room);
    this.pushRoomState(room);
    // 房主（重新）进房：把快照给他，页面刷新过也能接着跑
    if (room.hostId === user.id) {
      cs.conn.send({ t: 'room.host', roomId: room.id, hostId: room.hostId, checkpoint: room.checkpoint });
    }
  }

  /** explicit=true 表示主动离开（移出成员）；false 表示掉线（保留成员位） */
  private detach(roomId: string, conn: Conn, explicit: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const m = room.members.get(conn.user.id);
    if (!m || m.conn?.id !== conn.id) return;
    m.conn = null;
    if (explicit) room.members.delete(conn.user.id);

    if (room.members.size === 0) return this.close(room);
    if (room.hostId === conn.user.id) {
      if (explicit) this.electHost(room);
      else if (!room.hostTimer) room.hostTimer = setTimeout(() => this.electHost(room), this.hostGraceMs);
    }
    if (![...room.members.values()].some((x) => x.conn) && !room.emptyTimer) {
      room.emptyTimer = setTimeout(() => this.close(room), this.emptyRoomMs);
    }
    this.pushRoomState(room);
  }

  private electHost(room: Room): void {
    room.hostTimer = null;
    if (!this.rooms.has(room.id)) return;
    const current = room.members.get(room.hostId);
    if (current?.conn) return; // 已经回来了
    const next = [...room.members.values()]
      .filter((m) => m.conn && m.user.id !== room.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return; // 没人在线，等有人回来时房主仍是原来的人
    room.hostId = next.user.id;
    this.log(`[rooms] ${room.id} 换房主 → ${next.user.nickname}`);
    for (const m of room.members.values()) {
      if (!m.conn) continue;
      m.conn.send(
        m.user.id === room.hostId
          ? { t: 'room.host', roomId: room.id, hostId: room.hostId, checkpoint: room.checkpoint }
          : { t: 'room.host', roomId: room.id, hostId: room.hostId },
      );
    }
    this.pushRoomState(room);
  }

  private close(room: Room): void {
    if (room.hostTimer) clearTimeout(room.hostTimer);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    for (const m of room.members.values()) {
      if (!m.conn) continue;
      const cs = this.conns.get(m.conn.id);
      if (cs) cs.roomId = null;
      m.conn.send({ t: 'room.left', roomId: room.id, reason: 'closed' });
    }
    this.rooms.delete(room.id);
    this.log(`[rooms] 关闭 ${room.id}`);
    this.markLobbyDirty();
  }

  private hostRoom(cs: ConnState): Room | null {
    const room = cs.roomId ? this.rooms.get(cs.roomId) : undefined;
    if (!room) {
      cs.conn.send({ t: 'error', code: 'not_in_room', message: '不在房间里' });
      return null;
    }
    if (room.hostId !== cs.conn.user.id) {
      cs.conn.send({ t: 'error', code: 'not_host', message: '只有房主能这样做' });
      return null;
    }
    return room;
  }

  private relay(cs: ConnState, to: unknown, data: unknown): void {
    const room = cs.roomId ? this.rooms.get(cs.roomId) : undefined;
    if (!room) {
      cs.conn.send({ t: 'error', code: 'not_in_room', message: '不在房间里' });
      return;
    }
    const from = cs.conn.user.id;
    const msg: ServerMsg = { t: 'relay', from, data };
    let targets: UserId[];
    if (to === 'host') targets = [room.hostId];
    else if (to === 'all') targets = [...room.members.keys()].filter((id) => id !== from);
    else if (Array.isArray(to)) targets = to.map(Number);
    else {
      cs.conn.send({ t: 'error', code: 'bad_request', message: 'relay.to 不合法' });
      return;
    }
    for (const id of targets) room.members.get(id)?.conn?.send(msg);
  }

  // ---------- 积分 ----------

  private reportRating(cs: ConnState, raw: unknown): void {
    const room = this.hostRoom(cs);
    if (!room || !this.ratings) return;
    let result;
    try {
      result = this.ratings.record(parseReport(raw));
    } catch (e) {
      if (!(e instanceof ReportError)) throw e;
      cs.conn.send({ t: 'error', code: 'bad_request', message: e.message });
      return;
    }
    cs.conn.send({ t: 'rating.result', result });
    // 名字旁边显示的积分跟着变；取当前值而不是这局的 after，重复上报的旧局不会把分数改回去
    const ids = result.changes.map((c) => c.userId);
    for (const [id, rating] of this.ratings.current(ids)) {
      const user = this.knownUser(id);
      if (user && user.rating !== rating) this.updateUser({ ...user, rating });
    }
  }

  private knownUser(id: UserId): PublicUser | null {
    for (const r of this.rooms.values()) {
      const m = r.members.get(id);
      if (m) return m.user;
    }
    for (const cs of this.conns.values()) if (cs.conn.user.id === id) return cs.conn.user;
    return null;
  }

  // ---------- 推送 ----------

  private members(room: Room): Member[] {
    return [...room.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ ...m.user, connected: !!m.conn, joinedAt: m.joinedAt }));
  }

  private pushRoomState(room: Room): void {
    const msg: ServerMsg = { t: 'room.state', roomId: room.id, hostId: room.hostId, members: this.members(room), meta: room.meta };
    for (const m of room.members.values()) m.conn?.send(msg);
    this.markLobbyDirty();
  }

  private summaries(): RoomSummary[] {
    // 一个在线的人都没有的房间不在大厅里显示（仍可凭链接进入，直到被关闭）
    return [...this.rooms.values()]
      .filter((r) => [...r.members.values()].some((m) => m.conn))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id,
        hostId: r.hostId,
        hostName: r.members.get(r.hostId)?.user.nickname ?? '',
        members: [...r.members.values()].filter((m) => m.conn).map((m) => m.user),
        meta: r.meta,
        createdAt: r.createdAt,
      }));
  }

  private markLobbyDirty(): void {
    if (this.lobbyDirty) return;
    this.lobbyDirty = true;
    // 合并同一轮事件里的多次变化
    queueMicrotask(() => {
      this.lobbyDirty = false;
      const msg: ServerMsg = { t: 'lobby.rooms', rooms: this.summaries() };
      for (const cs of this.conns.values()) if (cs.watchingLobby) cs.conn.send(msg);
    });
  }

  /** 测试用 */
  checkpointOf(roomId: string): string | null | undefined {
    return this.rooms.get(roomId)?.checkpoint;
  }
}
