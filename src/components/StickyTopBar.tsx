import styles from "./StickyTopBar.module.css";

interface StickyTopBarProps {
  correctCount: number;
  wrongCount: number;
  attempts: number;
  elapsedSeconds: number;
  isPlaying: boolean;
  buttonLabel: "Start" | "Restart";
  onPrimaryAction: () => void;
  primaryDisabled: boolean;
  practiceWrongOnly: boolean;
  onTogglePracticeWrongOnly: (value: boolean) => void;
  currentPoolCount: number;
  totalCount: number;
  wrongHistoryCount: number;
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function StickyTopBar({
  correctCount,
  wrongCount,
  attempts,
  elapsedSeconds,
  isPlaying,
  buttonLabel,
  onPrimaryAction,
  primaryDisabled,
  practiceWrongOnly,
  onTogglePracticeWrongOnly,
  currentPoolCount,
  totalCount,
  wrongHistoryCount,
}: StickyTopBarProps) {
  return (
    <header className={styles.stickyWrap}>
      <div className={styles.panel}>
        <div className={styles.statsGrid} aria-label="Thống kê lượt chơi">
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Câu đúng</span>
            <strong className={styles.statValue}>{correctCount}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Câu sai</span>
            <strong className={styles.statValue}>{wrongCount}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Lần thử</span>
            <strong className={styles.statValue}>{attempts}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Thời gian</span>
            <strong className={styles.statValue}>
              {formatTimer(elapsedSeconds)}
            </strong>
          </div>
        </div>

        <div className={styles.controlsRow}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
          >
            {buttonLabel}
          </button>

          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={practiceWrongOnly}
              onChange={(event) =>
                onTogglePracticeWrongOnly(event.target.checked)
              }
              className={styles.toggleInput}
            />
            <span className={styles.toggleTrack} aria-hidden="true">
              <span className={styles.toggleThumb} />
            </span>
            <span className={styles.toggleText}>Ôn sai đã lưu</span>
          </label>
        </div>

        <p className={styles.metaLine}>
          <span>
            Pool: <strong>{currentPoolCount}</strong> / {totalCount} câu
          </span>
          <span>Ôn sai đã lưu: {wrongHistoryCount}</span>
          <span>{isPlaying ? "Đang chơi" : "Sẵn sàng"}</span>
        </p>
      </div>
    </header>
  );
}
