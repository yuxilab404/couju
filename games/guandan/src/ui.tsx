/** 掼蛋牌桌画面：自己在下，对家在上，上家在左，下家在右 */
import { FlyIn, Hand, lastPlayIndex, motion } from '@couju/kit-cards';
import type { Seat, SeatInfo, TurnUIProps } from '@couju/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hints, type Move } from './bot.ts';
import { faceOf, isWild, RANK_LABEL, sortCards, valueOf } from './cards.ts';
import { COUNTER_RANKS, outstanding } from './counter.ts';
import { beats, describe, interpret, parse, type Pattern } from './patterns.ts';
import { levelLabel, partnerOf, returnable, teamOf, tributeValue, type Action, type HandSummary, type Recent, type View } from './rules.ts';
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

/** 和平台房间页的队伍颜色一致 */
const TEAM_COLORS = ['#e76f51', '#2a9d8f'];
const PLACE_NAME = ['', '头游', '二游', '三游', '末游'];

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

/** 座位最近的一手；如果它是现在要压的那一手，写出它算作什么（配牌出的牌光看牌面认不出来） */
function RecentPlay({ v, seat }: { v: View; seat: Seat }) {
  const recent: Recent = v.phase === 'playing' ? v.recent[seat] : null;
  if (recent === 'pass') return <div className={styles.pass}>不出</div>;
  if (!recent) return null;
  const current = v.lastPlay && v.lastPlay.seat === seat ? v.lastPlay : null;
  return (
    <>
      <Hand small cards={sortCards(recent, v.level).map((c) => faceOf(c, v.level))} />
      {current && (
        <div className={styles.declared} data-declared={seat}>
          {describe(current, v.level)}
        </div>
      )}
    </>
  );
}

/** 座位最近一手：每出一手从 from（头像或我的手牌）飞到出牌区 */
function FlyingPlay({ v, seat, from }: { v: View; seat: Seat; from: () => Element | null }) {
  const i = lastPlayIndex(v.history, seat);
  return (
    <FlyIn k={i === null ? null : `${v.handNo}-${i}`} from={from} className={styles.flying}>
      <RecentPlay v={v} seat={seat} />
    </FlyIn>
  );
}

function TeamDot({ seat }: { seat: Seat }) {
  return <span className={styles.teamDot} style={{ background: TEAM_COLORS[teamOf(seat)] }} title={`队伍 ${teamOf(seat) + 1}`} />;
}

/** 一副或整场结束后摊开这个座位剩下的牌 */
function Leftover({ v, seat }: { v: View; seat: Seat }) {
  if (v.phase !== 'handOver' && v.phase !== 'ended') return null;
  const left = v.lastHand?.leftover[seat];
  if (!left || left.length === 0) return null;
  return (
    <div className={styles.revealed} data-leftover={seat}>
      <span>剩 {left.length} 张</span>
      <Hand small cards={sortCards(left, v.lastHand!.level).map((c) => faceOf(c, v.lastHand!.level))} />
    </div>
  );
}

function placeOf(v: View, seat: Seat): number | null {
  if ((v.phase === 'handOver' || v.phase === 'ended') && v.lastHand) return v.lastHand.place[seat];
  const i = v.finished.indexOf(seat);
  return i >= 0 ? i + 1 : null;
}

