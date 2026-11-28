/**
 * 掼蛋 bot 对打评测（开发用，不进 CI）。一个 pair 用同一副牌交换双方座位各打一局，
 * 以两局合计的净升级数作配对样本，抵消部分牌运。用法见 arena.sh。
 * node --experimental-strip-types --no-warnings arena.ts <旧版 src 目录> <pair数> <起始种子> [级牌]
 */
import { SeededRng, type Bot } from '@couju/sdk';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bot as newBot } from '../src/searchbot.ts';
import { active, apply, setup, validate, view, type Action, type View } from '../src/rules.ts';
import { sortCards } from '../src/cards.ts';

const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('用法：arena.ts <旧版 src 目录> <pair数> <起始种子> [级牌]');
const oldFile = ['searchbot.ts', 'bot.ts'].map((name) => resolve(dir, name)).find(existsSync);
if (!oldFile) throw new Error(`旧版目录里找不到 searchbot.ts 或 bot.ts：${dir}`);
const oldModule = await import(pathToFileURL(oldFile).href);
const oldBot = oldModule.bot as Bot<View, Action> | undefined;
if (!oldBot) throw new Error(`旧版模块没有导出 bot：${oldFile}`);
const parseIntArg = (raw: string | undefined, fallback: number, name: string) => {
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} 必须是整数`);
  return n;
};
const N = parseIntArg(process.argv[3], 200, 'pair数');
const from = parseIntArg(process.argv[4], 1000, '起始种子');
const level = parseIntArg(process.argv[5], 2, '级牌');
if (N < 1 || from < 0 || from + N - 1 > 0xffff_ffff || level < 2 || level > 14) {
  throw new Error('pair数须大于 0，种子须在 uint32 范围内，级牌须为 2..A（2..14）');
}
let hands = 0, wins = 0, pairs = 0, pts = 0, sq = 0, winSq = 0;
let maxMs = 0, slow = 0, maxCpuMs = 0, slowCpu = 0, cpuMs = 0;
for (let g = 0; g < N; g++) {
  let diff = 0;
  let pairWins = 0;
  for (const newTeam of [0, 1]) {
    const rng = SeededRng.fromSeed(from + g);
    const contexts = [0, 1, 2, 3].map((seat) => ({
      seat, rng: SeededRng.fromSeed((from + g + Math.imul(seat, 0x9e3779b9)) >>> 0),
      signal: new AbortController().signal,
    }));
    let s = setup({ rng, options: { length: 'one' } });
    // 单副评测默认用 2；可指定 3..A 检查级牌强度。保持实际发牌随机序列不变。
    if (level !== 2) s = {
      ...s, level, teamLevels: [level, level],
      hands: s.hands.map((hand) => sortCards(hand, level)),
    };
    while (s.phase !== 'ended') {
      const seat = active(s)[0];
      const useNew = seat % 2 === newTeam;
      const bot = useNew ? newBot : oldBot;
      const wallStart = performance.now();
      const cpuStart = process.cpuUsage();
      const a = await bot.decide(view(s, seat), contexts[seat]);
      const elapsed = performance.now() - wallStart;
      const cpu = process.cpuUsage(cpuStart);
      const decisionCpuMs = (cpu.user + cpu.system) / 1000;
      if (useNew) {
        maxMs = Math.max(maxMs, elapsed);
        maxCpuMs = Math.max(maxCpuMs, decisionCpuMs);
        cpuMs += decisionCpuMs;
        if (elapsed > 100) slow++;
        if (decisionCpuMs > 100) slowCpu++;
      }
      const err = validate(s, seat, a);
      if (err) throw new Error(`种子 ${from + g}、级牌 ${level}、座位 ${seat} 非法动作：${err}`);
      s = apply(s, seat, a, { rng });
    }
    const hand = s.lastHand!;
    hands++;
    if (hand.winTeam === newTeam) pairWins++;
    diff += hand.winTeam === newTeam ? hand.up : -hand.up;
  }
  pairs++;
  wins += pairWins;
  winSq += pairWins * pairWins;
  pts += diff;
  sq += diff * diff;
}
console.log(JSON.stringify({ hands, wins, winSq, pts, sq, pairs, maxMs, slow, cpuMs, maxCpuMs, slowCpu, level, seedFrom: from }));
