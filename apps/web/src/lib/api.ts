import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  PaginatedResponse,
  ArbitrageOpportunity,
  ArbitrageFilter,
  OpportunityHistory,
  UserBet,
  User,
  AuthTokens,
  ScannerStatus,
} from '@arbix/shared';
import {
  getAccessToken,
  getRefreshToken,
  storeTokens,
  clearTokens,
  isTokenExpired,
} from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// ─── Request Interceptor ─────────────────────────────────────────────────────

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Response Interceptor (Token Refresh) ────────────────────────────────────

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = getRefreshToken();
      if (!refreshToken || isTokenExpired(refreshToken)) {
        clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await axios.post<ApiResponse<AuthTokens>>(
          `${API_URL}/auth/refresh`,
          { refreshToken },
        );
        const tokens = response.data.data!;
        storeTokens(tokens);

        refreshQueue.forEach((cb) => cb(tokens.accessToken));
        refreshQueue = [];

        originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
        return apiClient(originalRequest);
      } catch {
        clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: async (email: string, password: string) => {
    const res = await apiClient.post<ApiResponse<{ user: User; tokens: AuthTokens }>>(
      '/auth/login',
      { email, password },
    );
    return res.data;
  },

  register: async (email: string, username: string, password: string) => {
    const res = await apiClient.post<ApiResponse<{ user: User; tokens: AuthTokens }>>(
      '/auth/register',
      { email, username, password },
    );
    return res.data;
  },

  logout: async () => {
    const refreshToken = getRefreshToken();
    await apiClient.post('/auth/logout', { refreshToken }).catch(() => {});
    clearTokens();
  },

  me: async () => {
    const res = await apiClient.get<ApiResponse<User>>('/auth/me');
    return res.data;
  },
};

// ─── Opportunities ───────────────────────────────────────────────────────────

export const opportunityApi = {
  getAll: async (
    filters?: ArbitrageFilter,
    page = 1,
    pageSize = 25,
  ) => {
    const res = await apiClient.get<ApiResponse<PaginatedResponse<ArbitrageOpportunity>>>(
      '/opportunities',
      { params: { ...filters, page, pageSize } },
    );
    return res.data;
  },

  getById: async (id: string) => {
    const res = await apiClient.get<ApiResponse<ArbitrageOpportunity>>(`/opportunities/${id}`);
    return res.data;
  },

  getAiInsight: async (id: string) => {
    const res = await apiClient.get<ApiResponse<{ insight: string; estimatedDuration: number }>>(
      `/opportunities/${id}/insight`,
    );
    return res.data;
  },

  markAsPlaced: async (id: string, stakeOverride?: number) => {
    const res = await apiClient.post<ApiResponse<UserBet>>(`/opportunities/${id}/place`, {
      stakeOverride,
    });
    return res.data;
  },
};

// ─── History ─────────────────────────────────────────────────────────────────

export const historyApi = {
  getAll: async (
    params?: {
      startDate?: string;
      endDate?: string;
      sport?: string;
      minRoi?: number;
      page?: number;
      pageSize?: number;
    },
  ) => {
    const res = await apiClient.get<ApiResponse<PaginatedResponse<OpportunityHistory>>>(
      '/history',
      { params },
    );
    return res.data;
  },

  getStats: async () => {
    const res = await apiClient.get<
      ApiResponse<{
        totalOpportunities: number;
        avgRoi: number;
        totalProfitAvailable: number;
        byDay: Array<{ date: string; count: number; avgRoi: number }>;
      }>
    >('/history/stats');
    return res.data;
  },
};

// ─── Portfolio ───────────────────────────────────────────────────────────────

export const portfolioApi = {
  getBets: async (params?: { page?: number; pageSize?: number }) => {
    const res = await apiClient.get<ApiResponse<PaginatedResponse<UserBet>>>(
      '/portfolio/bets',
      { params },
    );
    return res.data;
  },

  getStats: async () => {
    const res = await apiClient.get<
      ApiResponse<{
        totalBets: number;
        totalStaked: number;
        totalProfit: number;
        roi: number;
        winRate: number;
        bySport: Array<{ sport: string; bets: number; profit: number; roi: number }>;
        byBookmaker: Array<{ bookmaker: string; bets: number; stake: number }>;
        cumulativePnl: Array<{ date: string; pnl: number }>;
      }>
    >('/portfolio/stats');
    return res.data;
  },
};

// ─── Scanner ─────────────────────────────────────────────────────────────────

export const scannerApi = {
  getStatus: async () => {
    const res = await apiClient.get<ApiResponse<ScannerStatus>>('/scanner/status');
    return res.data;
  },
  refresh: async () => {
    const res = await apiClient.post<ApiResponse<{ started: boolean; message: string }>>('/scanner/refresh', {});
    return res.data;
  },
};