function SeatPanel(props: { v: View; seat: Seat; info: SeatInfo | undefined; secondsLeft: number | null; pos: 'left' | 'top' | 'right' }) {
  const { v, seat, info, secondsLeft, pos } = props;
  const isTurn = v.phase === 'playing' && v.turn === seat;
  const waiting = (v.phase === 'tribute' || v.phase === 'return') && actingInTribute(v).includes(seat);
  const place = placeOf(v, seat);
  const who = useRef<HTMLDivElement>(null);
  return (
    <div className={[styles.seat, styles[pos], isTurn || waiting ? styles.turn : '', isTurn || waiting ? motion.breathe : ''].join(' ')} data-seat={seat}>
      <div className={styles.who} ref={who}>
        <Avatar info={info} />
        <div className={styles.meta}>
          <div className={styles.name}>
            <TeamDot seat={seat} />
            <span className={styles.nameText}>{info?.name ?? `座位 ${seat + 1}`}</span>
          </div>
          <div className={styles.tags}>
            {place !== null ? (
              <span className={styles.placeTag} data-place={place}>
                {PLACE_NAME[place]}
              </span>
            ) : (
              <span className={styles.count} title="剩余张数">
                <span className={styles.miniBack} />
                {v.counts[seat]}
              </span>
            )}
            {(isTurn || waiting) && secondsLeft !== null && (
              <span className={[styles.clock, secondsLeft <= 5 ? motion.hurry : ''].join(' ')}>{secondsLeft}</span>
            )}
            {info?.kind === 'bot' && <span className={styles.tag}>电脑</span>}
            {info?.hosted && <span className={styles.tag}>托管</span>}
            {info && !info.connected && info.kind === 'human' && <span className={styles.tag}>掉线</span>}
            {v.phase === 'handOver' && v.ready[seat] && <span className={styles.tag}>已准备</span>}
          </div>
        </div>
      </div>
      <div className={styles.played}>
        <FlyingPlay v={v} seat={seat} from={() => who.current} />
        <Leftover v={v} seat={seat} />
      </div>
    </div>
  );
}

function actingInTribute(v: View): Seat[] {
  const t = v.tribute;
  if (!t) return [];
  if (v.phase === 'tribute') return t.givers.filter((g) => !t.gifts.some((x) => x.from === g));
  if (v.phase === 'return') return t.pairs.map((p) => p.to).filter((to) => !t.returns.some((r) => r.from === to));
  return [];
}

/** 进贡/还贡/抗贡的公开记录：这一副开头摆在桌子中间 */
function TributeLine({ v, name }: { v: View; name: (s: Seat) => string }) {
  const t = v.tribute;
  if (!t) return null;
  const show = v.phase === 'tribute' || v.phase === 'return' || (v.phase === 'playing' && v.history.length < 4);
  if (!show) return null;
  const card = (id: string) => <Hand small cards={[faceOf(id, v.level)]} />;
  if (t.resisted) {
    return (
      <div className={styles.tribute} data-tribute="resisted">
        {t.givers.length === 1 ? `${name(t.givers[0])}手里有两个大王` : `${t.givers.map(name).join('和')}合起来有两个大王`}
        ，抗贡！{name(t.leader)}先出
      </div>
    );
  }
  const given = t.pairs.length ? t.pairs : t.gifts.map((g) => ({ ...g, to: null as Seat | null }));
  return (
    <div className={styles.tribute} data-tribute={v.phase}>
      {given.map((g) => {
        const back = t.returns.find((r) => r.to === g.from);
        return (
          <div key={g.from} className={styles.tributeRow}>
            <span>
              {name(g.from)} 进贡{g.to !== null ? `给${name(g.to)}` : ''}
            </span>
            {card(g.card)}
            {back && (
              <>
                <span>还</span>
                {card(back.card)}
              </>
            )}
          </div>
        );
      })}
      {v.phase === 'tribute' && <div className={styles.dim}>等 {actingInTribute(v).map(name).join('、')} 进贡…</div>}
      {v.phase === 'return' && <div className={styles.dim}>等 {actingInTribute(v).map(name).join('、')} 还贡…</div>}
    </div>
  );
}

