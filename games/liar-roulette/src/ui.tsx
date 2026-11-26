/** 唬牌牌桌画面 */
import { Card, CardBack, FlipCard, FlyIn, Hand, motion, Pop, type CardFace, type Suit } from '@couju/kit-cards';
import type { Seat, SeatInfo, TurnUIProps } from '@couju/sdk';
import { useEffect, useRef, useState } from 'react';
import { FACE_LABEL, faceOf, type Face } from './cards.ts';
import { MAX_PLAY, showdownTimeline, type Action, type Showdown, type View } from './rules.ts';
import styles from './ui.module.css';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const SUITS: Suit[] = ['S', 'H', 'C', 'D'];
function cardFace(id: string): CardFace {
  const f = faceOf(id);
  const i = Number(id.slice(1)) || 0;
  if (f === 'W') return { id, label: '王', suit: i % 2 ? 'JR' : 'JB' };
  return { id, label: f, suit: SUITS[i % 4] };
}
/** 几张小牌并排摆开（不重叠） */
function Row({ cards }: { cards: CardFace[] }) {
  return (
    <span className={styles.row}>
      {cards.map((c) => (
        <Card key={c.id} face={c} small />
      ))}
    </span>
  );
}
function revealedFaces(d: Showdown, key: string): CardFace[] {
  return d.revealed.map((f: Face, j) => ({ ...cardFace(`${f}${j + 1}`), id: `${key}-${j}` }));
}

const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#7986cb'];
function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function Avatar({ info }: { info: SeatInfo | undefined }) {
  const name = info?.name ?? '?';
  if (info?.avatarUrl) return <img className={styles.avatar} src={info.avatarUrl} alt={name} />;
  return (
    <div className={styles.avatar} style={{ background: colorOf(name) }}>
      {[...name][0]}
    </div>
  );
}

/** 六个弹膛：扣过的变暗，出局的那一发标红。刚扣过扳机（fresh）时转一圈，跟翻牌动画的"扣扳机"同一刻 */
function Revolver({ v, seat, fresh }: { v: View; seat: Seat; fresh?: boolean }) {
  const shots = v.shots[seat];
  const dead = !v.alive[seat];
  return (
    <span
      key={shots}
      className={[styles.gun, fresh ? styles.gunFresh : ''].join(' ')}
      style={fresh ? { ['--shot-at' as string]: `${showdownTimeline(v.showdowns[v.showdowns.length - 1]?.revealed.length ?? 1).shot}ms` } : undefined}
      title={dead ? '中弹出局' : `已扣 ${shots} 次扳机，还剩 ${v.chambers - shots} 发`}
      data-shots={shots}
    >
      {Array.from({ length: v.chambers }, (_, i) => (
        <span
          key={i}
          className={[styles.chamber, i < shots ? styles.spent : '', dead && i === shots - 1 ? styles.bang : ''].join(' ')}
        />
      ))}
      <span className={styles.gunText}>{dead ? '中弹' : `${shots}/${v.chambers}`}</span>
    </span>
  );
}

function SeatPanel(props: {
  v: View;
  seat: Seat;
  info: SeatInfo | undefined;
  secondsLeft: number | null;
  /** 刚翻完牌、这个座位是扣扳机的人 */
  shooting: boolean;
}) {
  const { v, seat, info, secondsLeft, shooting } = props;
  const isTurn = v.phase !== 'ended' && v.turn === seat;
  const dead = !v.alive[seat];
  const mine = v.claims.filter((c) => c.seat === seat);
  const last = v.claims[v.claims.length - 1];
  const justPlayed = !!last && last.seat === seat;
  return (
    <div
      className={[styles.seat, isTurn ? styles.turn : '', isTurn ? motion.breathe : '', justPlayed ? styles.justPlayed : '', dead ? styles.dead : '', shooting && dead ? styles.dying : ''].join(' ')}
      data-seat={seat}
    >
      <div className={styles.who}>
        <Avatar info={info} />
        <div className={styles.meta}>
          <div className={styles.name}>{info?.name ?? `座位 ${seat + 1}`}</div>
          <div className={styles.tags}>
            {dead ? (
              <span className={styles.outTag}>出局</span>
            ) : (
              <span className={styles.count} title="手里剩几张">
                <span className={styles.miniBack} />
                {v.counts[seat]}
              </span>
            )}
            {isTurn && secondsLeft !== null && <Clock seconds={secondsLeft} />}
            {info?.kind === 'bot' && <span className={styles.tag}>电脑</span>}
            {info?.hosted && <span className={styles.tag}>托管中</span>}
            {info && !info.connected && info.kind === 'human' && <span className={styles.tag}>掉线</span>}
          </div>
        </div>
      </div>
      <Revolver v={v} seat={seat} fresh={shooting} />
      {justPlayed && (
        <Pop key={v.claims.length} className={styles.bubble}>
          扣 {last.count} 张：“都是 {v.table}”
        </Pop>
      )}
      {mine.length > 0 && !justPlayed && <div className={styles.claimLine}>本轮出了 {mine.map((c) => c.count).join(' + ')} 张</div>}
      {isTurn && !justPlayed && <div className={styles.thinking}>想一想<span className={styles.dots} /></div>}
    </div>
  );
}

