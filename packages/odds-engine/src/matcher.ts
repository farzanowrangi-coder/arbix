/**
 * Market Matcher
 * Identifies equivalent markets across different sportsbooks/prediction markets.
 * Uses normalized event keys and fuzzy team name matching.
 */

import type { UnifiedMarket, MarketOutcome, SportCategory } from '@arbix/shared';

// Common team name aliases for normalization
const TEAM_ALIASES: Record<string, string[]> = {
  'new_england_patriots': ['patriots', 'new england', 'ne patriots'],
  'kansas_city_chiefs': ['chiefs', 'kansas city', 'kc chiefs'],
  'los_angeles_lakers': ['lakers', 'la lakers', 'los angeles lakers'],
  'golden_state_warriors': ['warriors', 'golden state', 'gsw'],
  'new_york_yankees': ['yankees', 'ny yankees', 'new york yankees'],
  // ... extend as needed
};

const SPORT_KEYWORDS: Record<SportCategory, string[]> = {
  football: ['nfl', 'ncaaf', 'football', 'afl'],
  basketball: ['nba', 'ncaab', 'basketball', 'wnba'],
  baseball: ['mlb', 'baseball'],
  hockey: ['nhl', 'hockey'],
  soccer: ['mls', 'epl', 'ucl', 'soccer', 'football', 'la liga', 'bundesliga'],
  tennis: ['atp', 'wta', 'tennis', 'grand slam'],
  mma: ['ufc', 'mma', 'bellator', 'one fc'],
  boxing: ['boxing', 'wbc', 'wba', 'ibf'],
  golf: ['pga', 'golf', 'masters', 'open'],
  politics: ['election', 'president', 'senate', 'politics'],
  crypto: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto'],
  other: [],
};

export class MarketMatcher {
  /**
   * Generate a normalized key for a market that can be compared across books.
   */
  static generateMarketKey(
    eventName: string,
    marketType: string,
    sport: SportCategory
  ): string {
    const normalized = eventName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();

    return `${sport}::${marketType}::${normalized}`;
  }

  /**
   * Normalize a team/participant name for comparison.
   */
  static normalizeTeamName(name: string): string {
    const lower = name.toLowerCase().trim();

    for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
      if (aliases.some((alias) => lower.includes(alias))) {
        return canonical;
      }
    }

    return lower
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^(the_|a_|an_)/, '');
  }

  /**
   * Calculate similarity between two strings (0-1).
   * Uses Jaccard similarity on word tokens.
   */
  static similarity(a: string, b: string): number {
    const tokenize = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter(Boolean)
      );

    const setA = tokenize(a);
    const setB = tokenize(b);
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Determine if two markets represent the same event.
   */
  static areMarketsEquivalent(
    market1: UnifiedMarket,
    market2: UnifiedMarket,
    threshold = 0.7
  ): boolean {
    if (market1.sport !== market2.sport) return false;
    if (market1.marketType !== market2.marketType) return false;
    if (market1.normalizedKey === market2.normalizedKey) return true;

    const sim = this.similarity(market1.eventName, market2.eventName);
    if (sim >= threshold) return true;

    // Check start time proximity (within 5 minutes)
    if (market1.startTime && market2.startTime) {
      const diff = Math.abs(
        market1.startTime.getTime() - market2.startTime.getTime()
      );
      if (diff > 5 * 60 * 1000) return false;
      return sim >= 0.5;
    }

    return false;
  }

  /**
   * Match outcomes across markets (handles "Team A" vs "Team B" ordering).
   * Returns pairs of matching outcomes from market1 and market2.
   */
  static matchOutcomes(
    outcomes1: MarketOutcome[],
    outcomes2: MarketOutcome[]
  ): Array<[MarketOutcome, MarketOutcome]> {
    const pairs: Array<[MarketOutcome, MarketOutcome]> = [];

    for (const o1 of outcomes1) {
      let bestMatch: MarketOutcome | null = null;
      let bestScore = 0;

      for (const o2 of outcomes2) {
        const score = this.similarity(o1.outcome, o2.outcome);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = o2;
        }
      }

      if (bestMatch && bestScore >= 0.5) {
        pairs.push([o1, bestMatch]);
      }
    }

    return pairs;
  }

  /**
   * Find the best odds for each outcome across multiple markets.
   * Useful for building the best cross-book combination.
   */
  static findBestOddsPerOutcome(markets: UnifiedMarket[]): Map<string, MarketOutcome> {
    const bestOdds = new Map<string, MarketOutcome>();

    for (const market of markets) {
      for (const outcome of market.outcomes) {
        const key = this.normalizeTeamName(outcome.outcome);
        const existing = bestOdds.get(key);

        if (!existing || outcome.decimalOdds > existing.decimalOdds) {
          bestOdds.set(key, outcome);
        }
      }
    }

    return bestOdds;
  }

  /**
   * Detect sport from event name heuristically.
   */
  static detectSport(eventName: string): SportCategory {
    const lower = eventName.toLowerCase();

    for (const [sport, keywords] of Object.entries(SPORT_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return sport as SportCategory;
      }
    }

    return 'other';
  }
}
