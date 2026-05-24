import { chromium, Browser, Page } from 'playwright';
import { UnifiedMarket, MarketOutcome, BookmakerSlug, MarketType, SportCategory } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const BET365_BASE = 'https://www.bet365.com';

interface ScrapedOdds {
  eventName: string;
  league: string;
  startTime: string;
  markets: Array<{
    type: string;
    selections: Array<{ name: string; odds: string }>;
  }>;
}

const SPORT_PAGES: Array<{ path: string; sport: SportCategory }> = [
  { path: '#/AC/B1/C1/D8/F2/', sport: 'football' },
  { path: '#/AC/B2/C1/D13/F2/', sport: 'basketball' },
  { path: '#/AC/B3/C1/D8/F2/', sport: 'baseball' },
  { path: '#/AC/B4/C1/D48/F2/', sport: 'hockey' },
  { path: '#/AC/B151/C1/D10/F2/', sport: 'soccer' },
];

export class Bet365Adapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'bet365';
  readonly displayName = 'Bet365';
  protected readonly rateLimitPerMinute = 3; // Very conservative to avoid bans

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
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });

      for (const sportConfig of SPORT_PAGES.slice(0, 2)) {
        // Limit to 2 sports to avoid detection
        try {
          const sportMarkets = await this.scrapeSport(sportConfig.path, sportConfig.sport);
          markets.push(...sportMarkets);
        } catch (err) {
          logger.warn(`[bet365] Failed to scrape sport ${sportConfig.sport}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.warn(`[bet365] Browser launch failed: ${(err as Error).message}`);
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    }

    logger.info(`[bet365] Fetched ${markets.length} markets`);
    return markets;
  }

  private async scrapeSport(path: string, sport: SportCategory): Promise<UnifiedMarket[]> {
    if (!this.browser) return [];

    const page = await this.browser.newPage();
    const markets: UnifiedMarket[] = [];

    try {
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });

      await page.setViewportSize({ width: 1920, height: 1080 });

      // Navigate with timeout
      await page.goto(`${BET365_BASE}/${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Wait for odds to load
      await page.waitForSelector('.cl-MarketGroup, .sl-MarketGroup, .gl-MarketGroup', {
        timeout: 10000,
      }).catch(() => {});

      // Add a small random delay to mimic human behavior
      await page.waitForTimeout(1000 + Math.random() * 2000);

      const scrapedData = await this.extractOdds(page, sport);
      markets.push(...scrapedData);
    } catch (err) {
      logger.warn(`[bet365] Scraping error for path ${path}: ${(err as Error).message}`);
    } finally {
      await page.close().catch(() => {});
    }

    return markets;
  }

  private async extractOdds(page: Page, sport: SportCategory): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];

    // page.evaluate runs in browser context — DOM APIs available at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: ScrapedOdds[] = await (page as any).evaluate((): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = (globalThis as any).document;
      const results: ScrapedOdds[] = [];

      // Bet365 uses various class naming conventions; try multiple selectors
      const eventContainers = doc.querySelectorAll(
        '.sl-MarketCoupon, .cl-MarketGroup, .gl-MarketGroup, [class*="MarketGroup"]'
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventContainers.forEach((container: any) => {
        const eventNameEl = container.querySelector(
          '[class*="ParticipantName"], [class*="event-name"], [class*="EventName"]'
        );
        if (!eventNameEl) return;

        const eventName = eventNameEl.textContent?.trim() ?? '';
        if (!eventName) return;

        const timeEl = container.querySelector('[class*="time"], [class*="StartTime"]');
        const startTime = timeEl?.textContent?.trim() ?? new Date().toISOString();

        const leagueEl = container.querySelector('[class*="CompetitionName"], [class*="league"]');
        const league = leagueEl?.textContent?.trim() ?? '';

        const marketData: ScrapedOdds['markets'] = [];
        const marketGroups = container.querySelectorAll('[class*="Market"], [class*="market"]');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        marketGroups.forEach((marketGroup: any) => {
          const marketNameEl = marketGroup.querySelector('[class*="MarketName"], [class*="market-name"]');
          const marketType = marketNameEl?.textContent?.trim() ?? 'Moneyline';

          const selections: Array<{ name: string; odds: string }> = [];
          const oddsEls = marketGroup.querySelectorAll('[class*="Odds"], [class*="Price"], [class*="odds"]');

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          oddsEls.forEach((el: any) => {
            const parentEl = el.closest('[class*="Selection"], [class*="Participant"]');
            const nameEl = parentEl?.querySelector('[class*="Name"], [class*="name"]');
            const name = nameEl?.textContent?.trim() ?? el.getAttribute('data-participant') ?? '';
            const odds = el.textContent?.trim() ?? '';
            if (name && odds) {
              selections.push({ name, odds });
            }
          });

          if (selections.length >= 2) {
            marketData.push({ type: marketType, selections });
          }
        });

        if (marketData.length > 0) {
          results.push({ eventName, league, startTime, markets: marketData });
        }
      });

      return results;
    });

    for (const event of data) {
      for (const market of event.markets) {
        const marketType = this.inferMarketType(market.type);
        const outcomes: MarketOutcome[] = [];

        for (const sel of market.selections) {
          const decimal = this.parseOddsString(sel.odds);
          if (!decimal || decimal <= 1) continue;

          const american = this.decimalToAmerican(decimal);
          const implied = 1 / decimal;

          outcomes.push({
            outcome: sel.name,
            bookmaker: this.slug,
            decimalOdds: decimal,
            americanOdds: american,
            impliedProbability: Math.round(implied * 10000) / 10000,
            betUrl: BET365_BASE,
          });
        }

        if (outcomes.length >= 2) {
          markets.push({
            id: `bet365:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            eventName: event.eventName,
            sport,
            marketType,
            league: event.league ?? undefined,
            startTime: this.parseDate(event.startTime),
            outcomes,
            normalizedKey: this.buildNormalizedKey(event.eventName, marketType),
          });
        }
      }
    }

    return markets;
  }

  private parseOddsString(odds: string): number | null {
    if (!odds) return null;
    const cleaned = odds.trim();

    // Decimal format (e.g., "1.91" or "2.50")
    const decimal = parseFloat(cleaned);
    if (!isNaN(decimal) && decimal > 1 && decimal < 100) {
      return Math.round(decimal * 10000) / 10000;
    }

    // Fractional format (e.g., "9/10" or "5/4")
    const fractionMatch = cleaned.match(/^(\d+)\/(\d+)$/);
    if (fractionMatch && fractionMatch[1] && fractionMatch[2]) {
      const num = parseInt(fractionMatch[1], 10);
      const den = parseInt(fractionMatch[2], 10);
      if (den > 0) return Math.round((1 + num / den) * 10000) / 10000;
    }

    return null;
  }

  private parseDate(dateStr: string): Date | undefined {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
    return undefined;
  }

  private inferMarketType(type: string): MarketType {
    const t = type.toLowerCase();
    if (t.includes('spread') || t.includes('handicap') || t.includes('asian')) return 'spread';
    if (t.includes('total') || t.includes('goals') || t.includes('over') || t.includes('under')) return 'total';
    if (t.includes('1x2') || t.includes('match result') || t.includes('winner')) return 'moneyline';
    return 'moneyline';
  }

  private buildNormalizedKey(eventName: string, marketType: MarketType): string {
    const normalized = eventName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];
    return `${normalized}:${marketType}:${date}`;
  }
}
