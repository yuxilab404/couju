/** 唬牌规则说明（平台"规则"弹窗里画它，ADR-0010）。牌数、弹膛数都取自规则代码，换人数跟着变。 */
import { CardRow } from '@couju/kit-cards';
import type { RulesProps } from '@couju/sdk';
import { HAND_SIZE, JOKERS, perRank, RANKS } from './cards.ts';
import { CHAMBERS, MAX_PLAY, PLAY_MS, type View } from './rules.ts';
import { cardFace } from './ui.tsx';

/** 已经扣了 k 次都没响，第 k+1 枪响的概率（子弹位置开局随机、谁都不知道） */
export function fireChance(k: number): string {
  const left = CHAMBERS - k;
  return left <= 1 ? '必响' : `1/${left}`;
}

export function Rules({ numPlayers }: RulesProps<View, Record<string, never>>) {
  const per = perRank(numPlayers);
  return (
    <>
      <p>
        {numPlayers} 个人，每人一把 {CHAMBERS} 发的左轮、只装一颗子弹。轮流扣着出牌、说自己出的都是"本轮的牌"，敢不敢信全看你。说谎被抓或者冤枉了别人，都要对自己扣一枪。活到最后的人赢。
      </p>

      <h4>牌</h4>
      <p>
        {RANKS.join('、')} 三种牌各 {per} 张，外加 {JOKERS} 张王，一共 {per * RANKS.length + JOKERS} 张（{numPlayers} 人桌）。
        <b>王是万能牌</b>，算作任何点数。
      </p>
      <CardRow faces={['K1', 'Q2', 'A3', 'W1', 'W2'].map(cardFace)} label="K、Q、A 和两张王" />

      <h4>一轮怎么打</h4>
      <ol>
        <li>每个活着的人发 {HAND_SIZE} 张，再翻出<b>本轮的点数</b>（K、Q、A 之一）。</li>
        <li>轮到的人扣着出 1 到 {MAX_PLAY} 张，算是声称"这些都是本轮的点数"。其实是什么只有他自己知道，大家只看得到张数。</li>
        <li>
          下家二选一：<b>接着出</b>，或者喊<b>"骗子！"</b>翻开上一手。
        </li>
        <li>翻开后有一张不是本轮点数（王不算），就是上家说谎，<b>上家</b>扣一枪；全都对，就是喊的人冤枉人，<b>喊的人</b>扣一枪。</li>
        <li>翻过一次牌这一轮就结束。重新发牌开下一轮，扣扳机的人先出（他出局了就由下一个人）。</li>
      </ol>
      <p className="muted small">
        手里没牌的人跳过；轮到你时你没牌了，或者别人都没牌了，就只能喊骗子。
      </p>

      <h4>左轮</h4>
      <p>子弹在第几发开局随机、谁都不知道。扣过的次数大家都看得到，越往后越危险：</p>
      <table>
        <tbody>
          {Array.from({ length: CHAMBERS }, (_, k) => (
            <tr key={k}>
              <td>第 {k + 1} 枪</td>
              <td className="num">{fireChance(k)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">每一行是"前面都没响，这一枪响"的概率。</p>

      <h4>计分和时间</h4>
      <p>
        活到最后的人得 {numPlayers - 1} 分，其余每人扣 1 分。每次出牌或喊骗子有 {PLAY_MS / 1000} 秒，到时间机器人替你出。
      </p>
    </>
  );
}
