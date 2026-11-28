/** 测试用的玩具游戏：轮流加 1 或 2，先到 7 的人赢。每人有一个只有自己知道的秘密数。 */
import { defineTurnGame } from '@couju/sdk';

interface S { n: number; turn: number; players: number; secrets: number[]; winner: number | null }
type A = { add: 1 | 2 };
interface V { n: number; turn: number; mySecret: number | null }

export const toy = defineTurnGame<S, A, V>({
  id: 'toy',
  version: 1,
  name: '加到七',
  mode: 'turn',
  players: { min: 2, max: 4 },
  setup: ({ numPlayers, rng }) => ({
    n: 0, turn: rng.int(numPlayers), players: numPlayers,
    secrets: Array.from({ length: numPlayers }, () => 100 + rng.int(900)), winner: null,
  }),
  turn: {
    active: (s) => (s.winner === null ? [s.turn] : []),
    validate: (_s, _seat, a) => (a && (a.add === 1 || a.add === 2) ? null : '只能加 1 或 2'),
    apply: (s, seat, a) => {
      const n = s.n + a.add;
      return { ...s, n, turn: (s.turn + 1) % s.players, winner: n >= 7 ? seat : null };
    },
    timer: () => ({ ms: 10_000, seats: [] as number[] }),
  },
  view: (s, seat) => ({ n: s.n, turn: s.turn, mySecret: seat === null ? null : s.secrets[seat] }),
  result: (s) =>
    s.winner === null
      ? null
      : { winners: [s.winner], scores: Array.from({ length: s.players }, (_, i) => (i === s.winner ? 1 : 0)), summary: `${s.winner} 赢` },
  bot: { decide: () => ({ add: 1 }) },
  ui: () => null,
  rules: () => null,
});
