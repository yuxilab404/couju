/** 吹牛轮盘牌桌画面 */
import { Card, CardBack, Hand, type CardFace, type Suit } from '@couju/kit-cards';
import type { Seat, SeatInfo, TurnUIProps } from '@couju/sdk';
import { useEffect, useState } from 'react';
import { FACE_LABEL, faceOf, type Face } from './cards.ts';
import { MAX_PLAY, type Action, type Showdown, type View } from './rules.ts';
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

/** 六个弹膛：扣过的变暗，出局的那一发标红 */
function Revolver({ v, seat }: { v: View; seat: Seat }) {
  const shots = v.shots[seat];
  const dead = !v.alive[seat];
  return (
    <span className={styles.gun} title={dead ? '中弹出局' : `已扣 ${shots} 次扳机，还剩 ${v.chambers - shots} 发`} data-shots={shots}>
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

function SeatPanel(props: { v: View; seat: Seat; info: SeatInfo | undefined; secondsLeft: number | null }) {
  const { v, seat, info, secondsLeft } = props;
  const isTurn = v.phase !== 'ended' && v.turn === seat;
  const dead = !v.alive[seat];
  const mine = v.claims.filter((c) => c.seat === seat);
  return (
    <div className={[styles.seat, isTurn ? styles.turn : '', dead ? styles.dead : ''].join(' ')} data-seat={seat}>
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
            {isTurn && secondsLeft !== null && <span className={styles.clock}>{secondsLeft}</span>}
            {info?.kind === 'bot' && <span className={styles.tag}>电脑</span>}
            {info?.hosted && <span className={styles.tag}>托管中</span>}
            {info && !info.connected && info.kind === 'human' && <span className={styles.tag}>掉线</span>}
          </div>
        </div>
      </div>
      <Revolver v={v} seat={seat} />
      {mine.length > 0 && <div className={styles.claimLine}>本轮出了 {mine.map((c) => c.count).join(' + ')} 张</div>}
    </div>
  );
}

function ShowdownBanner({ v, d, name }: { v: View; d: Showdown; name: (s: Seat) => string }) {
  const latest = v.showdowns.length;
  return (
    <div key={latest} className={[styles.showdown, d.fired ? styles.fired : ''].join(' ')} role="status" data-showdown={latest}>
      <div className={styles.sdHead}>
        第 {d.round} 轮 · {name(d.accuser)} 喊 {name(d.accused)} 是骗子，翻开：
      </div>
      <div className={styles.sdCards}>
        <Row cards={revealedFaces(d, `sd${latest}`)} />
        <span className={d.lied ? styles.lied : styles.honest}>{d.lied ? `真有假牌（本轮 ${d.table}）` : `全是 ${d.table}，没骗人`}</span>
      </div>
      <div className={styles.sdShot}>
        {name(d.shooter)} 扣第 {d.shot} 次扳机……
        <b>{d.fired ? '砰！出局' : '咔哒，空枪'}</b>
      </div>
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

  const last = v.claims[v.claims.length - 1];
  const lastShowdown = v.showdowns[v.showdowns.length - 1];
  const pile = v.claims.reduce((m, c) => m + c.count, 0);
  const tooMany = selected.size > MAX_PLAY;

  const play = () => act({ type: 'play', cards: v.hand.filter((c) => selected.has(c)) });

  const status = (() => {
    if (v.phase === 'ended') return null;
    if (!myTurn) return `等待 ${name(v.turn)}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
    const what = v.mustCallLiar
      ? v.hand.length === 0
        ? '你没牌了，只能翻上一手'
        : '别人都没牌了，只能翻上一手'
      : last
        ? `接着出，或者喊${name(last.seat)}骗子`
        : `你先出，说都是 ${v.table}`;
    return `轮到你：${what}${secondsLeft !== null ? ` · ${secondsLeft} 秒` : ''}`;
  })();

  return (
    <div className={styles.table}>
      <div className={styles.opponents}>
        {others.map((s) => (
          <SeatPanel key={s} v={v} seat={s} info={info(s)} secondsLeft={secondsLeft} />
        ))}
      </div>

      <div className={styles.center}>
        <div className={styles.tableRank} aria-label={`本轮点数 ${v.table}`}>
          <span className={styles.dim}>第 {v.round} 轮 · 本轮说的都是</span>
          <span className={styles.bigRank} data-table={v.table}>
            {FACE_LABEL[v.table]}
          </span>
          <span className={styles.dim}>王算万能</span>
        </div>
        <div className={styles.pile}>
          {last ? (
            <>
              <div className={styles.backs}>
                {Array.from({ length: last.count }, (_, i) => (
                  <CardBack key={i} small />
                ))}
              </div>
              <div>
                {name(last.seat)} 扣下 {last.count} 张，说都是 {v.table}
              </div>
              <div className={styles.dim}>桌上一共 {pile} 张</div>
            </>
          ) : (
            <div className={styles.dim}>{v.phase === 'ended' ? '' : '还没人出牌'}</div>
          )}
        </div>
      </div>

      {lastShowdown && <ShowdownBanner v={v} d={lastShowdown} name={name} />}

      <div className={styles.mine}>
        {result && (
          <div className={styles.result}>
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

        <div className={[styles.myHand, myTurn ? styles.turnGlow : '', seat !== null && !v.alive[seat] ? styles.dead : ''].join(' ')}>
          {seat !== null ? (
            <>
              <div className={styles.myTag}>
                <Avatar info={info(seat)} />
                <span>{info(seat)?.name ?? '我'}</span>
                <Revolver v={v} seat={seat} />
                {!v.alive[seat] && <span className={styles.outTag}>出局</span>}
              </div>
              {v.alive[seat] && v.hand.length > 0 && (
                <Hand cards={v.hand.map(cardFace)} selected={selected} onChange={!v.mustCallLiar ? setSelected : undefined} />
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
