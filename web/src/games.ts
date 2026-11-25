/**
 * 游戏注册表：加一个新游戏 = 新建 games/<id>/ + 在这里加一行。
 * 第一个是建房时的默认游戏。
 */
import type { GameRegistry } from '@couju/platform';
import doudizhu from '@couju/game-doudizhu';

export const games: GameRegistry = [doudizhu];
