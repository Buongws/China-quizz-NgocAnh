import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import styles from "./AdminDashboard.module.css";
import {
  api,
  type AdminDashboardResponse,
  type AdminDashboardStudentRow,
  type ApiCategory,
  type ApiQuestion,
  type ApiUser,
} from "../lib/api";

interface AdminDashboardProps {
  authToken: string;
  currentUser: ApiUser;
  data?: AdminDashboardResponse;
  isLoading: boolean;
  isFetching: boolean;
  errorMessage: string;
  onRefresh: () => void;
  onLogout: () => void;
}

type BulkImportMode = "single-set" | "multi-block";

interface ParsedImportWord {
  legacyId?: string;
  question: string;
  answer: string;
}

interface ParsedImportSet {
  title: string;
  items: ParsedImportWord[];
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeImportWord(
  rawItem: unknown,
  index: number,
): ParsedImportWord {
  if (!rawItem || typeof rawItem !== "object") {
    throw new Error(`Item #${index + 1} không hợp lệ.`);
  }

  const item = rawItem as Record<string, unknown>;
  const question = String(item.question || "").trim();
  const answer = String(item.answer || "").trim();
  const legacyIdRaw = item.id ?? item.legacyId;
  const legacyId =
    legacyIdRaw === undefined || legacyIdRaw === null
      ? undefined
      : String(legacyIdRaw).trim();

  if (!question) {
    throw new Error(`Item #${index + 1} thiếu field question.`);
  }

  if (!answer) {
    throw new Error(`Item #${index + 1} thiếu field answer.`);
  }

  return {
    legacyId: legacyId || undefined,
    question,
    answer,
  };
}

function parseJsonArrayWords(jsonText: string): ParsedImportWord[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("JSON không hợp lệ.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("JSON phải là một mảng các item { question, answer }.");
  }

  if (parsed.length === 0) {
    throw new Error("Mảng JSON đang rỗng.");
  }

  return parsed.map((item, index) => normalizeImportWord(item, index));
}

function pickTitleFromPreamble(
  preamble: string,
  fallbackIndex: number,
): string {
  const lines = preamble
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "。");
  const line = lines.length > 0 ? lines[lines.length - 1] : undefined;

  if (!line) {
    return `Bo-tu-${fallbackIndex + 1}`;
  }

  const cleaned = line.replace(/[：:]\s*$/, "").trim();
  return cleaned || `Bo-tu-${fallbackIndex + 1}`;
}

function extractBracketArray(
  source: string,
  startIndex: number,
): { json: string; endIndex: number } {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          json: source.slice(startIndex, i + 1),
          endIndex: i + 1,
        };
      }
    }
  }

  throw new Error("Không tìm thấy dấu ] kết thúc mảng JSON.");
}

function parseMultiBlockImportText(source: string): ParsedImportSet[] {
  const text = source.trim();
  if (!text) {
    throw new Error("Nội dung import đang rỗng.");
  }

  const sets: ParsedImportSet[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const arrayStart = text.indexOf("[", cursor);
    if (arrayStart === -1) break;

    const preamble = text.slice(cursor, arrayStart);
    const { json, endIndex } = extractBracketArray(text, arrayStart);
    const title = pickTitleFromPreamble(preamble, sets.length);
    const items = parseJsonArrayWords(json);

    sets.push({ title, items });
    cursor = endIndex;
  }

  if (sets.length === 0) {
    throw new Error("Không tìm thấy block JSON nào để import.");
  }

  return sets;
}

