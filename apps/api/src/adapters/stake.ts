import { chromium, Browser, Page } from 'playwright';
import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const BASE_URL = 'https://stake.com';

const SPORT_PAGES: Array<{ slug: string; sport: SportCategory; futuresSlug?: string }> = [
  { slug: 'american-football', sport: 'football',   futuresSlug: 'american-football/nfl/nfl-25-26' },
  { slug: 'basketball',        sport: 'basketball',  futuresSlug: 'basketball/nba/nba-25-26' },
  { slug: 'baseball',          sport: 'baseball',    futuresSlug: 'baseball/mlb/mlb-2026' },
  { slug: 'ice-hockey',        sport: 'hockey',      futuresSlug: 'ice-hockey/nhl/nhl-25-26' },
  { slug: 'soccer',            sport: 'soccer' },
  { slug: 'tennis',            sport: 'tennis' },
  { slug: 'mma',               sport: 'mma' },
];

interface ScrapedEvent {
  name: string;
  league: string;
  startTime: string;
  isFutures: boolean;
  markets: Array<{
    name: string;
    selections: Array<{ name: string; odds: string }>;
  }>;
}

export class StakeAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'stake';
  readonly displayName = 'Stake';
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
          const events = await this.scrapeSportPage(
            `/sports/${sportConfig.slug}`,
            sportConfig.sport,
            false
          );
          markets.push(...events);

          if (sportConfig.futuresSlug) {
            const futures = await this.scrapeSportPage(
              `/sports/${sportConfig.futuresSlug}`,
              sportConfig.sport,
              true
            );
            markets.push(...futures);
          }
        } catch (err) {
          logger.warn(`[stake] Failed to scrape ${sportConfig.slug}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.warn(`[stake] Browser launch failed: ${(err as Error).message}`);
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    }

    logger.info(`[stake] Fetched ${markets.length} markets`);
    return markets;
  }

  private async scrapeSportPage(path: string, sport: SportCategory, isFutures: boolean): Promise<UnifiedMarket[]> {
    if (!this.browser) return [];
    const page = await this.browser.newPage();
    const markets: UnifiedMarket[] = [];

    try {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${BASE_URL}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Wait for sport event cards to render
      await page.waitForSelector(
        '[class*="event"], [class*="match"], [class*="fixture"], [data-testid*="event"]',
        { timeout: 8000 }
      ).catch(() => {});

      await page.waitForTimeout(1500 + Math.random() * 1500);

      const events = await this.extractOdds(page, isFutures);
      return this.parseEvents(events, sport, isFutures);
    } catch (err) {
      logger.warn(`[stake] Scraping error for ${path}: ${(err as Error).message}`);
      return markets;
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

      const eventCards = doc.querySelectorAll(
        '[class*="SportEvent"], [class*="sport-event"], [class*="EventCard"], [class*="MatchCard"], [class*="event-card"]'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventCards.forEach((card: any) => {
        const nameEls = card.querySelectorAll('[class*="Participant"], [class*="participant"], [class*="team"], [class*="Team"]');
        const names: string[] = [];
        nameEls.forEach((el: any) => {
          const t = el.textContent?.trim();
          if (t && t.length > 1 && t.length < 60) names.push(t);
        });

        if (names.length < 2 && !isFut) return;

        const eventName = isFut
          ? (card.querySelector('[class*="name"], [class*="title"]')?.textContent?.trim() ?? '')
          : `${names[0]} vs ${names[1]}`;
        if (!eventName) return;

        const timeEl = card.querySelector('[class*="time"], [class*="Time"], [class*="date"], time');
        const startTime = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? new Date().toISOString();

        const leagueEl = card.querySelector('[class*="league"], [class*="League"], [class*="competition"], [class*="tournament"]');
        const league = leagueEl?.textContent?.trim() ?? '';

        const oddsEls = card.querySelectorAll('[class*="Odd"], [class*="odd"], [class*="Price"], [class*="price"], [class*="outcome"]');
        const selections: Array<{ name: string; odds: string }> = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oddsEls.forEach((el: any, i: number) => {
          const odds = el.textContent?.trim() ?? '';
          if (!odds || isNaN(parseFloat(odds))) return;
          const labelEl = el.closest('[class*="Selection"], [class*="selection"], [class*="button"]')
            ?.querySelector('[class*="label"], [class*="name"], span:first-child');
          const name = labelEl?.textContent?.trim() || (i === 0 ? names[0] : i === 1 ? names[1] : 'Draw') || `Selection ${i + 1}`;
          selections.push({ name, odds });
        });

        if (selections.length >= 2) {
          results.push({
            name: eventName,
            league,
            startTime,
            isFutures: isFut,
            markets: [{ name: isFut ? 'To Win' : 'Match Winner', selections }],
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
          const decimal = parseFloat(sel.odds);
          if (isNaN(decimal) || decimal <= 1) continue;

          outcomes.push({
            outcome: sel.name,
            bookmaker: this.slug,
            decimalOdds: decimal,
            americanOdds: this.decimalToAmerican(decimal),
            impliedProbability: Math.round((1 / decimal) * 10000) / 10000,
            betUrl: `${BASE_URL}/sports`,
          });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `stake:${Date.now()}:${Math.random().toString(36).slice(2)}`,
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

  private inferMarketType(name: string, defaultType: MarketType): MarketType {
    const n = name.toLowerCase();
    if (
      n.includes('futures') || n.includes('outright') || n.includes('to win') ||
      n.includes('winner') || n.includes('championship') || n.includes('champion') ||
      n.includes('super bowl') || n.includes('world series') || n.includes('stanley cup') ||
      n.includes('nba finals') || n.includes('season winner')
    ) return 'futures';
    if (n.includes('spread') || n.includes('handicap')) return 'spread';
    if (n.includes('total') || n.includes('over') || n.includes('under')) return 'total';
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
