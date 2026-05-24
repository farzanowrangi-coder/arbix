import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';
import { config } from '../config';

const BASE_URL = 'https://api.the-odds-api.com/v4';

// Only fetch sports that are currently in season — saves quota
const SPORT_CONFIGS: Array<{ key: string; sport: SportCategory; league?: string }> = [
  { key: 'baseball_mlb',             sport: 'baseball',   league: 'MLB' },
  { key: 'basketball_nba',           sport: 'basketball', league: 'NBA' },
  { key: 'americanfootball_nfl',     sport: 'football',   league: 'NFL' },
  { key: 'icehockey_nhl',            sport: 'hockey',     league: 'NHL' },
  { key: 'soccer_epl',               sport: 'soccer',     league: 'EPL' },
  { key: 'soccer_uefa_champs_league',sport: 'soccer',     league: 'UCL' },
  { key: 'mma_mixed_martial_arts',   sport: 'mma',        league: 'MMA' },
  { key: 'tennis_atp_french_open',   sport: 'tennis',     league: 'ATP' },
];

const FUTURES_CONFIGS: Array<{ key: string; sport: SportCategory; league?: string; championshipKey: string }> = [
  { key: 'americanfootball_nfl_super_bowl_winner', sport: 'football',   league: 'NFL', championshipKey: 'nfl_super_bowl_2026'   },
  { key: 'basketball_nba_championship_winner',     sport: 'basketball', league: 'NBA', championshipKey: 'nba_finals_2026'        },
  { key: 'baseball_mlb_world_series_winner',       sport: 'baseball',   league: 'MLB', championshipKey: 'mlb_world_series_2026'  },
  { key: 'icehockey_nhl_championship_winner',      sport: 'hockey',     league: 'NHL', championshipKey: 'nhl_stanley_cup_2026'   },
];

const BOOKMAKER_MAP: Record<string, BookmakerSlug> = {
  draftkings:      'draftkings',
  fanduel:         'fanduel',
  betmgm:          'betmgm',
  caesars:         'caesars',
  williamhill_us:  'caesars',
  bet365:          'bet365',
  bovada:          'bovada',
  mybookie:        'mybookie',
  betonline:       'betonline',
  pinnacle:        'pinnacle',
  betway:          'betway',
  betrivers:       'betrivers',
  pointsbetus:     'betrivers',
};

const MARKET_TYPE_MAP: Record<string, MarketType> = {
  h2h:      'moneyline',
  spreads:  'spread',
  totals:   'total',
};

// Books whose lines we trust as a reference for sanity-checking
const SHARP_BOOKS = new Set<BookmakerSlug>(['pinnacle', 'draftkings', 'fanduel', 'betmgm']);