function Clock({ seconds }: { seconds: number }) {
  return <span className={[styles.clock, seconds <= 5 ? motion.hurry : ''].join(' ')}>{seconds}</span>;
}

/**
 * 翻牌：喊骗子 → 一张张翻开 → 判定 → 扣扳机。fresh = 刚发生的，按时间线一步步放；
 * 刷新页面或中途进来时直接显示结果。时间线和规则里的 pause 是同一份（showdownTimeline），bot 等它放完再出手。
 */
function ShowdownBanner(props: { v: View; d: Showdown; name: (s: Seat) => string; fresh: boolean; big: boolean }) {
  const { v, d, name, fresh, big } = props;
  const latest = v.showdowns.length;
  const t = showdownTimeline(d.revealed.length);
  const at = (ms: number) => ({ ['--at' as string]: `${fresh ? ms : 0}ms` });
  return (
    <div
      key={latest}
      className={[styles.showdown, d.fired ? styles.fired : '', fresh ? styles.fresh : '', big ? styles.big : ''].join(' ')}
      style={{ ['--shot-at' as string]: `${fresh ? t.shot : 0}ms` }}
      role="status"
      data-showdown={latest}
    >
      <div className={styles.sdHead}>
        第 {d.round} 轮 · <b>{name(d.accuser)}</b>：“<span className={styles.sdCall}>{name(d.accused)}是骗子！</span>”翻开：
      </div>
      <div className={styles.sdCards}>
        <span className={styles.row}>
          {revealedFaces(d, `sd${latest}`).map((c, j) =>
            fresh ? <FlipCard key={c.id} face={c} small delayMs={t.flip + j * t.flipGap} /> : <Card key={c.id} face={c} small />,
          )}
        </span>
        <span className={[styles.step, d.lied ? styles.lied : styles.honest].join(' ')} style={at(t.verdict)}>
          {d.lied ? `有假牌！本轮是 ${d.table}` : `全是 ${d.table}，没骗人`}
        </span>
      </div>
      <div className={styles.sdShot}>
        <span className={styles.step} style={at(t.trigger)}>
          {d.lied ? `${name(d.shooter)}撒谎被抓` : `${name(d.shooter)}冤枉了人`}，扣第 {d.shot} 次扳机……
        </span>
        <b className={[styles.step, styles.shotWord].join(' ')} style={at(t.shot)}>
          {d.fired ? '砰！出局' : '咔哒，空枪'}
        </b>
      </div>
    </div>
  );
}

/** 本轮桌上扣着的牌：每一手一叠，按出牌顺序排开；最新的一手从出牌人那边飞过来 */
function Pile({ v, name, from }: { v: View; name: (s: Seat) => string; from: (s: Seat) => Element | null }) {
  const last = v.claims[v.claims.length - 1];
  const pile = v.claims.reduce((m, c) => m + c.count, 0);
  if (!last) return <div className={styles.pileEmpty}>{v.phase === 'ended' ? '' : '还没人出牌'}</div>;
  return (
    <div className={styles.pile}>
      <div className={styles.stacks}>
        {v.claims.map((c, i) => {
          const latest = i === v.claims.length - 1;
          const stack = (
            <>
              <span className={styles.stack}>
                {Array.from({ length: c.count }, (_, j) => (
                  <CardBack key={j} small />
                ))}
              </span>
              <span className={styles.stackWho}>{name(c.seat)}</span>
            </>
          );
          return latest ? (
            <FlyIn key={`${v.round}-${i}`} k={`${v.round}-${i}`} onMount from={() => from(c.seat)} className={[styles.stackBox, styles.latest].join(' ')}>
              {stack}
            </FlyIn>
          ) : (
            <div key={`${v.round}-${i}`} className={styles.stackBox}>
              {stack}
            </div>
          );
        })}
      </div>
      <div className={styles.claimNow} data-claim={v.claims.length}>
        <b>{name(last.seat)}</b> 扣下 <b className={styles.claimCount}>{last.count}</b> 张，说都是 <b>{v.table}</b>
      </div>
      <div className={styles.dim}>桌上一共 {pile} 张</div>
    </div>
  );
}

