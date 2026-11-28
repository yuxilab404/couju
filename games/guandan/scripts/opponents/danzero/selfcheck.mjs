import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SeededRng } from '@couju/sdk';
import { active, apply, setup, validate, view } from '../../../src/rules.ts';
import { interpret } from '../../../src/patterns.ts';
import { sortCards } from '../../../src/cards.ts';
import { decide } from '../../../src/bot.ts';
import { createOpponent } from './opponent.mjs';

const opponent = await createOpponent();
const lab = process.env.DANZERO_LAB ?? fileURLToPath(new URL('../../../.baseline/external-danzero/', import.meta.url));
mkdirSync(lab, { recursive: true });
const report = { info: opponent.info, games: [], candidatesChecked: 0, sample: null };
const replay = [];
try {
  for (let g = 0; g < 8; g++) {
    const rng = SeededRng.fromSeed(1250000 + g);
    const contexts = Array.from({ length: 4 }, (_, seat) => ({ seat, rng: SeededRng.fromSeed(g * 4 + seat), signal: new AbortController().signal }));
    let state = setup({ rng, options: { length: 'one' } });
    const level = [2, 3, 5, 10, 11, 12, 13, 14][g];
    state = { ...state, level, teamLevels: [level, level], hands: state.hands.map((h) => sortCards(h, level)) };
    let steps = 0;
    let earlyForGame = 0;
    const late = [];
    while (state.phase !== 'ended') {
      const seat = active(state)[0];
      const v = view(state, seat);
      if (seat % 2 === 1 && steps < 10) {
        const candidates = await opponent.enumerate(v);
        for (const a of candidates) assert.equal(validate(state, seat, a), null, JSON.stringify({ a, level }));
        report.candidatesChecked += candidates.length;
        if (!report.sample && candidates.length > 50) report.sample = v;
      }
      const action = seat % 2 === 1 ? await opponent.decide(v) : decide(v);
      if (seat % 2 === 1) {
        const item = { v: structuredClone(v), action };
        late.push(item);
        if (steps > 30 && earlyForGame < 3) { earlyForGame++; replay.push(item); }
      }
      assert.equal(validate(state, seat, action), null, JSON.stringify({ seed: 1250000 + g, seat, action }));
      state = apply(state, seat, action, { rng });
      assert(++steps < 1000);
    }
    report.games.push({ seed: 1250000 + g, level, steps, winner: state.winnerTeam, order: state.finished });
    replay.push(...late.slice(-3));
    console.log(JSON.stringify(report.games.at(-1)));
  }
  // 接口拒绝完整 State，防止评测器误传真手牌。
  await assert.rejects(opponent.decide({ hands: [[], [], [], []] }), /public View/);
  // seed 924022：两家出完，当前玩家刚 PASS 后接风，历史末项仍是自己。
  const windFollow = JSON.parse(readFileSync(new URL('./fixtures/wind-follow.json', import.meta.url), 'utf8'));
  const windFollowAction = { type: 'play', cards: ['H12a'], as: { kind: 'single', main: 12 } };
  assert.deepEqual(await opponent.decide(windFollow), windFollowAction);
  replay.push({ v: windFollow, action: windFollowAction });
  for (const entry of replay.toReversed()) assert.deepEqual(await opponent.decide(entry.v), entry.action);
  const cold = await createOpponent();
  try {
    for (const entry of replay.toReversed()) assert.deepEqual(await cold.decide(entry.v), entry.action);
  } finally { cold.close(); }
  report.replayedViews = replay.length;
  writeFileSync(join(lab, 'replay-fixtures.json'), JSON.stringify(replay, null, 2));
  const base = report.sample;
  const fixture = (hand, level) => ({ ...structuredClone(base), me: 0, turn: 0, hand, level, teamLevels: [level, level], levelTeam: null, history: [], finished: [], lastPlay: null });
  const cases = [
    { v: fixture(['H02a', 'H02b', ...['S', 'H', 'C', 'D'].flatMap(s => [`${s}08a`, `${s}08b`])], 2), match: a => a.as?.kind === 'bomb' && a.cards.length === 10 },
    { v: fixture(['J16a', 'J16b', 'J17a', 'J17b'], 2), match: a => a.as?.kind === 'jokerBomb' },
    { v: fixture(['S14a','H14a','C14a','S02a','C02a','D02a','S03a','H03a','C03a','S13a','H13a','C13a'], 5), match: a => a.as?.kind === 'tube' && a.as.main === 3 },
    { v: fixture(['S14a','H14a','C14a','S02a','C02a','D02a','S03a','H03a','C03a','S13a','H13a','C13a'], 5), match: a => a.as?.kind === 'plate' && a.as.main === 2 },
    { v: fixture(['S14a','H14a','C14a','S02a','C02a','D02a','S03a','H03a','C03a','S13a','H13a','C13a'], 5), match: a => a.as?.kind === 'plate' && a.as.main === 14 },
    { v: fixture(['S03a','S04a','S05a','S06a','S07a'], 2), match: a => a.as?.kind === 'straightFlush' && a.as.main === 7 },
    { v: fixture(['S09a','H09a','C09a','J16a','J16b'], 2), match: a => a.as?.kind === 'fullHouse' && a.as.main === 9 },
  ];
  for (const { v, match } of cases) {
    const actions = await opponent.enumerate(v);
    assert(actions.some(match));
    for (const a of actions) assert(interpret(a.cards, v.level, null, a.as));
    report.candidatesChecked += actions.length;
  }
  report.rareFixtures = cases.length;
  report.stats = opponent.stats;
  writeFileSync(join(lab, 'selfcheck-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ candidateCount: report.candidatesChecked, stats: report.stats }));
} finally { opponent.close(); }
