/** 到服务端的 WebSocket：保活、断线重连、登录失效检测。 */
import { LIMITS, WS_PATH, type ClientMsg, type Me, type ServerMsg } from '@couju/protocol';
import { href } from './base.ts';
import { Store } from './store.ts';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'unauthorized';

export interface ConnState {
  status: ConnStatus;
  me: Me | null;
}

export class Connection {
  readonly state = new Store<ConnState>({ status: 'connecting', me: null });
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerMsg) => void>();
  private openListeners = new Set<() => void>();
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  private stopped = false;

  constructor(private url = defaultUrl()) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearPing();
    this.ws?.close();
    this.ws = null;
  }

  onMessage(fn: (m: ServerMsg) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 每次（重新）连上时调用；已连上则立即调用一次 */
  onOpen(fn: () => void): () => void {
    this.openListeners.add(fn);
    if (this.state.get().status === 'open') fn();
    return () => this.openListeners.delete(fn);
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        this.retry = 0;
        this.state.set({ status: 'open', me: msg.me });
        for (const fn of this.openListeners) fn();
        return;
      }
      for (const fn of this.listeners) fn(msg);
    };
    ws.onopen = () => {
      this.clearPing();
      this.ping = setInterval(() => this.send({ t: 'ping' }), LIMITS.pingIntervalMs);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearPing();
      this.ws = null;
      if (this.stopped) return;
      void this.afterClose();
    };
  }

  private async afterClose(): Promise<void> {
    // 握手 401 在浏览器里看不到状态码，用 /api/me 区分"登录失效"和"网络断了"
    try {
      const r = await fetch(href('/api/me'));
      if (r.status === 401) {
        this.state.set({ status: 'unauthorized' });
        return;
      }
    } catch {
      /* 网络问题，继续重连 */
    }
    this.state.set({ status: 'reconnecting' });
    const delay = Math.min(10_000, 500 * 2 ** this.retry++);
    setTimeout(() => !this.stopped && this.open(), delay);
  }

  private clearPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }
}

function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${href(WS_PATH)}`;
}
