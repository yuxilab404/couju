/** 斗地主牌桌画面 */
import { CardBack, FlipCard, FlyIn, Hand, lastPlayIndex, motion } from '@couju/kit-cards';
import type { Seat, SeatInfo, TurnUIProps } from '@couju/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hints } from './bot.ts';
import { faceOf, RANK_LABEL, sortCards } from './cards.ts';
import { COUNTER_RANKS, outstanding } from './counter.ts';
import type { Action, Recent, View } from './rules.ts';
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

function bidText(v: View, seat: Seat): string | null {
  const b = v.bids.find((x) => x.seat === seat);
  if (!b) return null;
  return b.score === 0 ? '不叫' : `${b.score} 分`;
}

function RecentPlay({ recent }: { recent: Recent }) {
  if (recent === 'pass') return <div className={styles.pass}>不要</div>;
  if (!recent) return null;
  return <Hand small cards={sortCards(recent).map(faceOf)} />;
}

/** 座位最近一手：每出一手从 from（头像或我的手牌）飞到出牌区 */
function FlyingPlay({ v, seat, from }: { v: View; seat: Seat; from: () => Element | null }) {
  return (
    <FlyIn k={lastPlayIndex(v.history, seat)} from={from} className={styles.flying}>
      <RecentPlay recent={v.recent[seat]} />
    </FlyIn>
  );
}

/** 一局结束后摊开这个座位手里剩下的牌 */
function Leftover({ v, seat }: { v: View; seat: Seat }) {
  const left = v.revealed?.[seat];
  if (!left) return null;
  return (
    <div className={styles.revealed} data-leftover={seat}>
      {left.length > 0 ? (
        <>
          <span>剩 {left.length} 张</span>
          <Hand small cards={left.map(faceOf)} />
        </>
      ) : (
        <span>出完了</span>
      )}
    </div>
  );
}

function SeatPanel(props: {
  v: View;
  seat: Seat;
  info: SeatInfo | undefined;
  secondsLeft: number | null;
  side: 'left' | 'right';
}) {
  const { v, seat, info, secondsLeft, side } = props;
  const isTurn = v.phase !== 'ended' && v.turn === seat;
  const bid = v.phase === 'bidding' ? bidText(v, seat) : null;
  const who = useRef<HTMLDivElement>(null);
  return (
    <div className={[styles.seat, styles[side], isTurn ? styles.turn : '', isTurn ? motion.breathe : ''].join(' ')} data-seat={seat}>
      <div className={styles.who} ref={who}>
        <Avatar info={info} />
        <div className={styles.meta}>
          <div className={styles.name}>
            {info?.name ?? `座位 ${seat + 1}`}
            {v.landlord !== null && (
              <span className={v.landlord === seat ? styles.badgeLord : styles.badgeFarmer}>
                {v.landlord === seat ? '地主' : '农民'}
              </span>
            )}
          </div>
          <div className={styles.tags}>
            <span className={styles.count} title="剩余张数">
              <span className={styles.miniBack} />
              {v.counts[seat]}
            </span>
            {isTurn && secondsLeft !== null && (
              <span className={[styles.clock, secondsLeft <= 5 ? motion.hurry : ''].join(' ')}>{secondsLeft}</span>
            )}
            {info?.kind === 'bot' && <span className={styles.tag}>电脑</span>}
            {info?.hosted && <span className={styles.tag}>托管中</span>}
            {info && !info.connected && info.kind === 'human' && <span className={styles.tag}>掉线</span>}
          </div>
        </div>
      </div>
      <div className={styles.played}>
        {bid ? <div className={styles.pass}>{bid}</div> : <FlyingPlay v={v} seat={seat} from={() => who.current} />}
        <Leftover v={v} seat={seat} />
      </div>
    </div>
  );
}

