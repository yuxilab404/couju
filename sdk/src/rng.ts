/**
 * 可序列化的确定性随机数（sfc32）。平台持有状态，以参数传给游戏；
 * 游戏只看到 Rng 接口，不得使用 Math.random。
 */
export type RngState = [number, number, number, number];

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, n) 的整数 */
  int(n: number): number;
  /** 返回打乱后的新数组，不改入参 */
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T;
}

export class SeededRng implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  /** 由任意 32 位种子生成初始状态 */
  static fromSeed(seed: number): SeededRng {
    const r = new SeededRng([0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0]);
    for (let i = 0; i < 15; i++) r.next();
    return r;
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[this.int(items.length)];
  }
}
