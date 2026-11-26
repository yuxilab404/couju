/**
 * 发现新版本（ADR-0006）：拉前端产物里的 version.json，和自己这份代码的 buildId 比。
 * 不经过服务端（服务端不认识前端版本）。只负责"知道有新版"，什么时候提示由界面决定。
 */
import { href } from './base.ts';
import { Store } from './store.ts';

export const UPDATE_CHECK_INTERVAL_MS = 10 * 60_000;

export interface UpdateState {
  /** 线上的新版本号；没有新版本时为 null */
  latest: string | null;
}

export async function fetchDeployedBuild(): Promise<string | null> {
  const r = await fetch(href('version.json'), { cache: 'no-store' });
  if (!r.ok) return null;
  const v = (await r.json()) as { buildId?: unknown };
  return typeof v.buildId === 'string' ? v.buildId : null;
}

/** 当前页面是不是正在打一局：对局中先不弹"有新版本"，这局打完再说 */
export const tableActivity = new Store<{ playing: boolean }>({ playing: false });

export class UpdateWatcher {
  readonly state = new Store<UpdateState>({ latest: null });
  private checking = false;

  constructor(
    private buildId: string,
    private fetchBuild: () => Promise<string | null> = fetchDeployedBuild,
  ) {}

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const v = await this.fetchBuild();
      if (v && v !== this.buildId && v !== this.state.get().latest) this.state.set({ latest: v });
    } catch {
      /* 拿不到就下次再看（开发环境没有 version.json，返回的是页面） */
    } finally {
      this.checking = false;
    }
  }

  /** 定时、切回前台、（重新）连上服务器时检查；服务端重启部署后重连那一下最先发现 */
  start(onReconnect: (fn: () => void) => () => void): () => void {
    const check = () => void this.check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const off = onReconnect(check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      off();
    };
  }
}
