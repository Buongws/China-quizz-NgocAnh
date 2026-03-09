import {
  type FormEvent,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import styles from "./App.module.css";
import { AdminDashboard } from "./components/AdminDashboard";
import { GameBoard } from "./components/GameBoard";
import { ResultModal } from "./components/ResultModal";
import { StickyTopBar } from "./components/StickyTopBar";
import { shuffleArray } from "./utils/shuffle";
import {
  ApiError,
  api,
  clearAuthToken,
  readAuthToken,
  writeAuthToken,
  type AdminDashboardResponse,
  type ApiCategory,
  type ApiQuestion,
} from "./lib/api";
import type { GameStatus, QuizItem, WrongPairState } from "./types";

const WRONG_IDS_STORAGE_PREFIX = "hanzi-quiz-wrong-ids-v2";
const MATCH_FEEDBACK_MS = 600;
const SCORE_CORRECT = 1;
const SCORE_WRONG = -1;
const QUIZ_PAIRS_PER_ROUND = 10;

type AuthMode = "login" | "register";
type QuestionGroup = {
  index: number;
  label: string;
  rangeLabel: string;
  items: QuizItem[];
};

function getWrongIdsStorageKey(userId: string) {
  return `${WRONG_IDS_STORAGE_PREFIX}:${userId}`;
}

function readWrongIdsForUser(userId: string | null): string[] {
  if (!userId || typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getWrongIdsStorageKey(userId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return Array.from(new Set(parsed.map(String)));
  } catch {
    return [];
  }
}

function writeWrongIdsForUser(userId: string | null, ids: string[]) {
  if (!userId || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getWrongIdsStorageKey(userId),
      JSON.stringify(ids),
    );
  } catch {
    // Ignore localStorage write errors
  }
}

function normalizeQuestions(rawItems: ApiQuestion[]): QuizItem[] {
  const normalized: QuizItem[] = [];
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();

  for (const item of rawItems) {
    const normalizedItem = {
      id: String(item.id),
      question: String(item.question || "").trim(),
      answer: String(item.answer || "").trim(),
    };

    if (
      normalizedItem.question.length === 0 ||
      normalizedItem.answer.length === 0
    ) {
      continue;
    }

    const pairKey = `${normalizedItem.question}\u0000${normalizedItem.answer}`;
    if (seenIds.has(normalizedItem.id) || seenPairs.has(pairKey)) {
      continue;
    }

    seenIds.add(normalizedItem.id);
    seenPairs.add(pairKey);
    normalized.push(normalizedItem);
  }

  return normalized;
}

function addUniqueIds(currentIds: string[], idsToAdd: string[]): string[] {
  const nextIds = new Set(currentIds);
  idsToAdd.forEach((id) => nextIds.add(id));
  return Array.from(nextIds);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatScoreTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

function buildQuestionCycleKey({
  categoryId,
  practiceWrongOnly,
  pool,
}: {
  categoryId: string | null;
  practiceWrongOnly: boolean;
  pool: QuizItem[];
}) {
  return `${categoryId ?? "none"}:${practiceWrongOnly ? "wrong-only" : "all"}:${pool.map((item) => item.id).join("|")}`;
}

function getNextSessionQuestionsFromPool({
  pool,
  previousRemaining,
  roundSize,
}: {
  pool: QuizItem[];
  previousRemaining: QuizItem[];
  roundSize: number;
}) {
  const limitedRoundSize = Math.min(roundSize, pool.length);
  if (limitedRoundSize === 0) {
    return {
      nextSessionQuestions: [],
      nextRemaining: [],
    };
  }

  if (pool.length <= limitedRoundSize) {
    return {
      nextSessionQuestions: shuffleArray(pool).slice(0, limitedRoundSize),
      nextRemaining: [],
    };
  }

  let remaining =
    previousRemaining.length > 0 ? previousRemaining : shuffleArray(pool);
  let nextSessionQuestions = remaining.slice(0, limitedRoundSize);
  let nextRemaining = remaining.slice(limitedRoundSize);

  if (nextSessionQuestions.length < limitedRoundSize) {
    const selectedIds = new Set(nextSessionQuestions.map((item) => item.id));
    const freshCycle = shuffleArray(pool);
    const topUpItems: QuizItem[] = [];
    const freshRemaining: QuizItem[] = [];

    for (const item of freshCycle) {
      if (
        topUpItems.length < limitedRoundSize - nextSessionQuestions.length &&
        !selectedIds.has(item.id)
      ) {
        topUpItems.push(item);
        selectedIds.add(item.id);
        continue;
      }

      freshRemaining.push(item);
    }

    nextSessionQuestions = [...nextSessionQuestions, ...topUpItems];
    nextRemaining = freshRemaining;
  }

  return {
    nextSessionQuestions,
    nextRemaining,
  };
}

function buildQuestionGroups(
  items: QuizItem[],
  groupSize: number,
): QuestionGroup[] {
  const groups: QuestionGroup[] = [];

  for (let index = 0; index < items.length; index += groupSize) {
    const groupNumber = Math.floor(index / groupSize) + 1;
    const start = index + 1;
    const end = Math.min(index + groupSize, items.length);

    groups.push({
      index: groupNumber - 1,
      label: `Nhóm ${groupNumber}`,
      rangeLabel: `Câu ${start}-${end}`,
      items: items.slice(index, index + groupSize),
    });
  }

  return groups;
}

function AuthGateCard({
  mode,
  onChangeMode,
  onSubmit,
  isPending,
  errorMessage,
}: {
  mode: AuthMode;
  onChangeMode: (mode: AuthMode) => void;
  onSubmit: (payload: { username: string; password: string }) => void;
  isPending: boolean;
  errorMessage: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ username: username.trim(), password });
  };

  return (
    <div className={styles.gateShell}>
      <section className={styles.gateCard} aria-label="Đăng nhập hoặc đăng ký">
        <p className={styles.eyebrow}>Quiz ghép cặp chữ Hán</p>
        <h1 className={styles.gateTitle}>Đăng nhập trước khi làm bài</h1>
        <p className={styles.gateSubtitle}>
          Mỗi học sinh có tài khoản riêng để lưu điểm theo từng chủ đề.
        </p>

        <div
          className={styles.authModeTabs}
          role="tablist"
          aria-label="Chọn chế độ xác thực"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`${styles.authModeButton} ${mode === "login" ? styles.authModeButtonActive : ""}`}
            onClick={() => onChangeMode("login")}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`${styles.authModeButton} ${mode === "register" ? styles.authModeButtonActive : ""}`}
            onClick={() => onChangeMode("register")}
          >
            Tạo tài khoản
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel}>
            Tên đăng nhập
            <input
              className={styles.input}
              type="text"
              autoComplete="username"
              placeholder="vd: minh.anh hoặc admin"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          <label className={styles.fieldLabel}>
            Mật khẩu
            <input
              className={styles.input}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder="Tối thiểu 6 ký tự"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText} role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            className={styles.primaryWideButton}
            disabled={isPending}
          >
            {isPending
              ? "Đang xử lý..."
              : mode === "login"
                ? "Đăng nhập"
                : "Tạo tài khoản"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ProfileSetupCard({
  username,
  onSubmit,
  isPending,
  errorMessage,
}: {
  username: string;
  onSubmit: (displayName: string) => void;
  isPending: boolean;
  errorMessage: string;
}) {
  const [displayName, setDisplayName] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(displayName.trim());
  };

  return (
    <div className={styles.gateShell}>
      <section className={styles.gateCard} aria-label="Thiết lập tên học sinh">
        <p className={styles.eyebrow}>Bước 2 / Hồ sơ</p>
        <h1 className={styles.gateTitle}>Đặt tên hiển thị</h1>
        <p className={styles.gateSubtitle}>
          Tên này sẽ hiển thị khi lưu điểm và lịch sử làm quiz. Tài khoản:{" "}
          <strong>@{username}</strong>
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel}>
            Tên học sinh
            <input
              className={styles.input}
              type="text"
              placeholder="Ví dụ: Minh Anh"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              minLength={2}
              maxLength={60}
              required
              autoFocus
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText} role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            className={styles.primaryWideButton}
            disabled={isPending}
          >
            {isPending ? "Đang lưu..." : "Lưu tên và vào game"}
          </button>
        </form>
      </section>
    </div>
  );
}

