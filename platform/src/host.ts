/**
 * 房主权威循环（ARCHITECTURE.md §4.3）：只在当前房主的浏览器里存在。
 * 持有房间配置、座位、游戏状态与随机数；按视角下发、调度 bot 与计时、写快照。
 * 不认识任何游戏的规则，只通过 GameDef 接口调用。
 */
import { SeededRng, defaultOptions, type AnyGameDef, type Result, type Seat, type TurnGameDef } from '@couju/sdk';
import { deepFreeze } from '@couju/sdk/testing.ts';
import { RATING, type MatchRating, type MatchReport, type Member, type UserId } from '@couju/protocol';
import {
  scoreKey,
  type Checkpoint,
  type GameEnvelope,
  type GamePublic,
  type LobbyMeta,
  type RatingStatus,
  type RoomConfig,
  type RoomPhase,
  type RoomPublic,
  type SeatSlot,
  type ToHost,
  type ToMember,
} from './wire.ts';
import { findGame, type GameRegistry } from './registry.ts';

export interface HostIO {
  myId: UserId;
  buildId: string;
  /** 发给其他成员（经中继） */
  sendTo(userId: UserId, msg: ToMember): void;
  /** 发给房主自己的客户端（本地） */
  deliverLocal(msg: ToMember): void;
  setMeta(meta: LobbyMeta): void;
  setCheckpoint(data: string): void;
  /** 一局结束后上报输赢（ADR-0007）；返回是否发出去了，没发出去的重连后再发 */
  reportRating(report: MatchReport): boolean;
  notice?(msg: string): void;
}

export interface HostOptions {
  /** bot 出手前的"思考"延迟 */
  botDelayMs?: [number, number];
  /** 真人掉线多久后由 bot 托管 */
  hostedAfterMs?: number;
  random?: () => number;
  freeze?: boolean;
  /** 开局时打乱座位（默认开）。只有要按固定座位断言的测试才关 */
  shuffleSeats?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TurnGame = TurnGameDef<any, any, any, any>;

interface LiveGame {
  def: TurnGame;
  env: GameEnvelope;
  rng: SeededRng;
  result: Result | null;
}

interface TimerState {
  handle: ReturnType<typeof setTimeout>;
  seq: number;
  key: string | undefined;
  seats: Seat[];
  deadline: number;
}

export class HostEngine {
  private config: RoomConfig;
  private seats: SeatSlot[];
  private phase: RoomPhase = 'waiting';
  private scoreboard: Record<string, number> = {};
  private round = 0;
  private game: LiveGame | null = null;
  /** 托管中的座位 = 掉线托管 ∪ 自己点的托管（manual） */
  private hosted = new Set<Seat>();
  /** 自己点了托管的座位（ADR-0009）：人在线也不收回，直到他取消、出手或这局结束 */
  private manual = new Set<Seat>();
  private members = new Map<UserId, Member>();
  private offlineTimers = new Map<UserId, ReturnType<typeof setTimeout>>();
  private timer: TimerState | null = null;
  /** 当前局面第一次被安排的时刻，算 pause 剩多少用 */
  private stateAt: { game: LiveGame | null; seq: number; at: number } = { game: null, seq: -1, at: 0 };
  private bots = new Map<Seat, AbortController>();
  private dirty = false;
  private disposed = false;
  /** 已结束、还没收到服务端回执的局；sent=false 的在下次下发时发出 */
  private unrated = new Map<string, { report: MatchReport; sent: boolean }>();
  private readonly botDelay: [number, number];
  private readonly hostedAfterMs: number;
  private readonly random: () => number;
  private readonly freeze: boolean;
  private readonly shuffleSeats: boolean;