function StudentCard({ row }: { row: AdminDashboardStudentRow }) {
  return (
    <article className={styles.studentCard}>
      <div className={styles.studentHeader}>
        <div>
          <p className={styles.studentName}>
            {row.student.displayName || "Chưa đặt tên"}
          </p>
          <p className={styles.studentEmail}>
            @{row.student.username || "unknown"}
          </p>
        </div>
        <span className={styles.badge}>{row.stats.totalSessions} lượt</span>
      </div>

      <div className={styles.studentStats}>
        <div className={styles.statBox}>
          <span>Tổng điểm</span>
          <strong>{row.stats.totalScoreAccumulated}</strong>
        </div>
        <div className={styles.statBox}>
          <span>Best</span>
          <strong>{row.stats.bestScore}</strong>
        </div>
        <div className={styles.statBox}>
          <span>Gần nhất</span>
          <strong>{row.stats.latestScore ?? "-"}</strong>
        </div>
      </div>

      <p className={styles.lastPlayedText}>
        Lần chơi gần nhất: {formatDate(row.stats.lastPlayedAt)}
      </p>

      {row.recentScores.length > 0 ? (
        <div className={styles.recentList}>
          {row.recentScores.map((score) => (
            <div key={score.id} className={styles.recentRow}>
              <div className={styles.recentMain}>
                <strong>{score.categoryTitle}</strong>
                <span>
                  {formatDate(score.createdAt)} •{" "}
                  {score.mode === "wrong-only" ? "Ôn sai" : "Thường"}
                </span>
              </div>
              <div className={styles.recentMeta}>
                <span>{score.score}đ</span>
                <span>{score.attempts} lượt</span>
                <span>{formatDuration(score.durationSeconds)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.emptySmall}>Học sinh này chưa có điểm.</p>
      )}
    </article>
  );
}

function CategoryChip({
  category,
  active,
  onClick,
}: {
  category: ApiCategory;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.categoryChip} ${active ? styles.categoryChipActive : ""}`}
    >
      <span>{category.title}</span>
      <small>{category.questionCount} từ</small>
    </button>
  );
}

export function AdminDashboard({
  authToken,
  currentUser,
  data,
  isLoading,
  isFetching,
  errorMessage,
  onRefresh,
  onLogout,
}: AdminDashboardProps) {
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [categoryKeyword, setCategoryKeyword] = useState("");
  const [selectedManageCategoryId, setSelectedManageCategoryId] = useState<
    string | null
  >(null);

  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [newCategorySlug, setNewCategorySlug] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");

  const [newQuestionText, setNewQuestionText] = useState("");
  const [newAnswerText, setNewAnswerText] = useState("");
  const [newLegacyId, setNewLegacyId] = useState("");
  const [bulkImportMode, setBulkImportMode] =
    useState<BulkImportMode>("multi-block");
  const [bulkImportTitle, setBulkImportTitle] = useState("");
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportProgress, setBulkImportProgress] = useState("");
  const [bulkImportSummary, setBulkImportSummary] = useState("");
  const [showCreateCategoryPanel, setShowCreateCategoryPanel] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [editableQuestions, setEditableQuestions] = useState<ApiQuestion[]>([]);
  const [editableQuestionsCategoryId, setEditableQuestionsCategoryId] =
    useState<string | null>(null);
  const [questionDraftFeedback, setQuestionDraftFeedback] = useState("");
  const [questionDraftFeedbackKind, setQuestionDraftFeedbackKind] = useState<
    "success" | "error"
  >("success");

  const categoriesQuery = useQuery({
    queryKey: ["admin-content-categories", authToken],
    queryFn: () => api.getCategories(authToken),
  });

  const manageableCategories = categoriesQuery.data?.categories ?? [];

  useEffect(() => {
    if (manageableCategories.length === 0) {
      setSelectedManageCategoryId(null);
      return;
    }

    if (
      !selectedManageCategoryId ||
      !manageableCategories.some((item) => item.id === selectedManageCategoryId)
    ) {
      setSelectedManageCategoryId(manageableCategories[0].id);
    }
  }, [manageableCategories, selectedManageCategoryId]);

  const selectedManageCategory =
    manageableCategories.find((item) => item.id === selectedManageCategoryId) ??
    null;

  useEffect(() => {
    if (bulkImportMode !== "single-set") {
      return;
    }

    // Keep import title in sync with current selected category for quick import.
    setBulkImportTitle(selectedManageCategory?.title || "");
  }, [
    bulkImportMode,
    selectedManageCategory?.id,
    selectedManageCategory?.title,
  ]);

  const filteredManageableCategories = useMemo(() => {
    const q = categoryKeyword.trim().toLowerCase();
    if (!q) {
      return manageableCategories;
    }

    return manageableCategories.filter((category) => {
      const title = category.title.toLowerCase();
      const slug = category.slug.toLowerCase();
      const description = (category.description || "").toLowerCase();
      return title.includes(q) || slug.includes(q) || description.includes(q);
    });
  }, [categoryKeyword, manageableCategories]);

  const categoryQuestionsQuery = useQuery({
    queryKey: ["admin-content-questions", authToken, selectedManageCategoryId],
    queryFn: () =>
      api.getQuestions(authToken, selectedManageCategoryId as string),
    enabled: Boolean(selectedManageCategoryId),
  });

  const refreshContentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-content-categories"] });
    queryClient.invalidateQueries({ queryKey: ["admin-content-questions"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["questions"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const createCategoryMutation = useMutation({
    mutationFn: () =>
      api.createAdminCategory(authToken, {
        title: newCategoryTitle.trim(),
        slug: newCategorySlug.trim() || undefined,
        description: newCategoryDescription.trim() || undefined,
      }),
    onSuccess: (response) => {
      setNewCategoryTitle("");
      setNewCategorySlug("");
      setNewCategoryDescription("");
      setSelectedManageCategoryId(response.category.id);
      refreshContentQueries();
      onRefresh();
    },
  });

  const createQuestionMutation = useMutation({
    mutationFn: () =>
      api.createAdminQuestion(authToken, {
        categoryId: selectedManageCategoryId as string,
        question: newQuestionText.trim(),
        answer: newAnswerText.trim(),
        legacyId: newLegacyId.trim() || undefined,
      }),
    onSuccess: () => {
      setNewQuestionText("");
      setNewAnswerText("");
      setNewLegacyId("");
      refreshContentQueries();
      onRefresh();
    },
  });

  const saveQuestionDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedManageCategoryId) {
        throw new Error("Vui lòng chọn bộ từ.");
      }

      if (editableQuestionsCategoryId !== selectedManageCategoryId) {
        throw new Error("Danh sách từ vựng chưa sẵn sàng, vui lòng thử lại.");
      }

      const originalById = new Map(
        questionsInSelectedCategory.map((item) => [item.id, item] as const),
      );
      const draftIds = new Set<string>();
      let updatedCount = 0;
      let deletedCount = 0;

      for (let index = 0; index < editableQuestions.length; index += 1) {
        const item = editableQuestions[index];
        const question = item.question.trim();
        const answer = item.answer.trim();
        const original = originalById.get(item.id);

        draftIds.add(item.id);

        if (!question) {
          throw new Error(`Dòng #${index + 1} thiếu nghĩa tiếng Việt.`);
        }

        if (!answer) {
          throw new Error(`Dòng #${index + 1} thiếu chữ Hán.`);
        }

        if (question.length > 120) {
          throw new Error(
            `Dòng #${index + 1}: nghĩa tiếng Việt tối đa 120 ký tự.`,
          );
        }

        if (answer.length > 120) {
          throw new Error(`Dòng #${index + 1}: chữ Hán tối đa 120 ký tự.`);
        }

        if (!original) {
          continue;
        }

        if (question !== original.question || answer !== original.answer) {
          await api.updateAdminQuestion(authToken, item.id, {
            question,
            answer,
          });
          updatedCount += 1;
        }
      }

      for (const original of questionsInSelectedCategory) {
        if (draftIds.has(original.id)) {
          continue;
        }
        await api.deleteAdminQuestion(authToken, original.id);
        deletedCount += 1;
      }

      return { updatedCount, deletedCount };
    },
    onMutate: () => {
      setQuestionDraftFeedback("");
    },
    onSuccess: (result) => {
      setEditableQuestions((prev) =>
        prev.map((item) => ({
          ...item,
          question: item.question.trim(),
          answer: item.answer.trim(),
        })),
      );

      if (result.updatedCount === 0 && result.deletedCount === 0) {
        setQuestionDraftFeedbackKind("success");
        setQuestionDraftFeedback("Không có thay đổi để lưu.");
        return;
      }

      setQuestionDraftFeedbackKind("success");
      setQuestionDraftFeedback(
        `Đã lưu thay đổi: sửa ${result.updatedCount} từ, xoá ${result.deletedCount} từ.`,
      );
      refreshContentQueries();
      onRefresh();
    },
    onError: (error) => {
      setQuestionDraftFeedbackKind("error");
      setQuestionDraftFeedback(
        error instanceof Error ? error.message : "Lưu thay đổi thất bại.",
      );
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async () => {
      const text = bulkImportText.trim();
      if (!text) {
        throw new Error("Vui lòng dán nội dung JSON trước khi import.");
      }

      let importedSetCount = 0;
      let importedWordCount = 0;
      let lastCreatedCategoryId: string | null = null;

      if (bulkImportMode === "single-set") {
        const words = parseJsonArrayWords(text);
        const importTitle =
          bulkImportTitle.trim() || selectedManageCategory?.title?.trim() || "";
        if (!importTitle) {
          throw new Error("Vui lòng nhập Title bộ từ để import.");
        }

        const existingCategory = manageableCategories.find(
          (category) =>
            category.title.trim().toLowerCase() === importTitle.toLowerCase(),
        );

        let targetCategoryId = existingCategory?.id || null;
        let targetCategoryTitle = existingCategory?.title || importTitle;

        if (!targetCategoryId) {
          setBulkImportProgress(`Đang tạo bộ từ: ${importTitle}...`);
          const createdCategory = await api.createAdminCategory(authToken, {
            title: importTitle,
          });
          targetCategoryId = createdCategory.category.id;
          targetCategoryTitle = createdCategory.category.title;
          importedSetCount += 1;
          lastCreatedCategoryId = targetCategoryId;
        } else {
          importedSetCount = 1;
          lastCreatedCategoryId = targetCategoryId;
        }

        for (let i = 0; i < words.length; i += 1) {
          const word = words[i];
          setBulkImportProgress(
            `Đang import từ ${i + 1}/${words.length} vào bộ "${targetCategoryTitle}"...`,
          );
          await api.createAdminQuestion(authToken, {
            categoryId: targetCategoryId,
            question: word.question,
            answer: word.answer,
            legacyId: word.legacyId,
          });
          importedWordCount += 1;
        }
      } else {
        const sets = parseMultiBlockImportText(text);

        for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
          const setItem = sets[setIndex];
          setBulkImportProgress(
            `Đang tạo bộ ${setIndex + 1}/${sets.length}: ${setItem.title}...`,
          );

          const createdCategory = await api.createAdminCategory(authToken, {
            title: setItem.title,
          });

          lastCreatedCategoryId = createdCategory.category.id;
          importedSetCount += 1;

          for (
            let wordIndex = 0;
            wordIndex < setItem.items.length;
            wordIndex += 1
          ) {
            const word = setItem.items[wordIndex];
            setBulkImportProgress(
              `Đang thêm từ ${wordIndex + 1}/${setItem.items.length} vào bộ \"${setItem.title}\"...`,
            );

            await api.createAdminQuestion(authToken, {
              categoryId: createdCategory.category.id,
              question: word.question,
              answer: word.answer,
              legacyId: word.legacyId,
            });
            importedWordCount += 1;
          }
        }
      }

      return { importedSetCount, importedWordCount, lastCreatedCategoryId };
    },
    onMutate: () => {
      setBulkImportSummary("");
      setBulkImportProgress("Chuẩn bị import...");
    },
    onSuccess: (result) => {
      refreshContentQueries();
      if (result.lastCreatedCategoryId) {
        setSelectedManageCategoryId(result.lastCreatedCategoryId);
      }
      setBulkImportSummary(
        `Import xong: ${result.importedSetCount} bộ từ, ${result.importedWordCount} từ vựng.`,
      );
      setBulkImportProgress("");
      onRefresh();
    },
    onError: (error) => {
      setBulkImportProgress("");
      setBulkImportSummary(
        error instanceof Error ? error.message : "Import thất bại.",
      );
    },
  });

  const filteredStudents = useMemo(() => {
    const rows = data?.students ?? [];
    const q = keyword.trim().toLowerCase();
    if (!q) {
      return rows;
    }

    return rows.filter((row) => {
      const name = (row.student.displayName || "").toLowerCase();
      const username = (row.student.username || "").toLowerCase();
      return name.includes(q) || username.includes(q);
    });
  }, [data?.students, keyword]);

  const createCategoryFeedback = createCategoryMutation.isPending
    ? "Đang tạo bộ từ..."
    : createCategoryMutation.isError
      ? createCategoryMutation.error instanceof Error
        ? createCategoryMutation.error.message
        : "Tạo bộ từ thất bại."
      : createCategoryMutation.isSuccess
        ? "Đã tạo bộ từ."
        : "";

  const createQuestionFeedback = createQuestionMutation.isPending
    ? "Đang thêm từ..."
    : createQuestionMutation.isError
      ? createQuestionMutation.error instanceof Error
        ? createQuestionMutation.error.message
        : "Thêm từ thất bại."
      : createQuestionMutation.isSuccess
        ? "Đã thêm từ vào bộ."
        : "";

  const bulkImportFeedback = bulkImportMutation.isPending
    ? bulkImportProgress || "Đang import..."
    : bulkImportSummary;

  const questionsInSelectedCategory =
    categoryQuestionsQuery.data?.questions ?? [];

  const editableQuestionsForSelectedCategory =
    editableQuestionsCategoryId === selectedManageCategoryId
      ? editableQuestions
      : [];

  const questionDraftStats = useMemo(() => {
    if (
      !selectedManageCategoryId ||
      editableQuestionsCategoryId !== selectedManageCategoryId
    ) {
      return {
        initialized: false,
        updatedCount: 0,
        deletedCount: 0,
        changedCount: 0,
      };
    }

    const originalById = new Map(
      questionsInSelectedCategory.map((item) => [item.id, item] as const),
    );
    const draftIds = new Set<string>();
    let updatedCount = 0;

    for (const item of editableQuestions) {
      draftIds.add(item.id);
      const original = originalById.get(item.id);
      if (!original) {
        continue;
      }

      if (
        item.question !== original.question ||
        item.answer !== original.answer
      ) {
        updatedCount += 1;
      }
    }

    let deletedCount = 0;
    for (const original of questionsInSelectedCategory) {
      if (!draftIds.has(original.id)) {
        deletedCount += 1;
      }
    }

    return {
      initialized: true,
      updatedCount,
      deletedCount,
      changedCount: updatedCount + deletedCount,
    };
  }, [
    editableQuestions,
    editableQuestionsCategoryId,
    questionsInSelectedCategory,
    selectedManageCategoryId,
  ]);

  useEffect(() => {
    if (!selectedManageCategoryId) {
      setEditableQuestions([]);
      setEditableQuestionsCategoryId(null);
      setQuestionDraftFeedback("");
      return;
    }

    if (!categoryQuestionsQuery.isSuccess) {
      return;
    }

    if (
      editableQuestionsCategoryId === selectedManageCategoryId &&
      questionDraftStats.changedCount > 0
    ) {
      return;
    }

    setEditableQuestions(
      questionsInSelectedCategory.map((item) => ({ ...item })),
    );
    setEditableQuestionsCategoryId(selectedManageCategoryId);
  }, [
    categoryQuestionsQuery.isSuccess,
    editableQuestionsCategoryId,
    questionDraftStats.changedCount,
    questionsInSelectedCategory,
    selectedManageCategoryId,
  ]);

  const handleQuestionDraftFieldChange = (
    questionId: string,
    field: "question" | "answer",
    value: string,
  ) => {
    setQuestionDraftFeedback("");
    setEditableQuestions((prev) =>
      prev.map((item) =>
        item.id !== questionId
          ? item
          : field === "question"
            ? { ...item, question: value }
            : { ...item, answer: value },
      ),
    );
  };

  const handleRemoveQuestionDraftRow = (questionId: string) => {
    setQuestionDraftFeedback("");
    setEditableQuestions((prev) =>
      prev.filter((item) => item.id !== questionId),
    );
  };

  const handleResetQuestionDraft = () => {
    setQuestionDraftFeedback("");
    setEditableQuestions(
      questionsInSelectedCategory.map((item) => ({ ...item })),
    );
    setEditableQuestionsCategoryId(selectedManageCategoryId);
  };

  const handleCreateCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCategoryMutation.mutate();
  };

  const handleCreateQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedManageCategoryId) return;
    createQuestionMutation.mutate();
  };

  const handleResetAllAdminState = () => {
    if (
      createCategoryMutation.isPending ||
      createQuestionMutation.isPending ||
      bulkImportMutation.isPending ||
      saveQuestionDraftMutation.isPending
    ) {
      return;
    }

    setKeyword("");
    setCategoryKeyword("");
    setSelectedManageCategoryId(null);

    setNewCategoryTitle("");
    setNewCategorySlug("");
    setNewCategoryDescription("");

    setNewQuestionText("");
    setNewAnswerText("");
    setNewLegacyId("");

    setBulkImportMode("multi-block");
    setBulkImportTitle("");
    setBulkImportText("");
    setBulkImportProgress("");
    setBulkImportSummary("");
    setShowCreateCategoryPanel(true);
    setShowImportPanel(false);
    setEditableQuestions([]);
    setEditableQuestionsCategoryId(null);
    setQuestionDraftFeedback("");
    setQuestionDraftFeedbackKind("success");

    createCategoryMutation.reset();
    createQuestionMutation.reset();
    bulkImportMutation.reset();
    saveQuestionDraftMutation.reset();

    categoriesQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ["admin-content-questions"] });
    onRefresh();
  };

  return (
    <div className={styles.pageShell}>
      <section className={styles.topCard}>
        <div>
          <p className={styles.eyebrow}>Admin Dashboard</p>
          <h1 className={styles.title}>Quản lý điểm học sinh</h1>
          <p className={styles.subtitle}>
            Đăng nhập: <strong>@{currentUser.username || "admin"}</strong>{" "}
            (role: admin)
          </p>
          <p className={styles.devHint}>
            Tài khoản local mặc định: admin / 123456
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={handleResetAllAdminState}
            disabled={
              isFetching ||
              createCategoryMutation.isPending ||
              createQuestionMutation.isPending ||
              bulkImportMutation.isPending ||
              saveQuestionDraftMutation.isPending
            }
          >
            {isFetching ? "Đang tải..." : "Làm mới (reset form)"}
          </button>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={onLogout}
          >
            Đăng xuất
          </button>
        </div>
      </section>

      <section className={styles.summaryCard} aria-label="Tổng quan hệ thống">
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <span>Học sinh</span>
            <strong>{data?.summary.totalStudents ?? 0}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span>Bản ghi điểm</span>
            <strong>{data?.summary.totalScoreRecords ?? 0}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span>Chủ đề</span>
            <strong>{data?.summary.totalCategories ?? 0}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span>Đang hiển thị</span>
            <strong>{data?.summary.returnedStudents ?? 0}</strong>
          </div>
        </div>
      </section>

      <section
        className={styles.manageCard}
        aria-label="Quản lý bộ từ và từ vựng"
      >
        <div className={styles.listHeader}>
          <div>
            <p className={styles.eyebrow}>Quản lý nội dung quiz</p>
            <h2 className={styles.sectionTitle}>
              Tạo bộ từ và thêm từ vựng thủ công
            </h2>
          </div>
        </div>

        <div className={styles.panelToggleRow}>
          <button
            type="button"
            className={styles.smallGhostButton}
            onClick={() => setShowCreateCategoryPanel((prev) => !prev)}
          >
            {showCreateCategoryPanel
              ? "Ẩn mục tạo bộ từ"
              : "Hiện mục tạo bộ từ"}
          </button>
          <button
            type="button"
            className={styles.smallGhostButton}
            onClick={() => setShowImportPanel((prev) => !prev)}
          >
            {showImportPanel ? "Ẩn Import JSON" : "Hiện Import JSON"}
          </button>
        </div>

        <div
          className={`${styles.manageGrid} ${!showCreateCategoryPanel ? styles.manageGridSingle : ""}`}
        >
          {showCreateCategoryPanel ? (
            <div className={styles.panelCard}>
              <h3 className={styles.panelTitle}>1. Tạo bộ từ mới</h3>
              <form className={styles.formGrid} onSubmit={handleCreateCategory}>
                <label className={styles.fieldLabelSmall}>
                  Tên bộ từ
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Ví dụ: Đồ ăn"
                    value={newCategoryTitle}
                    onChange={(event) =>
                      setNewCategoryTitle(event.target.value)
                    }
                    required
                    maxLength={80}
                  />
                </label>

                <label className={styles.fieldLabelSmall}>
                  Slug (tuỳ chọn)
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="do-an"
                    value={newCategorySlug}
                    onChange={(event) => setNewCategorySlug(event.target.value)}
                    maxLength={64}
                  />
                </label>

                <label className={styles.fieldLabelSmall}>
                  Mô tả (tuỳ chọn)
                  <textarea
                    className={styles.textarea}
                    placeholder="Mô tả ngắn cho bộ từ"
                    value={newCategoryDescription}
                    onChange={(event) =>
                      setNewCategoryDescription(event.target.value)
                    }
                    rows={3}
                  />
                </label>

                <button
                  type="submit"
                  className={styles.primaryActionButton}
                  disabled={createCategoryMutation.isPending}
                >
                  {createCategoryMutation.isPending
                    ? "Đang tạo..."
                    : "Tạo bộ từ"}
                </button>
              </form>
              {createCategoryFeedback ? (
                <p
                  className={
                    createCategoryMutation.isError
                      ? styles.errorText
                      : styles.successText
                  }
                  role={createCategoryMutation.isError ? "alert" : "status"}
                >
                  {createCategoryFeedback}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={styles.panelCard}>
            <div className={styles.panelHeaderInline}>
              <h3 className={styles.panelTitle}>2. Chọn bộ để thêm từ</h3>
              <button
                type="button"
                className={styles.smallGhostButton}
                onClick={() => categoriesQuery.refetch()}
                disabled={categoriesQuery.isFetching}
              >
                {categoriesQuery.isFetching ? "..." : "Refresh"}
              </button>
            </div>

            {categoriesQuery.isLoading ? (
              <p className={styles.noteText}>Đang tải bộ từ...</p>
            ) : categoriesQuery.isError ? (
              <p className={styles.errorText} role="alert">
                {categoriesQuery.error instanceof Error
                  ? categoriesQuery.error.message
                  : "Không tải được bộ từ."}
              </p>
            ) : manageableCategories.length === 0 ? (
              <p className={styles.noteText}>Chưa có bộ từ nào.</p>
            ) : (
              <div className={styles.categoryManagerBlock}>
                <div className={styles.panelMetaRow}>
                  <span className={styles.miniPill}>
                    Tổng bộ: {manageableCategories.length}
                  </span>
                  <span className={styles.miniPill}>
                    Hiển thị: {filteredManageableCategories.length}
                  </span>
                </div>
                <input
                  type="search"
                  className={styles.categorySearchInput}
                  placeholder="Tìm bộ từ theo tên / slug"
                  value={categoryKeyword}
                  onChange={(event) => setCategoryKeyword(event.target.value)}
                />

                {filteredManageableCategories.length === 0 ? (
                  <p className={styles.noteText}>
                    Không tìm thấy bộ từ phù hợp.
                  </p>
                ) : (
                  <div className={styles.categoryChipScroller}>
                    <div className={styles.categoryChipGrid}>
                      {filteredManageableCategories.map((category) => (
                        <CategoryChip
                          key={category.id}
                          category={category}
                          active={category.id === selectedManageCategoryId}
                          onClick={() =>
                            setSelectedManageCategoryId(category.id)
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedManageCategory ? (
              <>
                <div className={styles.selectedCategoryInfo}>
                  <strong>{selectedManageCategory.title}</strong>
                  <span>Slug: {selectedManageCategory.slug}</span>
                  <span>{selectedManageCategory.questionCount} từ hiện có</span>
                </div>

                <form
                  className={styles.formGrid}
                  onSubmit={handleCreateQuestion}
                >
                  <label className={styles.fieldLabelSmall}>
                    Nghĩa tiếng Việt
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Ví dụ: trời có gió"
                      value={newQuestionText}
                      onChange={(event) =>
                        setNewQuestionText(event.target.value)
                      }
                      required
                      maxLength={120}
                    />
                  </label>

                  <label className={styles.fieldLabelSmall}>
                    Chữ Hán
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="刮风"
                      value={newAnswerText}
                      onChange={(event) => setNewAnswerText(event.target.value)}
                      required
                      maxLength={120}
                    />
                  </label>

                  <button
                    type="submit"
                    className={styles.primaryActionButton}
                    disabled={
                      !selectedManageCategoryId ||
                      createQuestionMutation.isPending
                    }
                  >
                    {createQuestionMutation.isPending
                      ? "Đang thêm..."
                      : "Thêm từ vào bộ"}
                  </button>
                </form>

                {createQuestionFeedback ? (
                  <p
                    className={
                      createQuestionMutation.isError
                        ? styles.errorText
                        : styles.successText
                    }
                    role={createQuestionMutation.isError ? "alert" : "status"}
                  >
                    {createQuestionFeedback}
                  </p>
                ) : null}

                <div className={styles.panelHeaderInline}>
                  <div>
                    <h4 className={styles.subPanelTitle}>
                      Từ hiện có trong bộ
                    </h4>
                    {questionDraftStats.changedCount > 0 ? (
                      <p className={styles.inlineTip}>
                        Chưa lưu: sửa {questionDraftStats.updatedCount} từ, xoá{" "}
                        {questionDraftStats.deletedCount} từ.
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.inlineButtonGroup}>
                    <button
                      type="button"
                      className={styles.smallGhostButton}
                      onClick={handleResetQuestionDraft}
                      disabled={
                        saveQuestionDraftMutation.isPending ||
                        !questionDraftStats.changedCount
                      }
                    >
                      Hoàn tác
                    </button>
                    <button
                      type="button"
                      className={styles.smallPrimaryButton}
                      onClick={() => saveQuestionDraftMutation.mutate()}
                      disabled={
                        saveQuestionDraftMutation.isPending ||
                        !selectedManageCategoryId ||
                        categoryQuestionsQuery.isLoading ||
                        !questionDraftStats.changedCount
                      }
                    >
                      {saveQuestionDraftMutation.isPending
                        ? "Đang lưu..."
                        : "Lưu"}
                    </button>
                    <button
                      type="button"
                      className={styles.smallGhostButton}
                      onClick={() => categoryQuestionsQuery.refetch()}
                      disabled={
                        categoryQuestionsQuery.isFetching ||
                        !selectedManageCategoryId ||
                        saveQuestionDraftMutation.isPending
                      }
                    >
                      {categoryQuestionsQuery.isFetching ? "..." : "Refresh"}
                    </button>
                  </div>
                </div>

                {categoryQuestionsQuery.isLoading ? (
                  <p className={styles.noteText}>Đang tải từ vựng...</p>
                ) : categoryQuestionsQuery.isError ? (
                  <p className={styles.errorText} role="alert">
                    {categoryQuestionsQuery.error instanceof Error
                      ? categoryQuestionsQuery.error.message
                      : "Không tải được từ vựng."}
                  </p>
                ) : editableQuestionsForSelectedCategory.length === 0 ? (
                  <p className={styles.noteText}>
                    {questionDraftStats.changedCount > 0
                      ? 'Danh sách nháp đang trống. Bấm "Lưu" để xoá toàn bộ từ trong bộ.'
                      : "Bộ này chưa có từ nào."}
                  </p>
                ) : (
                  <div className={styles.wordList}>
                    {editableQuestionsForSelectedCategory.map((item, index) => (
                      <div
                        key={item.id}
                        className={`${styles.wordRow} ${styles.wordRowEditable}`}
                      >
                        <span className={styles.wordIndex}>{index + 1}</span>
                        <div className={styles.wordEditorFields}>
                          <label className={styles.wordFieldLabel}>
                            Nghĩa tiếng Việt
                            <input
                              type="text"
                              className={`${styles.input} ${styles.wordInput}`}
                              value={item.question}
                              onChange={(event) =>
                                handleQuestionDraftFieldChange(
                                  item.id,
                                  "question",
                                  event.target.value,
                                )
                              }
                              maxLength={120}
                              disabled={saveQuestionDraftMutation.isPending}
                            />
                          </label>
                          <label className={styles.wordFieldLabel}>
                            Chữ Hán
                            <input
                              type="text"
                              className={`${styles.input} ${styles.wordInput}`}
                              value={item.answer}
                              onChange={(event) =>
                                handleQuestionDraftFieldChange(
                                  item.id,
                                  "answer",
                                  event.target.value,
                                )
                              }
                              maxLength={120}
                              disabled={saveQuestionDraftMutation.isPending}
                            />
                          </label>
                          <small className={styles.wordMetaInline}>
                            ID: {item.legacyId}
                          </small>
                        </div>
                        <button
                          type="button"
                          className={styles.rowDangerButton}
                          onClick={() => handleRemoveQuestionDraftRow(item.id)}
                          disabled={saveQuestionDraftMutation.isPending}
                        >
                          Xoá
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {questionDraftFeedback ? (
                  <p
                    className={
                      questionDraftFeedbackKind === "error"
                        ? styles.errorText
                        : styles.successText
                    }
                    role={
                      questionDraftFeedbackKind === "error" ? "alert" : "status"
                    }
                  >
                    {questionDraftFeedback}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {showImportPanel ? (
          <div className={styles.importPanel}>
            <div className={styles.panelHeaderInline}>
              <div>
                <h3 className={styles.panelTitle}>
                  3. Import JSON nhanh (nhiều bộ từ)
                </h3>
                <p className={styles.inlineTip}>
                  Hỗ trợ format nhiều block như bạn gửi: tiêu đề bộ từ + mảng
                  JSON <code>[...]</code> (mỗi item có <code>question</code> và{" "}
                  <code>answer</code>).
                </p>
              </div>
              <button
                type="button"
                className={styles.smallGhostButton}
                onClick={() => {
                  setBulkImportText("");
                  setBulkImportProgress("");
                  setBulkImportSummary("");
                }}
                disabled={bulkImportMutation.isPending}
              >
                Xoá nội dung
              </button>
            </div>

            <div
              className={styles.modeSwitch}
              role="tablist"
              aria-label="Chọn chế độ import"
            >
              <button
                type="button"
                role="tab"
                aria-selected={bulkImportMode === "multi-block"}
                className={`${styles.modeButton} ${bulkImportMode === "multi-block" ? styles.modeButtonActive : ""}`}
                onClick={() => setBulkImportMode("multi-block")}
                disabled={bulkImportMutation.isPending}
              >
                Nhiều bộ (title + JSON)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bulkImportMode === "single-set"}
                className={`${styles.modeButton} ${bulkImportMode === "single-set" ? styles.modeButtonActive : ""}`}
                onClick={() => setBulkImportMode("single-set")}
                disabled={bulkImportMutation.isPending}
              >
                1 bộ (Title + JSON)
              </button>
            </div>

            <label className={styles.fieldLabelSmall}>
              Title bộ từ{" "}
              {bulkImportMode === "single-set"
                ? "(bắt buộc)"
                : "(dùng cho mode 1 bộ)"}
              <input
                className={styles.input}
                type="text"
                placeholder="Ví dụ: Trạng thái cơ bản / 基本状态"
                value={bulkImportTitle}
                onChange={(event) => setBulkImportTitle(event.target.value)}
                maxLength={80}
                disabled={
                  bulkImportMode !== "single-set" ||
                  bulkImportMutation.isPending
                }
                required={bulkImportMode === "single-set"}
              />
            </label>

            <label className={styles.fieldLabelSmall}>
              Dán nội dung JSON
              <textarea
                className={`${styles.textarea} ${styles.textareaLarge}`}
                placeholder={
                  bulkImportMode === "multi-block"
                    ? 'Trạng thái cơ bản\\n[ { \"question\": \"Mở\", \"answer\": \"开\" } ]\\n\\n物资与设备\\n[ ... ]'
                    : '[ { \"id\": 1, \"question\": \"Mở / bật\", \"answer\": \"开\" } ]'
                }
                value={bulkImportText}
                onChange={(event) => setBulkImportText(event.target.value)}
                spellCheck={false}
              />
            </label>

            <div className={styles.importActions}>
              <button
                type="button"
                className={styles.primaryActionButton}
                onClick={() => bulkImportMutation.mutate()}
                disabled={bulkImportMutation.isPending}
              >
                {bulkImportMutation.isPending
                  ? "Đang import..."
                  : "Import JSON"}
              </button>
              <button
                type="button"
                className={styles.smallGhostButton}
                onClick={() =>
                  bulkImportMode === "multi-block"
                    ? setBulkImportText(
                        'Trạng thái cơ bản / 基本状态\\n[\\n  { \"id\": 1, \"question\": \"Mở / bật\", \"answer\": \"开\" },\\n  { \"id\": 2, \"question\": \"Đóng / tắt\", \"answer\": \"关\" }\\n]\\n\\n物资与设备\\n[\\n  { \"id\": 1, \"question\": \"Nhíp, kẹp nhỏ\", \"answer\": \"镊子\" }\\n]',
                      )
                    : (setBulkImportTitle(
                        (prev) => prev || "Trạng thái cơ bản / 基本状态",
                      ),
                      setBulkImportText(
                        '[\\n  { \"id\": 1, \"question\": \"Mở / bật\", \"answer\": \"开\" },\\n  { \"id\": 2, \"question\": \"Đóng / tắt\", \"answer\": \"关\" }\\n]',
                      ))
                }
                disabled={bulkImportMutation.isPending}
              >
                Chèn mẫu
              </button>
            </div>

            {bulkImportMode === "single-set" ? (
              <p className={styles.noteText}>
                Gợi ý: nếu title trùng với bộ đã có thì hệ thống sẽ import vào
                bộ đó; nếu chưa có sẽ tự tạo mới.
              </p>
            ) : null}

            <div className={styles.codeHint}>
              <p className={styles.codeHintTitle}>Format hỗ trợ:</p>
              <pre className={styles.codeBlock}>
                {`Tên bộ từ A
[
  { "id": 1, "question": "Từ tiếng Việt", "answer": "汉字" }
]

Tên bộ từ B
[
  { "question": "Từ khác", "answer": "词语" }
]`}
              </pre>
            </div>

            {bulkImportFeedback ? (
              <p
                className={
                  bulkImportMutation.isError
                    ? styles.errorText
                    : styles.successText
                }
                role={bulkImportMutation.isError ? "alert" : "status"}
              >
                {bulkImportFeedback}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.listCard} aria-label="Danh sách điểm học sinh">
        <div className={styles.listHeader}>
          <div>
            <p className={styles.eyebrow}>Danh sách học sinh</p>
            <h2 className={styles.sectionTitle}>Điểm theo từng user</h2>
          </div>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Tìm theo tên hoặc username"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        {isLoading ? (
          <p className={styles.noteText}>Đang tải dashboard...</p>
        ) : errorMessage ? (
          <p className={styles.errorText} role="alert">
            {errorMessage}
          </p>
        ) : filteredStudents.length === 0 ? (
          <p className={styles.noteText}>Không có học sinh phù hợp.</p>
        ) : (
          <div className={styles.studentList}>
            {filteredStudents.map((row) => (
              <StudentCard key={row.student.id} row={row} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