export function Board(props: TurnUIProps<View, Action>) {
  const { view: v, seat, seats, act, pending, error, timer, result } = props;
  const info = (s: Seat) => seats.find((x) => x.seat === s);
  const name = (s: Seat) => (s === seat ? '你' : (info(s)?.name ?? `座位 ${s + 1}`));
  const now = useNow(timer !== null);
  const secondsLeft = timer ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : null;
  const myTurn = seat !== null && v.phase !== 'ended' && v.turn === seat;
  const canAct = myTurn && !pending;
  const me: Seat = seat ?? 0;
  const others = Array.from({ length: v.n - 1 }, (_, k) => (me + 1 + k) % v.n);
  if (seat === null) others.unshift(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const handKey = `${v.round}|${v.hand.join()}`;
  useEffect(() => setSelected(new Set()), [handKey]);

  // 进来时已经有的翻牌不再放动画；之后每次新翻牌都按时间线放一遍
  const seenAtMount = useRef(v.showdowns.length);
  const tableRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const seatEl = (s: Seat): Element | null =>
    s === seat ? handRef.current : (tableRef.current?.querySelector(`[data-seat="${s}"]`) ?? null);

  const last = v.claims[v.claims.length - 1];
  const lastShowdown = v.showdowns[v.showdowns.length - 1];
  const freshShowdown = !!lastShowdown && v.showdowns.length > seenAtMount.current;
  // 刚翻完、新一轮还没人出牌：桌面中间先让给翻牌
  const justRevealed = freshShowdown && v.claims.length === 0;
  const shooter = freshShowdown ? lastShowdown.shooter : null;
  const revealEnd = justRevealed ? showdownTimeline(lastShowdown.revealed.length).end : 0;
  const tooMany = selected.size > MAX_PLAY;

  const play = () => act({ type: 'play', cards: v.hand.filter((c) => selected.has(c)) });

  const status = (() => {
    if (v.phase === 'ended') return null;
    if (!myTurn) return `等待 ${name(v.turn)}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
    const what = v.mustCallLiar
      ? v.hand.length === 0
        ? `你没牌了，只能翻${name(last!.seat)}这一手`
        : `别人都没牌了，只能翻${name(last!.seat)}这一手`
      : last
        ? `${name(last.seat)}说这 ${last.count} 张都是 ${v.table}——接着出，或者喊骗子`
        : `新一轮你先出，说都是 ${v.table}`;
    return `轮到你：${what}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
  })();

  return (
    <div className={styles.table} ref={tableRef}>
      <div className={styles.opponents}>
        {others.map((s) => (
          <SeatPanel key={s} v={v} seat={s} info={info(s)} secondsLeft={secondsLeft} shooting={shooter === s} />
        ))}
      </div>

      <div className={styles.center}>
        <div className={styles.tableRank} aria-label={`本轮点数 ${v.table}`}>
          <span className={styles.dim}>第 {v.round} 轮 · 本轮说的都是</span>
          <Pop key={v.round} delayMs={revealEnd}>
            <span className={styles.bigRank} data-table={v.table}>
              {FACE_LABEL[v.table]}
            </span>
          </Pop>
          <span className={styles.dim}>王算万能</span>
        </div>
        <Pile v={v} name={name} from={seatEl} />
      </div>

      {lastShowdown && <ShowdownBanner v={v} d={lastShowdown} name={name} fresh={freshShowdown} big={justRevealed} />}

      <div className={styles.mine}>
        {result && (
          <div className={styles.result} style={{ ['--at' as string]: `${revealEnd}ms` }}>
            <div className={styles.resultTitle}>
              {seat !== null && result.winners.includes(seat) ? '你活到了最后' : seat !== null ? '你输了' : '本局结束'}
            </div>
            <div>
              {name(result.winners[0])} 获胜 · {result.summary}
            </div>
          </div>
        )}

        <div className={styles.status} aria-live="polite">
          {status && <span className={myTurn ? styles.myTurn : ''}>{status}</span>}
          {tooMany && <span className={styles.error}>一次最多出 {MAX_PLAY} 张</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>

        {canAct && (
          <div className={styles.actions}>
            {last && (
              <button className={styles.liar} onClick={() => act({ type: 'liar' })}>
                骗子！
              </button>
            )}
            {!v.mustCallLiar && (
              <button className={styles.primary} disabled={selected.size === 0 || tooMany} onClick={play}>
                {selected.size > 0 ? `出 ${selected.size} 张，说都是 ${v.table}` : `选 1–${MAX_PLAY} 张出`}
              </button>
            )}
          </div>
        )}

        <div
          ref={handRef}
          className={[styles.myHand, myTurn ? styles.turnGlow : '', seat !== null && !v.alive[seat] ? styles.dead : ''].join(' ')}
          data-myhand
        >
          {seat !== null ? (
            <>
              <div className={styles.myTag}>
                <Avatar info={info(seat)} />
                <span>{info(seat)?.name ?? '我'}</span>
                <Revolver v={v} seat={seat} fresh={shooter === seat} />
                {!v.alive[seat] && <span className={styles.outTag}>出局</span>}
              </div>
              {v.alive[seat] && v.hand.length > 0 && (
                <Hand key={v.round} deal cards={v.hand.map(cardFace)} selected={selected} onChange={!v.mustCallLiar ? setSelected : undefined} />
              )}
              {v.alive[seat] && v.hand.length === 0 && v.phase !== 'ended' && <div className={styles.dim}>手里没牌了</div>}
              {v.myPlays.length > 0 && (
                <div className={styles.myPlays}>
                  <span className={styles.dim}>本轮我扣下的：</span>
                  {v.myPlays.map((p, i) => (
                    <Row key={i} cards={p.map((c) => ({ ...cardFace(c), id: `mine-${c}` }))} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className={styles.dim}>旁观中</div>
          )}
        </div>
      </div>
    </div>
  );
}