  constructor(
    private registry: GameRegistry,
    private io: HostIO,
    members: Member[],
    checkpoint: Checkpoint | null,
    opts: HostOptions = {},
  ) {
    this.botDelay = opts.botDelayMs ?? [800, 1500];
    this.hostedAfterMs = opts.hostedAfterMs ?? 30_000;
    this.random = opts.random ?? Math.random;
    this.freeze = opts.freeze ?? false;
    this.shuffleSeats = opts.shuffleSeats ?? true;
    for (const m of members) this.members.set(m.id, m);

    const first = registry[0];
    this.config = { gameId: first.id, options: defaultOptions(first) };
    this.seats = Array.from({ length: first.players.min }, () => ({ kind: 'empty' }) as SeatSlot);
    if (checkpoint) this.restore(checkpoint);
    else {
      this.autoSeat(io.myId);
      for (const m of [...members].sort((a, b) => a.joinedAt - b.joinedAt)) this.autoSeat(m.id);
    }
    this.syncHosted(true);
    this.changed();
    this.schedule();
  }

  // ---------------- 外部事件 ----------------

  membersChanged(members: Member[]): void {
    if (this.disposed) return;
    const before = this.members;
    this.members = new Map(members.map((m) => [m.id, m]));
    if (this.phase === 'waiting') {
      // 离开房间的人让出座位
      this.seats = this.seats.map((s) => (s.kind === 'human' && !this.members.has(s.userId) ? { kind: 'empty' } : s));
      for (const m of members) if (!before.has(m.id)) this.autoSeat(m.id);
    }
    this.syncHosted(false);
    this.changed();
    this.schedule();
  }

  /** 服务端记完分了 */
  onRatingResult(r: MatchRating): void {
    if (this.disposed) return;
    // 快照里的待报列表也跟着变
    if (this.unrated.delete(r.matchId)) this.changed();
    const g = this.game;
    if (g && g.env.matchId === r.matchId && !g.env.rating) {
      g.env = { ...g.env, rating: r };
      this.changed();
    }
  }

  /** 和服务端的连接断过又连上：没回执的上报再发一次，快照和大厅摘要也补发 */
  linkReset(): void {
    if (this.disposed) return;
    for (const u of this.unrated.values()) u.sent = false;
    this.changed();
  }

  onRelay(from: UserId, data: unknown): void {
    if (this.disposed || !data || typeof data !== 'object') return;
    const msg = data as ToHost;
    switch (msg.k) {
      case 'hello':
        this.sendSync(from);
        return;
      case 'sit':
        return this.sit(from, msg.seat);
      case 'act':
        return this.act(from, msg.seq, msg.action);
      case 'auto':
        return this.setAuto(from, msg.on === true);
    }
  }

  // ---------------- 房主操作（房主界面直接调用） ----------------

  selectGame(gameId: string): void {
    if (this.phase !== 'waiting') return;
    const def = findGame(this.registry, gameId);
    if (!def) return;
    this.config = { gameId, options: defaultOptions(def) };
    this.resizeSeats(clamp(this.seats.length, def.players.min, def.players.max));
    this.changed();
  }

  setOption(key: string, value: unknown): void {
    if (this.phase !== 'waiting') return;
    this.config = { ...this.config, options: { ...this.config.options, [key]: value } };
    this.changed();
  }

  setSeatCount(n: number): void {
    if (this.phase !== 'waiting') return;
    const def = this.currentDef();
    this.resizeSeats(clamp(n, def.players.min, def.players.max));
    this.changed();
  }

  /** 设为空位 / bot / 把人请下座 */
  setSlot(seat: Seat, slot: SeatSlot): void {
    if (this.phase !== 'waiting' || seat < 0 || seat >= this.seats.length) return;
    if (slot.kind === 'human') {
      this.seats = this.seats.map((s) => (s.kind === 'human' && s.userId === slot.userId ? { kind: 'empty' } : s));
    }
    this.seats[seat] = slot;
    this.seats = [...this.seats];
    this.changed();
  }

