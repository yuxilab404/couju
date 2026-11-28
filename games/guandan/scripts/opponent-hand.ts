import { SeededRng, type Bot } from '@couju/sdk';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sortCards } from '../src/cards.ts';
import { active, apply, setup, validate, view, type Action, type State, type View } from '../src/rules.ts';
import { bot as tableBot } from '../src/searchbot.ts';

interface Opponent {
  decide(v: View): Action | Promise<Action>;
  close?(): void | Promise<void>;
}
export async function players(opponentPath: string, ourModule?: string) {
  const load = (path: string) => import(pathToFileURL(resolve(path)).href);
  const ours: Bot<View, Action> = ourModule ? (await load(ourModule)).bot : tableBot;
  const factory = (await load(opponentPath)).createOpponent;
  if (typeof factory !== 'function' || typeof ours?.decide !== 'function') throw new Error('参赛模块缺少出牌入口');
  const opponent: Opponent = await factory();
  if (typeof opponent?.decide !== 'function') throw new Error('对手缺少 decide(view)');
  return { ours, opponent };
}

export async function playHand(seed: number, ourTeam: number, lineup: Awaited<ReturnType<typeof players>>,
  change?: { turn: number; action: Action }) {
  const level = 2 + seed % 13;
  const rng = SeededRng.fromSeed(seed);
  const dealt = setup({ rng, options: { length: 'one' } });
  let s: State = { ...dealt, level, teamLevels: [level, level], hands: dealt.hands.map(h => sortCards(h, level)) };
  const turns: { seat: number; action: Action }[] = [];
  const contexts = [0, 1, 2, 3].map(seat => ({
    seat, rng: SeededRng.fromSeed((seed + Math.imul(seat, 0x9e3779b9)) >>> 0), signal: new AbortController().signal,
  }));
  while (s.phase !== 'ended') {
    const seat = active(s)[0], v = view(s, seat);
    let action = seat % 2 === ourTeam ? await lineup.ours.decide(v, contexts[seat]) : await lineup.opponent.decide(v);
    if (change?.turn === turns.length) {
      if (seat % 2 !== ourTeam) throw new Error('只可替换我方决策');
      action = change.action;
    }
    const error = validate(s, seat, action);
    if (error) throw new Error(JSON.stringify({ seed, level, ourTeam, turn: turns.length, seat, action, error }));
    turns.push({ seat, action });
    s = apply(s, seat, action, { rng });
  }
  if (change && change.turn >= turns.length) throw new Error('指定决策超出回放长度');
  const { order, winTeam, up } = s.lastHand!;
  const win = winTeam === ourTeam;
  return { seed, level, ourTeam, win, net: win ? up : -up, turns, order };
}
