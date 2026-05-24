import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const BASE_URL = 'https://guest.api.arcadia.pinnacle.com/0.1';

// ─── Pinnacle championship-winner futures ─────────────────────────────────────
// matchupId: the single "special" matchup that lists all teams as participants
// championshipKey: must match the key used by the Polymarket adapter
const FUTURES_CONFIGS = [
  { matchupId: 1611188946, sport: 'hockey'     as SportCategory, league: 'NHL',           championshipKey: 'nhl_stanley_cup_2026'   },
  { matchupId: 1611188915, sport: 'basketball' as SportCategory, league: 'NBA',           championshipKey: 'nba_finals_2026'        },
  { matchupId: 1622499515, sport: 'baseball'   as SportCategory, league: 'MLB',           championshipKey: 'mlb_world_series_2026'  },
  { matchupId: 1625949616, sport: 'football'   as SportCategory, league: 'NFL',           championshipKey: 'nfl_super_bowl_2026'    },
  { matchupId: 1619791352, sport: 'soccer'     as SportCategory, league: 'FIFA World Cup', championshipKey: 'fifa_world_cup_2026'   },
] as const;

// ─── Regular game leagues ─────────────────────────────────────────────────────
const GAME_LEAGUES = [
  { id: 1456, sport: 'hockey'     as SportCategory, name: 'NHL'         },
  { id: 487,  sport: 'basketball' as SportCategory, name: 'NBA'         },
  { id: 246,  sport: 'baseball'   as SportCategory, name: 'MLB'         },
  { id: 889,  sport: 'football'   as SportCategory, name: 'NFL'         },
  { id: 1980, sport: 'soccer'     as SportCategory, name: 'EPL'         },
  // Tennis — Pinnacle organises by tournament; 1488 = ATP, 1487 = WTA
  { id: 1488, sport: 'tennis'     as SportCategory, name: 'ATP'         },
  { id: 1487, sport: 'tennis'     as SportCategory, name: 'WTA'         },
];

// ─── Pinnacle API types ───────────────────────────────────────────────────────

interface PinnacleParticipant {
  id: number;
  name: string;
  alignment: 'home' | 'away' | 'neutral';
}

interface PinnacleMatchup {
  id: number;
  startTime: string;
  type?: string;
  league: { id: number; name: string };
  participants: PinnacleParticipant[];
  periods: PinnaclePeriod[];
}

interface PinnaclePeriod {
  number: number;
  moneyline?: { home: number; away: number; draw?: number };
  spreads?: Array<{ hdp: number; home: number; away: number }>;
  totals?: Array<{ points: number; over: number; under: number }>;
}

interface PinnacleMarketPrice {
  participantId: number;
  price: number;
}

interface PinnacleMarket {
  type: string;
  period: number;
  prices: PinnacleMarketPrice[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class PinnacleAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'pinnacle';
  readonly displayName = 'Pinnacle';
  protected readonly rateLimitPerMinute = 20;

  private cache: { data: UnifiedMarket[]; expiresAt: number } | null = null;
  private fetchPromise: Promise<UnifiedMarket[]> | null = null;

  private readonly headers = {
    'X-Api-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
    Referer: 'https://www.pinnacle.com/',
    Origin: 'https://www.pinnacle.com',
  };

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data;
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = this.doFetch().finally(() => { this.fetchPromise = null; });
    return this.fetchPromise;
  }

  private async doFetch(): Promise<UnifiedMarket[]> {
    const [gameMarkets, futuresMarkets] = await Promise.all([
      this.fetchGameMarkets().catch((err) => {
        logger.warn(`[pinnacle] Game markets failed: ${(err as Error).message}`);
        return [] as UnifiedMarket[];
      }),
      this.fetchFuturesMarkets().catch((err) => {
        logger.warn(`[pinnacle] Futures markets failed: ${(err as Error).message}`);
        return [] as UnifiedMarket[];
      }),
    ]);

    const all = [...gameMarkets, ...futuresMarkets];
    logger.info(`[pinnacle] ${all.length} markets (${gameMarkets.length} games + ${futuresMarkets.length} futures)`);
    this.cache = { data: all, expiresAt: Date.now() + CACHE_TTL_MS };
    return all;
  }

