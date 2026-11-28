/**
 * 掼蛋 bot 对打评测（开发用，不进 CI）：当前代码的 bot 对 <旧版目录> 里的 bot，
 * 每副牌两队交换再打一遍（复式），抵消牌运。用法见 arena.sh。
 * node --experimental-strip-types --no-warnings arena.ts <旧版 src 目录> <副数> <起始种子>
 */
import { SeededRng } from '@couju/sdk';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bot as newBot } from '../src/searchbot.ts';
import { active, apply, setup, validate, view, type Action, type View } from '../src/rules.ts';

type AnyBot = { decide(v: View, ctx: never): Action | Promise<Action> };
const dir = resolve(process.argv[2]);
const oldFile = existsSync(`${dir}/searchbot.ts`) ? `${dir}/searchbot.ts` : `${dir}/bot.ts`;
const oldBot = (await import(oldFile)).bot as AnyBot;
const N = Number(process.argv[3] ?? 200);
const from = Number(process.argv[4] ?? 1000);
const ctx = { seat: 0, rng: SeededRng.fromSeed(1), signal: new AbortController().signal } as never;

let pts = 0, wins = 0, hands = 0, sq = 0, maxMs = 0, slow = 0;
for (let g = 0; g < N; g++) {
  let pair = 0;
  for (const newTeam of [0, 1]) {
    const rng = SeededRng.fromSeed(from + g);
    let s = setup({ rng, options: { length: 'one' } });
    while (s.phase !== 'ended') {
      const seat = active(s)[0];
      const t = performance.now();
      const a = await (seat % 2 === newTeam ? newBot : oldBot).decide(view(s, seat), ctx);
      const dt = performance.now() - t;
      if (seat % 2 === newTeam) { maxMs = Math.max(maxMs, dt); if (dt > 100) slow++; }
      const err = validate(s, seat, a);
      if (err) throw new Error(`非法动作：${err}`);
      s = apply(s, seat, a, { rng });
    }
    const h = s.lastHand!;
    hands++;
    if (h.winTeam === newTeam) { wins++; pair += h.up; } else pair -= h.up;
  }
  pts += pair;
  sq += pair * pair;
}
console.log(JSON.stringify({ hands, wins, pts, sq, pairs: N, maxMs, slow }));
