// ============================================================
// ArbiX Shared Types
// ============================================================

export type OddsFormat = 'american' | 'decimal' | 'fractional' | 'probability';
export type MarketType = 'moneyline' | 'spread' | 'total' | 'yes_no' | 'prop' | 'futures';
export type SportCategory =
  | 'football'
  | 'basketball'
  | 'baseball'
  | 'hockey'
  | 'soccer'
  | 'tennis'
  | 'mma'
  | 'boxing'
  | 'golf'
  | 'politics'
  | 'crypto'
  | 'other';

export type BookmakerSlug =
  | 'polymarket'
  | 'draftkings'
  | 'fanduel'
  | 'pinnacle'
  | 'betmgm'
  | 'caesars'
  | 'bet365'
  | 'bovada'
  | 'mybookie'
  | 'betonline'
  | 'stake'
  | 'betway'
  | 'betrivers'
  | 'odds_api'
  | 'espn_bet'
  | 'kalshi'
  | 'williamhill'
  | 'unibet'
  | 'bwin'
  | 'pointsbet'
  | 'sportsinteraction';

export type SubscriptionTier = 'free' | 'basic' | 'pro';
export type NotificationChannel = 'browser' | 'telegram' | 'discord' | 'email' | 'sms';
export type OpportunityStatus = 'live' | 'expired' | 'completed' | 'suspicious';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── Odds & Markets ──────────────────────────────────────────────────────────

export interface RawOdds {
  bookmaker: BookmakerSlug;
  eventId: string;
  marketType: MarketType;
  outcome: string;
  americanOdds?: number;
  decimalOdds?: number;
  probability?: number;
  timestamp: Date;
  isLive: boolean;
  liquidity?: number;
  maxBet?: number;
}

export interface NormalizedOdds {
  bookmaker: BookmakerSlug;
  eventId: string;
  marketType: MarketType;
  outcome: string;
  decimalOdds: number;
  americanOdds: number;
  impliedProbability: number;
  timestamp: Date;
  isLive: boolean;
  liquidity?: number;
  maxBet?: number;
}

export interface MarketOutcome {
  outcome: string;
  bookmaker: BookmakerSlug;
  decimalOdds: number;
  americanOdds: number;
  impliedProbability: number;
  betUrl?: string;
  maxBet?: number;
  liquidity?: number;
}

export interface UnifiedMarket {
  id: string;
  eventName: string;
  sport: SportCategory;
  marketType: MarketType;
  league?: string;
  startTime?: Date;
  outcomes: MarketOutcome[];
  normalizedKey: string;
}

// ─── Arbitrage ───────────────────────────────────────────────────────────────

export interface StakeAllocation {
  outcome: string;
  bookmaker: BookmakerSlug;
  decimalOdds: number;
  stake: number;
  potentialReturn: number;
  betUrl?: string;
}

export interface ArbitrageOpportunity {
  id: string;
  eventName: string;
  sport: SportCategory;
  marketType: MarketType;
  league?: string;
  startTime?: Date;

  // Core metrics
  totalImpliedProbability: number;
  profitMargin: number;
  roi: number;

  // Stakes
  stakes: StakeAllocation[];
  totalStake: number;
  guaranteedProfit: number;

  // Meta
  detectedAt: Date;
  expiresAt?: Date;
  status: OpportunityStatus;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  confidenceReasons: string[];

  // Bookmakers involved
  bookmakers: BookmakerSlug[];

  // AI insights
  aiInsight?: string;
  estimatedDurationMinutes?: number;
}

export interface ArbitrageFilter {
  minRoi?: number;
  maxRoi?: number;
  sports?: SportCategory[];
  marketTypes?: MarketType[];
  bookmakers?: BookmakerSlug[];
  maxTotalStake?: number;
  confidenceLevels?: ConfidenceLevel[];
  status?: OpportunityStatus[];
}

// ─── Users & Auth ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  subscriptionTier: SubscriptionTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  notificationSettings: NotificationSettings;
  filterPreferences: ArbitrageFilter;
  defaultStake: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationSettings {
  channels: NotificationChannel[];
  telegramChatId?: string;
  discordWebhookUrl?: string;
  minRoiThreshold: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── WebSocket Events ────────────────────────────────────────────────────────

export type WsEventType =
  | 'opportunity:new'
  | 'opportunity:updated'
  | 'opportunity:expired'
  | 'market:updated'
  | 'scanner:status'
  | 'live:match'
  | 'live:opportunity'
  | 'games:update'
  | 'ping'
  | 'pong';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: string;
}

export interface ScannerStatus {
  isRunning: boolean;
  lastScanAt: Date;
  bookmakers: {
    slug: BookmakerSlug;
    status: 'ok' | 'error' | 'rate_limited';
    lastFetch: Date;
    marketsCount: number;
  }[];
  totalOpportunities: number;
}

// ─── Historical ──────────────────────────────────────────────────────────────

export interface OpportunityHistory {
  id: string;
  opportunityId: string;
  eventName: string;
  sport: SportCategory;
  roi: number;
  profitMargin: number;
  totalStake: number;
  guaranteedProfit: number;
  bookmakers: BookmakerSlug[];
  detectedAt: Date;
  expiresAt?: Date;
  duration?: number;
}

// ─── Live Matches ─────────────────────────────────────────────────────────────

export type LiveStoppageType = 'halftime' | 'quarter_break' | 'period_break' | 'inning_break' | 'timeout';

export interface LiveMatch {
  id: string;
  sport: SportCategory;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: number;
  clock: string;
  statusName: string;
  statusDetail: string;
  inStoppage: boolean;
  stoppageType?: LiveStoppageType;
  updatedAt: string;
}

export interface LiveArbitrageOpportunity {
  id: string;
  matchId: string;
  eventName: string;
  sport: SportCategory;
  league: string;
  roi: number;
  profitMargin: number;
  stakes: StakeAllocation[];
  totalStake: number;
  guaranteedProfit: number;
  bookmakers: BookmakerSlug[];
  detectedAt: string;
  gameStatus: string;
}

export interface UserBet {
  id: string;
  userId: string;
  opportunityId: string;
  stakeAllocations: StakeAllocation[];
  totalStake: number;
  actualProfit?: number;
  status: 'pending' | 'won' | 'lost' | 'void';
  placedAt: Date;
  settledAt?: Date;
}