function CategoryTabs({
  categories,
  selectedCategoryId,
  onSelect,
}: {
  categories: ApiCategory[];
  selectedCategoryId: string | null;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <section className={styles.categoryCard} aria-label="Chọn mục quiz">
      <div className={styles.sectionHeaderRow}>
        <div>
          <p className={styles.sectionEyebrow}>Bước 3 / Chọn mục</p>
          <h2 className={styles.sectionTitle}>Tab chủ đề quiz</h2>
        </div>
      </div>

      <div
        className={styles.categoryTabs}
        role="tablist"
        aria-label="Danh sách chủ đề"
      >
        {categories.map((category) => {
          const active = category.id === selectedCategoryId;
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.categoryTab} ${active ? styles.categoryTabActive : ""}`}
              onClick={() => onSelect(category.id)}
            >
              <span className={styles.categoryTabTitle}>{category.title}</span>
              <span className={styles.categoryTabMeta}>
                {category.questionCount} câu
              </span>
            </button>
          );
        })}
      </div>

      {categories.length > 0 ? (
        <p className={styles.categoryDescription}>
          {categories.find((item) => item.id === selectedCategoryId)
            ?.description || "Chọn một chủ đề để bắt đầu luyện ghép cặp."}
        </p>
      ) : null}
    </section>
  );
}

function QuestionGroupTabs({
  groups,
  selectedGroupIndex,
  onSelect,
}: {
  groups: QuestionGroup[];
  selectedGroupIndex: number;
  onSelect: (groupIndex: number) => void;
}) {
  if (groups.length === 0) {
    return null;
  }

  const selectedGroup = groups[selectedGroupIndex] ?? groups[0];

  return (
    <section className={styles.categoryCard} aria-label="Chọn nhóm câu hỏi">
      <div className={styles.sectionHeaderRow}>
        <div>
          <p className={styles.sectionEyebrow}>Bước 4 / Chọn nhóm</p>
          <h2 className={styles.sectionTitle}>Tab nhóm 10 câu</h2>
        </div>
      </div>

      <div
        className={styles.categoryTabs}
        role="tablist"
        aria-label="Danh sách nhóm câu hỏi"
      >
        {groups.map((group) => {
          const active = group.index === selectedGroupIndex;
          return (
            <button
              key={group.label}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.categoryTab} ${active ? styles.categoryTabActive : ""}`}
              onClick={() => onSelect(group.index)}
            >
              <span className={styles.categoryTabTitle}>{group.label}</span>
              <span className={styles.categoryTabMeta}>
                {group.rangeLabel} • {group.items.length} câu
              </span>
            </button>
          );
        })}
      </div>

      <p className={styles.categoryDescription}>
        {groups.length === 1
          ? `Chủ đề này hiện có ${selectedGroup.items.length} câu, nên chỉ có 1 nhóm.`
          : `${selectedGroup.label} đang chọn: ${selectedGroup.rangeLabel}, gồm ${selectedGroup.items.length} câu.`}
      </p>
    </section>
  );
}

