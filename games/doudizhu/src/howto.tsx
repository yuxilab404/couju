/**
 * 斗地主规则说明（平台"规则"弹窗里画它，ADR-0010）。
 * 例牌现场用 patterns.ts 解析，howto.test.ts 检查每个例子确实是标的那种牌型、炸弹顺序逐个压得过。
 */
import { CardRow } from '@couju/kit-cards';
import type { RulesProps } from '@couju/sdk';
import { faceOf, rankOf } from './cards.ts';
import { interpret, KIND_NAME, type Kind, type Pattern } from './patterns.ts';
import { BID_MS, MAX_REDEALS, PLAY_MS, type View } from './rules.ts';
import styles from './howto.module.css';

const SUITS = ['S', 'H', 'C', 'D'];
/** k 张某点数的牌（3..15；王另给） */
function nat(rank: number, k: number): string[] {
  return SUITS.slice(0, k).map((s) => `${s}${String(rank).padStart(2, '0')}`);
}
function run(from: number, to: number, w: number): string[] {
  const out: string[] = [];
  for (let r = from; r <= to; r++) out.push(...nat(r, w));
  return out;
}

export interface Example {
  kind: Kind;
  cards: string[];
  note: string;
  pattern: Pattern;
}

export function examples(): Example[] {
  const list: [Kind, string[], string][] = [
    ['single', nat(13, 1), '一张'],
    ['pair', nat(9, 2), '两张同点数'],
    ['triple', nat(7, 3), '三张同点数'],
    ['triple1', [...nat(10, 3), ...nat(4, 1)], '三张带一张，比三张'],
    ['triple2', [...nat(8, 3), ...nat(5, 2)], '三张带一对，比三张'],
    ['straight', run(6, 10, 1), '5 张或更多连着的单张，3 到 A，不含 2 和王'],
    ['pairs', run(3, 5, 2), '3 对或更多连着的对子'],
    ['plane', run(11, 12, 3), '2 个或更多连着的三张'],
    ['plane1', [...run(5, 6, 3), ...nat(9, 1), ...nat(13, 1)], '飞机每个三张带一张单牌（不能同时带大小王）'],
    ['plane2', [...run(7, 8, 3), ...nat(3, 2), ...nat(4, 2)], '飞机每个三张带一对'],
    ['four2', [...nat(6, 4), ...nat(3, 1), ...nat(11, 1)], '四张带两张单牌，不算炸弹'],
    ['four22', [...nat(12, 4), ...nat(4, 2), ...nat(8, 2)], '四张带两对，不算炸弹'],
  ];
  return list.map(([kind, cards, note]) => {
    const pattern = interpret(cards.map(rankOf), null);
    if (!pattern) throw new Error(`例牌不合法：${kind}`);
    return { kind, cards, note, pattern };
  });
}

/** 炸弹从小到大：举两个炸弹和王炸 */
export function bombLadder(): { name: string; cards: string[]; pattern: Pattern }[] {
  return [
    ['炸弹（3）', nat(3, 4)],
    ['炸弹（2）', nat(15, 4)],
    ['王炸', ['J16', 'J17']],
  ].map(([name, cards]) => ({ name: name as string, cards: cards as string[], pattern: interpret((cards as string[]).map(rankOf), null)! }));
}

/** 单张从小到大：3 … A 2 小王 大王 */
export function singleOrder(): string[] {
  return [...run(3, 15, 1), 'J16', 'J17'];
}

function Cards({ ids }: { ids: string[] }) {
  return <CardRow faces={ids.map(faceOf)} />;
}

export function Rules({ view }: RulesProps<View, Record<string, never>>) {
  const inGame = view && view.landlord !== null;
  return (
    <>
      <p>
        三个人，一副 54 张。先叫分抢地主，地主一个人对两个农民。每人 17 张，剩 3 张底牌归地主。谁先出完谁那一边赢。
      </p>

      <h4>单张大小</h4>
      <div className={styles.example}>
        <Cards ids={singleOrder()} />
      </div>
      <p className="muted small">从左到右越来越大：3 4 … K A 2 小王 大王。花色不分大小。</p>

      <h4>叫地主</h4>
      <ul>
        <li>随机一人先叫，按顺序每人一次：叫 1、2、3 分，或者不叫；后叫的人要比前面叫的高。</li>
        <li>有人叫 3 分直接当地主；否则一圈下来叫得最高的人当地主，底分就是他叫的分。</li>
        <li>
          三个人都不叫就重新发牌；连续 {MAX_REDEALS} 次都没人叫，第一个叫的人以 1 分当地主。
        </li>
        <li>地主拿走 3 张底牌（大家都能看到），先出牌。</li>
      </ul>

      <h4>牌型</h4>
      <p>
        下家只能出<b>同一种牌型、同样张数</b>的更大一手（顺子、连对、飞机还要一样长），或者用炸弹；也可以不要。两人都不要，最后出牌的人再领出。
      </p>
      <ul className={styles.kinds}>
        {examples().map((e) => (
          <li key={e.kind}>
            <b>{KIND_NAME[e.kind]}</b>
            <Cards ids={e.cards} />
            <div className="muted small">{e.note}</div>
          </li>
        ))}
      </ul>

      <h4>炸弹</h4>
      <p>
        <b>炸弹</b>是四张同点数，能压任何不是炸弹的牌；炸弹之间比点数。<b>王炸</b>是大小王一对，什么都压得住。
      </p>
      <ol className={styles.ladder} aria-label="炸弹从小到大">
        {bombLadder().map((b, i) => (
          <li key={b.name}>
            <span className={styles.rank}>{i + 1}</span>
            <b>{b.name}</b>
            <Cards ids={b.cards} />
          </li>
        ))}
      </ol>
      <p className="muted small">炸弹 3 &lt; 炸弹 4 &lt; … &lt; 炸弹 A &lt; 炸弹 2 &lt; 王炸。四带二、四带两对不算炸弹。</p>

      <h4>计分</h4>
      <ul>
        <li>每打出一个炸弹或王炸，倍数 ×2。</li>
        <li>
          <b>春天</b>：地主赢，两个农民一张牌都没出过，×2。<b>反春</b>：农民赢，地主只出过一手，×2。
        </li>
        <li>这一局的分 = 底分 × 倍数。地主赢得 2 倍，两个农民各扣 1 倍；农民赢反过来。</li>
        {inGame && (
          <li>
            本局：底分 {view.baseScore}，现在 ×{view.multiplier}（炸弹 {view.bombs} 个）。
          </li>
        )}
      </ul>

      <h4>时间</h4>
      <p>
        叫分 {BID_MS / 1000} 秒，每手出牌 {PLAY_MS / 1000} 秒；到时间机器人替你出。
      </p>
    </>
  );
}
