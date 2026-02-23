import styles from './CardButton.module.css';
import type { CardVisualState } from '../types';

interface CardButtonProps {
  label: string;
  side: 'left' | 'right';
  status: CardVisualState;
  disabled?: boolean;
  onClick: () => void;
}

export function CardButton({
  label,
  side,
  status,
  disabled = false,
  onClick,
}: CardButtonProps) {
  const className = [
    styles.cardButton,
    side === 'left' ? styles.sideLeft : styles.sideRight,
    status === 'selected' ? styles.selected : '',
    status === 'correct' ? styles.correct : '',
    status === 'wrong' ? styles.wrong : '',
    disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCorrect = status === 'correct';

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={status === 'selected'}
      aria-label={`${side === 'left' ? 'Tiếng Việt' : 'Chữ Hán'}: ${label}`}
    >
      <span className={styles.label}>{label}</span>
      {isCorrect ? (
        <span className={styles.checkBadge} aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}
