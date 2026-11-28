import { defineTurnGame } from '@couju/sdk';
import { bot } from './bot.ts';
import * as rules from './rules.ts';
import type { Action, State, View } from './rules.ts';
import { Rules } from './howto.tsx';
import { Board } from './ui.tsx';

export type { Action, State, View } from './rules.ts';

const liarRoulette = defineTurnGame<State, Action, View>({
  id: 'liar-roulette',
  version: 1,
  name: '唬牌',
  mode: 'turn',
  players: { min: 3, max: 5 },
  setup: ({ numPlayers, rng }) => rules.setup({ numPlayers, rng }),
  turn: {
    active: rules.active,
    validate: rules.validate,
    apply: rules.apply,
    timer: rules.timer,
    pause: rules.pause,
  },
  view: rules.view,
  result: rules.result,
  privateTokens: rules.privateTokens,
  bot,
  ui: Board,
  rules: Rules,
});

export default liarRoulette;
