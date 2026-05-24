/**
 * Confidence Scorer
 * Assigns confidence levels to arbitrage opportunities based on risk factors.
 */

import type {
  ArbitrageOpportunity,
  ConfidenceLevel,
  MarketOutcome,
} from '@arbix/shared';

export interface ConfidenceInput {
  roi: number;
  totalImpliedProbability: number;
  outcomes: Pick<MarketOutcome, 'bookmaker' | 'decimalOdds' | 'maxBet' | 'liquidity'>[];
  eventStartTime?: Date;
  isLiveMarket?: boolean;
  oddsAge?: number;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  reasons: string[];
}

const SUSPICIOUS_ROI_THRESHOLD = 15;
const MIN_LIQUIDITY_THRESHOLD = 500;
const MAX_ODDS_AGE_SECONDS = 30;

export class ConfidenceScorer {
  static score(input: ConfidenceInput): ConfidenceResult {
    let score = 100;
    const reasons: string[] = [];

    // Penalize excessively high ROI (likely stale/error odds)
    if (input.roi > SUSPICIOUS_ROI_THRESHOLD) {
      const penalty = Math.min(50, (input.roi - SUSPICIOUS_ROI_THRESHOLD) * 3);
      score -= penalty;
      reasons.push(`High ROI (${input.roi.toFixed(2)}%) may indicate stale or erroneous odds`);
    }

    // Penalize if odds are stale
    if (input.oddsAge && input.oddsAge > MAX_ODDS_AGE_SECONDS) {
      const penalty = Math.min(30, (input.oddsAge - MAX_ODDS_AGE_SECONDS) * 0.5);
      score -= penalty;
      reasons.push(`Odds are ${input.oddsAge}s old — may no longer be available`);
    }

    // Penalize live markets (odds change very fast)
    if (input.isLiveMarket) {
      score -= 20;
      reasons.push('Live market — odds change rapidly, execution window is very short');
    }

    // Penalize low liquidity
    for (const outcome of input.outcomes) {
      if (outcome.liquidity !== undefined && outcome.liquidity < MIN_LIQUIDITY_THRESHOLD) {
        score -= 15;
        reasons.push(
          `Low liquidity on ${outcome.bookmaker} ($${outcome.liquidity}) — may not fill`
        );
        break;
      }
    }

    // Penalize max bet restrictions
    for (const outcome of input.outcomes) {
      if (outcome.maxBet !== undefined && outcome.maxBet < 100) {
        score -= 10;
        reasons.push(
          `Low max bet on ${outcome.bookmaker} ($${outcome.maxBet}) — limits profit potential`
        );
        break;
      }
    }

    // Penalize if event starts very soon (may be suspended)
    if (input.eventStartTime) {
      const minutesUntilStart =
        (input.eventStartTime.getTime() - Date.now()) / 60000;
      if (minutesUntilStart < 5 && minutesUntilStart > 0) {
        score -= 25;
        reasons.push(
          `Event starts in ${minutesUntilStart.toFixed(0)}min — books may suspend betting`
        );
      } else if (minutesUntilStart < 0) {
        score -= 40;
        reasons.push('Event already started — significantly elevated risk');
      }
    }

    // Reward if ROI is in the "sweet spot" (real arb range 1-5%)
    if (input.roi >= 0.5 && input.roi <= 5) {
      score = Math.min(100, score + 5);
      reasons.push('ROI in typical real-arbitrage range');
    }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    let level: ConfidenceLevel;
    if (score >= 70) level = 'high';
    else if (score >= 40) level = 'medium';
    else level = 'low';

    return { score, level, reasons };
  }
}