  /** 有队伍的游戏里，房主帮大家换座（选队友）；其他游戏开局会随机排座，用不着 */
  swapSeats(a: Seat, b: Seat): void {
    if (this.phase !== 'waiting' || !this.currentDef().teams) return;
    if (a < 0 || b < 0 || a >= this.seats.length || b >= this.seats.length) return;
    const s = [...this.seats];
    [s[a], s[b]] = [s[b], s[a]];
    this.seats = s;
    this.changed();
  }

  canStart(): string | null {
    if (this.phase !== 'waiting') return '已经开始了';
    const def = this.currentDef();
    if (def.mode !== 'turn') return '实时游戏的房主循环还没有实现';
    if (!this.seats.some((s) => s.kind === 'human')) return '至少要有一个真人';
    if (this.seats.length < def.players.min || this.seats.length > def.players.max) return '人数不对';
    return null;
  }

  /**
   * 开局。空座按 bot 补满，然后：
   * - 有固定队伍的游戏（声明了 teams，比如掼蛋）按等人时的座位开，大家在外面自己选队友；
   * - 其他游戏随机排座，等人时坐哪儿只决定谁上桌。
   */
  start(): void {
    if (this.canStart() !== null) return;
    const def = this.currentDef() as TurnGame;
    this.seats = this.seats.map((s) => (s.kind === 'empty' ? { kind: 'bot' } : s));
    if (!def.teams && this.shuffleSeats) this.seats = this.shuffled(this.seats);
    const seed = Math.floor(this.random() * 2 ** 32);
    const rng = SeededRng.fromSeed(seed);
    const numPlayers = this.seats.length;
    const options = { ...defaultOptions(def), ...this.config.options };
    const state = def.setup({ numPlayers, options, rng });
    this.game = {
      def,
      rng,
      result: null,
      env: {
        gameId: def.id,
        gameVersion: def.version,
        numPlayers,
        options,
        state: this.maybeFreeze(state),
        rng: rng.state(),
        seq: 0,
        seatKeys: this.seats.map(scoreKey),
        matchId: this.newMatchId(),
        rating: null,
      },
    };
    this.game.result = def.result(state);
    this.phase = 'playing';
    this.round++;
    this.manual.clear();
    this.syncHosted(true);
    this.changed();
    this.schedule();
  }

  /** 结算后再来一局：同 start，有队伍的游戏座位不变，其他游戏重新随机 */
  rematch(): void {
    if (this.phase !== 'ended') return;
    this.phase = 'waiting';
    this.game = null;
    this.start();
  }

  backToRoom(): void {
    this.stopAll();
    this.phase = 'waiting';
    this.game = null;
    this.hosted.clear();
    this.manual.clear();
    // 不在线的人让出座位，bot 留着
    this.seats = this.seats.map((s) => (s.kind === 'human' && !this.members.get(s.userId)?.connected ? { kind: 'empty' } : s));
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
  }

  /** 房主界面读取 */
  snapshot(): { config: RoomConfig; seats: SeatSlot[]; phase: RoomPhase } {
    return { config: this.config, seats: this.seats, phase: this.phase };
  }

  // ---------------- 内部 ----------------

  private currentDef(): AnyGameDef {
    return findGame(this.registry, this.config.gameId) ?? this.registry[0];
  }

  private resizeSeats(n: number): void {
    const s = this.seats.slice(0, n);
    while (s.length < n) s.push({ kind: 'empty' });
    this.seats = s;
    // 座位多出来了：还站着的人按入房顺序坐下
    const standing = [...this.members.values()].filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    for (const m of standing) this.autoSeat(m.id);
  }

  private autoSeat(userId: UserId): void {
    if (this.phase !== 'waiting') return;
    if (this.seats.some((s) => s.kind === 'human' && s.userId === userId)) return;
    const i = this.seats.findIndex((s) => s.kind === 'empty');
    if (i >= 0) this.seats[i] = { kind: 'human', userId };
  }

  private seatOf(userId: UserId): Seat | null {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.userId === userId);
    return i >= 0 ? i : null;
  }

