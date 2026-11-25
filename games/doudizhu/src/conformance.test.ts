import { runConformance } from '@couju/sdk/testing.ts';
import { expect, it } from 'vitest';
import doudizhu from './index.ts';

it('一致性：bot 自对弈 300 局', async () => {
  const r = await runConformance(doudizhu, { games: 300 });
  console.log(`conformance: ${r.games} 局，平均 ${r.avgSteps.toFixed(1)} 步`);
  expect(r.games).toBe(300);
}, 120_000);
