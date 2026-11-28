/** 重跑已记录的一局并验证每手相同，然后只改一个决策再打到底。步号从 0 开始。 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { players, playHand } from './opponent-hand.ts';
import type { Action } from '../src/rules.ts';

const [opponent, trace, seedArg, teamArg, turnArg, actionJson, ours] = process.argv.slice(2);
const seed = Number(seedArg), team = Number(teamArg), turn = Number(turnArg);
if (!actionJson || !Number.isSafeInteger(turn) || turn < 0 || ![0, 1].includes(team)) {
  throw new Error('用法：opponent-replay.ts <对手模块> <回放.jsonl> <种子> <我方队> <步号> <替代动作JSON> [原我方模块]');
}
const action: Action = JSON.parse(actionJson);
const recorded = readFileSync(trace, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  .find(row => row.seed === seed && row.ourTeam === team);
if (!recorded) throw new Error('回放里没有指定的种子和座次');
const run = async (change?: {turn: number; action: Action}) => {
  const lineup = await players(opponent, ours);
  try { return await playHand(seed, team, lineup, change); } finally { await lineup.opponent.close?.(); }
};
const original = await run();
if (!isDeepStrictEqual(original, recorded)) throw new Error('原局未能逐步重现，请核对双方版本');
const alternative = await run({ turn, action });
if (!isDeepStrictEqual(original.turns.slice(0, turn), alternative.turns.slice(0, turn))) throw new Error('两局在指定决策前已分歧');
console.log(JSON.stringify({ seed, team, turn, original: original.turns[turn], alternative: alternative.turns[turn],
  netBefore: original.net, netAfter: alternative.net, orderBefore: original.order, orderAfter: alternative.order }));