export function Board(props: TurnUIProps<View, Action>) {
  const { view: v, seat, seats, act, pending, error, timer, result } = props;
  const me: Seat = seat ?? 0;
  const right = (me + 1) % 3;
  const left = (me + 2) % 3;
  const info = (s: Seat) => seats.find((x) => x.seat === s);
  const now = useNow(timer !== null);
  const secondsLeft = timer ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : null;
  const myTurn = seat !== null && v.phase !== 'ended' && v.turn === seat;
  const canAct = myTurn && !pending;
  const handRef = useRef<HTMLDivElement>(null);
  // 底牌：叫完地主那一刻翻开（中途进来的直接显示）
  const bottomAtMount = useRef(v.bottom !== null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hintIdx, setHintIdx] = useState(0);
  const handKey = v.hand.join();
  const trickKey = `${v.turn}|${v.history.length}|${v.phase}`;
  useEffect(() => setSelected(new Set()), [handKey]);
  // 我"不要"了（自己点的，或超时被代打），选着的牌落回去
  const lastEntry = v.history[v.history.length - 1];
  const iJustPassed = !!lastEntry && lastEntry.seat === seat && lastEntry.cards === null;
  useEffect(() => {
    if (iJustPassed) setSelected(new Set());
  }, [iJustPassed, v.history.length]);
  /** 点"提示"时 bot 给的话，比如"建议不要" */
  const [hintNote, setHintNote] = useState<string | null>(null);
  useEffect(() => {
    setHintIdx(0);
    setHintNote(null);
  }, [trickKey]);
  const hintInfo = useMemo(() => (myTurn ? hints(v) : null), [myTurn, trickKey, handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // bot 自己会"不要"时，第一下提示先说建议不要，再点才轮着给能压的牌
  const hintSteps: (string[] | 'pass')[] = hintInfo ? [...(hintInfo.pass ? (['pass'] as const) : []), ...hintInfo.moves] : [];
  const canHint = !!hintInfo && hintInfo.moves.length > 0;

  // 单击切换一张，按住左键（手机上用手指）横着拖过一段批量选/取消，见 kit-cards 的 Hand
  const choose = (next: Set<string>) => {
    if (seat === null) return;
    setSelected(next);
    setHintNote(null);
  };
  const play = () => act({ type: 'play', cards: v.hand.filter((c) => selected.has(c)) });
  const hint = () => {
    if (!canHint) return;
    const step = hintSteps[hintIdx % hintSteps.length];
    if (step === 'pass') {
      setSelected(new Set());
      setHintNote(hintInfo!.fromTeammate ? '队友的牌，建议不要；再点提示看能压的牌' : '建议不要，留着牌后面用；再点提示看能压的牌');
    } else {
      setSelected(new Set(step));
      setHintNote(null);
    }
    setHintIdx(hintIdx + 1);
  };
  const passSuggested = hintNote !== null;

  const status = (() => {
    if (v.phase === 'ended') return null;
    const who = v.turn === seat ? '轮到你' : `等待 ${info(v.turn)?.name ?? `座位 ${v.turn + 1}`}`;
    const what = v.phase === 'bidding' ? '叫分' : v.lastPlay ? '跟牌' : '出牌';
    return `${who}${v.turn === seat ? what : ''}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
  })();

  return (
    <div className={styles.table}>
      <div className={styles.top}>
        <div className={styles.bottomCards}>
          {v.bottom ? (
            bottomAtMount.current ? (
              <Hand small cards={v.bottom.map(faceOf)} />
            ) : (
              <div className={styles.backs}>
                {v.bottom.map((c, i) => (
                  <FlipCard key={c} face={faceOf(c)} small delayMs={i * 150} />
                ))}
              </div>
            )
          ) : (
            <div className={styles.backs}>
              <CardBack small />
              <CardBack small />
              <CardBack small />
            </div>
          )}
        </div>
        <div className={styles.info}>
          <span>{v.phase === 'bidding' ? `当前 ${v.maxBid || '无人叫'}${v.maxBid ? ' 分' : ''}` : `底分 ${v.baseScore}`}</span>
          <span>倍数 ×{v.multiplier}</span>
          {v.redeals > 0 && v.phase === 'bidding' && <span>第 {v.redeals + 1} 次发牌</span>}
        </div>
      </div>

      {v.phase !== 'ended' && <CardCounter v={v} />}

      <div className={styles.opponents}>
        <SeatPanel v={v} seat={left} info={info(left)} secondsLeft={secondsLeft} side="left" />
        <SeatPanel v={v} seat={right} info={info(right)} secondsLeft={secondsLeft} side="right" />
      </div>

      <div className={styles.mine}>
        <div className={styles.myPlayed}>
          {v.phase === 'bidding' ? (
            bidText(v, me) && <div className={styles.pass}>{bidText(v, me)}</div>
          ) : (
            <FlyingPlay v={v} seat={me} from={() => handRef.current} />
          )}
        </div>

        {result && (
          <div className={styles.result} role="status">
            <div className={styles.resultTitle}>
              {seat !== null && result.winners.includes(seat) ? '你赢了' : seat !== null ? '你输了' : '本局结束'}
            </div>
            <div>{result.summary}</div>
          </div>
        )}

        <div className={styles.status} aria-live="polite">
          {status && <span className={myTurn ? styles.myTurn : ''}>{status}</span>}
          {canAct && hintNote && <span className={styles.hintNote}>{hintNote}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>

        {canAct && v.phase === 'bidding' && (
          <div className={styles.actions}>
            <button onClick={() => act({ type: 'bid', score: 0 })}>不叫</button>
            {([1, 2, 3] as const).map((n) => (
              <button key={n} className={styles.primary} disabled={n <= v.maxBid} onClick={() => act({ type: 'bid', score: n })}>
                {n} 分
              </button>
            ))}
          </div>
        )}
        {canAct && v.phase === 'playing' && (
          <div className={styles.actions}>
            <button
              className={passSuggested ? styles.primary : undefined}
              disabled={!v.lastPlay}
              onClick={() => {
                setSelected(new Set());
                act({ type: 'pass' });
              }}
            >
              不要
            </button>
            <button onClick={hint} disabled={!canHint}>
              提示
            </button>
            <button className={styles.primary} disabled={selected.size === 0} onClick={play}>
              出牌
            </button>
          </div>
        )}

        <div ref={handRef} className={[styles.myHand, myTurn ? styles.turnGlow : ''].join(' ')}>
          {seat !== null ? (
            <>
              <div className={styles.myTag}>
                <Avatar info={info(seat)} />
                <span>{info(seat)?.name ?? '我'}</span>
                {v.landlord !== null && (
                  <span className={v.landlord === seat ? styles.badgeLord : styles.badgeFarmer}>
                    {v.landlord === seat ? '地主' : '农民'}
                  </span>
                )}
                <span className={styles.dim}>{v.hand.length} 张</span>
              </div>
              <Hand key={v.redeals} deal cards={v.hand.map(faceOf)} selected={selected} onChange={choose} />
            </>
          ) : v.revealed ? (
            <>
              <div className={styles.dim}>旁观中 · {info(0)?.name ?? '座位 1'}</div>
              <Leftover v={v} seat={0} />
            </>
          ) : (
            <div className={styles.dim}>旁观中 · 座位 1 剩 {v.counts[0]} 张</div>
          )}
        </div>
      </div>
    </div>
  );
}


const COUNTER_KEY = 'couju.doudizhu.counter';

function readCounterPref(): boolean {
  try {
    return localStorage.getItem(COUNTER_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 记牌器：别人手里每个点数还剩几张。只用自己的手牌和公开的出牌记录算，见 counter.ts */
function CardCounter({ v }: { v: View }) {
  const [open, setOpen] = useState(readCounterPref);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(COUNTER_KEY, next ? 'on' : 'off');
    } catch {
      /* 隐私模式 */
    }
  };
  const left = outstanding(v);
  return (
    <div className={styles.counter} aria-label="记牌器">
      <button type="button" className={styles.counterToggle} onClick={toggle} aria-expanded={open}>
        记牌器 {open ? '▾' : '▸'}
      </button>
      {open &&
        COUNTER_RANKS.map((r) => (
          <span
            key={r}
            className={[styles.counterCell, left[r] === 0 ? styles.counterGone : '', left[r] === 4 ? styles.counterFour : ''].join(' ')}
            data-rank={r}
            title={`${RANK_LABEL[r]}：别人手里还有 ${left[r]} 张`}
          >
            <span className={styles.counterRank}>{r === 17 ? '大' : r === 16 ? '小' : RANK_LABEL[r]}</span>
            <span className={styles.counterNum}>{left[r]}</span>
          </span>
        ))}
    </div>
  );
}
