/**
 * 牌桌动画的小工具：牌从某处飞过来、翻牌、发牌依次落下。
 * 只是表现，不进规则；系统设置了"减少动态效果"时一律跳过，测试环境（没有 Web Animations）也跳过。
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Card, CardBack, type CardFace } from './Card.tsx';
import styles from './motion.module.css';

export function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 把 el 从 from 的位置"飞"回它现在的位置（FLIP）。from 拿不到或没法动画就什么都不做 */
export function flyFrom(el: HTMLElement | null, from: Element | null, opts: { duration?: number; scale?: number } = {}): void {
  if (!el || !from || typeof el.animate !== 'function' || reducedMotion()) return;
  const a = from.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  if (b.width === 0 && b.height === 0) return;
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  const s = opts.scale ?? 0.55;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.2 },
      { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1.06)`, opacity: 1, offset: 0.75 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: opts.duration ?? 420, easing: 'cubic-bezier(.2,.75,.25,1)' },
  );
}

/**
 * k 变了（有新的一手）就让里面的东西从 from() 指向的元素飞过来。
 * 默认第一次渲染不飞：刷新页面或中途进来时，桌上已有的牌不该再飞一遍。
 * onMount：每一手是新挂载的元素（按手换 key）时用，挂载即飞。
 */
export function FlyIn(props: {
  k: string | number | null;
  from: () => Element | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onMount?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(props.onMount ? undefined : props.k);
  useLayoutEffect(() => {
    if (prev.current === props.k) return;
    prev.current = props.k;
    if (props.k !== null) flyFrom(ref.current, props.from());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.k]);
  return (
    <div ref={ref} className={props.className} style={props.style}>
      {props.children}
    </div>
  );
}

/** 出牌记录里 seat 最近一手的序号（没出过为 null）；拿来当 FlyIn 的 k，这个座位每出一手（含"不要"）变一次 */
export function lastPlayIndex(history: readonly { seat: number }[], seat: number): number | null {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].seat === seat) return i;
  return null;
}

/** 翻开一张牌：先是牌背，delayMs 后翻到正面 */
export function FlipCard({ face, small, delayMs = 0 }: { face: CardFace; small?: boolean; delayMs?: number }) {
  return (
    <span className={styles.flip} style={{ ['--flip-delay' as string]: `${delayMs}ms` }} data-flip={face.id}>
      <span className={styles.flipInner}>
        <span className={styles.flipFront}>
          <Card face={face} small={small} />
        </span>
        <span className={styles.flipBack}>
          <CardBack small={small} />
        </span>
      </span>
    </span>
  );
}

/** 刚出现的东西弹一下（"不要"、出局之类的小牌子）。换 key 就再弹一次 */
export function Pop({ children, className, delayMs = 0 }: { children: ReactNode; className?: string; delayMs?: number }) {
  return (
    <span className={[styles.pop, className ?? ''].join(' ')} style={{ ['--pop-delay' as string]: `${delayMs}ms` }}>
      {children}
    </span>
  );
}

export const motion = styles;
