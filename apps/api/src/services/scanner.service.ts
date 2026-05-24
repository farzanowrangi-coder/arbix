import EventEmitter from 'events';
import cron from 'node-cron';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

const ARB_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // UUID v5 namespace
import {
  UnifiedMarket,
  ArbitrageOpportunity,
  BookmakerSlug,
  ScannerStatus,
  WsEvent,
} from '@arbix/shared';
import { createAllAdapters, BaseAdapter } from '../adapters';
import { config } from '../config';
import { logger } from '../logger';
import { query } from '../db';
import { getRedis } from '../redis';

interface BookmakerState {
  slug: BookmakerSlug;
  status: 'ok' | 'error' | 'rate_limited';
  lastFetch: Date;
  marketsCount: number;
  error?: string;
}

const OPPORTUNITY_KEY_PREFIX = 'arb:opp:';
const LIVE_OPPS_KEY = 'arb:live';

export class ScannerService extends EventEmitter {
  private adapters: BaseAdapter[] = [];
  private bookmakerStates: Map<BookmakerSlug, BookmakerState> = new Map();
  private isRunning = false;
  private lastScanAt: Date = new Date(0);
  private totalOpportunities = 0;
  private cronTask: cron.ScheduledTask | null = null;
  private scanning = false;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('[scanner] Already running');
      return;
    }

    const enabledSlugs = config.scanner.enabledAdapters as BookmakerSlug[];
    this.adapters = createAllAdapters(enabledSlugs);

    for (const adapter of this.adapters) {
      this.bookmakerStates.set(adapter.slug, {
        slug: adapter.slug,
        status: 'ok',
        lastFetch: new Date(0),
        marketsCount: 0,
      });
    }

    this.isRunning = true;
    logger.info(`[scanner] Starting with ${this.adapters.length} adapters, interval ${config.scanner.intervalMs}ms`);

    // Run immediately, then on schedule
    this.runScan().catch((err) => logger.error('[scanner] Initial scan error', { error: (err as Error).message }));

    const intervalSeconds = Math.max(5, Math.floor(config.scanner.intervalMs / 1000));
    const cronExpression = `*/${intervalSeconds} * * * * *`;

    this.cronTask = cron.schedule(cronExpression, () => {
      this.runScan().catch((err) =>
        logger.error('[scanner] Scan error', { error: (err as Error).message })
      );
    });

    logger.info('[scanner] Started successfully');
  }

  stop(): void {
    if (!this.isRunning) return;
    this.cronTask?.stop();
    this.cronTask = null;
    this.isRunning = false;
    logger.info('[scanner] Stopped');
  }

  getStatus(): ScannerStatus {
    return {
      isRunning: this.isRunning,
      lastScanAt: this.lastScanAt,
      bookmakers: Array.from(this.bookmakerStates.values()),
      totalOpportunities: this.totalOpportunities,
    };
  }

  // Kick off an immediate scan outside the cron schedule (e.g., from the UI refresh button).
  // Returns false if a scan is already in progress.
  triggerScan(): boolean {
    if (this.scanning) return false;
    this.runScan().catch((err) =>
      logger.error('[scanner] Manual scan error', { error: (err as Error).message })
    );
    return true;
  }

  private async runScan(): Promise<void> {
    if (this.scanning) {
      logger.debug('[scanner] Skipping scan — previous scan still running');
      return;
    }

    this.scanning = true;
    const scanStart = Date.now();

    try {
      const allMarkets = await this.fetchAllMarkets();
      logger.info(`[scanner] Fetched ${allMarkets.length} total markets in ${Date.now() - scanStart}ms`);

      if (allMarkets.length === 0) return;

      const opportunities = await this.detectArbitrage(allMarkets);

      if (opportunities.length > 0) {
        logger.info(`[scanner] Found ${opportunities.length} arbitrage opportunities`);
        await this.processOpportunities(opportunities);
      }

      this.lastScanAt = new Date();

      const statusEvent: WsEvent<ScannerStatus> = {
        type: 'scanner:status',
        payload: this.getStatus(),
        timestamp: new Date().toISOString(),
      };
      this.emit('ws:broadcast', statusEvent);
    } catch (err) {
      logger.error('[scanner] Scan cycle error', { error: (err as Error).message });
    } finally {
      this.scanning = false;
    }
  }

  private async fetchAllMarkets(): Promise<UnifiedMarket[]> {
    const concurrency = config.scanner.concurrencyLimit;
    const allMarkets: UnifiedMarket[] = [];

    // Process adapters in batches to limit concurrency
    for (let i = 0; i < this.adapters.length; i += concurrency) {
      const batch = this.adapters.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map((adapter) => this.fetchFromAdapter(adapter)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const adapter = batch[j];
        if (!adapter) continue;

        if (result.status === 'fulfilled') {
          allMarkets.push(...result.value);
        } else {
          logger.warn(`[scanner] Adapter ${adapter.slug} failed: ${result.reason}`);
        }
      }
    }

    return allMarkets;
  }

  private async fetchFromAdapter(adapter: BaseAdapter): Promise<UnifiedMarket[]> {
    const state = this.bookmakerStates.get(adapter.slug);
    const fetchStart = Date.now();

    try {
      // 30-second hard timeout per adapter so one slow/hanging adapter never blocks the scan cycle
      const markets = await Promise.race([
        adapter.fetchMarkets(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Adapter timeout after 30s`)), 30_000)
        ),
      ]);

      this.bookmakerStates.set(adapter.slug, {
        slug: adapter.slug,
        status: 'ok',
        lastFetch: new Date(),
        marketsCount: markets.length,
      });

      logger.debug(`[scanner] ${adapter.slug}: ${markets.length} markets in ${Date.now() - fetchStart}ms`);
      return markets;
    } catch (err) {
      const errMsg = (err as Error).message;
      const isRateLimited = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');

      this.bookmakerStates.set(adapter.slug, {
        slug: adapter.slug,
        status: isRateLimited ? 'rate_limited' : 'error',
        lastFetch: state?.lastFetch ?? new Date(0),
        marketsCount: state?.marketsCount ?? 0,
        error: errMsg,
      });

      throw err;
    }
  }

  private async detectArbitrage(markets: UnifiedMarket[]): Promise<ArbitrageOpportunity[]> {
    try {
      // Group markets by normalized key to find cross-bookmaker opportunities
      const marketsByKey = new Map<string, UnifiedMarket[]>();

      for (const market of markets) {
        const existing = marketsByKey.get(market.normalizedKey) ?? [];
        existing.push(market);
        marketsByKey.set(market.normalizedKey, existing);
      }

      const opportunities: ArbitrageOpportunity[] = [];

      for (const [, relatedMarkets] of marketsByKey) {
        if (relatedMarkets.length < 2) {
          // Could still have arb if same key but different outcomes from different books
          const singleMarket = relatedMarkets[0];
          if (singleMarket) {
            const opp = this.checkSingleMarketArb(singleMarket);
            if (opp) opportunities.push(opp);
          }
          continue;
        }

        // Merge outcomes across all markets with same normalizedKey
        const mergedMarket = this.mergeMarkets(relatedMarkets);
        const opp = this.calculateArbitrage(mergedMarket);
        if (opp) opportunities.push(opp);
      }

      return opportunities;
    } catch (err) {
      logger.error('[scanner] Arbitrage detection error', { error: (err as Error).message });
      return [];
    }
  }

  private mergeMarkets(markets: UnifiedMarket[]): UnifiedMarket {
    const base = markets[0]!;
    const outcomeMap = new Map<string, typeof base.outcomes[0]>();

    for (const market of markets) {
      for (const outcome of market.outcomes) {
        const key = outcome.outcome.toLowerCase().trim();
        const existing = outcomeMap.get(key);
        // Keep highest decimal odds for each outcome
        if (!existing || outcome.decimalOdds > existing.decimalOdds) {
          outcomeMap.set(key, outcome);
        }
      }
    }

    return {
      ...base,
      outcomes: Array.from(outcomeMap.values()),
    };
  }

  private checkSingleMarketArb(market: UnifiedMarket): ArbitrageOpportunity | null {
    // Single bookmaker can't have arb unless it has 3+ outcomes
    if (market.outcomes.length < 3) return null;
    return this.calculateArbitrage(market);
  }

  private calculateArbitrage(market: UnifiedMarket): ArbitrageOpportunity | null {
    const { outcomes } = market;
    if (outcomes.length < 2) return null;

    // For 2-way markets, we need one outcome from each of 2 different bookmakers
    const bookmakerSet = new Set(outcomes.map((o) => o.bookmaker));
    if (bookmakerSet.size < 2 && outcomes.length === 2) return null;

    const totalImplied = outcomes.reduce((sum, o) => sum + o.impliedProbability, 0);

    // Arbitrage exists when total implied probability < 1
    if (totalImplied >= 1.0) return null;

    const profitMargin = 1 - totalImplied;
    const roi = (profitMargin / totalImplied) * 100;

    // Minimum 0.2% ROI to filter noise
    if (roi < 0.2) return null;
    // Futures markets can have legitimate larger discrepancies (25% cap); game markets capped at 15%
    const roiCap = market.marketType === 'futures' ? 25 : 15;
    if (roi > roiCap) return null;

    const defaultStake = 1000;
    const stakes = outcomes.map((outcome) => {
      const stake = (outcome.impliedProbability / totalImplied) * defaultStake;
      // Strip the NOT: prefix for display — the betUrl and bookmaker make it clear this is the NO leg
      const displayOutcome = outcome.outcome.startsWith('NOT:')
        ? `${outcome.outcome.slice(4)} (NO / Does Not Win)`
        : outcome.outcome;
      return {
        outcome: displayOutcome,
        bookmaker: outcome.bookmaker,
        decimalOdds: outcome.decimalOdds,
        stake: Math.round(stake * 100) / 100,
        potentialReturn: Math.round(stake * outcome.decimalOdds * 100) / 100,
        betUrl: outcome.betUrl,
      };
    });

    const guaranteedProfit = Math.round((defaultStake * profitMargin) * 100) / 100;
    const confidence = this.calculateConfidence(roi, outcomes, market);
    const now = new Date();

    // Deterministic UUID so the same arb upserts instead of creating duplicate rows
    const bookmakerKey = Array.from(new Set(outcomes.map((o) => o.bookmaker))).sort().join(',');
    const deterministicId = uuidv5(`${market.normalizedKey}:${bookmakerKey}`, ARB_NAMESPACE);

    return {
      id: deterministicId,
      eventName: market.eventName,
      sport: market.sport,
      marketType: market.marketType,
      league: market.league,
      startTime: market.startTime,
      totalImpliedProbability: Math.round(totalImplied * 1000000) / 1000000,
      profitMargin: Math.round(profitMargin * 1000000) / 1000000,
      roi: Math.round(roi * 10000) / 10000,
      stakes,
      totalStake: defaultStake,
      guaranteedProfit,
      detectedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour
      status: 'live',
      confidence: confidence.level,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      bookmakers: Array.from(new Set(outcomes.map((o) => o.bookmaker))),
    };
  }

  private calculateConfidence(
    roi: number,
    outcomes: UnifiedMarket['outcomes'],
    market: UnifiedMarket
  ): { level: 'high' | 'medium' | 'low'; score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0.5;

    const isFutures = market.marketType === 'futures';

    // Higher ROI = lower confidence (too good to be true), but futures can have bigger spreads
    const highRoiThreshold = isFutures ? 20 : 15;
    const medRoiThreshold = isFutures ? 10 : 5;
    if (roi > highRoiThreshold) {
      score -= 0.15;
      reasons.push('High ROI — verify prices are current');
    } else if (roi > medRoiThreshold) {
      score -= 0.05;
      reasons.push('Above-average ROI — verify odds are current');
    } else {
      score += 0.1;
      reasons.push('ROI within normal arbitrage range');
    }

    // More bookmakers = higher confidence
    const bookmakerCount = new Set(outcomes.map((o) => o.bookmaker)).size;
    if (bookmakerCount >= 3) {
      score += 0.15;
      reasons.push('Multiple bookmakers involved');
    } else if (bookmakerCount === 2) {
      score += 0.05;
    }

    // Check liquidity
    const hasLiquidity = outcomes.some((o) => (o.liquidity ?? 0) > 1000);
    if (hasLiquidity) {
      score += 0.1;
      reasons.push('Good liquidity available');
    }

    // Market type
    if (market.marketType === 'moneyline') {
      score += 0.05;
      reasons.push('Moneyline markets are reliable');
    }

    // Pinnacle or Polymarket involved = higher confidence (sharp/prediction-market sources)
    const hasSharpBook = outcomes.some((o) => o.bookmaker === 'pinnacle' || o.bookmaker === 'polymarket');
    if (hasSharpBook) {
      score += 0.1;
      const sharpNames = outcomes
        .filter((o) => o.bookmaker === 'pinnacle' || o.bookmaker === 'polymarket')
        .map((o) => o.bookmaker === 'pinnacle' ? 'Pinnacle' : 'Polymarket');
      reasons.push(`${[...new Set(sharpNames)].join('/')} (sharp source) odds included`);
    }

    // Polymarket YES/NO futures arb — highlight the mechanism
    const hasPolyNo = outcomes.some((o) => o.outcome.startsWith('NOT:'));
    if (hasPolyNo) {
      reasons.push('Polymarket NO vs sportsbook YES cross-platform arb');
    }

    score = Math.min(0.95, Math.max(0.1, score));

    let level: 'high' | 'medium' | 'low';
    if (score >= 0.7) level = 'high';
    else if (score >= 0.45) level = 'medium';
    else level = 'low';

    return { level, score: Math.round(score * 10000) / 10000, reasons };
  }

  private async processOpportunities(opportunities: ArbitrageOpportunity[]): Promise<void> {
    const redis = getRedis();

    for (const opp of opportunities) {
      try {
        // Store in Redis with TTL
        const redisKey = `${OPPORTUNITY_KEY_PREFIX}${opp.id}`;
        await redis.setex(
          redisKey,
          config.scanner.opportunityTtlSeconds,
          JSON.stringify(opp)
        );

        // Add to live set
        await redis.zadd(LIVE_OPPS_KEY, Date.now(), opp.id);

        // Persist to PostgreSQL
        await this.persistOpportunity(opp);

        this.totalOpportunities++;

        // Emit WebSocket event
        const event: WsEvent<ArbitrageOpportunity> = {
          type: 'opportunity:new',
          payload: opp,
          timestamp: new Date().toISOString(),
        };
        this.emit('ws:broadcast', event);
        this.emit('opportunity:new', opp);
      } catch (err) {
        logger.error('[scanner] Failed to process opportunity', {
          id: opp.id,
          error: (err as Error).message,
        });
      }
    }

    // Clean up expired live entries
    const expiredBefore = Date.now() - config.scanner.opportunityTtlSeconds * 1000;
    await redis.zremrangebyscore(LIVE_OPPS_KEY, '-inf', expiredBefore).catch(() => {});
  }

  private async persistOpportunity(opp: ArbitrageOpportunity): Promise<void> {
    await query(
      `INSERT INTO arbitrage_opportunities (
        id, event_name, sport, market_type, league, start_time,
        total_implied_probability, profit_margin, roi,
        stakes, total_stake, guaranteed_profit,
        detected_at, expires_at, status,
        confidence, confidence_score, confidence_reasons, bookmakers
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      ON CONFLICT (id) DO UPDATE SET
        roi = EXCLUDED.roi,
        profit_margin = EXCLUDED.profit_margin,
        total_implied_probability = EXCLUDED.total_implied_probability,
        stakes = EXCLUDED.stakes,
        guaranteed_profit = EXCLUDED.guaranteed_profit,
        expires_at = EXCLUDED.expires_at,
        status = 'live',
        confidence = EXCLUDED.confidence,
        confidence_score = EXCLUDED.confidence_score`,
      [
        opp.id,
        opp.eventName,
        opp.sport,
        opp.marketType,
        opp.league ?? null,
        opp.startTime ?? null,
        opp.totalImpliedProbability,
        opp.profitMargin,
        opp.roi,
        JSON.stringify(opp.stakes),
        opp.totalStake,
        opp.guaranteedProfit,
        opp.detectedAt,
        opp.expiresAt ?? null,
        opp.status,
        opp.confidence,
        opp.confidenceScore,
        JSON.stringify(opp.confidenceReasons),
        JSON.stringify(opp.bookmakers),
      ]
    );
  }
}

// Singleton
let scannerInstance: ScannerService | null = null;

export function getScanner(): ScannerService {
  if (!scannerInstance) {
    scannerInstance = new ScannerService();
  }
  return scannerInstance;
}
