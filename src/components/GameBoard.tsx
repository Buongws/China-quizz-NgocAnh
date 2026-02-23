import styles from './GameBoard.module.css';
import { CardButton } from './CardButton';
import type { QuizItem, WrongPairState } from '../types';

interface GameBoardProps {
  leftItems: QuizItem[];
  rightItems: QuizItem[];
  selectedLeftId: string | null;
  selectedRightId: string | null;
  matchedIds: Set<string>;
  wrongPair: WrongPairState | null;
  isInputLocked: boolean;
  onSelectLeft: (id: string) => void;
  onSelectRight: (id: string) => void;
  emptyStateMessage: string;
}

export function GameBoard({
  leftItems,
  rightItems,
  selectedLeftId,
  selectedRightId,
  matchedIds,
  wrongPair,
  isInputLocked,
  onSelectLeft,
  onSelectRight,
  emptyStateMessage,
}: GameBoardProps) {
  const hasItems = leftItems.length > 0 && rightItems.length > 0;

  return (
    <section className={styles.boardCard} aria-label="Bảng ghép cặp">
      <div className={styles.languageTabs} aria-hidden="true">
        <div className={styles.tabItem}>🇻🇳 越南语</div>
        <div className={styles.tabItem}>🇨🇳 中文</div>
      </div>

      {!hasItems ? (
        <div className={styles.emptyState}>{emptyStateMessage}</div>
      ) : (
        <div className={styles.columns}>
          <div className={styles.column} aria-label="Cột nghĩa tiếng Việt">
            {leftItems.map((item) => {
              const status = matchedIds.has(item.id)
                ? 'correct'
                : wrongPair?.leftId === item.id
                  ? 'wrong'
                  : selectedLeftId === item.id
                    ? 'selected'
                    : 'normal';

              const disabled = matchedIds.has(item.id) || isInputLocked;

              return (
                <CardButton
                  key={`left-${item.id}`}
                  label={item.question}
                  side="left"
                  status={status}
                  disabled={disabled}
                  onClick={() => onSelectLeft(item.id)}
                />
              );
            })}
          </div>

          <div className={styles.column} aria-label="Cột chữ Hán">
            {rightItems.map((item) => {
              const status = matchedIds.has(item.id)
                ? 'correct'
                : wrongPair?.rightId === item.id
                  ? 'wrong'
                  : selectedRightId === item.id
                    ? 'selected'
                    : 'normal';

              const disabled = matchedIds.has(item.id) || isInputLocked;

              return (
                <CardButton
                  key={`right-${item.id}`}
                  label={item.answer}
                  side="right"
                  status={status}
                  disabled={disabled}
                  onClick={() => onSelectRight(item.id)}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