function HandResult({ h, name, me }: { h: HandSummary; name: (s: Seat) => string; me: Seat | null }) {
  const mine = me !== null ? teamOf(me) : null;
  const who = mine === null ? `队伍 ${h.winTeam + 1}` : mine === h.winTeam ? '我们' : '对方';
  const lv = (x: number) => levelLabel(x);
  const doubleDown = h.order.length === 2;
  return (
    <div className={styles.handResult} role="status" data-hand-result={h.hand}>
      <div className={styles.handTitle}>第 {h.hand} 副结束（打 {lv(h.level)}）</div>
      <div className={styles.orderRow}>
        {h.order.map((s, i) => (
          <span key={s}>
            {PLACE_NAME[i + 1]} {name(s)}
          </span>
        ))}
        {doubleDown && <span>双下</span>}
      </div>
      <div>
        {h.passedA
          ? `${who}过 A！`
          : `${who}升 ${h.up} 级：${lv(h.levelsBefore[h.winTeam])} → ${lv(h.levelsAfter[h.winTeam])}`}
      </div>
      {h.resetTeam !== null && <div className={styles.warn}>队伍 {h.resetTeam + 1} 打 A 没过够次数，回到 2</div>}
    </div>
  );
}

export function Board(props: TurnUIProps<View, Action>) {
  const { view: v, seat, seats, act, pending, error, timer, result } = props;
  const me: Seat = seat ?? 0;
  const right = (me + 1) % 4;
  const top = partnerOf(me);
  const left = (me + 3) % 4;
  const info = (s: Seat) => seats.find((x) => x.seat === s);
  const name = (s: Seat) => (s === seat ? '你' : (info(s)?.name ?? `座位 ${s + 1}`));
  const now = useNow(timer !== null);
  const secondsLeft = timer ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : null;
  const myTurn = seat !== null && v.phase === 'playing' && v.turn === seat;
  const myTribute = seat !== null && actingInTribute(v).includes(seat);
  const canAct = (myTurn || myTribute) && !pending;
  const handRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hintIdx, setHintIdx] = useState(0);
  /** 点"提示"选出来的牌按 bot 的解释出；自己改了选择就作废 */
  const [hintAs, setHintAs] = useState<Move['as'] | null>(null);
  const handKey = v.hand.join();
  const trickKey = `${v.handNo}|${v.phase}|${v.turn}|${v.history.length}`;
  useEffect(() => {
    setSelected(new Set());
    setHintAs(null);
  }, [handKey]);
  // 我"不出"了（自己点的，或超时被代打），选着的牌落回去
  const lastEntry = v.history[v.history.length - 1];
  const iJustPassed = !!lastEntry && lastEntry.seat === seat && lastEntry.cards === null;
  useEffect(() => {
    if (iJustPassed) {
      setSelected(new Set());
      setHintAs(null);
    }
  }, [iJustPassed, v.history.length]);
  useEffect(() => setHintIdx(0), [trickKey]);
  const hintList = useMemo(() => (myTurn ? hints(v) : []), [myTurn, trickKey, handKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (next: Set<string>) => {
    if (seat === null) return;
    setSelected(next);
    setHintAs(null);
  };
  const chosen = v.hand.filter((c) => selected.has(c));

  // 选中的牌能怎么出：有几种解释就给几个按钮（比如 5 张同点数能当炸弹也能当三带二）
  const readings: Pattern[] = useMemo(() => {
    if (!myTurn || chosen.length === 0) return [];
    return parse(chosen, v.level).filter((p) => !v.lastPlay || beats(p, v.lastPlay));
  }, [myTurn, chosen.join(), v.level, v.lastPlay]); // eslint-disable-line react-hooks/exhaustive-deps
  const primary = hintAs ?? (chosen.length ? interpret(chosen, v.level, v.lastPlay) : null);
  const alternatives = readings.filter((p) => !primary || p.kind !== primary.kind || p.main !== primary.main);

  const play = (as?: Move['as']) => {
    const use = as ?? (primary ? { kind: primary.kind, main: primary.main } : undefined);
    act({ type: 'play', cards: chosen, ...(use ? { as: use } : {}) });
  };
  const hint = () => {
    if (hintList.length === 0) return;
    const m = hintList[hintIdx % hintList.length];
    setSelected(new Set(m.cards));
    setHintAs(m.as);
    setHintIdx(hintIdx + 1);
  };

  // 进贡/还贡：提示直接选好一张能交的牌
  const tributeHint = () => {
    if (seat === null) return;
    let card: string | undefined;
    if (v.phase === 'tribute') {
      const target = tributeValue(v.hand, v.level);
      card = v.hand.find((c) => !isWild(c, v.level) && valueOf(c, v.level) === target);
    } else {
      card = returnable(v.hand).slice().sort((a, b) => valueOf(a, v.level) - valueOf(b, v.level))[0];
    }
    if (card) setSelected(new Set([card]));
  };

  const status = (() => {
    if (v.phase === 'ended') return null;
    if (v.phase === 'handOver') {
      const left = [0, 1, 2, 3].filter((i) => !v.ready[i]);
      return `等 ${left.map(name).join('、')} 点继续${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
    }
    if (v.phase === 'tribute' || v.phase === 'return') {
      if (!myTribute) return null;
      const what = v.phase === 'tribute' ? '选手里最大的一张牌进贡（配牌除外）' : '选一张 10 以下的牌还给对方';
      return `${what}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
    }
    const who = v.turn === seat ? '轮到你' : `等待 ${name(v.turn)}`;
    const what = v.turn === seat ? (v.lastPlay ? '管牌' : '出牌') : '';
    return `${who}${what}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
  })();

  const myTeam = teamOf(me);
  const lv = (x: number) => levelLabel(x);
  const myPlace = placeOf(v, me);

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <span className={styles.levelBig} data-level={v.level}>
          打 {lv(v.level)}
        </span>
        <span className={styles.dim}>
          红桃 {RANK_LABEL[v.level]} 是配牌 · 第 {v.handNo} 副
        </span>
        <span className={styles.levels}>
          <span style={{ color: TEAM_COLORS[myTeam] }}>
            {seat === null ? '1·3 号位' : '我方'} {lv(v.teamLevels[myTeam])}
          </span>
          <span>:</span>
          <span style={{ color: TEAM_COLORS[1 - myTeam] }}>
            {seat === null ? '2·4 号位' : '对方'} {lv(v.teamLevels[1 - myTeam])}
          </span>
        </span>
        {v.aFails.some((n) => n > 0) && v.opts.aLimit > 0 && (
          <span className={styles.dim}>
            打 A 没过：{[myTeam, 1 - myTeam].map((t) => `${v.aFails[t]}/${v.opts.aLimit}`).join(' : ')}
          </span>
        )}
      </div>

      {v.phase === 'playing' && <CardCounter v={v} />}

      <div className={styles.opponents}>
        <SeatPanel v={v} seat={left} info={info(left)} secondsLeft={secondsLeft} pos="left" />
        <SeatPanel v={v} seat={top} info={info(top)} secondsLeft={secondsLeft} pos="top" />
        <SeatPanel v={v} seat={right} info={info(right)} secondsLeft={secondsLeft} pos="right" />
      </div>

      <TributeLine v={v} name={name} />
      {(v.phase === 'handOver' || v.phase === 'ended') && v.lastHand && <HandResult h={v.lastHand} name={name} me={seat} />}

      <div className={styles.mine}>
        <div className={styles.myPlayed}>
          <FlyingPlay v={v} seat={me} from={() => handRef.current} />
        </div>

        {result && (
          <div className={styles.result} role="status">
            <div className={styles.resultTitle}>
              {seat !== null && result.winners.includes(seat) ? '你们赢了' : seat !== null ? '你们输了' : '比赛结束'}
            </div>
            <div>{result.summary}</div>
          </div>
        )}

        <div className={styles.status} aria-live="polite">
          {status && <span className={myTurn || myTribute ? styles.myTurn : ''}>{status}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>

        {seat !== null && v.phase === 'handOver' && !v.ready[seat] && (
          <div className={styles.actions}>
            <button className={styles.primary} disabled={pending} onClick={() => act({ type: 'ready' })}>
              继续
            </button>
          </div>
        )}
        {canAct && (v.phase === 'tribute' || v.phase === 'return') && (
          <div className={styles.actions}>
            <button onClick={tributeHint}>提示</button>
            <button
              className={styles.primary}
              disabled={chosen.length !== 1}
              onClick={() => act(v.phase === 'tribute' ? { type: 'tribute', card: chosen[0] } : { type: 'return', card: chosen[0] })}
            >
              {v.phase === 'tribute' ? '进贡' : '还贡'}
            </button>
          </div>
        )}
        {canAct && v.phase === 'playing' && (
          <div className={styles.actions}>
            <button
              disabled={!v.lastPlay}
              onClick={() => {
                setSelected(new Set());
                setHintAs(null);
                act({ type: 'pass' });
              }}
            >
              不出
            </button>
            <button onClick={hint} disabled={hintList.length === 0}>
              提示
            </button>
            <button className={styles.primary} disabled={chosen.length === 0} onClick={() => play()}>
              出牌
            </button>
          </div>
        )}
        {/* "当×× 出"另起一行并预留高度：放在上一行里会把居中的按钮挤开，连点两下"提示"第二下就点到了"出牌" */}
        {canAct && v.phase === 'playing' && (
          <div className={[styles.actions, styles.altRow].join(' ')}>
            {alternatives.map((p) => (
              <button key={`${p.kind}${p.main}`} className={styles.alt} onClick={() => play({ kind: p.kind, main: p.main })}>
                当{describe(p, v.level)}出
              </button>
            ))}
          </div>
        )}

        <div ref={handRef} className={[styles.myHand, myTurn || myTribute ? styles.turnGlow : ''].join(' ')}>
          {seat !== null ? (
            <>
              <div className={styles.myTag}>
                <Avatar info={info(seat)} />
                <TeamDot seat={seat} />
                <span>{info(seat)?.name ?? '我'}</span>
                {myPlace !== null && <span className={styles.placeTag}>{PLACE_NAME[myPlace]}</span>}
                <span className={styles.dim}>{v.hand.length} 张</span>
              </div>
              {v.phase === 'handOver' || v.phase === 'ended' ? (
                <Leftover v={v} seat={seat} />
              ) : (
                <Hand key={v.handNo} deal cards={v.hand.map((c) => faceOf(c, v.level))} selected={selected} onChange={choose} />
              )}
            </>
          ) : (
            <>
              <div className={styles.dim}>
                旁观中 · {info(0)?.name ?? '座位 1'} 剩 {v.counts[0]} 张
              </div>
              <Leftover v={v} seat={0} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const COUNTER_KEY = 'couju.guandan.counter';

function readCounterPref(): boolean {
  try {
    return localStorage.getItem(COUNTER_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** 记牌器：别人手里每个点数还剩几张（两副牌，每个点数最多 8 张） */
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
        记牌 {open ? '▾' : '▸'}
      </button>
      {open &&
        COUNTER_RANKS.map((r) => (
          <span
            key={r}
            className={[
              styles.counterCell,
              left[r] === 0 ? styles.counterGone : '',
              r === v.level ? styles.counterLevel : '',
              r < 16 && left[r] >= 4 ? styles.counterMany : '',
            ].join(' ')}
            data-rank={r}
            title={`${RANK_LABEL[r]}：别人手里还有 ${left[r]} 张${r === v.level ? '（级牌）' : ''}`}
          >
            <span className={styles.counterRank}>{r === 17 ? '大' : r === 16 ? '小' : RANK_LABEL[r]}</span>
            <span className={styles.counterNum}>{left[r]}</span>
          </span>
        ))}
    </div>
  );
}