  private sit(from: UserId, seat: Seat | null): void {
    if (this.phase !== 'waiting') return this.sendSync(from);
    if (seat === null) {
      this.seats = this.seats.map((s) => (s.kind === 'human' && s.userId === from ? { kind: 'empty' } : s));
    } else if (seat >= 0 && seat < this.seats.length && this.seats[seat].kind === 'empty') {
      this.seats = this.seats.map((s) => (s.kind === 'human' && s.userId === from ? { kind: 'empty' } : s));
      this.seats[seat] = { kind: 'human', userId: from };
    }
    this.changed();
  }

  private act(from: UserId, seq: number, action: unknown): void {
    const reject = (reason: string) => this.send(from, { k: 'reject', seq, reason });
    const g = this.game;
    if (this.phase !== 'playing' || !g) return reject('现在不能操作');
    const seat = this.seatOf(from);
    if (seat === null) return reject('你没有坐在这一局里');
    // 人自己出手了：不管是掉线回来还是点过托管，托管都结束
    if (this.hosted.has(seat)) this.release(seat);
    const err = this.tryApply(seat, action);
    if (err) reject(err);
  }

  /** 自己点托管 / 取消托管：只在对局中、坐在这一局里时有效 */
  private setAuto(from: UserId, on: boolean): void {
    const seat = this.seatOf(from);
    if (this.phase !== 'playing' || !this.game || seat === null) return this.sendSync(from);
    if (on) {
      this.manual.add(seat);
      this.hosted.add(seat);
    } else if (this.hosted.has(seat)) {
      this.release(seat);
    }
    this.changed();
    this.schedule();
  }

  /** 座位交还给真人：停掉正在替他想的 bot */
  private release(seat: Seat): void {
    this.manual.delete(seat);
    this.hosted.delete(seat);
    this.bots.get(seat)?.abort();
    this.bots.delete(seat);
  }

  /** 返回 null 表示已应用 */
  private tryApply(seat: Seat, action: unknown): string | null {
    const g = this.game!;
    const s = g.env.state;
    try {
      if (!g.def.turn.active(s).includes(seat)) return '还没轮到你';
      const reason = g.def.turn.validate(s, seat, action);
      if (reason !== null) return reason;
      const next = g.def.turn.apply(s, seat, action, { rng: g.rng });
      g.env = { ...g.env, state: this.maybeFreeze(next), rng: g.rng.state(), seq: g.env.seq + 1 };
    } catch (e) {
      // 游戏代码出错：状态不变，随机数回到动作前
      g.rng = new SeededRng(g.env.rng);
      this.io.notice?.(`游戏出错：${(e as Error).message}`);
      return '操作格式不正确';
    }
    g.result = g.def.result(g.env.state);
    if (g.result) this.finish(g.result);
    this.changed();
    this.schedule();
    return null;
  }

  private finish(result: Result): void {
    this.phase = 'ended';
    // 自己点的托管只管这一局；掉线托管的照旧显示，人还没回来
    for (const seat of this.manual) this.hosted.delete(seat);
    this.manual.clear();
    const keys = this.game!.env.seatKeys;
    result.scores?.forEach((d, seat) => {
      const k = keys[seat];
      this.scoreboard = { ...this.scoreboard, [k]: (this.scoreboard[k] ?? 0) + d };
    });
    this.queueRating();
    this.stopAll();
  }

  /**
   * 这局要上报的输赢；不计分时为 null。按开局时的座位算：中途离开、托管的人照样计输赢。
   * bot 不参与积分，所以至少要有一个真人赢、一个真人输。
   */
  private ratingReport(): MatchReport | null {
    const g = this.game;
    if (!g?.result || !g.env.matchId) return null;
    const weight = Math.max(0, Math.min(RATING.maxWeight, Number(g.result.weight ?? 1) || 0));
    const winners: UserId[] = [];
    const losers: UserId[] = [];
    g.env.seatKeys.forEach((k, seat) => {
      if (!k.startsWith('u')) return;
      (g.result!.winners.includes(seat) ? winners : losers).push(Number(k.slice(1)));
    });
    if (weight === 0 || winners.length === 0 || losers.length === 0) return null;
    return { matchId: g.env.matchId, gameId: g.env.gameId, weight, winners, losers };
  }