export default function App() {
  const queryClient = useQueryClient();

  const [authToken, setAuthToken] = useState<string | null>(readAuthToken);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [profileErrorMessage, setProfileErrorMessage] = useState("");

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedQuestionGroupIndex, setSelectedQuestionGroupIndex] =
    useState(0);
  const [practiceWrongOnly, setPracticeWrongOnly] = useState(false);
  const [wrongHistoryIds, setWrongHistoryIds] = useState<string[]>([]);

  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [sessionQuestions, setSessionQuestions] = useState<QuizItem[]>([]);
  const [leftColumnItems, setLeftColumnItems] = useState<QuizItem[]>([]);
  const [rightColumnItems, setRightColumnItems] = useState<QuizItem[]>([]);
  const [selectedLeftId, setSelectedLeftId] = useState<string | null>(null);
  const [selectedRightId, setSelectedRightId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [wrongPair, setWrongPair] = useState<WrongPairState | null>(null);
  const [isInputLocked, setIsInputLocked] = useState(false);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showResultModal, setShowResultModal] = useState(false);

  const resolveTimeoutRef = useRef<number | null>(null);
  const sessionCounterRef = useRef(0);
  const submittedSessionKeysRef = useRef<Set<number>>(new Set());
  const questionCycleKeyRef = useRef("");
  const remainingQuestionsRef = useRef<QuizItem[]>([]);
  const [activeSessionKey, setActiveSessionKey] = useState(0);

  const authMutation = useMutation({
    mutationFn: (payload: {
      mode: AuthMode;
      username: string;
      password: string;
    }) =>
      payload.mode === "login"
        ? api.login(payload.username, payload.password)
        : api.register(payload.username, payload.password),
    onSuccess: (data) => {
      writeAuthToken(data.token);
      setAuthToken(data.token);
      setAuthErrorMessage("");
    },
    onError: (error) => {
      setAuthErrorMessage(
        error instanceof Error ? error.message : "Lỗi xác thực.",
      );
    },
  });

  const meQuery = useQuery({
    queryKey: ["auth", "me", authToken],
    queryFn: () => api.getMe(authToken as string),
    enabled: Boolean(authToken),
    retry: false,
  });

  const profileMutation = useMutation({
    mutationFn: (displayName: string) =>
      api.updateProfile(authToken as string, displayName),
    onSuccess: () => {
      setProfileErrorMessage("");
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => {
      setProfileErrorMessage(
        error instanceof Error ? error.message : "Không thể lưu tên.",
      );
    },
  });

  const currentUser = meQuery.data?.user ?? null;
  const userId = currentUser?.id ?? null;
  const isAdminUser = currentUser?.role === "admin";
  const hasDisplayName = Boolean(currentUser?.displayName?.trim());

  const categoriesQuery = useQuery({
    queryKey: ["categories", authToken],
    queryFn: () => api.getCategories(authToken as string),
    enabled: Boolean(authToken && hasDisplayName),
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const selectedCategory =
    categories.find((item) => item.id === selectedCategoryId) ?? null;

  const questionsQuery = useQuery({
    queryKey: ["questions", authToken, selectedCategoryId],
    queryFn: () =>
      api.getQuestions(authToken as string, selectedCategoryId as string),
    enabled: Boolean(authToken && hasDisplayName && selectedCategoryId),
  });

  const scoresQuery = useQuery({
    queryKey: ["scores", authToken],
    queryFn: () => api.getMyScores(authToken as string, 8),
    enabled: Boolean(authToken && hasDisplayName),
  });

  const adminDashboardQuery = useQuery<AdminDashboardResponse>({
    queryKey: ["admin-dashboard", authToken],
    queryFn: () =>
      api.getAdminDashboard(authToken as string, {
        limitStudents: 100,
        recentScoreLimit: 5,
      }),
    enabled: Boolean(authToken && isAdminUser),
  });

  const submitScoreMutation = useMutation({
    mutationFn: (payload: {
      categoryId: string;
      score: number;
      attempts: number;
      durationSeconds: number;
      totalPairs: number;
      correctPairs: number;
      mode: "all" | "wrong-only";
    }) => api.submitScore(authToken as string, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scores"] });
    },
  });

  const allQuestions = useMemo(
    () => normalizeQuestions(questionsQuery.data?.questions ?? []),
    [questionsQuery.data?.questions],
  );
  const questionGroups = useMemo(
    () => buildQuestionGroups(allQuestions, QUIZ_PAIRS_PER_ROUND),
    [allQuestions],
  );
  const safeSelectedQuestionGroupIndex = questionGroups.some(
    (group) => group.index === selectedQuestionGroupIndex,
  )
    ? selectedQuestionGroupIndex
    : 0;
  const selectedQuestionGroup =
    questionGroups[safeSelectedQuestionGroupIndex] ?? null;
  const questionsInSelectedGroup = selectedQuestionGroup?.items ?? [];

  const wrongHistorySet = useMemo(
    () => new Set(wrongHistoryIds),
    [wrongHistoryIds],
  );
  const matchedIdSet = useMemo(() => new Set(matchedIds), [matchedIds]);
  const correctCount = matchedIds.length;
  const wrongCount = Math.max(attempts - correctCount, 0);

  const selectablePool = useMemo(() => {
    if (!practiceWrongOnly) {
      return questionsInSelectedGroup;
    }

    return questionsInSelectedGroup.filter((item) =>
      wrongHistorySet.has(item.id),
    );
  }, [practiceWrongOnly, questionsInSelectedGroup, wrongHistorySet]);
  const questionCycleKey = useMemo(
    () =>
      buildQuestionCycleKey({
        categoryId: selectedCategoryId,
        practiceWrongOnly,
        pool: selectablePool,
      }),
    [practiceWrongOnly, selectablePool, selectedCategoryId],
  );

  const canStartInCurrentMode = selectablePool.length > 0;

  function clearResolveTimeout() {
    if (resolveTimeoutRef.current !== null) {
      window.clearTimeout(resolveTimeoutRef.current);
      resolveTimeoutRef.current = null;
    }
  }

  function resetRoundState() {
    clearResolveTimeout();
    submitScoreMutation.reset();
    setSelectedLeftId(null);
    setSelectedRightId(null);
    setMatchedIds([]);
    setWrongPair(null);
    setIsInputLocked(false);
    setScore(0);
    setAttempts(0);
    setElapsedSeconds(0);
    setShowResultModal(false);
  }

  function resetBoardToIdle() {
    resetRoundState();
    setSessionQuestions([]);
    setLeftColumnItems([]);
    setRightColumnItems([]);
    setGameStatus("idle");
  }

  function handleLogout() {
    clearAuthToken();
    setAuthToken(null);
    setAuthMode("login");
    setAuthErrorMessage("");
    setProfileErrorMessage("");
    setSelectedCategoryId(null);
    setPracticeWrongOnly(false);
    setWrongHistoryIds([]);
    submitScoreMutation.reset();
    resetBoardToIdle();
    queryClient.clear();
  }

  function lockInputsForFeedback(afterDelay?: () => void) {
    clearResolveTimeout();
    resolveTimeoutRef.current = window.setTimeout(() => {
      afterDelay?.();
      setIsInputLocked(false);
      resolveTimeoutRef.current = null;
    }, MATCH_FEEDBACK_MS);
  }

  function resolvePair(leftId: string, rightId: string) {
    if (gameStatus !== "playing") {
      return;
    }

    setIsInputLocked(true);
    setAttempts((prev) => prev + 1);

    if (leftId === rightId) {
      setScore((prev) => prev + SCORE_CORRECT);
      setMatchedIds((prev) =>
        prev.includes(leftId) ? prev : [...prev, leftId],
      );
      setWrongPair(null);
      setSelectedLeftId(null);
      setSelectedRightId(null);
      lockInputsForFeedback();
      return;
    }

    setScore((prev) => prev + SCORE_WRONG);
    setWrongPair({ leftId, rightId });
    setWrongHistoryIds((prev) => addUniqueIds(prev, [leftId, rightId]));

    lockInputsForFeedback(() => {
      setWrongPair(null);
      setSelectedLeftId(null);
      setSelectedRightId(null);
    });
  }

  function startOrRestartGame() {
    resetRoundState();

    if (!canStartInCurrentMode) {
      setSessionQuestions([]);
      setLeftColumnItems([]);
      setRightColumnItems([]);
      setGameStatus("idle");
      return;
    }

    if (questionCycleKeyRef.current !== questionCycleKey) {
      questionCycleKeyRef.current = questionCycleKey;
      remainingQuestionsRef.current = [];
    }

    const { nextSessionQuestions, nextRemaining } =
      getNextSessionQuestionsFromPool({
        pool: selectablePool,
        previousRemaining: remainingQuestionsRef.current,
        roundSize: QUIZ_PAIRS_PER_ROUND,
      });

    remainingQuestionsRef.current = nextRemaining;
    setSessionQuestions(nextSessionQuestions);
    setLeftColumnItems(shuffleArray(nextSessionQuestions));
    setRightColumnItems(shuffleArray(nextSessionQuestions));
    sessionCounterRef.current += 1;
    setActiveSessionKey(sessionCounterRef.current);
    setGameStatus("playing");
  }

  function handleSelectLeft(id: string) {
    if (gameStatus !== "playing" || isInputLocked || matchedIdSet.has(id)) {
      return;
    }

    setSelectedLeftId(id);
    if (selectedRightId) {
      resolvePair(id, selectedRightId);
    }
  }

  function handleSelectRight(id: string) {
    if (gameStatus !== "playing" || isInputLocked || matchedIdSet.has(id)) {
      return;
    }

    setSelectedRightId(id);
    if (selectedLeftId) {
      resolvePair(selectedLeftId, id);
    }
  }

  useEffect(() => {
    if (!authToken) {
      return;
    }

    if (isUnauthorizedError(meQuery.error)) {
      handleLogout();
    }
  }, [authToken, meQuery.error]);

  useEffect(() => {
    if (!userId) {
      setWrongHistoryIds([]);
      return;
    }

    setWrongHistoryIds(readWrongIdsForUser(userId));
    setPracticeWrongOnly(false);
  }, [userId]);

  useEffect(() => {
    questionCycleKeyRef.current = questionCycleKey;
    remainingQuestionsRef.current = [];
  }, [questionCycleKey]);

  useEffect(() => {
    writeWrongIdsForUser(userId, wrongHistoryIds);
  }, [userId, wrongHistoryIds]);

  useEffect(() => {
    if (categories.length === 0) {
      setSelectedCategoryId(null);
      return;
    }

    if (
      !selectedCategoryId ||
      !categories.some((item) => item.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (questionGroups.length === 0) {
      setSelectedQuestionGroupIndex(0);
      return;
    }

    if (safeSelectedQuestionGroupIndex !== selectedQuestionGroupIndex) {
      setSelectedQuestionGroupIndex(safeSelectedQuestionGroupIndex);
    }
  }, [
    questionGroups.length,
    safeSelectedQuestionGroupIndex,
    selectedQuestionGroupIndex,
  ]);

  useEffect(() => {
    resetBoardToIdle();
  }, [safeSelectedQuestionGroupIndex]);

  useEffect(() => {
    setSelectedQuestionGroupIndex(0);
    resetBoardToIdle();
    setPracticeWrongOnly(false);
  }, [selectedCategoryId]);

  useEffect(() => {
    if (gameStatus !== "playing") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [gameStatus]);

  useEffect(() => {
    if (
      gameStatus !== "playing" ||
      sessionQuestions.length === 0 ||
      matchedIds.length !== sessionQuestions.length
    ) {
      return;
    }

    clearResolveTimeout();
    setIsInputLocked(false);
    setGameStatus("finished");
    setShowResultModal(true);

    if (
      authToken &&
      selectedCategoryId &&
      activeSessionKey > 0 &&
      !submittedSessionKeysRef.current.has(activeSessionKey)
    ) {
      submittedSessionKeysRef.current.add(activeSessionKey);
      submitScoreMutation.mutate({
        categoryId: selectedCategoryId,
        score,
        attempts,
        durationSeconds: elapsedSeconds,
        totalPairs: sessionQuestions.length,
        correctPairs: sessionQuestions.length,
        mode: practiceWrongOnly ? "wrong-only" : "all",
      });
    }
  }, [
    activeSessionKey,
    attempts,
    authToken,
    elapsedSeconds,
    gameStatus,
    matchedIds.length,
    practiceWrongOnly,
    score,
    selectedCategoryId,
    sessionQuestions.length,
    submitScoreMutation,
  ]);

  useEffect(() => {
    return () => {
      clearResolveTimeout();
    };
  }, []);

  const topBarButtonLabel = gameStatus === "idle" ? "Start" : "Restart";
  const topBarButtonDisabled =
    gameStatus === "playing"
      ? false
      : questionsQuery.isLoading ||
        questionsQuery.isError ||
        !canStartInCurrentMode;

  let emptyStateMessage = "Chọn chủ đề và nhấn Start để bắt đầu lượt ghép cặp.";
  if (questionsQuery.isLoading) {
    emptyStateMessage = "Đang tải câu hỏi từ MongoDB...";
  } else if (questionsQuery.isError) {
    emptyStateMessage =
      questionsQuery.error instanceof Error
        ? questionsQuery.error.message
        : "Không tải được câu hỏi.";
  } else if (!selectedCategoryId) {
    emptyStateMessage = "Chưa có chủ đề quiz để chơi.";
  } else if (questionsInSelectedGroup.length === 0) {
    emptyStateMessage = "Nhóm câu hỏi này hiện chưa có dữ liệu để chơi.";
  } else if (practiceWrongOnly && selectablePool.length === 0) {
    emptyStateMessage =
      "Chưa có câu sai trong nhóm này. Hãy chơi chế độ thường trước để lưu ôn sai.";
  }

  const saveStatusMessage = submitScoreMutation.isPending
    ? "Đang lưu điểm lên MongoDB..."
    : submitScoreMutation.isError
      ? submitScoreMutation.error instanceof Error
        ? `Lưu điểm lỗi: ${submitScoreMutation.error.message}`
        : "Lưu điểm lỗi."
      : submitScoreMutation.isSuccess
        ? "Điểm đã được lưu."
        : "";

  if (!authToken) {
    return (
      <AuthGateCard
        mode={authMode}
        onChangeMode={(mode) => {
          setAuthMode(mode);
          setAuthErrorMessage("");
        }}
        onSubmit={({ username, password }) => {
          setAuthErrorMessage("");
          authMutation.mutate({ mode: authMode, username, password });
        }}
        isPending={authMutation.isPending}
        errorMessage={authErrorMessage}
      />
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className={styles.gateShell}>
        <section className={styles.gateCard}>
          <h1 className={styles.gateTitle}>Đang xác thực tài khoản...</h1>
          <p className={styles.gateSubtitle}>Vui lòng chờ trong giây lát.</p>
        </section>
      </div>
    );
  }

  if (meQuery.isError && !isUnauthorizedError(meQuery.error)) {
    return (
      <div className={styles.gateShell}>
        <section className={styles.gateCard}>
          <h1 className={styles.gateTitle}>Không tải được tài khoản</h1>
          <p className={styles.errorText} role="alert">
            {meQuery.error instanceof Error
              ? meQuery.error.message
              : "Lỗi không xác định"}
          </p>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.primaryWideButton}
              onClick={() => meQuery.refetch()}
            >
              Thử lại
            </button>
            <button
              type="button"
              className={styles.secondaryWideButton}
              onClick={handleLogout}
            >
              Đăng xuất
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  if (isAdminUser) {
    return (
      <AdminDashboard
        authToken={authToken}
        currentUser={currentUser}
        data={adminDashboardQuery.data}
        isLoading={adminDashboardQuery.isLoading}
        isFetching={adminDashboardQuery.isFetching}
        errorMessage={
          adminDashboardQuery.isError
            ? adminDashboardQuery.error instanceof Error
              ? adminDashboardQuery.error.message
              : "Không tải được admin dashboard."
            : ""
        }
        onRefresh={() => adminDashboardQuery.refetch()}
        onLogout={handleLogout}
      />
    );
  }

  if (!hasDisplayName) {
    return (
      <ProfileSetupCard
        username={currentUser.username}
        onSubmit={(displayName) => {
          setProfileErrorMessage("");
          profileMutation.mutate(displayName);
        }}
        isPending={profileMutation.isPending}
        errorMessage={profileErrorMessage}
      />
    );
  }

  return (
    <div className={styles.appShell}>
      <section className={styles.accountCard} aria-label="Thông tin người dùng">
        <div>
          <p className={styles.sectionEyebrow}>Học sinh</p>
          <h2 className={styles.accountName}>{currentUser.displayName}</h2>
          <p className={styles.accountEmail}>@{currentUser.username}</p>
        </div>
        <button
          type="button"
          className={styles.logoutButton}
          onClick={handleLogout}
        >
          Đăng xuất
        </button>
      </section>

      <CategoryTabs
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelect={(categoryId) => {
          startTransition(() => {
            setSelectedCategoryId(categoryId);
          });
        }}
      />

      <StickyTopBar
        correctCount={correctCount}
        wrongCount={wrongCount}
        attempts={attempts}
        elapsedSeconds={elapsedSeconds}
        isPlaying={gameStatus === "playing"}
        buttonLabel={topBarButtonLabel}
        onPrimaryAction={startOrRestartGame}
        primaryDisabled={topBarButtonDisabled}
        practiceWrongOnly={practiceWrongOnly}
        onTogglePracticeWrongOnly={setPracticeWrongOnly}
        currentPoolCount={selectablePool.length}
        totalCount={questionsInSelectedGroup.length}
        wrongHistoryCount={wrongHistoryIds.length}
      />

      <QuestionGroupTabs
        groups={questionGroups}
        selectedGroupIndex={safeSelectedQuestionGroupIndex}
        onSelect={(groupIndex) => {
          startTransition(() => {
            setSelectedQuestionGroupIndex(groupIndex);
          });
        }}
      />

      <main className={styles.main}>
        <section className={styles.introCard} aria-label="Giới thiệu trò chơi">
          <p className={styles.eyebrow}>Quiz ghép cặp</p>
          <h1 className={styles.title}>Nhớ mặt chữ Hán</h1>
          <p className={styles.subtitle}>
            {selectedCategory
              ? `Chủ đề hiện tại: ${selectedCategory.title}.${selectedQuestionGroup ? ` ${selectedQuestionGroup.label} đang mở, gồm ${questionsInSelectedGroup.length} câu.` : ""} Học sinh có thể chọn tab theo từng nhóm tối đa ${QUIZ_PAIRS_PER_ROUND} câu rồi bắt đầu làm bài. Chọn 1 nghĩa tiếng Việt + 1 chữ Hán để ghép đúng.`
              : "Chọn một chủ đề để bắt đầu luyện."}
          </p>
        </section>

        {categoriesQuery.isLoading ? (
          <section className={styles.noteCard}>
            Đang tải danh sách chủ đề...
          </section>
        ) : null}

        {categoriesQuery.isError ? (
          <section className={styles.noteCardError} role="alert">
            {categoriesQuery.error instanceof Error
              ? categoriesQuery.error.message
              : "Không tải được danh sách chủ đề."}
          </section>
        ) : null}

        {saveStatusMessage ? (
          <section
            className={
              submitScoreMutation.isError
                ? styles.noteCardError
                : styles.noteCardSuccess
            }
            aria-live="polite"
          >
            {saveStatusMessage}
          </section>
        ) : null}

        <GameBoard
          leftItems={leftColumnItems}
          rightItems={rightColumnItems}
          selectedLeftId={selectedLeftId}
          selectedRightId={selectedRightId}
          matchedIds={matchedIdSet}
          wrongPair={wrongPair}
          isInputLocked={isInputLocked}
          onSelectLeft={handleSelectLeft}
          onSelectRight={handleSelectRight}
          emptyStateMessage={emptyStateMessage}
        />

        <section className={styles.helpCard} aria-label="Hướng dẫn tính điểm">
          <div className={styles.helpRow}>
            <span className={styles.helpDotCorrect} aria-hidden="true" />
            <span>Đúng: +1 điểm</span>
          </div>
          <div className={styles.helpRow}>
            <span className={styles.helpDotWrong} aria-hidden="true" />
            <span>
              Sai: -1 điểm, lưu vào danh sách ôn sai (theo tài khoản hiện tại)
            </span>
          </div>
        </section>

        <section
          className={styles.historyCard}
          aria-label="Lịch sử điểm gần đây"
        >
          <div className={styles.sectionHeaderRow}>
            <div>
              <p className={styles.sectionEyebrow}>Kết quả đã lưu</p>
              <h2 className={styles.sectionTitle}>Lịch sử điểm gần đây</h2>
            </div>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => scoresQuery.refetch()}
              disabled={scoresQuery.isFetching}
            >
              {scoresQuery.isFetching ? "Đang tải..." : "Làm mới"}
            </button>
          </div>

          {scoresQuery.isLoading ? (
            <p className={styles.mutedText}>Đang tải lịch sử điểm...</p>
          ) : scoresQuery.isError ? (
            <p className={styles.errorText} role="alert">
              {scoresQuery.error instanceof Error
                ? scoresQuery.error.message
                : "Không tải được lịch sử điểm."}
            </p>
          ) : (scoresQuery.data?.scores.length ?? 0) === 0 ? (
            <p className={styles.mutedText}>Chưa có lượt chơi nào được lưu.</p>
          ) : (
            <div className={styles.historyList}>
              {scoresQuery.data?.scores.map((entry) => (
                <div key={entry.id} className={styles.historyRow}>
                  <div className={styles.historyMain}>
                    <strong>{entry.categoryTitle}</strong>
                    <span>
                      {formatScoreTime(entry.createdAt)} •{" "}
                      {entry.mode === "wrong-only" ? "Ôn sai" : "Thường"}
                    </span>
                  </div>
                  <div className={styles.historyStats}>
                    <span>{entry.score} điểm</span>
                    <span>{entry.attempts} lượt</span>
                    <span>{formatDuration(entry.durationSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <ResultModal
        open={showResultModal}
        score={score}
        attempts={attempts}
        elapsedSeconds={elapsedSeconds}
        totalPairs={sessionQuestions.length}
        onRestart={startOrRestartGame}
        onClose={() => setShowResultModal(false)}
      />
    </div>
  );
}
