/**
 * 一排牌，张数多时自动重叠，手机竖屏也放得下。
 * 给了 onChange 就能选牌：单击切换一张；按住左键（或手指）横着拖过一段，松开时整段切换。
 * 键盘（Tab 到牌上按回车/空格）和读屏工具的点击也能切换一张。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Card, type CardFace } from './Card.tsx';
import { DragController, dragSelection, indexAtX } from './dragSelect.ts';
import styles from './cards.module.css';

export interface HandProps {
  cards: CardFace[];
  selected?: ReadonlySet<string>;
  /** 选牌结果（整组替换）；不给就只展示、不能选 */
  onChange?: (next: Set<string>) => void;
  small?: boolean;
}

export function Hand({ cards, selected, onChange, small }: HandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ctl = useRef(new DragController());
  const pointerId = useRef<number | null>(null);
  // 拖动过程中的预览；松手才交给 onChange
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const base = selected ?? new Set<string>();
  const ids = cards.map((c) => c.id);
  const handKey = ids.join(',');
  const interactive = !!onChange && cards.length > 0;

  // 手牌变了：作废进行中的拖选（指针位置已对不上按下时的那一排牌）
  useEffect(() => {
    if (!ctl.current.active) return;
    ctl.current.cancel();
    pointerId.current = null;
    setPreview(null);
  }, [handKey]);

  const indexAt = (clientX: number): number => {
    const slots = ref.current ? Array.from(ref.current.children) : [];
    return indexAtX(
      slots.map((el) => el.getBoundingClientRect().left),
      clientX,
    );
  };

  const slotIndex = (target: EventTarget): number | null => {
    const slot = (target as HTMLElement).closest?.('[data-idx]');
    if (!slot || !ref.current?.contains(slot)) return null;
    return Number((slot as HTMLElement).dataset.idx);
  };

  const toggleOne = (index: number) => onChange!(dragSelection(base, ids, index, index));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || pointerId.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 只认左键
    const index = slotIndex(e.target);
    if (index === null) return;
    e.preventDefault(); // 不触发文字选择
    pointerId.current = e.pointerId;
    ref.current!.setPointerCapture?.(e.pointerId);
    setPreview(ctl.current.down(ids, base, index));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerId.current) return;
    const next = ctl.current.move(ids, indexAt(e.clientX));
    if (next === null) {
      pointerId.current = null;
      setPreview(null);
    } else setPreview(next);
  };

  const finish = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (e.pointerId !== pointerId.current) return;
    pointerId.current = null;
    setPreview(null);
    if (!commit) return ctl.current.cancel();
    const next = ctl.current.up(ids);
    if (next) onChange!(next);
  };

  // 键盘、读屏工具产生的 click 没有对应的 pointer 事件（detail 为 0）；指针点击已在 pointerup 里处理过
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!interactive || e.detail !== 0) return;
    const index = slotIndex(e.target);
    if (index !== null) toggleOne(index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || (e.key !== 'Enter' && e.key !== ' ')) return;
    const index = slotIndex(e.target);
    if (index === null) return;
    e.preventDefault();
    toggleOne(index);
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
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {cards.map((c, i) => (
        <div key={c.id} className={styles.slot} data-idx={i}>
          <Card face={c} small={small} selected={shown.has(c.id)} interactive={interactive} />
        </div>
      ))}
    </div>
  );
}
