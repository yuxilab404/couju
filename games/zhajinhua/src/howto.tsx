/** 炸金花规则说明（平台"规则"弹窗里画它，ADR-0010）。例牌用规则自己的牌型识别，档位、时间取自规则代码。 */
import { CardRow } from '@couju/kit-cards';
import type { RulesProps } from '@couju/sdk';
import { describe, KIND_LABEL, type Kind } from './patterns.ts';
import { ANTE, normalizeOptions, STAKES, TURN_MS, type Options, type View } from './rules.ts';
import { cardFace } from './ui.tsx';

/** 牌型从大到小，每种一个例子；howto.test 检查例子真是这个牌型、并且一个压一个 */
export const EXAMPLES: { kind: Kind; cards: string[]; note: string }[] = [
  { kind: 'trips', cards: ['S14', 'H14', 'D14'], note: '三张一样的点数。AAA 最大，222 最小' },
  { kind: 'straightFlush', cards: ['H12', 'H13', 'H14'], note: '同一花色的三张连牌' },
  { kind: 'flush', cards: ['C2', 'C7', 'C11'], note: '同一花色，不连' },
  { kind: 'straight', cards: ['S4', 'H5', 'D6'], note: '三张连牌，花色不同' },
  { kind: 'pair', cards: ['S9', 'D9', 'C3'], note: '两张一样的，先比对子再比单张' },
  { kind: 'high', cards: ['S14', 'D10', 'H7'], note: '什么都不是，从大到小一张张比' },
];

export function Rules({ numPlayers, options }: RulesProps<View, Options>) {
  const o = normalizeOptions(options);
  return (
    <>
      <p>
        {numPlayers} 个人，每人 3 张牌扣着。可以不看牌"闷着"下注，也可以看了再决定跟不跟。最后没弃牌、比牌没输的人拿走底池。不比花色。
      </p>

      <h4>牌型（从大到小）</h4>
      <table>
        <tbody>
          {EXAMPLES.map((e) => (
            <tr key={e.kind}>
              <td>
                <b>{KIND_LABEL[e.kind]}</b>
              </td>
              <td>
                <CardRow faces={e.cards.map(cardFace)} label={describe(e.cards)} />
              </td>
              <td className="small">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>
          顺子里 <b>Q-K-A 最大</b>，<b>A-2-3 最小</b>；K-A-2 不算顺子。
        </li>
        <li>点数从大到小：A K Q J 10 … 3 2。</li>
        <li>两手牌完全一样大时，<b>主动比牌的人输</b>。</li>
        {o.beat235 ? (
          <li>
            <b>235 吃豹子</b>（本房间开着）：花色不全一样的 2、3、5 是最小的单张，但能压过豹子，别的都压不过。
            <CardRow faces={['S2', 'H3', 'C5'].map(cardFace)} label="235" />
          </li>
        ) : (
          <li>本房间不算"235 吃豹子"，235 就是一手普通的单张。</li>
        )}
      </ul>

      <h4>怎么下注</h4>
      <ol>
        <li>开局每人先下 {ANTE} 分底注，随机一个人坐庄，从庄家下家开始轮流行动。</li>
        <li>
          <b>单注</b>从 {STAKES[0]} 开始。没看牌的人<b>闷跟</b>付 1 倍单注；看过牌的人<b>跟注</b>付 2 倍。
        </li>
        <li>
          <b>加注</b>：把单注提到更高一档（{STAKES.join(' / ')}），再按上面的倍数付。之后每个人都按新单注跟。
        </li>
        <li>
          <b>看牌</b>：轮到你时随时可以翻开自己的牌，不算一次行动，看完接着选。
          {o.blindRounds > 0 && <b>本房间前 {o.blindRounds} 轮必须闷着，不能看牌。</b>}
        </li>
        <li>
          <b>比牌</b>：从第二轮起，付一次跟注的钱，挑一个还没弃牌的人比大小，输的人出局。只有你们两个看得到对方的牌。
        </li>
        <li>
          <b>弃牌</b>：这局不玩了，已经下的留在底池。
        </li>
      </ol>
      <p>
        只剩一个人时他拿走底池。每人都行动满 <b>{o.maxRounds} 轮</b>还没分出胜负，就从下一个该行动的人开始按座次挨个系统比牌（一样大算后比的人输）。结束后所有人亮牌。
      </p>

      <h4>计分和时间</h4>
      <p>
        赢的人得到底池里别人下的分，其余每人扣掉自己下的。每次行动有 {TURN_MS / 1000} 秒，到时间算<b>弃牌</b>。底池越大，这局计账号积分时分量越重。
      </p>
    </>
  );
}
