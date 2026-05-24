import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

// BetMGM uses a public API via their CDN
const BASE_URL = 'https://sports.nj.betmgm.com/en/sports';
const API_BASE = 'https://cds-api.nj.betmgm.com/bettingoffer/fixtures';

interface BetMGMOutcome {
  id: number;
  name: { value: string };
  odds: number; // decimal
  americanOdds?: number;
  attr?: string;
  isActive?: boolean;
}

interface BetMGMGame {
  id: number;
  name: { value: string };
  startDate: string;
  isLive?: boolean;
  results: BetMGMOutcome[];
}

interface BetMGMOffer {
  id: number;
  name: { value: string };
  combinationType?: string;
  games: BetMGMGame[];
}

interface BetMGMFixture {
  id: number;
  name: { value: string };
  startDate: string;
  sport?: { name: { value: string } };
  tournament?: { name: { value: string } };
  betOffers?: BetMGMOffer[];
}

interface BetMGMResponse {
  fixtures?: BetMGMFixture[];
  total?: number;
}

const SPORT_ENDPOINTS = [
  { path: 'football/nfl', sport: 'football' as SportCategory },
  { path: 'basketball/nba', sport: 'basketball' as SportCategory },
  { path: 'baseball/mlb', sport: 'baseball' as SportCategory },
  { path: 'hockey/nhl', sport: 'hockey' as SportCategory },
  { path: 'soccer', sport: 'soccer' as SportCategory },
];

export class BetMGMAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'betmgm';
  readonly displayName = 'BetMGM';
  protected readonly rateLimitPerMinute = 15;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    for (const endpoint of SPORT_ENDPOINTS) {
      try {
        const url = `${API_BASE}?x-bwin-accessid=Y2Y4NjI0ODAtMDM4YS00NTM0LTliZTktNmU0ZjZjMTIzZGQz&lang=en-us&country=US&userCountry=US&subdivision=NJ&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&sportIds=${this.sportToId(endpoint.sport)}&regionIds=9&competitionIds=&fixtureIds=&page=1&pageSize=50&sortBy=StartDate`;

        const response = await this.fetchWithProxy<BetMGMResponse>(url, {
          headers: {
            Referer: `${BASE_URL}/${endpoint.path}`,
            Origin: 'https://sports.nj.betmgm.com',
          },
        });

        const parsed = this.parseResponse(response, endpoint.sport);
        markets.push(...parsed);
      } catch (err) {
        logger.warn(`[betmgm] Failed to fetch ${endpoint.path}: ${(err as Error).message}`);
      }
    }

    logger.info(`[betmgm] Fetched ${markets.length} markets`);
    return markets;
  }

  private parseResponse(response: BetMGMResponse, sport: SportCategory): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    if (!response?.fixtures) return markets;

    for (const fixture of response.fixtures) {
      const eventName = fixture.name?.value ?? 'Unknown Event';
      const league = fixture.tournament?.name?.value ?? undefined;

      for (const offer of fixture.betOffers ?? []) {
        for (const game of offer.games ?? []) {
          if (!game.results || game.results.length < 2) continue;

          const marketType = this.inferMarketType(offer.name?.value ?? '');
          const outcomes: MarketOutcome[] = [];

          for (const result of game.results) {
            if (result.isActive === false) continue;
            if (!result.odds || result.odds <= 1) continue;

            const decimal = result.odds;
            const american = this.decimalToAmerican(decimal);
            const implied = 1 / decimal;

            outcomes.push({
              outcome: result.attr ? `${result.name.value} ${result.attr}` : result.name.value,
              bookmaker: this.slug,
              decimalOdds: Math.round(decimal * 10000) / 10000,
              americanOdds: american,
              impliedProbability: Math.round(implied * 10000) / 10000,
              betUrl: `https://sports.nj.betmgm.com/en/sports/event/${fixture.id}`,
            });
          }

          if (outcomes.length >= 2) {
            markets.push({
              id: `betmgm:${fixture.id}:${game.id}`,
              eventName,
              sport,
              marketType,
              league,
              startTime: new Date(fixture.startDate),
              outcomes,
              normalizedKey: this.buildNormalizedKey(eventName, marketType, fixture.startDate),
            });
          }
        }
      }
    }

    return markets;
  }

  private inferMarketType(name: string): MarketType {
    const n = name.toLowerCase();
    if (n.includes('spread') || n.includes('handicap')) return 'spread';
    if (n.includes('total') || n.includes('over/under') || n.includes('o/u')) return 'total';
    if (n.includes('moneyline') || n.includes('money line') || n.includes('ml') || n.includes('winner') || n.includes('1x2')) return 'moneyline';
    return 'moneyline';
  }

  private sportToId(sport: SportCategory): number {
    const map: Record<SportCategory, number> = {
      football: 2,
      basketball: 7,
      baseball: 23,
      hockey: 4,
      soccer: 1,
      tennis: 5,
      mma: 36,
      boxing: 9,
      golf: 18,
      politics: 999,
      crypto: 998,
      other: 0,
    };
    return map[sport] ?? 0;
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType, startDate: string): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = startDate.split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
