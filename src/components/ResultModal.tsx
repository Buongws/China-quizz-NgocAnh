import { useEffect } from "react";
import styles from "./ResultModal.module.css";

interface ResultModalProps {
  open: boolean;
  score: number;
  attempts: number;
  elapsedSeconds: number;
  totalPairs: number;
  onRestart: () => void;
  onClose: () => void;
}

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ResultModal({
  open,
  score,
  attempts,
  elapsedSeconds,
  totalPairs,
  onRestart,
  onClose,
}: ResultModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
      >
        <p className={styles.badge}>Hoàn thành</p>
        <h2 id="result-modal-title" className={styles.title}>
          Bạn đã ghép xong {totalPairs} cặp
        </h2>
        <p className={styles.subtitle}>
          Tiếp tục chơi để nhớ mặt chữ nhanh hơn qua nhiều lượt shuffle.
        </p>

        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <span>Điểm</span>
            <strong>{score}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>Lần thử</span>
            <strong>{attempts}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>Thời gian</span>
            <strong>{formatTimer(elapsedSeconds)}</strong>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            Đóng
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onRestart}
          >
            Chơi lại
          </button>
        </div>
      </div>
    </div>
  );
}
