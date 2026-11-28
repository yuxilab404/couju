/**
 * 重训开局领出的线性评分器。用当前规则发牌，用指定版本的规则 bot 把各候选打到底。
 * 复现首版权重，从仓库根目录运行（基准源码放在仓库内才能解析 SDK）。
 * mkdir -p games/guandan/.baseline/teacher
 * git archive da10f0b games/guandan/src | tar -x -C games/guandan/.baseline/teacher --strip-components=3
 * node games/guandan/scripts/train-opening.ts games/guandan/.baseline/teacher 400001 3200
 */
import { SeededRng } from '@couju/sdk';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sortCards } from '../src/cards.ts';
import { openingFeatures } from '../src/opening.ts';
import { apply, setup, view, type State } from '../src/rules.ts';

if (!process.argv[2]) throw new Error('请指定基准规则 bot 的 src 目录');
const teacher: typeof import('../src/bot.ts') = await import(pathToFileURL(resolve(process.argv[2], 'bot.ts')).href);
const start = Number(process.argv[3] ?? 400001), count = Number(process.argv[4] ?? 3200);
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 1 || start + count > 2 ** 32) {
  throw new Error('发牌数须为正整数，种子须在 uint32 范围内');
}

function finish(s: State, team: number, rng: SeededRng): number {
  while (s.phase === 'playing') {
    const action = teacher.decide(view(s, s.turn));
    s = apply(s, s.turn, action, { rng });
  }
  const h = s.lastHand!;
  return h.winTeam === team ? h.up : -h.up;
}

// 累加 XᵀX 和 Xᵀy 即可，不需要保留牌局或样本。x 和 y 都取相对同一首选的差。
let matrix: number[][] = [], samples = 0;
for (let seed = start; seed < start + count; seed++) {
  const rng = SeededRng.fromSeed(seed);
  let s = setup({ rng, options: { length: 'one' } });
  const level = [2, 5, 10, 14][seed % 4];
  s = { ...s, level, teamLevels: [level, level], hands: s.hands.map((h) => sortCards(h, level)) };
  let positions = 0;
  while (s.phase === 'playing' && s.hands.reduce((n, h) => n + h.length, 0) > 50 && positions < 4) {
    const v = view(s, s.turn);
    const first = teacher.decide(v);
    if (!s.lastPlay && first.type === 'play' && rng.next() < 0.5) {
      const moves = teacher.leadOrder(v);
      if (moves.length >= 2 && moves.length <= 12) {
        const features = openingFeatures(v, moves, teacher.planHand);
        const outcomes = moves.map((m) => {
          const next = apply(s, s.turn, { type: 'play', cards: m.cards, as: m.as }, { rng });
          return finish(next, s.turn % 2, rng);
        });
        for (let k = 1; k < moves.length; k++) {
          const x = features[k].map((f, i) => f - features[0][i]);
          if (!matrix.length) matrix = x.map(() => Array(x.length + 1).fill(0));
          for (let i = 0; i < x.length; i++) {
            for (let j = 0; j < x.length; j++) matrix[i][j] += x[i] * x[j];
            matrix[i][x.length] += x[i] * (outcomes[k] - outcomes[0]);
          }
          samples++;
        }
        positions++;
      }
    }
    s = apply(s, s.turn, first, { rng });
  }
}

// 解带 L2 正则的方程，正则项也让相关的牌型特征有唯一解。
const d = matrix.length;
if (!d) throw new Error('这些种子没有产生可比较的首攻');
for (let i = 0; i < d; i++) matrix[i][i] += 25;
for (let i = 0; i < d; i++) {
  const pivot = matrix[i][i];
  for (let j = i; j <= d; j++) matrix[i][j] /= pivot;
  for (let k = 0; k < d; k++) {
    if (k === i) continue;
    const factor = matrix[k][i];
    for (let j = i; j <= d; j++) matrix[k][j] -= factor * matrix[i][j];
  }
}
console.log(JSON.stringify({ samples, weights: matrix.map((r) => Number(r[d].toFixed(4))) }));
