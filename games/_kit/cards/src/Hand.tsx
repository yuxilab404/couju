/**
 * 一排牌，张数多时自动重叠，手机竖屏也放得下。
 * 给了 onChange 就能选牌：单击切换一张；按住左键（或手指）横着拖过一段，松开时整段切换。
 */
import { useRef, useState, type PointerEvent } from 'react';
import { Card, type CardFace } from './Card.tsx';
import { dragSelection, indexAtX } from './dragSelect.ts';
import styles from './cards.module.css';

export interface HandProps {
  cards: CardFace[];
  selected?: ReadonlySet<string>;
  /** 选牌结果（整组替换）；不给就只展示、不能选 */
  onChange?: (next: Set<string>) => void;
  small?: boolean;
}

interface Drag {
  pointerId: number;
  anchor: number;
  current: number;
  /** 按下那一刻的手牌和选择：拖动中手牌变了也不会错位 */
  ids: string[];
  base: ReadonlySet<string>;
}

export function Hand({ cards, selected, onChange, small }: HandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // 拖动过程中的预览；松手才交给 onChange
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const base = selected ?? new Set<string>();
  const ids = cards.map((c) => c.id);
  const interactive = !!onChange && cards.length > 0;

  const indexAt = (clientX: number): number => {
    const slots = ref.current ? Array.from(ref.current.children) : [];
    return indexAtX(
      slots.map((el) => el.getBoundingClientRect().left),
      clientX,
    );
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 只认左键
    const slot = (e.target as HTMLElement).closest('[data-idx]');
    if (!slot || !ref.current?.contains(slot)) return;
    e.preventDefault(); // 不触发文字选择
    const anchor = Number((slot as HTMLElement).dataset.idx);
    drag.current = { pointerId: e.pointerId, anchor, current: anchor, ids, base };
    ref.current.setPointerCapture?.(e.pointerId);
    setPreview(dragSelection(base, ids, anchor, anchor));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const current = Math.min(indexAt(e.clientX), d.ids.length - 1);
    if (current === d.current) return;
    d.current = current;
    setPreview(dragSelection(d.base, d.ids, d.anchor, current));
  };

  const finish = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setPreview(null);
    if (!commit) return;
    // 手牌在拖动中变了（比如出掉了）：只保留现在还在手里的牌
    const now = new Set(ids);
    const next = dragSelection(d.base, d.ids, d.anchor, d.current);
    onChange!(new Set([...next].filter((id) => now.has(id))));
  };

  const shown = preview ?? base;
  return (
    <div
      ref={ref}
      className={[styles.hand, small ? styles.handSmall : '', interactive ? styles.handInteractive : ''].join(' ')}
      style={{ ['--n' as string]: Math.max(cards.length, 2) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
    >
      {cards.map((c, i) => (
        <div key={c.id} className={styles.slot} data-idx={i}>
          <Card face={c} small={small} selected={shown.has(c.id)} interactive={interactive} />
        </div>
      ))}
    </div>
  );
}