  // ─── Championship futures ─────────────────────────────────────────────────

  private async fetchFuturesMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    for (const cfg of FUTURES_CONFIGS) {
      try {
        const [matchup, marketData] = await Promise.all([
          this.fetchWithRetry<PinnacleMatchup>(
            `${BASE_URL}/matchups/${cfg.matchupId}`,
            { headers: this.headers }
          ),
          this.fetchWithRetry<PinnacleMarket[]>(
            `${BASE_URL}/matchups/${cfg.matchupId}/markets/straight`,
            { headers: this.headers }
          ),
        ]);

        // Build participant ID → name map
        const participantMap = new Map<number, string>();
        for (const p of matchup.participants ?? []) {
          participantMap.set(p.id, p.name);
        }

        // Find the moneyline market for period 0 (full event)
        const mlMarket = Array.isArray(marketData)
          ? marketData.find((m) => m.type === 'moneyline' && m.period === 0)
          : null;
        if (!mlMarket) continue;

        // Emit one UnifiedMarket per team that still has a price
        for (const priceEntry of mlMarket.prices) {
          const teamName = participantMap.get(priceEntry.participantId);
          if (!teamName) continue;

          const american = priceEntry.price;
          if (!american || isNaN(american)) continue;

          const { decimal, implied } = this.parseAmericanOdds(american);
          if (decimal <= 1.01) continue;

          const normalizedKey = `${this.teamSlug(teamName)}:futures:${cfg.championshipKey}`;

          markets.push({
            id: `pinnacle:futures:${cfg.matchupId}:${priceEntry.participantId}`,
            eventName: `${teamName} — ${cfg.league} Championship`,
            sport: cfg.sport,
            marketType: 'futures',
            league: cfg.league,
            startTime: matchup.startTime ? new Date(matchup.startTime) : undefined,
            outcomes: [{
              outcome: teamName,
              bookmaker: this.slug,
              decimalOdds: decimal,
              americanOdds: american,
              impliedProbability: implied,
              betUrl: `https://www.pinnacle.com/en/matchup/${cfg.matchupId}`,
            }],
            normalizedKey,
          });
        }
      } catch (err) {
        logger.warn(`[pinnacle] Futures fetch failed for matchup ${cfg.matchupId}: ${(err as Error).message}`);
      }
    }