  private queueRating(): void {
    const g = this.game;
    if (!g || g.env.rating) return;
    const report = this.ratingReport();
    if (report && !this.unrated.has(report.matchId)) this.unrated.set(report.matchId, { report, sent: false });
  }

  private ratingStatus(): RatingStatus {
    const g = this.game;
    if (!g || this.phase !== 'ended') return null;
    return g.env.rating ?? (this.ratingReport() ? 'pending' : null);
  }

  private shuffled<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private newMatchId(): string {
    const part = () => Math.floor(this.random() * 2 ** 32).toString(16).padStart(8, '0');
    return part() + part();
  }

  private maybeFreeze<T>(s: T): T {
    return this.freeze ? deepFreeze(s) : s;
  }

  /** 根据成员在线情况更新托管座位 */
  private syncHosted(immediate: boolean): void {
    if (this.phase !== 'playing') {
      this.hosted.clear();
      this.manual.clear();
      return;
    }
    this.seats.forEach((slot, seat) => {
      if (slot.kind !== 'human') {
        this.manual.delete(seat);
        return;
      }
      const m = this.members.get(slot.userId);
      const pending = this.offlineTimers.get(slot.userId);
      // 自己点的托管：在线也一直托管，掉线了更不用等宽限
      if (this.manual.has(seat)) {
        if (pending) clearTimeout(pending);
        this.offlineTimers.delete(slot.userId);
        this.hosted.add(seat);
        return;
      }
      if (m?.connected) {
        if (pending) clearTimeout(pending);
        this.offlineTimers.delete(slot.userId);
        if (this.hosted.has(seat)) this.release(seat);
        return;
      }
      if (this.hosted.has(seat) || pending) return;
      // 不在房间里（主动离开）或刚恢复的快照：立即托管；掉线：给宽限
      if (!m || immediate) {
        this.hosted.add(seat);
      } else {
        const round = this.round;
        this.offlineTimers.set(
          slot.userId,
          setTimeout(() => {
            this.offlineTimers.delete(slot.userId);
            if (this.phase !== 'playing' || this.disposed || this.round !== round) return;
            // 这个座位现在还得是同一个人
            const now = this.seats[seat];
            if (now?.kind !== 'human' || now.userId !== slot.userId) return;
            if (this.members.get(slot.userId)?.connected) return;
            this.hosted.add(seat);
            this.changed();
            this.schedule();
          }, this.hostedAfterMs),
        );
      }
    });
  }

  private botControlled(seat: Seat): boolean {
    return this.seats[seat]?.kind === 'bot' || this.hosted.has(seat);
  }

  private clearOfflineTimers(): void {
    for (const t of this.offlineTimers.values()) clearTimeout(t);
    this.offlineTimers.clear();
  }

  private stopAll(): void {
    this.clearOfflineTimers();
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
    for (const c of this.bots.values()) c.abort();
    this.bots.clear();
  }

  /** 状态或座位控制变化后：安排 bot 与倒计时 */
  private schedule(): void {
    const g = this.game;
    if (this.disposed || this.phase !== 'playing' || !g) return;
    const s = g.env.state;
    const active = g.def.turn.active(s);

    for (const seat of active) if (this.botControlled(seat) && !this.bots.has(seat)) this.runBot(seat, 0);

    const t = g.def.turn.timer?.(s) ?? null;
    // 同一个状态（只是座位控制或成员变了）不重新计时；给了相同 key 也沿用
    const sameTimer =
      t && this.timer && (this.timer.seq === g.env.seq || (t.key !== undefined && t.key === this.timer.key));
    if (!sameTimer) {
      if (this.timer) clearTimeout(this.timer.handle);
      this.timer = null;
      if (t) {
        const seq = g.env.seq;
        const ms = t.ms + this.pauseMs();
        this.timer = {
          seq,
          key: t.key,
          seats: t.seats,
          deadline: Date.now() + ms,
          handle: setTimeout(() => this.onTimeout(), ms),
        };
      }
    }
  }

