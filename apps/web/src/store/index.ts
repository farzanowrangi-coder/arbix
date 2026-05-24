import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import type {
  User,
  AuthTokens,
  ArbitrageOpportunity,
  ArbitrageFilter,
  ScannerStatus,
  LiveMatch,
  LiveArbitrageOpportunity,
} from '@arbix/shared';
import { storeTokens, clearTokens, getAccessToken } from '@/lib/auth';

// ─── Auth Store ──────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, tokens: AuthTokens) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,

        login: (user, tokens) => {
          storeTokens(tokens);
          set({
            user,
            accessToken: tokens.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        },

        logout: () => {
          clearTokens();
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
          });
        },

        setUser: (user) => set({ user }),

        setLoading: (loading) => set({ isLoading: loading }),

        hydrate: () => {
          const token = getAccessToken();
          if (token) {
            set({ accessToken: token, isAuthenticated: true });
          }
        },
      }),
      {
        name: 'arbix-auth',
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
        }),
      },
    ),
    { name: 'AuthStore' },
  ),
);

// ─── Opportunity Store ───────────────────────────────────────────────────────

interface OpportunityState {
  liveOpportunities: ArbitrageOpportunity[];
  filters: ArbitrageFilter;
  scannerStatus: ScannerStatus | null;
  lastUpdateAt: Date | null;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';

  setLiveOpportunities: (opportunities: ArbitrageOpportunity[]) => void;
  addOrUpdateOpportunity: (opportunity: ArbitrageOpportunity) => void;
  removeOpportunity: (id: string) => void;
  setFilters: (filters: ArbitrageFilter) => void;
  updateFilter: <K extends keyof ArbitrageFilter>(key: K, value: ArbitrageFilter[K]) => void;
  resetFilters: () => void;
  setScannerStatus: (status: ScannerStatus) => void;
  setConnectionStatus: (status: OpportunityState['connectionStatus']) => void;

  // Live matches
  liveMatches: LiveMatch[];
  liveArbitrageOpportunities: LiveArbitrageOpportunity[];
  setLiveMatch: (match: LiveMatch) => void;
  setLiveArbitrageOpportunity: (opp: LiveArbitrageOpportunity) => void;
}

const defaultFilters: ArbitrageFilter = {
  minRoi: 0,
  status: ['live'],
};

export const useOpportunityStore = create<OpportunityState>()(
  devtools(
    (set) => ({
      liveOpportunities: [],
      filters: defaultFilters,
      scannerStatus: null,
      lastUpdateAt: null,
      connectionStatus: 'disconnected',
      liveMatches: [],
      liveArbitrageOpportunities: [],

      setLiveOpportunities: (opportunities) =>
        set({ liveOpportunities: opportunities, lastUpdateAt: new Date() }),

      addOrUpdateOpportunity: (opportunity) =>
        set((state) => {
          const existing = state.liveOpportunities.findIndex((o) => o.id === opportunity.id);
          if (existing >= 0) {
            const updated = [...state.liveOpportunities];
            updated[existing] = opportunity;
            return { liveOpportunities: updated, lastUpdateAt: new Date() };
          }
          return {
            liveOpportunities: [opportunity, ...state.liveOpportunities],
            lastUpdateAt: new Date(),
          };
        }),

      removeOpportunity: (id) =>
        set((state) => ({
          liveOpportunities: state.liveOpportunities.filter((o) => o.id !== id),
          lastUpdateAt: new Date(),
        })),

      setFilters: (filters) => set({ filters }),

      updateFilter: (key, value) =>
        set((state) => ({ filters: { ...state.filters, [key]: value } })),

      resetFilters: () => set({ filters: defaultFilters }),

      setScannerStatus: (status) => set({ scannerStatus: status }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),

      setLiveMatch: (match) =>
        set((state) => {
          const idx = state.liveMatches.findIndex((m) => m.id === match.id);
          if (idx >= 0) {
            const updated = [...state.liveMatches];
            updated[idx] = match;
            return { liveMatches: updated };
          }
          return { liveMatches: [match, ...state.liveMatches] };
        }),

      setLiveArbitrageOpportunity: (opp) =>
        set((state) => {
          const idx = state.liveArbitrageOpportunities.findIndex((o) => o.id === opp.id);
          if (idx >= 0) {
            const updated = [...state.liveArbitrageOpportunities];
            updated[idx] = opp;
            return { liveArbitrageOpportunities: updated };
          }
          return { liveArbitrageOpportunities: [opp, ...state.liveArbitrageOpportunities] };
        }),
    }),
    { name: 'OpportunityStore' },
  ),
);

// ─── Notification Store ──────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: 'opportunity' | 'alert' | 'system' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  opportunityId?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    (set) => ({
      notifications: [],
      unreadCount: 0,

      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: Math.random().toString(36).slice(2),
          timestamp: new Date(),
          read: false,
        };
        set((state) => ({
          notifications: [newNotification, ...state.notifications.slice(0, 49)],
          unreadCount: state.unreadCount + 1,
        }));
      },

      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        })),

      markAllAsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        })),

      clearAll: () => set({ notifications: [], unreadCount: 0 }),
    }),
    { name: 'NotificationStore' },
  ),
);