// Maximum allowed implied-probability divergence from the sharpest book's line.
// If a book's implied prob for an outcome is more than this far from Pinnacle's,
// we treat the price as stale/promotional and skip it.
const MAX_IMPLIED_DIVERGENCE = 0.18; // 18 percentage points

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export class TheOddsApiAdapter extends BaseAdapter {
  readonly slug = 'odds_api' as BookmakerSlug;
  readonly displayName = 'The Odds API';
  protected readonly rateLimitPerMinute = 2;

  // In-memory cache — keyed by sport/futures key.
  // stale=true means TTL has expired but data is kept as a fallback when the API is unavailable.
  private cache: Map<string, { data: OddsApiEvent[]; expiresAt: number; stale?: boolean }> = new Map();

  private get apiKey(): string {
    return config.oddsApi?.key ?? process.env['ODDS_API_KEY'] ?? '';
  }

  // Free tier = 500 req/month across 8 sport + 4 futures endpoints.
  // Default 30 min cache.  Set ODDS_API_CACHE_MINUTES env to override.
  private cacheTtlMs(isFutures = false): number {
    const minutes = parseInt(process.env['ODDS_API_CACHE_MINUTES'] ?? '30', 10);
    const effective = Math.max(5, minutes);
    return (isFutures ? effective * 4 : effective) * 60 * 1000;
  }

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    if (!this.apiKey) {
      logger.warn('[odds-api] No ODDS_API_KEY configured — skipping');
      return [];
    }

    const markets: UnifiedMarket[] = [];

    for (const sportConfig of SPORT_CONFIGS) {
      try {
        const events = await this.fetchSport(sportConfig.key);
        markets.push(...this.parseEvents(events, sportConfig.sport, sportConfig.league, false));
      } catch (err) {
        logger.warn(`[odds-api] Failed to fetch ${sportConfig.key}: ${(err as Error).message}`);
      }
    }

    for (const futuresConfig of FUTURES_CONFIGS) {
      try {
        const events = await this.fetchSport(futuresConfig.key, true);
        markets.push(...this.parseFuturesEvents(events, futuresConfig.sport, futuresConfig.league, futuresConfig.championshipKey));
      } catch (err) {
        logger.warn(`[odds-api] Failed to fetch futures ${futuresConfig.key}: ${(err as Error).message}`);
      }
    }

    logger.info(`[odds-api] Fetched ${markets.length} markets`);
    return markets;
  }

  private async fetchSport(sportKey: string, isFutures = false): Promise<OddsApiEvent[]> {
    const cacheKey = sportKey;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const markets = isFutures ? 'outrights' : 'h2h,spreads,totals';
    const bookmakers = isFutures
      ? '' // all books for futures
      : '&bookmakers=draftkings,fanduel,betmgm,williamhill_us,bovada,pinnacle,betway,betrivers';

    const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${this.apiKey}&regions=us&markets=${markets}&oddsFormat=decimal${bookmakers}`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!resp.ok) {
        if (resp.status === 422 || resp.status === 404) return []; // off-season
        // Quota exhaustion (401/402) or rate-limit (429): serve stale cache if available
        if (resp.status === 401 || resp.status === 402 || resp.status === 429) {
          if (cached) {
            logger.warn(`[odds-api] Quota/auth error (${resp.status}) for ${sportKey} — serving stale cache`);
            return cached.data;
          }
        }
        throw new Error(`HTTP ${resp.status} for ${sportKey}`);
      }

      const data = (await resp.json()) as OddsApiEvent[];
      const ttl = this.cacheTtlMs(isFutures);
      this.cache.set(cacheKey, { data, expiresAt: Date.now() + ttl });
      logger.debug(`[odds-api] Fetched ${data.length} events for ${sportKey}`);
      return data;
    } catch (err) {
      // Network errors or other failures — serve stale cache if available
      if (cached) {
        logger.warn(`[odds-api] Fetch failed for ${sportKey} — serving stale cache (${(err as Error).message})`);
        return cached.data;
      }
      throw err;
    }
  }

  private parseEvents(
    events: OddsApiEvent[],
    sport: SportCategory,
    league: string | undefined,
    isFutures: boolean,
  ): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];

    for (const event of events) {
      // Skip games that have already started — live odds from different books
      // are captured at different times and create phantom arb from divergent snapshots.
      const commenceTime = new Date(event.commence_time);
      if (!isFutures && commenceTime < new Date()) continue;

      const eventName = `${event.home_team} vs ${event.away_team}`;

      // Build a reference map of Pinnacle's implied probabilities per market+outcome
      // so we can sanity-check other books' prices.
      const pinnacleRef = this.buildPinnacleRef(event);

      for (const bookmaker of event.bookmakers) {
        const slug = BOOKMAKER_MAP[bookmaker.key];
        if (!slug) continue;

        for (const market of bookmaker.markets) {
          const marketKey = market.key;
          const marketType: MarketType = isFutures
            ? 'futures'
            : (MARKET_TYPE_MAP[marketKey] ?? 'moneyline');

          // For spread/total markets, include the specific line in the normalised key
          // so DraftKings -1.5 and Pinnacle -1.0 are NOT merged into the same group.
          const linePoint = this.extractLine(market);

          const outcomes: MarketOutcome[] = [];
          for (const outcome of market.outcomes) {
            const price = outcome.price;
            if (!price || price <= 1.01) continue;

            // Sanity-check: if we have a Pinnacle reference price for this outcome,
            // reject any book that deviates more than MAX_IMPLIED_DIVERGENCE.
            // This filters out stale/promotional prices that generate phantom arb.
            const refKey = `${marketKey}:${linePoint ?? ''}:${outcome.name}`;
            const refImplied = pinnacleRef.get(refKey);
            const thisImplied = 1 / price;
            if (
              refImplied !== undefined &&
              Math.abs(thisImplied - refImplied) > MAX_IMPLIED_DIVERGENCE
            ) {
              logger.debug(
                `[odds-api] Skipping ${slug} ${outcome.name} @ ${price} ` +
                `(implied ${(thisImplied * 100).toFixed(1)}% vs Pinnacle ${(refImplied * 100).toFixed(1)}%)`,
              );
              continue;
            }

            const outcomeName = this.buildOutcomeName(outcome, marketKey);
            outcomes.push({
              outcome: outcomeName,
              bookmaker: slug,
              decimalOdds: Math.round(price * 10000) / 10000,
              americanOdds: this.decimalToAmerican(price),
              impliedProbability: Math.round(thisImplied * 10000) / 10000,
              betUrl: this.betUrl(slug),
            });
          }

          if (outcomes.length < 2) continue;

          markets.push({
            id: `odds_api:${event.id}:${marketKey}:${linePoint ?? ''}:${slug}`,
            eventName,
            sport,
            marketType,
            league,
            startTime: commenceTime,
            outcomes,
            normalizedKey: this.buildNormalizedKey(eventName, marketType, linePoint, commenceTime),
          });
        }
      }
    }

    return markets;
  }

  // Emit one UnifiedMarket per team per bookmaker for futures championship events.
  // Each market has a single outcome (the team), with normalizedKey matching the
  // Polymarket per-team binary market so arb can be detected cross-platform.
  private parseFuturesEvents(
    events: OddsApiEvent[],
    sport: SportCategory,
    league: string | undefined,
    championshipKey: string,
  ): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];

    for (const event of events) {
      for (const bookmaker of event.bookmakers) {
        const slug = BOOKMAKER_MAP[bookmaker.key];
        if (!slug) continue;

        for (const market of bookmaker.markets) {
          if (market.key !== 'outrights') continue;

          for (const outcome of market.outcomes) {
            const price = outcome.price;
            if (!price || price <= 1.01) continue;

            const teamName = outcome.name;
            const normalizedKey = `${this.teamSlug(teamName)}:futures:${championshipKey}`;

            markets.push({
              id: `odds_api:futures:${event.id}:${slug}:${this.teamSlug(teamName)}`,
              eventName: `${teamName} — ${league ?? 'Championship'} ${new Date().getFullYear()}`,
              sport,
              marketType: 'futures',
              league,
              startTime: event.commence_time ? new Date(event.commence_time) : undefined,
              outcomes: [{
                outcome: teamName,
                bookmaker: slug,
                decimalOdds: Math.round(price * 10000) / 10000,
                americanOdds: this.decimalToAmerican(price),
                impliedProbability: Math.round((1 / price) * 10000) / 10000,
                betUrl: this.betUrl(slug),
              }],
              normalizedKey,
            });
          }
        }
      }
    }

    return markets;
  }

  private teamSlug(name: string): string {
    return name.toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  // Build a map of Pinnacle's implied probabilities keyed by `marketKey:line:outcomeName`.
  // Used to sanity-check retail-book prices.
  private buildPinnacleRef(event: OddsApiEvent): Map<string, number> {
    const ref = new Map<string, number>();
    const pinnacle = event.bookmakers.find((b) => b.key === 'pinnacle');
    if (!pinnacle) return ref;

    for (const market of pinnacle.markets) {
      const line = this.extractLine(market);
      for (const outcome of market.outcomes) {
        if (!outcome.price || outcome.price <= 1) continue;
        ref.set(`${market.key}:${line ?? ''}:${outcome.name}`, 1 / outcome.price);
      }
    }
    return ref;
  }

  // Extract the spread/total line value from a market (absolute value so -1.5 and +1.5 both → 1.5)
  private extractLine(market: OddsApiMarket): number | undefined {
    if (market.key !== 'spreads' && market.key !== 'totals') return undefined;
    const point = market.outcomes[0]?.point;
    if (point === undefined) return undefined;
    return Math.abs(point);
  }

  private buildOutcomeName(outcome: OddsApiOutcome, marketKey: string): string {
    if (marketKey === 'spreads' && outcome.point !== undefined) {
      const sign = outcome.point > 0 ? '+' : '';
      return `${outcome.name} ${sign}${outcome.point}`;
    }
    if ((marketKey === 'totals' || marketKey === 'outrights') && outcome.point !== undefined) {
      return `${outcome.name} ${outcome.point}`;
    }
    return outcome.name;
  }

  // Include the spread/total line and actual game date so games on different dates
  // (e.g. a 3-game series) never get merged into the same group.
  private buildNormalizedKey(eventName: string, marketType: MarketType, line?: number, gameDate?: Date): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = (gameDate ?? new Date()).toISOString().split('T')[0];
    const lineSuffix = line !== undefined ? `_${line}` : '';
    return `${normalized}:${marketType}${lineSuffix}:${date}`;
  }

  private betUrl(slug: BookmakerSlug): string {
    const urls: Partial<Record<BookmakerSlug, string>> = {
      draftkings: 'https://sportsbook.draftkings.com',
      fanduel:    'https://sportsbook.fanduel.com',
      betmgm:     'https://sports.betmgm.com',
      caesars:    'https://sportsbook.caesars.com',
      bovada:     'https://www.bovada.lv',
      mybookie:   'https://www.mybookie.ag',
      betonline:  'https://www.betonline.ag',
      pinnacle:   'https://www.pinnacle.com',
      betway:     'https://betway.com',
      betrivers:  'https://www.betrivers.com',
    };
    return urls[slug] ?? 'https://www.google.com';
  }
}
