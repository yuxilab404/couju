/**
 * 掼蛋规则说明（平台"规则"弹窗里画它，ADR-0010）。
 * 例牌和炸弹大小的顺序都现场用 patterns.ts 解析、排序，规则改了这里跟着变；howto.test.ts 检查顺序确实逐个压得过。
 */
import { CardRow } from '@couju/kit-cards';
import type { RulesProps } from '@couju/sdk';
import { faceOf, RANK_LABEL } from './cards.ts';
import { describe, interpret, KIND_NAME, type Kind, type Pattern } from './patterns.ts';
import { ACE, HANDOVER_MS, levelLabel, PLAY_MS, TEAM_NAME, TRIBUTE_MS, type Options, type View } from './rules.ts';
import styles from './howto.module.css';

/** 第 k 张（0..7）某点数的牌：先黑桃、梅花、方块两副，红桃放最后（红桃级牌是配牌，举例时尽量不碰） */
const ORDER = ['Sa', 'Ca', 'Da', 'Sb', 'Cb', 'Db', 'Ha', 'Hb'];
function nat(rank: number, k: number): string[] {
  return ORDER.slice(0, k).map((x) => `${x[0]}${String(rank).padStart(2, '0')}${x[1]}`);
}
function wilds(level: number, k: number): string[] {
  return ['a', 'b'].slice(0, k).map((d) => `H${String(level).padStart(2, '0')}${d}`);
}
/** 举例用的点数，碰上级牌就换一个，免得例子被级牌搅乱 */
function avoid(rank: number, level: number): number {
  return rank !== level ? rank : rank === ACE ? 13 : rank + 1;
}

export interface Example {
  name: string;
  cards: string[];
  pattern: Pattern;
  note?: string;
}

function example(name: string, cards: string[], level: number, note?: string): Example {
  const pattern = interpret(cards, level, null);
  if (!pattern) throw new Error(`例牌不合法：${name}`);
  return { name, cards, pattern, note };
}

/** 普通牌型：只能用同牌型、同张数的更大一手去压 */
export function plainExamples(level: number): (Example & { kind: Kind })[] {
  const r = (x: number) => avoid(x, level);
  const straight = [10, 11, 12, 13, 14].map((x, i) => `${'SCDSC'[i]}${String(x).padStart(2, '0')}${i < 3 ? 'a' : 'b'}`);
  const list: [Kind, string[], string][] = [
    ['single', nat(r(13), 1), '比点数'],
    ['pair', nat(r(8), 2), '比点数'],
    ['triple', nat(r(7), 3), '比点数'],
    ['fullHouse', [...nat(r(9), 3), ...nat(r(4), 2)], '三张带一对，比三张的点数'],
    ['straight', straight, '正好 5 张连着，比最大一张；A 可以当 1（A2345 最小）或当 A（10JQKA 最大），不能绕过 A 接 2，不能带王'],
    // 连着的牌型里级牌就在本来的位置，不用避开
    ['tube', [...nat(5, 2), ...nat(6, 2), ...nat(7, 2)], '3 个连着的对子，比最大一对'],
    ['plate', [...nat(11, 3), ...nat(12, 3)], '2 个连着的三张，比大的那个三张'],
  ];
  return list.map(([kind, cards, note]) => ({ ...example(KIND_NAME[kind], cards, level, note), kind }));
}

/** 炸弹从小到大 */
export function bombLadder(level: number): Example[] {
  const r = (x: number) => avoid(x, level);
  const sf = [9, 10, 11, 12, 13].map((x, i) => `S${String(x).padStart(2, '0')}${i % 2 ? 'b' : 'a'}`);
  return [
    example('4 张炸弹', nat(r(ACE), 4), level, '四张同点数'),
    example('5 张炸弹', nat(r(3), 5), level, `张数多就大：5 张 ${RANK_LABEL[r(3)]} 也压得过 4 张 ${RANK_LABEL[r(ACE)]}`),
    example('同花顺', sf, level, '同一花色的顺子，比最大一张'),
    example('6 张炸弹', nat(r(4), 6), level),
    example('7 张炸弹', nat(r(5), 7), level),
    example('8 张炸弹', nat(r(6), 8), level, '两副牌里同点数最多 8 张'),
    example('9 张炸弹', [...nat(r(7), 8), ...wilds(level, 1)], level, '再加配牌凑'),
    example('10 张炸弹', [...nat(r(8), 8), ...wilds(level, 2)], level),
    example('天王炸', ['J16a', 'J16b', 'J17a', 'J17b'], level, '四张王，最大'),
  ];
}

/** 单张的大小：2 … A，然后级牌、小王、大王 */
export function singleOrder(level: number): string[] {
  const out: string[] = [];
  for (let x = 2; x <= ACE; x++) if (x !== level) out.push(nat(x, 1)[0]);
  out.push(nat(level, 1)[0], 'J16a', 'J17a');
  return out;
}

function Cards({ ids, level }: { ids: string[]; level: number }) {
  return <CardRow faces={ids.map((id) => faceOf(id, level))} />;
}

