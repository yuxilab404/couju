import { runConformance } from '@couju/sdk/testing.ts';
import { expect, it } from 'vitest';
import game from './index.ts';

it('一致性：bot 自对弈 300 局（2–6 人轮流）', async () => {
  const r = await runConformance(game, { games: 300 });
  console.log(`conformance: ${r.games} 局，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(300);
}, 120_000);
