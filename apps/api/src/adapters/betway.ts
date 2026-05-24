import { chromium, Browser, Page } from 'playwright';
import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const BASE_URL = 'https://betway.com';

const SPORT_PAGES: Array<{ path: string; sport: SportCategory; futuresPath?: string }> = [
  {
    path: '/en/sports/american-football/',
    sport: 'football',
    futuresPath: '/en/sports/american-football/nfl/winner/',
  },
  {
    path: '/en/sports/basketball/',
    sport: 'basketball',
    futuresPath: '/en/sports/basketball/nba/winner/',
  },
  {
    path: '/en/sports/baseball/',
    sport: 'baseball',
    futuresPath: '/en/sports/baseball/mlb/winner/',
  },
  {
    path: '/en/sports/ice-hockey/',
    sport: 'hockey',
    futuresPath: '/en/sports/ice-hockey/nhl/winner/',
  },
  { path: '/en/sports/football/', sport: 'soccer' },
  { path: '/en/sports/tennis/',   sport: 'tennis' },
  { path: '/en/sports/mma/',      sport: 'mma' },
];

interface ScrapedEvent {
  name: string;
  league: string;
  startTime: string;
  markets: Array<{
    name: string;
    selections: Array<{ name: string; odds: string }>;
  }>;
}

export class BetwayAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'betway';
  readonly displayName = 'Betway';
  protected readonly rateLimitPerMinute = 3;

  private browser: Browser | null = null;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });

      for (const sportConfig of SPORT_PAGES.slice(0, 3)) {
        try {
          const events = await this.scrapePage(sportConfig.path, sportConfig.sport, false);
          markets.push(...events);

          if (sportConfig.futuresPath) {
            const futures = await this.scrapePage(sportConfig.futuresPath, sportConfig.sport, true);
            markets.push(...futures);
          }
        } catch (err) {
          logger.warn(`[betway] Failed to scrape ${sportConfig.path}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.warn(`[betway] Browser launch failed: ${(err as Error).message}`);
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    }

    logger.info(`[betway] Fetched ${markets.length} markets`);
    return markets;
  }

  private async scrapePage(path: string, sport: SportCategory, isFutures: boolean): Promise<UnifiedMarket[]> {
    if (!this.browser) return [];
    const page = await this.browser.newPage();

    try {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${BASE_URL}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      await page.waitForSelector(
        '[class*="event"], [class*="match"], [class*="fixture"], [class*="market"]',
        { timeout: 8000 }
      ).catch(() => {});

      await page.waitForTimeout(1500 + Math.random() * 1500);

      const events = await this.extractOdds(page, isFutures);
      return this.parseEvents(events, sport, isFutures);
    } catch (err) {
      logger.warn(`[betway] Scraping error for ${path}: ${(err as Error).message}`);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  private async extractOdds(page: Page, isFutures: boolean): Promise<ScrapedEvent[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (page as any).evaluate((isFut: boolean): ScrapedEvent[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = (globalThis as any).document;
      const results: ScrapedEvent[] = [];

      const eventContainers = doc.querySelectorAll(
        '[class*="EventCard"], [class*="event-card"], [class*="MatchRow"], [class*="match-row"], [class*="OutrightEvent"], [class*="CompetitorEvent"]'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventContainers.forEach((container: any) => {
        const participantEls = container.querySelectorAll(
          '[class*="Participant"], [class*="participant"], [class*="competitor"], [class*="team-name"], [class*="TeamName"]'
        );
        const participants: string[] = [];
        participantEls.forEach((el: any) => {
          const t = el.textContent?.trim();
          if (t && t.length > 1 && t.length < 60) participants.push(t);
        });

        const nameEl = container.querySelector('[class*="event-name"], [class*="EventName"], [class*="title"], h3, h4');
        const eventName = isFut
          ? (nameEl?.textContent?.trim() ?? participants.join(' vs '))
          : participants.length >= 2
            ? `${participants[0]} vs ${participants[1]}`
            : nameEl?.textContent?.trim() ?? '';
        if (!eventName) return;

        const timeEl = container.querySelector('time, [class*="time"], [class*="Time"], [class*="date"]');
        const startTime = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? new Date().toISOString();

        const leagueEl = container.querySelector('[class*="league"], [class*="competition"], [class*="category"]');
        const league = leagueEl?.textContent?.trim() ?? '';

        const priceContainers = container.querySelectorAll(
          '[class*="Price"], [class*="Odds"], [class*="odd"], [class*="Selection"], [class*="Button"][class*="market"]'
        );

        const selections: Array<{ name: string; odds: string }> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priceContainers.forEach((pc: any, i: number) => {
          const oddsEl = pc.querySelector('[class*="price"], [class*="odds"], [class*="value"]') ?? pc;
          const oddsText = oddsEl?.textContent?.trim() ?? '';
          if (!oddsText) return;

          // Betway uses fractional (9/10) or decimal (1.91) odds
          const isFractional = /^\d+\/\d+$/.test(oddsText);
          const isDecimal = !isNaN(parseFloat(oddsText)) && parseFloat(oddsText) > 1;
          if (!isFractional && !isDecimal) return;

          const labelEl = pc.querySelector('[class*="label"], [class*="name"], [class*="selection-name"]');
          const name = labelEl?.textContent?.trim() ||
            (i === 0 ? participants[0] : i === 1 ? participants[1] : 'Draw') ||
            `Selection ${i + 1}`;

          selections.push({ name, odds: oddsText });
        });

        if (selections.length >= 2) {
          results.push({
            name: eventName,
            league,
            startTime,
            markets: [{ name: isFut ? 'Outright Winner' : 'Match Result', selections }],
          });
        }
      });

      return results;
    }, isFutures);
  }

  private parseEvents(events: ScrapedEvent[], sport: SportCategory, isFutures: boolean): UnifiedMarket[] {
    const markets: UnifiedMarket[] = [];
    const defaultMarketType: MarketType = isFutures ? 'futures' : 'moneyline';

    for (const event of events) {
      for (const market of event.markets) {
        const marketType = this.inferMarketType(market.name, defaultMarketType);
        const outcomes: MarketOutcome[] = [];

        for (const sel of market.selections) {
          const decimal = this.parseOdds(sel.odds);
          if (decimal === null || decimal <= 1) continue;

          outcomes.push({
            outcome: sel.name,
            bookmaker: this.slug,
            decimalOdds: decimal,
            americanOdds: this.decimalToAmerican(decimal),
            impliedProbability: Math.round((1 / decimal) * 10000) / 10000,
            betUrl: `${BASE_URL}/en/sports`,
          });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `betway:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            eventName: event.name,
            sport,
            marketType,
            league: event.league || undefined,
            startTime: this.parseDate(event.startTime),
            outcomes,
            normalizedKey: this.buildNormalizedKey(event.name, marketType),
          });
        }
      }
    }

    return markets;
  }

  private parseOdds(odds: string): number | null {
    // Fractional: "9/10", "5/4"
    const frac = odds.match(/^(\d+)\/(\d+)$/);
    if (frac && frac[1] && frac[2]) {
      const num = parseInt(frac[1], 10);
      const den = parseInt(frac[2], 10);
      if (den > 0) return Math.round((1 + num / den) * 10000) / 10000;
    }
    // Decimal: "1.91"
    const dec = parseFloat(odds);
    if (!isNaN(dec) && dec > 1 && dec < 1000) return Math.round(dec * 10000) / 10000;
    return null;
  }

  private inferMarketType(name: string, defaultType: MarketType): MarketType {
    const n = name.toLowerCase();
    if (
      n.includes('outright') || n.includes('futures') || n.includes('to win') ||
      n.includes('winner') || n.includes('championship') || n.includes('champion') ||
      n.includes('super bowl') || n.includes('world series') || n.includes('stanley cup') ||
      n.includes('nba finals') || n.includes('season winner')
    ) return 'futures';
    if (n.includes('spread') || n.includes('handicap') || n.includes('asian')) return 'spread';
    if (n.includes('total') || n.includes('goals') || n.includes('over') || n.includes('under')) return 'total';
    if (n.includes('1x2') || n.includes('match result') || n.includes('moneyline') || n.includes('match winner')) return 'moneyline';
    return defaultType;
  }

  private parseDate(str: string): Date | undefined {
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d;
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
