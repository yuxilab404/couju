import { runConformance } from '@couju/sdk/testing.ts';
import { expect, it } from 'vitest';
import guandan from './index.ts';

/** 默认规则是整场（打过 A），一场几十副；大部分局只打一副，另跑几场完整比赛 */
const oneHand = {
  ...guandan,
  options: guandan.options!.map((o) => (o.key === 'length' ? { ...o, default: 'one' } : o)),
};

it('一致性：只打一副，bot 自对弈 60 局', async () => {
  const r = await runConformance(oneHand, { games: 60 });
  console.log(`conformance(一副): ${r.games} 局，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(60);
}, 120_000);

it('一致性：从 2 打过 A 的完整比赛 4 场（含进贡、还贡、抗贡、打 A）', async () => {
  const r = await runConformance(guandan, { games: 4, seed: 7, maxSteps: 40_000 });
  console.log(`conformance(整场): ${r.games} 场，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(4);
}, 300_000);
