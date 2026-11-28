import { defineTurnGame } from '@couju/sdk';
import { bot } from './bot.ts';
import * as rules from './rules.ts';
import type { Action, Options, State, View } from './rules.ts';
import { Rules } from './howto.tsx';
import { Board } from './ui.tsx';

export type { Action, Options, State, View } from './rules.ts';

const zhajinhua = defineTurnGame<State, Action, View, Options>({
  id: 'zhajinhua',
  version: 1,
  name: '炸金花',
  mode: 'turn',
  players: { min: 2, max: 6 },
  options: [
    {
      key: 'maxRounds',
      label: '封顶轮数',
      choices: [
        { value: 5, label: '5 轮' },
        { value: 10, label: '10 轮' },
        { value: 20, label: '20 轮' },
      ],
      default: rules.DEFAULT_OPTIONS.maxRounds,
    },
    {
      key: 'blindRounds',
      label: '必闷',
      choices: [
        { value: 0, label: '不限制' },
        { value: 1, label: '第 1 轮必闷' },
        { value: 3, label: '前 3 轮必闷' },
      ],
      default: rules.DEFAULT_OPTIONS.blindRounds,
    },
    {
      key: 'beat235',
      label: '235',
      choices: [
        { value: true, label: '235 吃豹子' },
        { value: false, label: '235 就是单张' },
      ],
      default: rules.DEFAULT_OPTIONS.beat235,
    },
  ],
  setup: ({ numPlayers, options, rng }) => rules.setup({ numPlayers, options, rng }),
  turn: {
    active: rules.active,
    validate: rules.validate,
    apply: rules.apply,
    timer: rules.timer,
    onTimeout: rules.onTimeout,
    pause: rules.pause,
  },
  view: rules.view,
  result: rules.result,
  privateTokens: rules.privateTokens,
  bot,
  ui: Board,
  rules: Rules,
});

export default zhajinhua;
