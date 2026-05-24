import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

// FanDuel uses state-specific API endpoints; TN is one of the less restricted ones
const BASE_URL = 'https://sbapi.tn.sportsbook.fanduel.com/api';

interface FDTab {
  tabName: string;
  tabId: number;
  markets?: FDMarket[];
}

interface FDRunner {
  selectionId: number;
  runnerName: string;
  winRunnerOdds?: {
    americanDisplayOdds?: { americanOdds: string };
    trueOdds?: number;
  };
  handicap?: number;
  status?: string;
}

interface FDMarket {
  marketId: string;
  marketName: string;
  marketType?: string;
  runners: FDRunner[];
  status?: string;
  inPlay?: boolean;
}

interface FDEvent {
  eventId: number;
  name: string;
  openDate: string;
  competitionName?: string;
  tabs?: FDTab[];
  markets?: FDMarket[];
}

interface FDCompetition {
  competitionId: number;
  name: string;
  events: FDEvent[];
}

interface FDSportsResponse {
  competitions?: FDCompetition[];
  attachments?: {
    competitions?: Record<string, FDCompetition>;
    events?: Record<string, FDEvent>;
    markets?: Record<string, FDMarket>;
  };
}

// FanDuel event type IDs — regular markets
const SPORT_CONFIGS = [
  { eventTypeId: 6423,  sport: 'football'   as SportCategory, isFutures: false },
  { eventTypeId: 7522,  sport: 'basketball' as SportCategory, isFutures: false },
  { eventTypeId: 7511,  sport: 'baseball'   as SportCategory, isFutures: false },
  { eventTypeId: 7524,  sport: 'hockey'     as SportCategory, isFutures: false },
  { eventTypeId: 7523,  sport: 'soccer'     as SportCategory, isFutures: false },
  // Futures / outrights
  { eventTypeId: 30226, sport: 'football'   as SportCategory, isFutures: true },
  { eventTypeId: 30001, sport: 'basketball' as SportCategory, isFutures: true },
  { eventTypeId: 30005, sport: 'baseball'   as SportCategory, isFutures: true },
  { eventTypeId: 30003, sport: 'hockey'     as SportCategory, isFutures: true },
];

export class FanDuelAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'fanduel';
  readonly displayName = 'FanDuel';
  protected readonly rateLimitPerMinute = 15;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    for (const sportConfig of SPORT_CONFIGS) {
      try {
        const url = `${BASE_URL}/content-managed-page?page=CUSTOM&customPageId=${sportConfig.eventTypeId}&_ak=FhMFpcPWXMeyZxOx&timezone=America%2FNew_York`;
        const response = await this.fetchWithProxy<FDSportsResponse>(url, {
          headers: {
            Referer: 'https://sportsbook.fanduel.com/',
            'x-fanduel-request': 'true',
          },
        });

        const parsed = this.parseResponse(response, sportConfig.sport, sportConfig.isFutures);
        markets.push(...parsed);
      } catch (err) {
        logger.warn(`[fanduel] Failed to fetch sport ${sportConfig.eventTypeId}: ${(err as Error).message}`);
      }
    }

    logger.info(`[fanduel] Fetched ${markets.length} markets`);
    return markets;
  }

  private parseResponse(response: FDSportsResponse, sport: SportCategory, isFutures: boolean): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    if (!response) return markets;

    // Try attachments format
    if (response.attachments?.events) {
      const events = Object.values(response.attachments.events);
      for (const event of events) {
        markets.push(...this.extractMarketsFromEvent(event, sport, isFutures));
      }
      return markets;
    }

    // Try competitions format
    if (response.competitions) {
      for (const comp of response.competitions) {
        for (const event of comp.events ?? []) {
          markets.push(...this.extractMarketsFromEvent(event, sport, isFutures));
        }
      }
    }

    return markets;
  }

  private extractMarketsFromEvent(
    event: FDEvent,
    sport: SportCategory,
    isFutures: boolean
  ): UnifiedMarket[] {
    const results: UnifiedMarket[] = [];
    const allMarkets: FDMarket[] = [];

    if (event.markets) allMarkets.push(...event.markets);
    if (event.tabs) {
      for (const tab of event.tabs) {
        if (tab.markets) allMarkets.push(...tab.markets);
      }
    }

    for (const market of allMarkets) {
      if (market.status === 'CLOSED' || market.status === 'SUSPENDED') continue;
      if (!market.runners || market.runners.length < 2) continue;

      const marketType = isFutures ? 'futures' : this.inferMarketType(market.marketName);
      const outcomes: MarketOutcome[] = [];

      for (const runner of market.runners) {
        if (runner.status === 'REMOVED' || runner.status === 'LOSER') continue;
        const americanStr = runner.winRunnerOdds?.americanDisplayOdds?.americanOdds;
        if (!americanStr) continue;

        const american = parseInt(americanStr.replace('+', ''), 10);
        if (isNaN(american)) continue;

        const { decimal, implied } = this.parseAmericanOdds(american);
        const label = runner.handicap != null
          ? `${runner.runnerName} ${runner.handicap > 0 ? '+' : ''}${runner.handicap}`
          : runner.runnerName;

        outcomes.push({
          outcome: label,
          bookmaker: this.slug,
          decimalOdds: decimal,
          americanOdds: american,
          impliedProbability: implied,
          betUrl: `https://sportsbook.fanduel.com/event/${event.eventId}`,
        });
      }

      if (outcomes.length >= 2) {
        results.push({
          id: `fanduel:${event.eventId}:${market.marketId}`,
          eventName: event.name,
          sport,
          marketType,
          league: event.competitionName ?? undefined,
          startTime: new Date(event.openDate),
          outcomes,
          normalizedKey: this.buildNormalizedKey(event.name, marketType, event.openDate),
        });
      }
    }

    return results;
  }

  private inferMarketType(name: string): MarketType {
    const n = name.toLowerCase();
    if (
      n.includes('futures') || n.includes('outright') || n.includes('to win') ||
      n.includes('championship') || n.includes('champion') || n.includes('super bowl') ||
      n.includes('world series') || n.includes('stanley cup') || n.includes('nba finals') ||
      n.includes('season winner') || n.includes('league winner')
    ) return 'futures';
    if (n.includes('spread') || n.includes('handicap')) return 'spread';
    if (n.includes('total') || n.includes('over') || n.includes('under')) return 'total';
    if (n.includes('moneyline') || n.includes('money line')) return 'moneyline';
    if (n.includes('prop') || n.includes('player')) return 'prop';
    return 'moneyline';
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType, startDate: string): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = startDate.split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
