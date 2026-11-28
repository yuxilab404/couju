/** 从同一局面分别跟牌和过牌，都打到底，再拟合净升级差。可按种子分片，命令见 BOT.md。 */
import { SeededRng } from '@couju/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sortCards } from '../src/cards.ts';
import { contestExample } from '../src/contest.ts';
import { apply, setup, view, type Action, type State, type View } from '../src/rules.ts';
import { solveRidge } from './ridge.ts';

const [mode, ...args] = process.argv.slice(2);
if (mode === 'fit') {
  const [penaltyArg, ...files] = args;
  const penalty = Number(penaltyArg);
  if (!(penalty > 0) || !files.length) throw new Error('用法：fit <正则系数> <采样文件...>');
  let matrix: number[][] = [], samples = 0;
  for (const file of files) {
    const batch = JSON.parse(readFileSync(file, 'utf8')) as { matrix: number[][]; samples: number };
    if (!matrix.length) matrix = batch.matrix;
    else batch.matrix.forEach((row, i) => row.forEach((value, j) => matrix[i][j] += value));
    samples += batch.samples;
  }
  console.log(JSON.stringify({ samples, weights: solveRidge(matrix, penalty) }));
} else if (mode === 'sample') {
  const [rulePath, opponentPath, from, size, output] = args;
  const start = Number(from), count = Number(size);
  if (!output || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || start + count > 2 ** 32) {
    throw new Error('用法：sample <基准 bot.ts> <rule 或外部模块> <起始种子> <种子数> <采样文件>');
  }
  const load = (path: string) => import(pathToFileURL(resolve(path)).href);
  const rule: (v: View) => Action = (await load(rulePath)).decide;
  const opponent = opponentPath === 'rule' ? { decide: rule } : await (await load(opponentPath)).createOpponent();
  let matrix: number[][] = [], samples = 0;
  try {
    for (let seed = start; seed < start + count; seed++) {
      const team = seed % 2, level = 2 + seed % 13, rng = SeededRng.fromSeed(seed);
      const dealt = setup({ rng, options: { length: 'one' } });
      let s: State = { ...dealt, level, teamLevels: [level, level], hands: dealt.hands.map(h => sortCards(h, level)) };
      const play = (s: State) => s.turn % 2 === team ? rule(view(s, s.turn)) : opponent.decide(view(s, s.turn));
      const pool: { state: State; first: Action }[] = [];
      while (s.phase === 'playing' && s.hands.reduce((n, h) => n + h.length, 0) > 50) {
        const first = await play(s);
        if (s.turn % 2 === team && s.lastPlay && s.lastPlay.seat % 2 !== team) pool.push({ state: s, first });
        s = apply(s, s.turn, first, { rng });
      }
      let positions = 0;
      for (const { state, first } of rng.shuffle(pool)) {
        const example = contestExample(view(state, state.turn), first);
        if (!example) continue;
        const payoff = async (a: Action) => {
          let next = apply(state, state.turn, a, { rng });
          while (next.phase === 'playing') next = apply(next, next.turn, await play(next), { rng });
          const h = next.lastHand!;
          return h.winTeam === team ? h.up : -h.up;
        };
        const gain = await payoff(example.action) - await payoff({ type: 'pass' });
        const x = example.features;
        if (!matrix.length) matrix = x.map(() => Array(x.length + 1).fill(0));
        for (let i = 0; i < x.length; i++) {
          for (let j = 0; j < x.length; j++) matrix[i][j] += x[i] * x[j];
          matrix[i][x.length] += x[i] * gain;
        }
        samples++;
        if (++positions === 6) break;
      }
    }
  } finally { await opponent.close?.(); }
  writeFileSync(output, JSON.stringify({ start, count, samples, matrix }), { flag: 'wx' });
} else {
  throw new Error('请选择 sample 或 fit，命令见 BOT.md');
}
