import { defineTurnGame } from '@couju/sdk';
import { bot } from './bot.ts';
import * as rules from './rules.ts';
import type { Action, State, View } from './rules.ts';
import { Rules } from './howto.tsx';
import { Board } from './ui.tsx';

export type { Action, State, View } from './rules.ts';

const doudizhu = defineTurnGame<State, Action, View>({
  id: 'doudizhu',
  version: 1,
  name: '斗地主',
  mode: 'turn',
  players: { min: 3, max: 3 },
  setup: ({ rng }) => rules.setup({ rng }),
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
  rules: Rules,
});

export default doudizhu;
