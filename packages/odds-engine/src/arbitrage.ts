/**
 * Arbitrage Detection Engine
 * Core engine that scans unified markets and finds arbitrage opportunities.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UnifiedMarket,
  ArbitrageOpportunity,
  MarketOutcome,
  BookmakerSlug,
  SportCategory,
} from '@arbix/shared';
import { ArbitrageCalculator } from './calculator';
import { MarketMatcher } from './matcher';
import { ConfidenceScorer } from './confidence';

export interface ScanOptions {
  minRoi?: number;
  maxRoi?: number;
  bankroll?: number;
  includeHighRiskOnly?: boolean;
}

export class ArbitrageEngine {
  private readonly defaultBankroll = 1000;

  /**
   * Scan a list of unified markets for arbitrage opportunities.
   */
  scan(markets: UnifiedMarket[], options: ScanOptions = {}): ArbitrageOpportunity[] {
    const { minRoi = 0, maxRoi = 100, bankroll = this.defaultBankroll } = options;
    const opportunities: ArbitrageOpportunity[] = [];

    // Group markets by sport + marketType
    const groups = this.groupEquivalentMarkets(markets);

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      const opp = this.findBestArbitrage(group, bankroll);
      if (!opp) continue;

      if (opp.roi < minRoi || opp.roi > maxRoi) continue;

      opportunities.push(opp);
    }

    // Sort by ROI descending
    return opportunities.sort((a, b) => b.roi - a.roi);
  }

  /**
   * Group markets that represent the same event across different bookmakers.
   */
  private groupEquivalentMarkets(
    markets: UnifiedMarket[]
  ): Map<string, UnifiedMarket[]> {
    const groups = new Map<string, UnifiedMarket[]>();

    for (const market of markets) {
      let placed = false;

      for (const [key, group] of groups.entries()) {
        if (MarketMatcher.areMarketsEquivalent(market, group[0])) {
          group.push(market);
          placed = true;
          break;
        }
      }

      if (!placed) {
        groups.set(market.id, [market]);
      }
    }

    return groups;
  }

  /**
   * Given a group of equivalent markets from different books,
   * find the best arbitrage combination.
   */
  private findBestArbitrage(
    markets: UnifiedMarket[],
    bankroll: number
  ): ArbitrageOpportunity | null {
    // For each outcome, find the best odds across all markets
    const allOutcomeNames = new Set<string>();
    for (const market of markets) {
      for (const outcome of market.outcomes) {
        allOutcomeNames.add(
          MarketMatcher.normalizeTeamName(outcome.outcome)
        );
      }
    }

    // Find best odds per outcome
    const bestPerOutcome = new Map<string, MarketOutcome>();

    for (const normalizedName of allOutcomeNames) {
      let best: MarketOutcome | null = null;

      for (const market of markets) {
        for (const outcome of market.outcomes) {
          if (
            MarketMatcher.normalizeTeamName(outcome.outcome) === normalizedName
          ) {
            if (!best || outcome.decimalOdds > best.decimalOdds) {
              best = outcome;
            }
          }
        }
      }

      if (best) bestPerOutcome.set(normalizedName, best);
    }

    if (bestPerOutcome.size < 2) return null;

    const outcomes = Array.from(bestPerOutcome.values());
    const calcResult = ArbitrageCalculator.calculate({ outcomes, totalBankroll: bankroll });

    if (!calcResult.isArbitrage) return null;

    const firstMarket = markets[0];
    const bookmakers = [...new Set(outcomes.map((o) => o.bookmaker))] as BookmakerSlug[];

    // Score confidence
    const confidence = ConfidenceScorer.score({
      roi: calcResult.roi,
      totalImpliedProbability: calcResult.totalImpliedProbability,
      outcomes,
      eventStartTime: firstMarket.startTime,
      isLiveMarket: false,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min default

    return {
      id: uuidv4(),
      eventName: firstMarket.eventName,
      sport: firstMarket.sport,
      marketType: firstMarket.marketType,
      league: firstMarket.league,
      startTime: firstMarket.startTime,
      totalImpliedProbability: calcResult.totalImpliedProbability,
      profitMargin: calcResult.profitMargin,
      roi: calcResult.roi,
      stakes: calcResult.stakes,
      totalStake: calcResult.totalStake,
      guaranteedProfit: calcResult.guaranteedProfit,
      detectedAt: now,
      expiresAt,
      status: 'live',
      confidence: confidence.level,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      bookmakers,
    };
  }
}
