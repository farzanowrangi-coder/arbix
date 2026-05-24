import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const EVENTS_BASE = 'https://sportsbook.draftkings.com/api/odds/v1/leagues';

interface DKOffer {
  id: string;
  label: string;
  isSuspended: boolean;
  outcomes: DKOutcome[];
}

interface DKOutcome {
  id: string;
  label: string;
  oddsAmerican: string;
  oddsDecimal: number;
  line?: number;
  isSuspended?: boolean;
}

interface DKCategory {
  id: number;
  name: string;
  subCategories: DKSubCategory[];
}

interface DKSubCategory {
  id: number;
  name: string;
  events: DKEvent[];
}

interface DKEvent {
  id: number;
  name: string;
  startDate: string;
  teamList?: Array<{ id: number; name: string; city?: string }>;
  offers: DKOffer[];
}

interface DKLeagueResponse {
  eventGroup?: {
    id: number;
    name: string;
    offerCategories: DKCategory[];
    events?: DKEvent[];
  };
}

// DraftKings league IDs for major sports — regular markets
const LEAGUE_CONFIGS = [
  { leagueId: 88808, categoryId: 583, subcategoryId: 4517, sport: 'football' as SportCategory, name: 'NFL' },
  { leagueId: 42648, categoryId: 583, subcategoryId: 4517, sport: 'basketball' as SportCategory, name: 'NBA' },
  { leagueId: 84240, categoryId: 583, subcategoryId: 4517, sport: 'baseball' as SportCategory, name: 'MLB' },
  { leagueId: 42133, categoryId: 583, subcategoryId: 4517, sport: 'hockey' as SportCategory, name: 'NHL' },
];

// DraftKings futures / championship winner markets
const FUTURES_CONFIGS = [
  { leagueId: 88808, categoryId: 1200, subcategoryId: 6003, sport: 'football' as SportCategory, name: 'NFL Super Bowl' },
  { leagueId: 42648, categoryId: 1000, subcategoryId: 1269, sport: 'basketball' as SportCategory, name: 'NBA Championship' },
  { leagueId: 84240, categoryId: 1400, subcategoryId: 6003, sport: 'baseball' as SportCategory, name: 'MLB World Series' },
  { leagueId: 42133, categoryId: 1000, subcategoryId: 6003, sport: 'hockey' as SportCategory, name: 'NHL Stanley Cup' },
];

export class DraftKingsAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'draftkings';
  readonly displayName = 'DraftKings';
  protected readonly rateLimitPerMinute = 15;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    const allConfigs = [
      ...LEAGUE_CONFIGS.map((c) => ({ ...c, marketType: undefined })),
      ...FUTURES_CONFIGS.map((c) => ({ ...c, marketType: 'futures' as MarketType })),
    ];

    for (const leagueConfig of allConfigs) {
      try {
        const url = `${EVENTS_BASE}/${leagueConfig.leagueId}/categories/${leagueConfig.categoryId}/subcategories/${leagueConfig.subcategoryId}`;
        const response = await this.fetchWithProxy<DKLeagueResponse>(url, {
          headers: {
            Referer: 'https://sportsbook.draftkings.com/',
            'x-requested-with': 'XMLHttpRequest',
          },
        });

        const parsed = this.parseLeagueResponse(
          response,
          leagueConfig.sport,
          leagueConfig.name,
          leagueConfig.marketType
        );
        markets.push(...parsed);
      } catch (err) {
        logger.warn(`[draftkings] Failed to fetch ${leagueConfig.name}: ${(err as Error).message}`);
      }
    }

    logger.info(`[draftkings] Fetched ${markets.length} markets`);
    return markets;
  }

  private parseLeagueResponse(
    response: DKLeagueResponse,
    sport: SportCategory,
    leagueName: string,
    forceMarketType?: MarketType
  ): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    const eventGroup = response?.eventGroup;
    if (!eventGroup) return markets;

    const allEvents = this.extractEvents(eventGroup);

    for (const event of allEvents) {
      if (!event.offers || event.offers.length === 0) continue;

      for (const offer of event.offers) {
        if (offer.isSuspended) continue;
        if (!offer.outcomes || offer.outcomes.length < 2) continue;

        const marketType = forceMarketType ?? this.inferMarketType(offer.label);
        const outcomes: MarketOutcome[] = [];

        for (const outcome of offer.outcomes) {
          if (outcome.isSuspended) continue;
          if (!outcome.oddsAmerican || outcome.oddsAmerican === 'N/A') continue;

          const american = parseInt(outcome.oddsAmerican.replace('+', ''), 10);
          if (isNaN(american)) continue;

          const { decimal, implied } = this.parseAmericanOdds(american);
          const label = outcome.line != null
            ? `${outcome.label} ${outcome.line > 0 ? '+' : ''}${outcome.line}`
            : outcome.label;

          outcomes.push({
            outcome: label,
            bookmaker: this.slug,
            decimalOdds: decimal,
            americanOdds: american,
            impliedProbability: implied,
            betUrl: `https://sportsbook.draftkings.com/event/${event.id}`,
          });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `draftkings:${event.id}:${offer.id}`,
            eventName: event.name,
            sport,
            marketType,
            league: leagueName,
            startTime: new Date(event.startDate),
            outcomes,
            normalizedKey: this.buildNormalizedKey(event.name, marketType, event.startDate),
          });
        }
      }
    }

    return markets;
  }

  private extractEvents(eventGroup: DKLeagueResponse['eventGroup']): DKEvent[] {
    if (!eventGroup) return [];
    const events: DKEvent[] = [];

    if (eventGroup.events) {
      events.push(...eventGroup.events);
    }

    for (const category of eventGroup.offerCategories ?? []) {
      for (const subcat of category.subCategories ?? []) {
        events.push(...(subcat.events ?? []));
      }
    }

    // Deduplicate by id
    const seen = new Set<number>();
    return events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  private inferMarketType(label: string): MarketType {
    const l = label.toLowerCase();
    if (
      l.includes('futures') || l.includes('outright') || l.includes('to win') ||
      l.includes('championship') || l.includes('champion') || l.includes('super bowl') ||
      l.includes('world series') || l.includes('stanley cup') || l.includes('nba finals') ||
      l.includes('season winner') || l.includes('league winner')
    ) return 'futures';
    if (l.includes('spread') || l.includes('handicap') || l.includes('point spread')) return 'spread';
    if (l.includes('total') || l.includes('over') || l.includes('under') || l.includes('ou')) return 'total';
    if (l.includes('moneyline') || l.includes('money line') || l.includes('ml')) return 'moneyline';
    if (l.includes('prop') || l.includes('player')) return 'prop';
    return 'moneyline';
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType, startDate: string): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = startDate.split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
