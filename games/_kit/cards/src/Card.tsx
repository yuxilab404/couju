/** 纯 CSS 画的扑克牌，不依赖图片。牌的点数含义由各游戏自己定，这里只负责画。 */
import styles from './cards.module.css';

export type Suit = 'S' | 'H' | 'C' | 'D' | 'JB' | 'JR';

export interface CardFace {
  id: string;
  /** 角上显示的字，如 "10"、"A"、"大王" */
  label: string;
  /** JB = 小王（黑），JR = 大王（红） */
  suit: Suit;
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', C: '♣', D: '♦', JB: '★', JR: '★' };

export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D' || suit === 'JR';
}

export interface CardProps {
  face: CardFace;
  selected?: boolean;
  small?: boolean;
  /** 可以选（点击/拖拽由外面的 Hand 统一处理） */
  interactive?: boolean;
}

export function Card({ face, selected, small, interactive }: CardProps) {
  const joker = face.suit === 'JB' || face.suit === 'JR';
  const cls = [
    styles.card,
    isRed(face.suit) ? styles.red : styles.black,
    selected ? styles.selected : '',
    small ? styles.small : '',
    interactive ? styles.clickable : '',
  ].join(' ');
  return (
    <div
      className={cls}
      data-card={face.id}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? !!selected : undefined}
    >
      {joker ? (
        <div className={styles.joker}>
          <span>{face.suit === 'JR' ? '大' : '小'}</span>
          <span>王</span>
          <span className={styles.jokerStar}>★</span>
        </div>
      ) : (
        <>
          <div className={styles.corner}>
            <span className={styles.rank}>{face.label}</span>
            <span className={styles.suit}>{SUIT_SYMBOL[face.suit]}</span>
          </div>
          <div className={styles.pip}>{SUIT_SYMBOL[face.suit]}</div>
        </>
      )}
    </div>
  );
}

/** 牌背（显示对手剩余张数时用） */
export function CardBack({ small }: { small?: boolean }) {
  return <div className={[styles.card, styles.back, small ? styles.small : ''].join(' ')} />;
}