export function Rules({ options, view }: RulesProps<View, Options>) {
  const level = view?.level ?? 2;
  const L = levelLabel(level);
  const wildFace = wilds(level, 1);
  const tripleWithWild = [...nat(avoid(7, level), 2), ...wildFace];
  const wildMeaning = interpret(tripleWithWild, level, null)!;
  return (
    <>
      <p>
        四个人两队，<b>对家一队</b>（{TEAM_NAME[0]}、{TEAM_NAME[1]}）。两副牌 108 张，每人 27 张。轮流出牌，谁先出完谁赢这一副；
        赢的队升级，从 2 一路打到 A，先打过 A 的队赢下整场。
      </p>

      <h4>级牌和逢人配</h4>
      <p>
        {view ? (
          <>
            现在是第 {view.handNo} 副，<b>打 {L}</b>
            {view.levelTeam !== null && `（${TEAM_NAME[view.levelTeam]}的级）`}。
          </>
        ) : (
          <>第一副两队都打 2，以后每副打上一副头游那一队的级。下面的例子按打 {L} 画。</>
        )}{' '}
        本副打几，几就是<b>级牌</b>（牌上标"级"）。
        <b>红桃级牌是逢人配</b>（标"配"）：可以当除了大小王以外的任何一张牌用，凑对子、顺子、炸弹都行。
      </p>
      <div className={styles.example}>
        <Cards ids={tripleWithWild} level={level} />
        <span className="muted small">= {describe(wildMeaning, level)}</span>
      </div>

      <h4>单张大小</h4>
      <p>
        单张、对子、三张、三带二和炸弹里，级牌排在 A 上面、小王下面：
      </p>
      <div className={styles.example}>
        <Cards ids={singleOrder(level)} level={level} />
      </div>
      <p className="muted small">
        从左到右越来越大：2 3 … A，然后级牌 {L}、小王、大王。顺子、木板、钢板、同花顺里，级牌回到它本来的位置。花色不分大小。
      </p>

      <h4>牌型</h4>
      <p>下家只能用<b>同一种牌型、同样张数</b>的更大一手去压，或者用炸弹。</p>
      <ul className={styles.kinds}>
        {plainExamples(level).map((e) => (
          <li key={e.kind}>
            <div className={styles.kindHead}>
              <b>{e.name}</b>
              <span className="muted small">{describe(e.pattern, level)}</span>
            </div>
            <Cards ids={e.cards} level={level} />
            <div className="muted small">{e.note}</div>
          </li>
        ))}
      </ul>

      <h4>炸弹从小到大</h4>
      <p>
        炸弹能压任何不是炸弹的牌。炸弹之间<b>先比档次</b>（下表越往下越大），<b>同一档再比点数</b>：同样张数的炸弹比点数（级牌比 A 大），
        同花顺比最大一张。
      </p>
      <ol className={styles.ladder} aria-label="炸弹从小到大">
        {bombLadder(level).map((e, i) => (
          <li key={e.name}>
            <span className={styles.rank}>{i + 1}</span>
            <div className={styles.ladderBody}>
              <div className={styles.kindHead}>
                <b>{e.name}</b>
                {e.note && <span className="muted small">{e.note}</span>}
              </div>
              <Cards ids={e.cards} level={level} />
            </div>
          </li>
        ))}
      </ol>
      <p className="muted small">
        一句话：4 张 &lt; 5 张 &lt; 同花顺 &lt; 6 张 &lt; 7 张 &lt; 8 张 &lt; 9 张 &lt; 10 张 &lt; 天王炸。
      </p>

      <h4>出牌</h4>
      <ul>
        <li>第一副随机一人先出；以后见"进贡"。领出的人出什么牌型都行，后面的人按顺序压或者不出。</li>
        <li>其余还有牌的人都不出，最后出牌的人再领出一手。</li>
        <li>
          <b>接风</b>：一个人出完最后一手，别人都不要，就由他的<b>对家</b>接着领出（对家也出完了就轮到下家）。
        </li>
        <li>一队两人都出完（双上），或者三个人出完，这一副就结束。出完的先后叫头游、二游、三游，最后一个是末游。</li>
      </ul>

      <h4>升级</h4>
      <table>
        <tbody>
          <tr><td>头游 + 对家二游（双上）</td><td className="num">升 3 级</td></tr>
          <tr><td>头游 + 对家三游</td><td className="num">升 2 级</td></tr>
          <tr><td>头游 + 对家末游</td><td className="num">升 1 级</td></tr>
        </tbody>
      </table>
      <p>
        头游那一队升级，最多升到 A；下一副打这一队的级。轮到本队打 A 时，要<b>本队拿头游、并且对家不是末游</b>才算过 A，赢下整场。
        {options.length === 'full' && options.aLimit > 0 && <>本队打 A 累计 {options.aLimit} 次没过，就退回 2 重新打。</>}
      </p>

      <h4>进贡和还贡（从第二副起）</h4>
      <ul>
        <li>上一副的末游给头游进贡：交出手里<b>最大的一张</b>（配牌不算）。头游还他一张 10 或以下的牌。</li>
        <li>双下（被对方双上）时两个人都进贡：大的那张给头游、小的给二游，两人各还一张。一样大时头游下家那张给头游。</li>
        <li><b>抗贡</b>：要进贡的人手里（双下时两人加起来）有两张大王，就不用进贡。</li>
        <li>进贡的人先出（双下时是进贡大的那位）；抗贡时头游先出。</li>
      </ul>

      <h4>时间</h4>
      <p>
        每手出牌 {PLAY_MS / 1000} 秒，进贡、还贡 {TRIBUTE_MS / 1000} 秒，一副打完点"继续" {HANDOVER_MS / 1000} 秒；到时间机器人替你出。
      </p>

      <h4>这个房间</h4>
      <ul>
        <li>{options.length === 'one' ? '只打一副：这一副的赢家每人得升级数那么多分，输家扣同样多。' : '从 2 打过 A：过 A 的队每人 +1，另一队每人 −1。'}</li>
        {options.length === 'full' && <li>{options.aLimit > 0 ? `打 A ${options.aLimit} 次不过回到 2。` : '打 A 不限次数。'}</li>}
      </ul>
    </>
  );
}
