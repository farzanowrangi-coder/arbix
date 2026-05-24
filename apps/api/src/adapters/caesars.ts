import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

// Caesars Sportsbook public API (NJ state endpoint)
const BASE_URL = 'https://api.au.sbtech.com';
const BRAND_ID = 'HMD5ZJ28DL';

interface CaesarsSelection {
  id: string;
  name: string;
  currentPriceUp: number;
  currentPriceDown: number;
  runnerNum?: number;
  handicap?: number;
  status?: string;
}

interface CaesarsMarket {
  id: string;
  marketType: string;
  description: string;
  status?: string;
  selections: CaesarsSelection[];
}

interface CaesarsEvent {
  id: string;
  description: string;
  startTime: string;
  sport?: { description: string };
  competition?: { description: string };
  markets: CaesarsMarket[];
}

interface CaesarsResponse {
  data?: CaesarsEvent[];
  error?: unknown;
}

const SPORT_IDS: Array<{ id: string; sport: SportCategory }> = [
  { id: '29', sport: 'football' },
  { id: '3', sport: 'basketball' },
  { id: '2', sport: 'baseball' },
  { id: '4', sport: 'hockey' },
  { id: '1', sport: 'soccer' },
  { id: '20', sport: 'tennis' },
  { id: '11', sport: 'mma' },
];

export class CaesarsAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'caesars';
  readonly displayName = 'Caesars';
  protected readonly rateLimitPerMinute = 15;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    for (const sportConfig of SPORT_IDS) {
      try {
        // Caesars / SBTech API
        const url = `${BASE_URL}/${BRAND_ID}/GetEventsByLeague/json?siteId=2&sportId=${sportConfig.id}&lang=en&liveStatus=0&count=50`;

        const response = await this.fetchWithProxy<CaesarsResponse>(url, {
          headers: {
            Referer: 'https://sportsbook.caesars.com/',
            Origin: 'https://sportsbook.caesars.com',
          },
        });

        const parsed = this.parseResponse(response, sportConfig.sport);
        markets.push(...parsed);
      } catch (err) {
        logger.warn(`[caesars] Failed to fetch sport ${sportConfig.id}: ${(err as Error).message}`);
      }
    }

    logger.info(`[caesars] Fetched ${markets.length} markets`);
    return markets;
  }

  private parseResponse(response: CaesarsResponse, sport: SportCategory): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    if (!response?.data) return markets;

    for (const event of response.data) {
      const eventName = event.description;
      const league = event.competition?.description ?? undefined;

      for (const market of event.markets ?? []) {
        if (market.status === 'Suspended' || market.status === 'Closed') continue;
        if (!market.selections || market.selections.length < 2) continue;

        const marketType = this.inferMarketType(market.description);
        const outcomes: MarketOutcome[] = [];

        for (const selection of market.selections) {
          if (selection.status === 'Suspended') continue;
          if (!selection.currentPriceUp || !selection.currentPriceDown) continue;

          const decimal = 1 + selection.currentPriceUp / selection.currentPriceDown;
          const american = this.decimalToAmerican(decimal);
          const implied = 1 / decimal;

          const label = selection.handicap != null
            ? `${selection.name} ${selection.handicap > 0 ? '+' : ''}${selection.handicap}`
            : selection.name;

          outcomes.push({
            outcome: label,
            bookmaker: this.slug,
            decimalOdds: Math.round(decimal * 10000) / 10000,
            americanOdds: american,
            impliedProbability: Math.round(implied * 10000) / 10000,
            betUrl: `https://sportsbook.caesars.com/us/nj/bet/sports/event/${event.id}`,
          });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `caesars:${event.id}:${market.id}`,
            eventName,
            sport,
            marketType,
            league,
            startTime: new Date(event.startTime),
            outcomes,
            normalizedKey: this.buildNormalizedKey(eventName, marketType, event.startTime),
          });
        }
      }
    }

    return markets;
  }

  private inferMarketType(description: string): MarketType {
    const d = description.toLowerCase();
    if (d.includes('spread') || d.includes('handicap') || d.includes('asian')) return 'spread';
    if (d.includes('total') || d.includes('over') || d.includes('under') || d.includes('o/u')) return 'total';
    if (d.includes('moneyline') || d.includes('money line') || d.includes('ml')) return 'moneyline';
    if (d.includes('1x2') || d.includes('match result')) return 'moneyline';
    return 'moneyline';
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType, startTime: string): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = startTime.split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
