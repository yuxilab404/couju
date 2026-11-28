/**
 * 局面估值：给一个完整局面（四家手牌都知道，搜索里随机分好的那种），估计 seat 所在的队这副最后净升几级。
 * 网络是离线自对弈练出来的小 MLP（scripts/train/），权重在 value-weights.ts；这里只有特征和前向计算。
 * 特征先编成小整数（训练数据按字节存），再按 SCALE 缩放。改特征要重新训练。
 */
import { isWild, rankOf } from './cards.ts';
import type { Kind } from './patterns.ts';
import type { State } from './rules.ts';

const KINDS: Kind[] = ['single', 'pair', 'triple', 'fullHouse', 'straight', 'tube', 'plate', 'bomb', 'straightFlush', 'jokerBomb'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17];

/** 每家：按大小排的 15 格（级牌排在 A 后面）、按自然点数的 13 格、配牌数、张数、是否出完 */
const PER_SEAT = 15 + 13 + 3;
export const FEATURES = 4 * PER_SEAT + 13 + 4 + (1 + KINDS.length + 2 + 4 + 1) + 5;

/** 每个特征的缩放：原始值都是 0..27 的整数 */
export const SCALE: number[] = (() => {
  const s: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 28; i++) s.push(1 / 4);
    s.push(1 / 2, 1 / 27, 1);
  }
  for (let i = 0; i < 13 + 4 + 1 + KINDS.length; i++) s.push(1);
  s.push(1 / 17, 1 / 10, 1, 1, 1, 1, 1 / 3);
  for (let i = 0; i < 5; i++) s.push(1);
  return s;
})();

/** 局面 → 原始整数特征（seat 视角：座位按 seat、下家、对家、上家排） */
export function encode(s: State, seat: number, out: Uint8Array = new Uint8Array(FEATURES)): Uint8Array {
  out.fill(0);
  const level = s.level;
  // 按大小排：2..A 去掉级牌，然后级牌、小王、大王
  const order = RANKS.filter((r) => r !== level && r <= 14);
  order.push(level, 16, 17);
  const slot = new Array<number>(18).fill(0);
  order.forEach((r, i) => (slot[r] = i));
  let k = 0;
  for (let rel = 0; rel < 4; rel++) {
    const h = s.hands[(seat + rel) % 4];
    for (const id of h) {
      if (isWild(id, level)) {
        out[k + 28]++;
        continue;
      }
      const r = rankOf(id);
      out[k + slot[r]]++;
      if (r <= 14) out[k + 15 + r - 2]++;
    }
    out[k + 29] = h.length;
    out[k + 30] = s.finished.includes((seat + rel) % 4) ? 1 : 0;
    k += PER_SEAT;
  }
  out[k + level - 2] = 1;
  k += 13;
  out[k + ((s.turn - seat + 4) % 4)] = 1;
  k += 4;
  const lp = s.lastPlay;
  if (lp) {
    out[k] = 1;
    out[k + 1 + KINDS.indexOf(lp.kind)] = 1;
    out[k + 1 + KINDS.length] = lp.main;
    out[k + 2 + KINDS.length] = Math.min(lp.size, 10);
    out[k + 3 + KINDS.length + ((lp.seat - seat + 4) % 4)] = 1;
    out[k + 7 + KINDS.length] = s.passes;
  }
  k += 1 + KINDS.length + 2 + 4 + 1;
  // 头游是谁（相对座位），还没人出完记在最后一格
  if (s.finished.length) out[k + ((s.finished[0] - seat + 4) % 4)] = 1;
  else out[k + 4] = 1;
  return out;
}

export interface Net {
  /** 每层 [输出数][输入数] 展平的权重和偏置；隐藏层 ReLU，输出 tanh × 3 */
  layers: { w: Float32Array; b: Float32Array; inp: number; out: number }[];
}

const buf = new Uint8Array(FEATURES);

export function evaluate(net: Net, s: State, seat: number): number {
  encode(s, seat, buf);
  let x = new Float32Array(FEATURES);
  for (let i = 0; i < FEATURES; i++) x[i] = buf[i] * SCALE[i];
  net.layers.forEach((L, li) => {
    const y = new Float32Array(L.out);
    for (let o = 0; o < L.out; o++) {
      let a = L.b[o];
      const row = o * L.inp;
      for (let i = 0; i < L.inp; i++) a += L.w[row + i] * x[i];
      y[o] = li < net.layers.length - 1 ? Math.max(0, a) : a;
    }
    x = y;
  });
  return 3 * Math.tanh(x[0]);
}
