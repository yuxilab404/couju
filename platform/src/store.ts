/** 极简可订阅状态，配合 React useSyncExternalStore */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = (): T => this.value;
  set(patch: Partial<T> | ((v: T) => T)): void {
    this.value = typeof patch === 'function' ? patch(this.value) : { ...this.value, ...patch };
    for (const l of this.listeners) l();
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}
