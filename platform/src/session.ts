/**
 * 一个房间的客户端会话：所有人（含房主）都通过它看房间、发操作。
 * 自己是房主时，在这里创建/销毁 HostEngine，并把中继消息接到它上面。
 */
import type { ClientMsg, Member, ServerMsg, UserId } from '@couju/protocol';
import type { Result, Seat } from '@couju/sdk';
import { HostEngine, type HostOptions } from './host.ts';
import type { GameRegistry } from './registry.ts';
import { Store } from './store.ts';
import type { Checkpoint, RatingStatus, RoomPublic, ToHost, ToMember } from './wire.ts';

export interface Link {
  send(msg: ClientMsg): boolean;
  onMessage(fn: (m: ServerMsg) => void): () => void;
  onOpen(fn: () => void): () => void;
}

export interface GameState {
  seat: Seat | null;
  view: unknown;
  seq: number;
  timer: { seats: Seat[]; deadline: number } | null;
  result: Result | null;
  rating: RatingStatus;
}

export interface RoomState {
  status: 'joining' | 'in' | 'gone';
  goneReason: string | null;
  roomId: string | null;
  hostId: UserId | null;
  members: Member[];
  amHost: boolean;
  room: RoomPublic | null;
  game: GameState | null;
  pending: boolean;
  error: string | null;
  notice: string | null;
}

const KNOWN_TO_HOST = new Set(['hello', 'sit', 'act']);
const KNOWN_TO_MEMBER = new Set(['sync', 'reject']);

export class RoomSession {
  readonly state: Store<RoomState>;
  engine: HostEngine | null = null;
  private seq = 0;
  private unsubs: (() => void)[] = [];
  private lastCheckpoint = '';
  private lastMeta = '';
  private disposed = false;

  constructor(
    private link: Link,
    private myId: UserId,
    private registry: GameRegistry,
    private buildId: string,
    /** null = 新建房间 */
    roomId: string | null,
    private hostOpts: HostOptions = {},
  ) {
    this.state = new Store<RoomState>({
      status: 'joining', goneReason: null, roomId, hostId: null, members: [], amHost: false,
      room: null, game: null, pending: false, error: null, notice: null,
    });
    this.unsubs.push(link.onMessage((m) => this.onServer(m)));
    this.unsubs.push(link.onOpen(() => this.enter()));
  }

  // ---------- 操作 ----------

  act(action: unknown): void {
    const seq = ++this.seq;
    this.state.set({ pending: true, error: null });
    // 断线时发不出去：别让按钮一直卡在"处理中"
    if (!this.toHost({ k: 'act', seq, action })) this.state.set({ pending: false, error: '网络断开了，连上后再出一次' });
  }

  sit(seat: Seat | null): void {
    this.toHost({ k: 'sit', seat });
  }

  leave(): void {
    this.link.send({ t: 'room.leave' });
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.engine?.dispose();
    this.engine = null;
  }

  // ---------- 内部 ----------

  private enter(): void {
    if (this.disposed) return;
    const { roomId } = this.state.get();
    // （重新）连上：服务端那边的快照和大厅摘要可能落后了，清掉去重缓存，房主随后会补发最新的
    this.lastCheckpoint = '';
    this.lastMeta = '';
    this.engine?.linkReset();
    if (roomId) {
      // 重连时房间可能已经关了（全员离线太久、服务端重启）：回到 joining，收到 not_found 就转为 gone
      // 断开期间发出的操作可能丢了，房主补发视图后还轮到自己就再点一次，所以先把按钮放开
      this.state.set({ status: 'joining', pending: false });
      this.link.send({ t: 'room.join', roomId });
    } else {
      this.link.send({ t: 'room.create', meta: null });
    }
  }

  private toHost(msg: ToHost): boolean {
    const { hostId } = this.state.get();
    if (this.engine) {
      this.engine.onRelay(this.myId, msg);
      return true;
    }
    return hostId !== null && this.link.send({ t: 'relay', to: 'host', data: msg });
  }

