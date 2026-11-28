/** 同一副牌换座，逐局写回放。用法见 BOT.md。 */
import { open } from 'node:fs/promises';
import { players, playHand } from './opponent-hand.ts';
const [opponentPath, startArg, countArg, replayPath, ourModule] = process.argv.slice(2);
const start = Number(startArg), count = Number(countArg);
if (!opponentPath || !replayPath || !Number.isSafeInteger(start) || start < 0 ||
    !Number.isSafeInteger(count) || count < 1 || start + count > 2 ** 32) {
  throw new Error('用法：opponent-arena.ts <对手模块> <起始种子> <种子数> <新回放.jsonl> [我方 bot 模块]');
}
const replay = await open(replayPath, 'wx');
try {
  const lineup = await players(opponentPath, ourModule);
  try {
    let wins = 0, points = 0;
    for (let seed = start; seed < start + count; seed++) {
      for (const team of [0, 1]) {
        const hand = await playHand(seed, team, lineup);
        wins += Number(hand.win);
        points += hand.net;
        await replay.writeFile(JSON.stringify(hand) + '\n');
      }
    }
    console.log(JSON.stringify({ start, pairs: count, wins, points }));
  } finally { await lineup.opponent.close?.(); }
} finally { await replay.close(); }
