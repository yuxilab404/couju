/**
 * 估值网络的训练数据（强化版）：规则 bot 打到全场剩 START 张，之后四家都用搜索 bot 打完，
 * 记下这段里随机抽的局面和最后结果。网络学的是"按搜索 bot 的水平打下去会怎样"。
 * node --experimental-strip-types --no-warnings gen-search.ts <副数> <种子> <输出文件> [START]
 */
import { SeededRng } from '@couju/sdk';
import { writeFileSync } from 'node:fs';
import { decide as ruleDecide } from '../../src/bot.ts';
import { decide as searchDecide } from '../../src/searchbot.ts';
import { active, apply, setup, view, type State } from '../../src/rules.ts';
import { encode, FEATURES } from '../../src/value.ts';

const N = Number(process.argv[2]);
const seed = Number(process.argv[3]);
const file = process.argv[4];
const START = Number(process.argv[5] ?? 80);
const pick = SeededRng.fromSeed(seed ^ 0x9e3779b9);
const rows: Uint8Array[] = [];
const outs: number[] = [];
const flush = () => {
  const buf = new Uint8Array(rows.length * (FEATURES + 1));
  rows.forEach((r, i) => {
    buf.set(r, i * (FEATURES + 1));
    buf[i * (FEATURES + 1) + FEATURES] = outs[i] & 0xff;
  });
  writeFileSync(file, buf);
};
for (let g = 0; g < N; g++) {
  const rng = SeededRng.fromSeed(seed * 1_000_003 + g);
  let s: State = setup({ rng, options: { length: 'one' } });
  const mine: { row: Uint8Array; seat: number }[] = [];
  while (s.phase === 'playing') {
    const total = s.hands.reduce((n, h) => n + h.length, 0);
    const seat = active(s)[0];
    if (total <= START) {
      if (pick.int(2) === 0) {
        const p = pick.int(4);
        mine.push({ row: encode(s, p), seat: p });
      }
      s = apply(s, seat, await searchDecide(view(s, seat)), { rng });
    } else s = apply(s, seat, ruleDecide(view(s, seat)), { rng });
  }
  const h = s.lastHand!;
  for (const m of mine) {
    rows.push(m.row);
    outs.push(h.winTeam === m.seat % 2 ? h.up : -h.up);
  }
  if (g % 500 === 499) flush();
}
flush();
console.log(`${N} 副，${rows.length} 个局面`);
