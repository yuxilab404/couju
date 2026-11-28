import type { Combo, Move } from './bot.ts';
import { valueOfRank, wildsOf } from './cards.ts';
import { outstanding } from './counter.ts';
import { isBomb } from './patterns.ts';
import type { View } from './rules.ts';

// 用同一副牌试不同首攻，以终局净升级差拟合。训练入口见 scripts/train-opening.ts。
const weights = [
  -0.0357, -0.1864, 0.0617, -0.0207, 0.0067, 0.0609, 0.0774, 0.2190, 0.0881,
  -0.4931, -0.0721, -0.0884, 0.0562, 0.1873, -0.1587, 0.1234, -0.0232,
  -0.0878, -0.4467, 0.0505, 0.0387, 0.3350, -0.1269,
];

type Planner = (hand: readonly string[], level: number) => Combo[];

export function openingFeatures(v: View, moves: Move[], plan: Planner): number[][] {
  const unseen = outstanding(v);
  const me = v.me!;
  const opp = Math.min(v.counts[(me + 1) % 4], v.counts[(me + 3) % 4]);
  const partner = v.counts[(me + 2) % 4];
  return moves.map(({ cards, p }) => {
    const used = new Set(cards);
    const left = plan(v.hand.filter((c) => !used.has(c)), v.level);
    const single = Number(p.kind === 'single'), pair = Number(p.kind === 'pair');
    const bomb = Number(isBomb(p));
    let higherRanks = 0;
    if (single || pair) {
      for (let r = 2; r <= 17; r++) {
        if (valueOfRank(r, v.level) > p.main && unseen[r] >= p.size) higherRanks++;
      }
    }
    return [
      // 出牌的张数、大小、牌型和它消耗的控制牌。
      p.size / 6, p.main / 15, single, pair, Number(p.kind === 'fullHouse'), Number(p.kind === 'triple'),
      Number(p.kind === 'straight'), Number(p.kind === 'tube'), Number(p.kind === 'plate'), bomb, Number(p.main >= 15),
      // 剩牌的弱单、手数、炸弹、这手用掉的配牌、己方和桌外可能接住的同型牌。
      left.filter((c) => c.kind === 'single' && c.main <= 10).length / 4,
      left.length / 8, left.filter(isBomb).length / 3, wildsOf(cards, v.level).length / 2,
      left.filter((c) => c.kind === p.kind && c.main > p.main).length / 3, higherRanks / 10,
      // 同样一手牌，价值还取决于对手、对家和自己离出完有多远。
      (single + pair) * p.main / 15, bomb * p.size / 6, single * opp / 20, pair * opp / 20,
      bomb * left.length / 8, single * partner / 20,
    ];
  });
}

export function chooseOpening(v: View, moves: Move[], plan: Planner): Move {
  const values = openingFeatures(v, moves, plan).map((x) => x.reduce((sum, f, i) => sum + f * weights[i], 0));
  const best = values.indexOf(Math.max(...values));
  return values[best] > values[0] + 0.07 ? moves[best] : moves[0];
}
