export type QuizMode = 'all' | 'wrong-only';

export interface ApiUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: 'student' | 'admin';
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
}

export interface MeResponse {
  user: ApiUser;
}

export interface ApiCategory {
  id: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  questionCount: number;
}

export interface CategoriesResponse {
  categories: ApiCategory[];
}

export interface ApiQuestion {
  id: string;
  question: string;
  answer: string;
  categoryId: string;
  legacyId: string;
  order: number;
}

export interface QuestionsResponse {
  questions: ApiQuestion[];
}

export interface CreateAdminCategoryInput {
  title: string;
  slug?: string;
  description?: string;
}

export interface CreateAdminQuestionInput {
  categoryId: string;
  question: string;
  answer: string;
  legacyId?: string;
}

export interface ApiScore {
  id: string;
  userId: string;
  categoryId: string;
  categoryTitle: string;
  score: number;
  attempts: number;
  durationSeconds: number;
  totalPairs: number;
  correctPairs: number;
  mode: QuizMode;
  createdAt: string;
}

export interface ScoresResponse {
  scores: ApiScore[];
}

export interface AdminStudentStats {
  totalSessions: number;
  totalScoreAccumulated: number;
  bestScore: number;
  latestScore: number | null;
  lastPlayedAt: string | null;
}

export interface AdminDashboardStudentRow {
  student: ApiUser;
  stats: AdminStudentStats;
  recentScores: ApiScore[];
}

export interface AdminDashboardResponse {
  summary: {
    totalStudents: number;
    totalScoreRecords: number;
    totalCategories: number;
    returnedStudents: number;
  };
  students: AdminDashboardStudentRow[];
}

export interface SubmitScoreInput {
  categoryId: string;
  score: number;
  attempts: number;
  durationSeconds: number;
  totalPairs: number;
  correctPairs: number;
  mode: QuizMode;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export const AUTH_TOKEN_STORAGE_KEY = 'hanzi-quiz-auth-token-v1';

export function readAuthToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore localStorage write errors
  }
}

export function clearAuthToken() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore localStorage write errors
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  token?: string | null;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message =
      (payload && typeof payload.message === 'string' && payload.message) ||
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  register(username: string, password: string) {
    return apiRequest<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
  },

  login(username: string, password: string) {
    return apiRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },

  getMe(token: string) {
    return apiRequest<MeResponse>('/api/auth/me', {
      token,
    });
  },

  updateProfile(token: string, displayName: string) {
    return apiRequest<MeResponse>('/api/users/me/profile', {
      method: 'PATCH',
      token,
      body: { displayName },
    });
  },

  getCategories(token: string) {
    return apiRequest<CategoriesResponse>('/api/categories', {
      token,
    });
  },

  getQuestions(token: string, categoryId: string) {
    const query = new URLSearchParams({ categoryId });
    return apiRequest<QuestionsResponse>(`/api/quizzes/questions?${query.toString()}`, {
      token,
    });
  },

  getMyScores(token: string, limit = 8) {
    const query = new URLSearchParams({ limit: String(limit) });
    return apiRequest<ScoresResponse>(`/api/scores/me?${query.toString()}`, {
      token,
    });
  },

  submitScore(token: string, payload: SubmitScoreInput) {
    return apiRequest<{ score: ApiScore }>('/api/scores', {
      method: 'POST',
      token,
      body: payload,
    });
  },

  getAdminDashboard(
    token: string,
    options?: { limitStudents?: number; recentScoreLimit?: number; userId?: string },
  ) {
    const query = new URLSearchParams();
    if (options?.limitStudents) query.set('limitStudents', String(options.limitStudents));
    if (options?.recentScoreLimit) {
      query.set('recentScoreLimit', String(options.recentScoreLimit));
    }
    if (options?.userId) query.set('userId', options.userId);

    const suffix = query.size ? `?${query.toString()}` : '';
    return apiRequest<AdminDashboardResponse>(`/api/admin/dashboard${suffix}`, { token });
  },

  createAdminCategory(token: string, payload: CreateAdminCategoryInput) {
    return apiRequest<{ category: ApiCategory }>('/api/admin/dashboard/categories', {
      method: 'POST',
      token,
      body: payload,
    });
  },

  createAdminQuestion(token: string, payload: CreateAdminQuestionInput) {
    return apiRequest<{ question: ApiQuestion }>('/api/admin/dashboard/questions', {
      method: 'POST',
      token,
      body: payload,
    });
  },
};
