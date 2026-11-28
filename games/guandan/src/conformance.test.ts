import { runConformance } from '@couju/sdk/testing.ts';
import { expect, it } from 'vitest';
import { decide as ruleDecide } from './bot.ts';
import guandan from './index.ts';

/**
 * 默认规则是整场（打过 A），一场几十副；大部分局只打一副，另跑几场完整比赛。
 * 牌桌上的搜索 bot 一步要推演上百次，只跑几局；其余用它底下的规则 bot（快得多）。
 */
const oneHand = {
  ...guandan,
  options: guandan.options!.map((o) => (o.key === 'length' ? { ...o, default: 'one' } : o)),
};
const ruleBot = { decide: ruleDecide };

it('一致性：只打一副，搜索 bot 自对弈 6 局', async () => {
  const r = await runConformance(oneHand, { games: 6, seed: 3 });
  expect(r.games).toBe(6);
}, 120_000);

it('一致性：只打一副，规则 bot 自对弈 60 局', async () => {
  const r = await runConformance({ ...oneHand, bot: ruleBot }, { games: 60 });
  console.log(`conformance(一副): ${r.games} 局，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(60);
}, 120_000);

it('一致性：从 2 打过 A 的完整比赛 4 场（含进贡、还贡、抗贡、打 A）', async () => {
  const r = await runConformance({ ...guandan, bot: ruleBot }, { games: 4, seed: 7, maxSteps: 40_000 });
  console.log(`conformance(整场): ${r.games} 场，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(4);
}, 300_000);
