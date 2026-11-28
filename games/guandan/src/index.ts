import { defineTurnGame } from '@couju/sdk';
import { bot } from './searchbot.ts';
import * as rules from './rules.ts';
import type { Action, Options, State, View } from './rules.ts';
import { Board } from './ui.tsx';

export type { Action, Options, State, View } from './rules.ts';

const guandan = defineTurnGame<State, Action, View, Options>({
  id: 'guandan',
  version: 1,
  name: '掼蛋',
  mode: 'turn',
  players: { min: 4, max: 4 },
  // 对家一队：1、3 号位一队，2、4 号位一队
  teams: () => [0, 1, 0, 1],
  options: [
    {
      key: 'length',
      label: '打多久',
      choices: [
        { value: 'full', label: '从 2 打过 A' },
        { value: 'one', label: '只打一副' },
      ],
      default: rules.DEFAULT_OPTIONS.length,
    },
    {
      key: 'aLimit',
      label: '打 A',
      choices: [
        { value: 3, label: '三次不过回到 2' },
        { value: 0, label: '不限次数' },
      ],
      default: rules.DEFAULT_OPTIONS.aLimit,
    },
  ],
  setup: ({ rng, options }) => rules.setup({ rng, options }),
  turn: {
    active: rules.active,
    validate: rules.validate,
    apply: rules.apply,
    timer: rules.timer,
  },
  view: rules.view,
  result: rules.result,
  privateTokens: rules.privateTokens,
  bot,
  ui: Board,
});

export default guandan;