  /** 当前局面游戏要求的停顿（TurnRules.pause），从这个局面出现时算起 */
  private pauseMs(): number {
    const g = this.game;
    if (!g?.def.turn.pause) return 0;
    let ms = 0;
    try {
      ms = Number(g.def.turn.pause(g.env.state)) || 0;
    } catch {
      ms = 0;
    }
    const full = Math.max(0, Math.min(10_000, ms));
    // 同一个局面里重新安排（成员变化、托管切换）时只停剩下的部分
    const now = Date.now();
    if (this.stateAt.game !== g || this.stateAt.seq !== g.env.seq) this.stateAt = { game: g, seq: g.env.seq, at: now };
    return Math.max(0, full - (now - this.stateAt.at));
  }

  private onTimeout(): void {
    const g = this.game;
    const t = this.timer;
    this.timer = null;
    if (!g || !t || this.phase !== 'playing') return;
    const active = g.def.turn.active(g.env.state);
    for (const seat of t.seats) {
      if (!active.includes(seat)) continue;
      if (g.def.turn.onTimeout) {
        const err = this.tryApply(seat, g.def.turn.onTimeout(g.env.state, seat));
        if (err) this.io.notice?.(`超时默认动作不合法：${err}`);
      } else if (!this.bots.has(seat)) {
        this.runBot(seat, 0, true);
      }
    }
  }

  private runBot(seat: Seat, attempt: number, immediate = false): void {
    const g = this.game!;
    const ctl = new AbortController();
    this.bots.set(seat, ctl);
    const [lo, hi] = this.botDelay;
    // 局面刚变时游戏要求停一会儿（让人看清翻牌之类），停完再"思考"
    const delay = immediate ? 0 : this.pauseMs() + lo + this.random() * (hi - lo);
    const view = JSON.parse(JSON.stringify(g.def.view(g.env.state, seat)));
    const rng = SeededRng.fromSeed(Math.floor(this.random() * 2 ** 32));

    const done = () => {
      if (this.bots.get(seat) === ctl) this.bots.delete(seat);
    };
    setTimeout(async () => {
      if (ctl.signal.aborted) return done();
      let action: unknown;
      try {
        action = await g.def.bot.decide(view, { seat, rng, signal: ctl.signal });
      } catch (e) {
        this.io.notice?.(`bot 出错：${(e as Error).message}`);
        return done();
      }
      if (ctl.signal.aborted || this.game !== g || this.phase !== 'playing') return done();
      done();
      if (!g.def.turn.active(g.env.state).includes(seat)) return;
      // 真人回来了就不替他出
      if (!this.botControlled(seat) && !immediate) return;
      const err = this.tryApply(seat, action);
      if (err) {
        // 局面在 bot 思考期间变了：重新问一次
        if (attempt < 2) this.runBot(seat, attempt + 1, true);
        else this.io.notice?.(`bot 连续出了不合法的动作：${err}`);
      }
    }, delay);
  }

  // ---------------- 下发 ----------------