    logger.debug(`[pinnacle] ${markets.length} futures team markets`);
    return markets;
  }

  // ─── Regular game markets ─────────────────────────────────────────────────

  private async fetchGameMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    for (const leagueCfg of GAME_LEAGUES) {
      try {
        const matchups = await this.fetchWithRetry<PinnacleMatchup[]>(
          `${BASE_URL}/leagues/${leagueCfg.id}/matchups`,
          { headers: this.headers }
        );

        for (const matchup of matchups ?? []) {
          if (matchup.type !== 'matchup') continue;
          const parsed = this.parseGameMatchup(matchup, leagueCfg.sport, leagueCfg.name);
          markets.push(...parsed);
        }
      } catch (err) {
        logger.warn(`[pinnacle] Failed to fetch league ${leagueCfg.name}: ${(err as Error).message}`);
      }
    }

    return markets;
  }

  private parseGameMatchup(
    matchup: PinnacleMatchup,
    sport: SportCategory,
    leagueName: string,
  ): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    const parts = matchup.participants ?? [];
    if (parts.length < 2) return markets;

    const home = parts.find((p) => p.alignment === 'home');
    const away = parts.find((p) => p.alignment === 'away');
    if (!home || !away) return markets;

    const commenceTime = new Date(matchup.startTime);
    // Skip in-progress games
    if (commenceTime < new Date()) return markets;

    const eventName = `${away.name} @ ${home.name}`;

    for (const period of matchup.periods ?? []) {
      if (period.number !== 0) continue;

      if (period.moneyline) {
        const { home: homeOdds, away: awayOdds, draw } = period.moneyline;
        const outcomes: MarketOutcome[] = [];

        if (homeOdds) {
          const { decimal, implied } = this.parseAmericanOdds(homeOdds);
          outcomes.push({ outcome: home.name, bookmaker: this.slug, decimalOdds: decimal, americanOdds: homeOdds, impliedProbability: implied, betUrl: `https://www.pinnacle.com/en/matchup/${matchup.id}` });
        }
        if (awayOdds) {
          const { decimal, implied } = this.parseAmericanOdds(awayOdds);
          outcomes.push({ outcome: away.name, bookmaker: this.slug, decimalOdds: decimal, americanOdds: awayOdds, impliedProbability: implied, betUrl: `https://www.pinnacle.com/en/matchup/${matchup.id}` });
        }
        if (draw) {
          const { decimal, implied } = this.parseAmericanOdds(draw);
          outcomes.push({ outcome: 'Draw', bookmaker: this.slug, decimalOdds: decimal, americanOdds: draw, impliedProbability: implied });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `pinnacle:${matchup.id}:ml`,
            eventName,
            sport,
            marketType: 'moneyline',
            league: leagueName,
            startTime: commenceTime,
            outcomes,
            normalizedKey: this.buildGameKey(eventName, 'moneyline', commenceTime),
          });
        }
      }

      if (period.spreads?.length) {
        const s = period.spreads[0];
        const outcomes: MarketOutcome[] = [];
        if (s.home) {
          const { decimal, implied } = this.parseAmericanOdds(s.home);
          outcomes.push({ outcome: `${home.name} ${s.hdp > 0 ? '+' : ''}${s.hdp}`, bookmaker: this.slug, decimalOdds: decimal, americanOdds: s.home, impliedProbability: implied });
        }
        if (s.away) {
          const { decimal, implied } = this.parseAmericanOdds(s.away);
          outcomes.push({ outcome: `${away.name} ${-s.hdp > 0 ? '+' : ''}${-s.hdp}`, bookmaker: this.slug, decimalOdds: decimal, americanOdds: s.away, impliedProbability: implied });
        }
        if (outcomes.length === 2) {
          markets.push({
            id: `pinnacle:${matchup.id}:spread`,
            eventName, sport, marketType: 'spread', league: leagueName, startTime: commenceTime, outcomes,
            normalizedKey: this.buildGameKey(eventName, 'spread', commenceTime),
          });
        }
      }

      if (period.totals?.length) {
        const t = period.totals[0];
        const outcomes: MarketOutcome[] = [];
        if (t.over) {
          const { decimal, implied } = this.parseAmericanOdds(t.over);
          outcomes.push({ outcome: `Over ${t.points}`, bookmaker: this.slug, decimalOdds: decimal, americanOdds: t.over, impliedProbability: implied });
        }
        if (t.under) {
          const { decimal, implied } = this.parseAmericanOdds(t.under);
          outcomes.push({ outcome: `Under ${t.points}`, bookmaker: this.slug, decimalOdds: decimal, americanOdds: t.under, impliedProbability: implied });
        }
        if (outcomes.length === 2) {
          markets.push({
            id: `pinnacle:${matchup.id}:total`,
            eventName, sport, marketType: 'total', league: leagueName, startTime: commenceTime, outcomes,
            normalizedKey: this.buildGameKey(eventName, 'total', commenceTime),
          });
        }
      }
    }

    return markets;
  }

  private buildGameKey(eventName: string, marketType: MarketType, date: Date): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const dateStr = date.toISOString().split('T')[0];
    return `${normalized}:${marketType}:${dateStr}`;
  }

  private teamSlug(name: string): string {
    return name.toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
}