  private onServer(m: ServerMsg): void {
    if (this.disposed) return;
    const st = this.state.get();
    switch (m.t) {
      case 'room.state': {
        if (st.roomId && m.roomId !== st.roomId) return;
        const hostChanged = m.hostId !== st.hostId;
        this.state.set({ status: 'in', roomId: m.roomId, hostId: m.hostId, members: m.members, amHost: m.hostId === this.myId });
        if (m.hostId !== this.myId && this.engine) this.dropEngine();
        this.engine?.membersChanged(m.members);
        if (hostChanged && m.hostId !== this.myId) this.link.send({ t: 'relay', to: 'host', data: { k: 'hello' } });
        return;
      }
      case 'room.host': {
        if (m.roomId !== this.state.get().roomId) return;
        this.state.set({ hostId: m.hostId, amHost: m.hostId === this.myId });
        if (m.hostId === this.myId) {
          if (!this.engine) this.becomeHost(m.checkpoint ?? null);
        } else {
          this.dropEngine();
          this.link.send({ t: 'relay', to: 'host', data: { k: 'hello' } });
        }
        return;
      }
      case 'room.left':
        if (m.roomId !== st.roomId) return;
        this.state.set({
          status: 'gone',
          goneReason: m.reason === 'replaced' ? '你在别的页面进了这个房间' : m.reason === 'closed' ? '房间已关闭' : null,
        });
        this.dispose();
        return;
      case 'error':
        if (m.code === 'not_found' && st.status === 'joining') {
          this.state.set({ status: 'gone', goneReason: m.message });
          this.dispose();
        }
        return;
      case 'relay':
        return this.onRelay(m.from, m.data);
      case 'rating.result':
        this.engine?.onRatingResult(m.result);
        return;
    }
  }

  private onRelay(from: UserId, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const k = (data as { k?: unknown }).k;
    if (typeof k !== 'string') return;
    if (KNOWN_TO_HOST.has(k)) {
      this.engine?.onRelay(from, data);
    } else if (KNOWN_TO_MEMBER.has(k) && from === this.state.get().hostId) {
      this.onHostMsg(data as ToMember);
    }
  }

  private onHostMsg(msg: ToMember): void {
    if (msg.k === 'reject') {
      this.state.set({ pending: false, error: msg.reason });
      return;
    }
    const prev = this.state.get().game;
    const g = msg.game;
    const game: GameState | null = g && {
      seat: g.seat,
      view: g.view,
      seq: g.seq,
      timer: g.timer ? { seats: g.timer.seats, deadline: Date.now() + g.timer.remainingMs } : null,
      result: g.result,
      // 旧版本房主发来的视图没有这个字段
      rating: g.rating ?? null,
    };
    const progressed = !prev || !game || game.seq !== prev.seq;
    this.state.set((s) => ({
      ...s,
      room: msg.room,
      game,
      pending: progressed ? false : s.pending,
      error: progressed ? null : s.error,
      notice: msg.room.buildId !== this.buildId ? '房主的版本和你不同，刷新页面可以更新' : s.notice,
    }));
  }

  private becomeHost(checkpointData: string | null): void {
    let cp: Checkpoint | null = null;
    if (checkpointData) {
      try {
        cp = JSON.parse(checkpointData) as Checkpoint;
      } catch {
        cp = null;
      }
    }
    this.engine = new HostEngine(
      this.registry,
      {
        myId: this.myId,
        buildId: this.buildId,
        sendTo: (id, msg) => this.link.send({ t: 'relay', to: [id], data: msg }),
        deliverLocal: (msg) => this.onHostMsg(msg),
        setMeta: (meta) => {
          const s = JSON.stringify(meta);
          // 只有真的发出去了才记下，断线期间的变化重连后会补发
          if (s !== this.lastMeta && this.link.send({ t: 'room.meta', meta })) this.lastMeta = s;
        },
        setCheckpoint: (data) => {
          if (data !== this.lastCheckpoint && this.link.send({ t: 'room.checkpoint', data })) this.lastCheckpoint = data;
        },
        reportRating: (report) => this.link.send({ t: 'rating.report', report }),
        notice: (msg) => this.state.set({ notice: msg }),
      },
      this.state.get().members,
      cp,
      this.hostOpts,
    );
  }

  private dropEngine(): void {
    this.engine?.dispose();
    this.engine = null;
    this.lastCheckpoint = '';
    this.lastMeta = '';
  }
}
