/** 炸金花牌桌画面 */
import { Card, CardBack, FlipCard, motion, Pop, type CardFace } from '@couju/kit-cards';
import type { Seat, SeatInfo, TurnUIProps } from '@couju/sdk';
import { useEffect, useRef, useState } from 'react';
import { describe, rankLabel, rankOf, suitOf } from './patterns.ts';
import { COMPARE, endPause, type Action, type Compare, type LogEntry, type View } from './rules.ts';
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

export function cardFace(id: string): CardFace {
  return { id, label: rankLabel(rankOf(id)), suit: suitOf(id) };
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

/** 一条行动记录的说法，如"闷跟 1"、"加到 5"、"和小明比牌" */
export function actionText(e: LogEntry, name: (s: Seat) => string): string {
  switch (e.type) {
    case 'look':
      return '看牌';
    case 'fold':
      return '弃牌';
    case 'call':
      return `${e.blind ? '闷跟' : '跟'} ${e.cost}`;
    case 'raise':
      return `${e.blind ? '闷' : ''}加到 ${e.stake}（下 ${e.cost}）`;
    case 'compare':
      return `和${name(e.target!)}比牌`;
  }
}

/** 三张牌：知道的翻开，不知道的扣着。flipFrom 给了就按这个延迟翻开（刚看牌、刚比牌） */
function Cards({ hand, small, flipAt }: { hand: string[] | null; small?: boolean; flipAt?: number }) {
  return (
    <span className={styles.cards}>
      {hand
        ? hand.map((c, i) =>
            flipAt !== undefined ? (
              <FlipCard key={c} face={cardFace(c)} small={small} delayMs={flipAt + i * COMPARE.flipGap} />
            ) : (
              <Card key={c} face={cardFace(c)} small={small} />
            ),
          )
        : [0, 1, 2].map((i) => <CardBack key={i} small={small} />)}
    </span>
  );
}

function Clock({ seconds }: { seconds: number }) {
  return <span className={[styles.clock, seconds <= 5 ? motion.hurry : ''].join(' ')}>{seconds}</span>;
}

function SeatPanel(props: {
  v: View;
  seat: Seat;
  info: SeatInfo | undefined;
  name: (s: Seat) => string;
  secondsLeft: number | null;
  /** 选比牌对象时可以点 */
  onPick?: () => void;
}) {
  const { v, seat, info, name, secondsLeft, onPick } = props;
  const isTurn = v.phase !== 'ended' && v.turn === seat;
  const lastIdx = v.log.findLastIndex((e) => e.seat === seat);
  const last = lastIdx >= 0 ? v.log[lastIdx] : null;
  const justActed = lastIdx >= 0 && lastIdx === v.log.length - 1;
  const lost = v.compares.some((c) => c.loser === seat);
  const winner = v.end?.winner === seat;
  const status = v.folded[seat] ? (lost ? '比牌输' : '弃牌') : v.seen[seat] ? '已看牌' : '闷牌';
  const hand = v.hands[seat];
  const Tag = onPick ? 'button' : 'div';
  return (
    <Tag
      className={[
        styles.seat,
        isTurn ? styles.turn : '',
        isTurn ? motion.breathe : '',
        justActed ? styles.justActed : '',
        v.folded[seat] ? styles.out : '',
        winner ? styles.winner : '',
        onPick ? styles.pickable : '',
      ].join(' ')}
      data-seat={seat}
      onClick={onPick}
      aria-label={onPick ? `和${name(seat)}比牌` : undefined}
    >
      <div className={styles.who}>
        <Avatar info={info} />
        <div className={styles.meta}>
          <div className={styles.name}>
            {info?.name ?? `座位 ${seat + 1}`}
            {v.dealer === seat && <span className={styles.dealer} title="庄家">庄</span>}
          </div>
          <div className={styles.tags}>
            <span className={[styles.status, v.seen[seat] ? styles.seenTag : '', v.folded[seat] ? styles.outTag : ''].join(' ')} data-status={status}>
              {status}
            </span>
            {isTurn && secondsLeft !== null && <Clock seconds={secondsLeft} />}
            {info?.kind === 'bot' && <span className={styles.tag}>电脑</span>}
            {info?.hosted && <span className={styles.tag}>托管中</span>}
            {info && !info.connected && info.kind === 'human' && <span className={styles.tag}>掉线</span>}
          </div>
        </div>
      </div>
      <div className={styles.seatRow}>
        <Cards hand={hand} small />
        <span className={styles.bet} title="这局下了多少">
          <span className={styles.chip} />
          {v.bets[seat]}
        </span>
      </div>
      {hand && <div className={styles.kind}>{describe(hand)}</div>}
      {last && (
        <Pop key={lastIdx} className={[styles.bubble, justActed ? styles.bubbleNew : ''].join(' ')}>
          {actionText(last, name)}
        </Pop>
      )}
      {winner && <div className={styles.crown}>赢下底池</div>}
    </Tag>
  );
}

/** 比牌：两边的牌一张张翻开，再出结果。我不是比牌的人就只看到谁输了 */
function CompareBanner(props: { v: View; c: Compare; name: (s: Seat) => string; fresh: boolean }) {
  const { v, c, name, fresh } = props;
  const at = (ms: number) => ({ ['--at' as string]: `${fresh ? ms : 0}ms` });
  const side = (s: Seat, delay: number) => (
    <div className={[styles.side, c.loser === s ? styles.loserSide : ''].join(' ')}>
      <b>{name(s)}</b>
      <Cards hand={v.hands[s]} small flipAt={fresh && v.hands[s] ? delay : undefined} />
      {v.hands[s] && (
        <span className={styles.step} style={at(COMPARE.verdict)}>
          {describe(v.hands[s]!)}
        </span>
      )}
    </div>
  );
  return (
    <div className={[styles.compare, fresh ? styles.fresh : ''].join(' ')} role="status" data-compare={v.compares.length}>
      <div className={styles.cmpHead}>{c.auto ? '封顶系统比牌' : `${name(c.a)}找${name(c.b)}比牌`}</div>
      <div className={styles.cmpBody}>
        {side(c.a, COMPARE.flip)}
        <span className={styles.vs}>VS</span>
        {side(c.b, COMPARE.flip + 3 * COMPARE.flipGap)}
      </div>
      <b className={[styles.step, styles.verdict].join(' ')} style={at(COMPARE.verdict)}>
        {name(c.loser)}输了，出局
      </b>
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

  const [menu, setMenu] = useState<'raise' | 'compare' | null>(null);
  useEffect(() => setMenu(null), [v.log.length, myTurn]);

  // 进来时已经有的记录不再放动画
  const logAtMount = useRef(v.log.length);
  const knewAtMount = useRef(seat !== null && v.hands[seat] !== null);
  const lastEntry = v.log[v.log.length - 1];
  const lastCompare = v.compares.filter((c) => !c.auto).at(-1);
  const autoCompares = v.compares.filter((c) => c.auto);
  const freshCompare = !!lastEntry && lastEntry.type === 'compare' && v.log.length > logAtMount.current;
  const settle = v.end && v.log.length > logAtMount.current ? endPause(v.end.reason) : 0;

  const myHand = seat !== null ? v.hands[seat] : null;
  const mySeen = seat !== null && v.seen[seat];
  const mayLook = seat !== null && !v.seen[seat] && v.acted[seat] >= v.options.blindRounds;
  const mayCompare = seat !== null && v.acted[seat] >= 1;
  const mult = mySeen ? 2 : 1;
  const callCost = v.stake * mult;
  const higher = v.stakes.filter((x) => x > v.stake);
  const targets = v.folded.flatMap((f, i) => (f || i === seat ? [] : [i]));

  const status = (() => {
    if (v.phase === 'ended') return null;
    if (!myTurn) return `等待 ${name(v.turn)}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
    const what = menu === 'compare' ? '选一个人比牌' : seat !== null && v.folded[seat] ? '' : mySeen ? '看过牌，下注翻倍' : '闷着下注只要一半';
    return `轮到你：${what}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
  })();

  return (
    <div className={styles.table}>
      <div className={styles.opponents}>
        {others.map((s) => (
          <SeatPanel
            key={s}
            v={v}
            seat={s}
            info={info(s)}
            name={name}
            secondsLeft={secondsLeft}
            onPick={canAct && menu === 'compare' && !v.folded[s] ? () => act({ type: 'compare', target: s }) : undefined}
          />
        ))}
      </div>

      <div className={styles.center}>
        <div className={styles.pot} aria-label={`底池 ${v.pot}`}>
          <span className={styles.dim}>底池</span>
          <Pop key={v.pot}>
            <span className={styles.potNum} data-pot={v.pot}>
              {v.pot}
            </span>
          </Pop>
        </div>
        <div className={styles.info}>
          <div>
            单注 <b data-stake={v.stake}>{v.stake}</b>
            <span className={styles.dim}>（闷 {v.stake} / 看 {v.stake * 2}）</span>
          </div>
          <div>
            第 <b>{v.round}</b> / {v.options.maxRounds} 轮
            {v.options.blindRounds > 0 && <span className={styles.dim}> · 前 {v.options.blindRounds} 轮必闷</span>}
          </div>
        </div>
      </div>

      {lastCompare && <CompareBanner key={v.compares.indexOf(lastCompare)} v={v} c={lastCompare} name={name} fresh={freshCompare} />}
      {autoCompares.length > 0 && (
        <div className={styles.chain} role="status">
          <div className={styles.cmpHead}>{v.options.maxRounds} 轮封顶，系统按座次挨个比牌</div>
          {autoCompares.map((c, i) => (
            <div key={i}>
              {name(c.a)} 对 {name(c.b)}：<b>{name(c.loser)}</b>输
            </div>
          ))}
        </div>
      )}

      <div className={styles.mine}>
        {result && seat !== null && (
          <div className={styles.result} style={{ ['--at' as string]: `${settle}ms` }}>
            <div className={styles.resultTitle}>{result.winners.includes(seat) ? `你赢了 ${result.scores?.[seat] ?? ''}` : `你输了 ${-(result.scores?.[seat] ?? 0)}`}</div>
            <div>
              {name(result.winners[0])}赢下底池 · {result.summary}
            </div>
          </div>
        )}
        {result && seat === null && (
          <div className={styles.result} style={{ ['--at' as string]: `${settle}ms` }}>
            <div className={styles.resultTitle}>本局结束</div>
            <div>
              {name(result.winners[0])}赢下底池 · {result.summary}
            </div>
          </div>
        )}

        <div className={styles.statusLine} aria-live="polite">
          {status && <span className={myTurn ? styles.myTurn : ''}>{status}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>

        {canAct && (
          <>
            <div className={styles.actions}>
              {!mySeen && (
                <button className={styles.look} disabled={!mayLook} onClick={() => act({ type: 'look' })} title={mayLook ? '' : `前 ${v.options.blindRounds} 轮必须闷牌`}>
                  看牌
                </button>
              )}
              <button className={styles.primary} onClick={() => act({ type: 'call' })}>
                {mySeen ? '跟注' : '闷跟'} {callCost}
              </button>
              <button disabled={higher.length === 0} aria-pressed={menu === 'raise'} onClick={() => setMenu(menu === 'raise' ? null : 'raise')}>
                加注
              </button>
              <button disabled={!mayCompare} aria-pressed={menu === 'compare'} onClick={() => setMenu(menu === 'compare' ? null : 'compare')} title={mayCompare ? '' : '第一轮不能比牌'}>
                比牌
              </button>
              <button className={styles.fold} onClick={() => act({ type: 'fold' })}>
                弃牌
              </button>
            </div>
            {menu === 'raise' && (
              <div className={styles.subActions}>
                {higher.map((x) => (
                  <button key={x} onClick={() => act({ type: 'raise', stake: x })}>
                    加到 {x}（下 {x * mult}）
                  </button>
                ))}
              </div>
            )}
            {menu === 'compare' && (
              <div className={styles.subActions}>
                {targets.map((t) => (
                  <button key={t} onClick={() => act({ type: 'compare', target: t })}>
                    和{name(t)}比（下 {callCost}）
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className={[styles.myHand, myTurn ? styles.turnGlow : '', seat !== null && v.folded[seat] ? styles.out : ''].join(' ')} data-myhand>
          {seat !== null ? (
            <>
              <div className={styles.myTag}>
                <Avatar info={info(seat)} />
                <span>{info(seat)?.name ?? '我'}</span>
                {v.dealer === seat && <span className={styles.dealer}>庄</span>}
                <span className={styles.bet}>
                  <span className={styles.chip} />
                  已下 {v.bets[seat]}
                </span>
                {v.folded[seat] && <span className={[styles.status, styles.outTag].join(' ')}>{v.compares.some((c) => c.loser === seat) ? '比牌输' : '弃牌'}</span>}
                {v.end?.winner === seat && <span className={styles.crown}>赢下底池</span>}
              </div>
              <div className={styles.myCards}>
                <Cards hand={myHand} flipAt={myHand && !knewAtMount.current ? 0 : undefined} />
              </div>
              <div className={styles.kind} data-mykind>
                {myHand ? describe(myHand) : '闷牌中，没看过自己的牌'}
              </div>
            </>
          ) : (
            <div className={styles.dim}>旁观中</div>
          )}
        </div>
      </div>
    </div>
  );
}
