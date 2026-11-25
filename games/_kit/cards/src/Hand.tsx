/** 一排可以点选的牌，张数多时自动重叠，手机竖屏也放得下。 */
import { Card, type CardFace } from './Card.tsx';
import styles from './cards.module.css';

export interface HandProps {
  cards: CardFace[];
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  small?: boolean;
}

export function Hand({ cards, selected, onToggle, small }: HandProps) {
  return (
    <div
      className={[styles.hand, small ? styles.handSmall : ''].join(' ')}
      style={{ ['--n' as string]: Math.max(cards.length, 2) }}
    >
      {cards.map((c) => (
        <div key={c.id} className={styles.slot}>
          <Card face={c} small={small} selected={selected?.has(c.id)} onClick={onToggle ? () => onToggle(c.id) : undefined} />
        </div>
      ))}
    </div>
  );
}
