import type { AnyGameDef } from '@couju/sdk';

/** web/src/games.ts 提供；平台只按 id 查找，不认识具体游戏 */
export type GameRegistry = readonly AnyGameDef[];

export function findGame(registry: GameRegistry, id: string): AnyGameDef | undefined {
  return registry.find((g) => g.id === id);
}
