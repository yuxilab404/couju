/**
 * 估值网络的训练数据：规则 bot 自对弈，随机抽局面记下特征和"这一队最后净升几级"。
 * node --experimental-strip-types --no-warnings gen.ts <副数> <种子> <输出文件>
 * 输出每行 FEATURES 个字节的特征 + 1 个字节（有符号）的结果。
 */
import { SeededRng } from '@couju/sdk';
import { writeFileSync } from 'node:fs';
import { decide } from '../../src/bot.ts';
import { active, apply, setup, view, type State } from '../../src/rules.ts';
import { encode, FEATURES } from '../../src/value.ts';

const N = Number(process.argv[2]);
const seed = Number(process.argv[3]);
const file = process.argv[4];
const pick = SeededRng.fromSeed(seed ^ 0x9e3779b9);
const rows: Uint8Array[] = [];
const outs: number[] = [];
for (let g = 0; g < N; g++) {
  const rng = SeededRng.fromSeed(seed * 1_000_003 + g);
  let s: State = setup({ rng, options: { length: 'one' } });
  const mine: { row: Uint8Array; seat: number }[] = [];
  while (s.phase === 'playing') {
    if (pick.int(4) === 0) {
      const seat = pick.int(4);
      mine.push({ row: encode(s, seat), seat });
    }
    const seat = active(s)[0];
    s = apply(s, seat, decide(view(s, seat)), { rng });
  }
  const h = s.lastHand!;
  for (const m of mine) {
    rows.push(m.row);
    outs.push(h.winTeam === m.seat % 2 ? h.up : -h.up);
  }
}
const buf = new Uint8Array(rows.length * (FEATURES + 1));
rows.forEach((r, i) => {
  buf.set(r, i * (FEATURES + 1));
  buf[i * (FEATURES + 1) + FEATURES] = outs[i] & 0xff;
});
writeFileSync(file, buf);
console.log(`${N} 副，${rows.length} 个局面`);