  private changed(): void {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (this.disposed) return;
      this.broadcast();
      this.io.setCheckpoint(JSON.stringify(this.checkpoint()));
      this.io.setMeta(this.meta());
      for (const u of this.unrated.values()) if (!u.sent) u.sent = this.io.reportRating(u.report);
    });
  }

  private roomPublic(): RoomPublic {
    return {
      config: this.config,
      seats: this.seats,
      hosted: [...this.hosted],
      phase: this.phase,
      scoreboard: this.scoreboard,
      round: this.round,
      buildId: this.io.buildId,
    };
  }

  private gamePublic(seat: Seat | null, shared?: unknown): GamePublic | null {
    const g = this.game;
    if (!g) return null;
    const t = this.timer;
    return {
      seat,
      view: shared !== undefined ? shared : g.def.view(g.env.state, seat),
      seq: g.env.seq,
      timer: t ? { seats: t.seats, remainingMs: Math.max(0, t.deadline - Date.now()) } : null,
      result: g.result,
      rating: this.ratingStatus(),
      pauseMs: this.pauseMs(),
    };
  }

  private broadcast(): void {
    const room = this.roomPublic();
    const g = this.game;
    const shared = g?.def.publicView ? g.def.view(g.env.state, null) : undefined;
    const ids = new Set<UserId>([this.io.myId]);
    for (const m of this.members.values()) if (m.connected) ids.add(m.id);
    for (const id of ids) {
      this.send(id, { k: 'sync', room, game: this.gamePublic(this.seatOf(id), shared) });
    }
  }

  private sendSync(userId: UserId): void {
    this.send(userId, { k: 'sync', room: this.roomPublic(), game: this.gamePublic(this.seatOf(userId)) });
  }

  private send(userId: UserId, msg: ToMember): void {
    if (userId === this.io.myId) this.io.deliverLocal(msg);
    else this.io.sendTo(userId, msg);
  }

  private meta(): LobbyMeta {
    const def = this.currentDef();
    return {
      gameId: def.id,
      gameName: def.name,
      seats: this.seats.length,
      humans: this.seats.filter((s) => s.kind === 'human').length,
      phase: this.phase,
    };
  }

  private checkpoint(): Checkpoint {
    return {
      v: 1,
      buildId: this.io.buildId,
      config: this.config,
      seats: this.seats,
      phase: this.phase,
      scoreboard: this.scoreboard,
      round: this.round,
      game: this.game ? this.game.env : null,
      unrated: [...this.unrated.values()].map((u) => u.report),
      manual: [...this.manual],
    };
  }

  private restore(cp: Checkpoint): void {
    // 上一任房主没等到回执的上报：先接过来，不管这个房间现在玩什么、能不能恢复
    for (const r of cp.unrated ?? []) this.unrated.set(r.matchId, { report: r, sent: false });
    const def = findGame(this.registry, cp.config.gameId);
    if (!def) {
      this.io.notice?.('房间里的游戏在你的版本里不存在，请刷新页面');
      return;
    }
    this.config = cp.config;
    this.seats = cp.seats;
    this.scoreboard = cp.scoreboard;
    this.round = cp.round;
    this.phase = cp.phase === 'ended' ? 'ended' : cp.phase;
    if (cp.game && cp.phase !== 'waiting') {
      if (cp.game.gameVersion !== def.version || def.mode !== 'turn') {
        this.io.notice?.('你的游戏版本和这局不一致，请刷新页面；这一局已回到等人');
        this.phase = 'waiting';
        return;
      }
      const turnDef = def as TurnGame;
      this.game = {
        def: turnDef,
        env: {
          ...cp.game,
          state: this.maybeFreeze(cp.game.state),
          // TODO(del-when: 积分上线一周后，旧版本写的快照都已过期)：旧快照没有 matchId，这局不计积分
          matchId: cp.game.matchId ?? '',
          rating: cp.game.rating ?? null,
        },
        rng: new SeededRng(cp.game.rng),
        result: turnDef.result(cp.game.state),
      };
      // 上一任房主可能没来得及报或没收到回执：再报一次，服务端按 matchId 去重
      if (this.phase === 'ended') this.queueRating();
      // TODO(del-when: 手动托管上线一周后，旧版本写的快照都已过期)：旧快照没有 manual
      else for (const seat of cp.manual ?? []) if (this.seats[seat]?.kind === 'human') this.manual.add(seat);
    } else {
      this.phase = 'waiting';
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