// ─── Games ────────────────────────────────────────────────────────────────────

export interface BookOdds {
  bookmaker: string;
  bookmakerLabel: string;
  decimalOdds: number;
  americanOdds: number;
  isBest: boolean;
  betUrl?: string;
}

export interface GameOutcome {
  name: string;
  books: BookOdds[];
  bestBook: string;
  bestDecimalOdds: number;
  bestAmericanOdds: number;
}

export interface GameOddsEntry {
  id: string;
  eventName: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string | null;
  isLive: boolean;
  isCompleted: boolean;
  homeScore: number | null;
  awayScore: number | null;
  statusDetail: string;
  outcomes: GameOutcome[];
  hasArb: boolean;
  arbRoi: number | null;
  totalImplied: number | null;
}

export const gamesApi = {
  getUpcoming: async () => {
    const res = await apiClient.get<ApiResponse<GameOddsEntry[]>>('/games/upcoming');
    return res.data;
  },
};

// ─── Wallet ──────────────────────────────────────────────────────────────────

export const walletApi = {
  getBalance: async () => {
    const res = await apiClient.get<ApiResponse<{ balance: number; isDemo: boolean }>>('/wallet/balance');
    return res.data;
  },
  deposit: async (amount: number) => {
    const res = await apiClient.post<ApiResponse<{ balance: number }>>('/wallet/deposit', { amount });
    return res.data;
  },
  setDemoMode: async (isDemo: boolean) => {
    const res = await apiClient.post<ApiResponse<null>>('/wallet/demo-mode', { isDemo });
    return res.data;
  },
  getTransactions: async () => {
    const res = await apiClient.get<ApiResponse<any[]>>('/wallet/transactions');
    return res.data;
  },
};

// ─── Credentials ─────────────────────────────────────────────────────────────

export const credentialsApi = {
  list: async () => {
    const res = await apiClient.get<ApiResponse<any[]>>('/credentials');
    return res.data;
  },
  save: async (bookmaker: string, login: string, password: string) => {
    const res = await apiClient.post<ApiResponse<null>>('/credentials', { bookmaker, login, password });
    return res.data;
  },
  remove: async (bookmaker: string) => {
    const res = await apiClient.delete<ApiResponse<null>>(`/credentials/${bookmaker}`);
    return res.data;
  },
};

// ─── Auto-Bet ─────────────────────────────────────────────────────────────────

export const autoBetApi = {
  getSettings: async () => {
    const res = await apiClient.get<ApiResponse<any>>('/auto-bet/settings');
    return res.data;
  },
  saveSettings: async (settings: any) => {
    const res = await apiClient.put<ApiResponse<any>>('/auto-bet/settings', settings);
    return res.data;
  },
  getHistory: async () => {
    const res = await apiClient.get<ApiResponse<any[]>>('/auto-bet/history');
    return res.data;
  },
  getStats: async () => {
    const res = await apiClient.get<ApiResponse<any>>('/auto-bet/stats');
    return res.data;
  },
};

// ─── Live ─────────────────────────────────────────────────────────────────────

export const liveApi = {
  getMatches: async () => {
    const res = await apiClient.get<ApiResponse<{ matches: import('@arbix/shared').LiveMatch[]; opportunities: import('@arbix/shared').LiveArbitrageOpportunity[] }>>('/live/matches');
    return res.data;
  },
};

// ─── User ────────────────────────────────────────────────────────────────────

// Convenience alias for pages that use api.get/post directly
export const api = apiClient;

export const userApi = {
  updateProfile: async (data: Partial<Pick<User, 'email' | 'username'>>) => {
    const res = await apiClient.patch<ApiResponse<User>>('/users/profile', data);
    return res.data;
  },

  updateNotifications: async (settings: User['notificationSettings']) => {
    const res = await apiClient.patch<ApiResponse<User>>('/users/notifications', settings);
    return res.data;
  },

  updateFilters: async (filters: User['filterPreferences']) => {
    const res = await apiClient.patch<ApiResponse<User>>('/users/filters', filters);
    return res.data;
  },

  createCheckoutSession: async (tier: string) => {
    const res = await apiClient.post<ApiResponse<{ url: string }>>(
      '/users/subscription/checkout',
      { tier },
    );
    return res.data;
  },

  getApiKeys: async () => {
    const res = await apiClient.get<ApiResponse<Array<{ id: string; key: string; createdAt: string }>>>(
      '/users/api-keys',
    );
    return res.data;
  },

  createApiKey: async () => {
    const res = await apiClient.post<ApiResponse<{ key: string }>>('/users/api-keys');
    return res.data;
  },

  deleteApiKey: async (id: string) => {
    const res = await apiClient.delete<ApiResponse<null>>(`/users/api-keys/${id}`);
    return res.data;
  },
};
