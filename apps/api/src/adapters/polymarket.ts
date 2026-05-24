import { UnifiedMarket, MarketOutcome, BookmakerSlug, SportCategory, MarketType } from '@arbix/shared';
import { BaseAdapter } from './base';
import { logger } from '../logger';

const CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';

// ─── Championship key resolution ─────────────────────────────────────────────

interface ChampionshipDef {
  key: string;
  sport: SportCategory;
}

const CHAMPIONSHIP_PATTERNS: Array<{ regex: RegExp } & ChampionshipDef> = [
  { regex: /nhl stanley cup/i,                    key: 'nhl_stanley_cup',   sport: 'hockey' },
  { regex: /nba finals/i,                          key: 'nba_finals',        sport: 'basketball' },
  { regex: /nfl super bowl|super bowl/i,           key: 'nfl_super_bowl',    sport: 'football' },
  { regex: /mlb world series|world series/i,       key: 'mlb_world_series',  sport: 'baseball' },
  { regex: /fifa world cup/i,                      key: 'fifa_world_cup',    sport: 'soccer' },
  { regex: /uefa champions league/i,               key: 'ucl',               sport: 'soccer' },
  { regex: /nhl playoffs/i,                        key: 'nhl_stanley_cup',   sport: 'hockey' },
];

// "Will [the] Team Name win [the] Year Championship?"
const WILL_WIN_RE = /^Will (?:the )?(.+?) win (?:the )?(\d{4}) (.+?)[\?]?$/i;

function resolveChampionship(champStr: string, year: string): (ChampionshipDef & { year: string }) | null {
  for (const def of CHAMPIONSHIP_PATTERNS) {
    if (def.regex.test(champStr)) {
      return { key: `${def.key}_${year}`, sport: def.sport, year };
    }
  }
  return null;
}

function teamSlug(name: string): string {
  return name.toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Gamma API types ──────────────────────────────────────────────────────────

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug?: string;
  outcomes: string;       // JSON: ["Yes","No"] or team names
  outcomePrices: string;  // JSON: ["0.40","0.60"]
  endDateIso?: string;
  active: boolean;
  closed: boolean;
  volume24hrClob?: number;
  liquidityClob?: number;
  clobTokenIds?: string[];
}

// ─── CLOB API types ───────────────────────────────────────────────────────────

interface ClobToken {
  token_id: string;
  outcome: string;
  price: number;
  winner?: boolean;
}

interface ClobMarket {
  condition_id: string;
  question_id: string;
  question: string;
  market_slug?: string;
  category?: string;
  active: boolean;
  closed: boolean;
  end_date_iso?: string;
  tokens: ClobToken[];
  volume_24hr?: number;
}

interface ClobMarketsResponse {
  data: ClobMarket[];
  next_cursor?: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class PolymarketAdapter extends BaseAdapter {
  readonly slug: BookmakerSlug = 'polymarket';
  readonly displayName = 'Polymarket';
  protected readonly rateLimitPerMinute = 60;

  private cache: { data: UnifiedMarket[]; expiresAt: number } | null = null;
  private fetchPromise: Promise<UnifiedMarket[]> | null = null;

  async fetchMarkets(): Promise<UnifiedMarket[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.data;
    }
    // Prevent stampede: if a fetch is already in progress, wait for it
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = this.doFetch().finally(() => { this.fetchPromise = null; });
    return this.fetchPromise;
  }

  private async doFetch(): Promise<UnifiedMarket[]> {
    const markets = await this.fetchChampionshipFutures();
    logger.info(`[polymarket] ${markets.length} championship futures markets`);
    this.cache = { data: markets, expiresAt: Date.now() + CACHE_TTL_MS };
    return markets;
  }

  // ─── Championship futures from Gamma API ─────────────────────────────────

  private async fetchChampionshipFutures(): Promise<UnifiedMarket[]> {
    // Gamma API caps at 100 per page — fetch first 3 pages; sports championships are front-loaded
    const pages: GammaMarket[][] = [];
    for (const offset of [0, 100, 200]) {
      try {
        const url = `${GAMMA_URL}/markets?active=true&closed=false&limit=100&offset=${offset}`;
        const raw = await this.fetchWithRetry<GammaMarket[]>(url);
        if (Array.isArray(raw) && raw.length > 0) pages.push(raw);
        if (!Array.isArray(raw) || raw.length < 100) break; // last page
      } catch {
        break;
      }
    }
    const raw = pages.flat();
    if (!raw.length) return [];

    const markets: UnifiedMarket[] = [];

    for (const m of raw) {
      if (!m.active || m.closed) continue;

      const match = WILL_WIN_RE.exec(m.question);
      if (!match) continue;

      const [, teamRaw, year, champRaw] = match;
      const team = teamRaw.trim();
      const champ = resolveChampionship(champRaw.trim(), year);
      if (!champ) continue;

      let outcomes: string[];
      let prices: string[];
      try {
        outcomes = JSON.parse(m.outcomes);
        prices = JSON.parse(m.outcomePrices);
      } catch {
        continue;
      }

      if (outcomes.length < 2 || prices.length < 2) continue;

      // Polymarket YES/NO is always index 0=Yes, 1=No
      const yesPrice = parseFloat(prices[0]);
      const noPrice = parseFloat(prices[1]);
      if (!yesPrice || !noPrice || yesPrice <= 0.01 || noPrice <= 0.01) continue;

      const yesDecimal = Math.round((1 / yesPrice) * 10000) / 10000;
      const noDecimal  = Math.round((1 / noPrice)  * 10000) / 10000;
      const betUrl = m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com';
      const normalizedKey = `${teamSlug(team)}:futures:${champ.key}`;

      markets.push({
        id: `polymarket:futures:${m.conditionId}`,
        eventName: `${team} — ${champRaw.trim()} ${year}`,
        sport: champ.sport,
        marketType: 'futures',
        league: champRaw.trim(),
        startTime: m.endDateIso ? new Date(m.endDateIso) : undefined,
        normalizedKey,
        outcomes: [
          {
            // YES side — represents "team wins the championship"
            outcome: team,
            bookmaker: this.slug,
            decimalOdds: yesDecimal,
            americanOdds: this.decimalToAmerican(yesDecimal),
            impliedProbability: Math.round(yesPrice * 10000) / 10000,
            betUrl,
            liquidity: m.liquidityClob ?? m.volume24hrClob,
          },
          {
            // NO side — represents "team does NOT win the championship"
            // Paired with a sportsbook YES on the same team this creates cross-book arb.
            outcome: `NOT:${team}`,
            bookmaker: this.slug,
            decimalOdds: noDecimal,
            americanOdds: this.decimalToAmerican(noDecimal),
            impliedProbability: Math.round(noPrice * 10000) / 10000,
            betUrl,
            liquidity: m.liquidityClob ?? m.volume24hrClob,
          },
        ],
      });
    }

    logger.debug(`[polymarket] ${markets.length} championship futures parsed`);
    return markets;
  }

  // ─── Game-level markets from CLOB API ────────────────────────────────────

  private async fetchGameMarkets(): Promise<UnifiedMarket[]> {
    const markets: UnifiedMarket[] = [];
    let cursor: string | undefined;

    try {
      do {
        const url = cursor
          ? `${CLOB_URL}/markets?next_cursor=${encodeURIComponent(cursor)}&active=true&closed=false&limit=100`
          : `${CLOB_URL}/markets?active=true&closed=false&limit=100`;

        const resp = await this.fetchWithRetry<ClobMarketsResponse>(url);
        if (!resp?.data || !Array.isArray(resp.data)) break;

        for (const m of resp.data) {
          const unified = this.parseClobGameMarket(m);
          if (unified) markets.push(unified);
        }

        cursor = resp.next_cursor && resp.next_cursor !== '0' ? resp.next_cursor : undefined;
      } while (cursor && markets.length < 500);
    } catch (err) {
      logger.warn(`[polymarket] CLOB fetch failed: ${(err as Error).message}`);
    }

    return markets;
  }

  private parseClobGameMarket(market: ClobMarket): UnifiedMarket | null {
    if (!market.active || market.closed) return null;
    if (!market.tokens || market.tokens.length < 2) return null;

    // Skip championship futures (handled via Gamma API above)
    if (WILL_WIN_RE.test(market.question)) return null;

    const outcomes: MarketOutcome[] = [];

    for (const token of market.tokens) {
      if (!token.outcome || token.price == null) continue;
      const price = Math.max(0.001, Math.min(0.999, token.price));
      const decimalOdds = this.probabilityToDecimal(price);
      outcomes.push({
        outcome: token.outcome,
        bookmaker: this.slug,
        decimalOdds,
        americanOdds: this.decimalToAmerican(decimalOdds),
        impliedProbability: price,
        betUrl: market.market_slug
          ? `https://polymarket.com/event/${market.market_slug}`
          : undefined,
        liquidity: market.volume_24hr,
      });
    }

    if (outcomes.length < 2) return null;

    const sport = this.categorizeMarket(market.category ?? '');
    const marketType: MarketType = this.guessMarketType(market.question);

    return {
      id: market.condition_id,
      eventName: market.question,
      sport,
      marketType,
      league: market.category ?? undefined,
      startTime: market.end_date_iso ? new Date(market.end_date_iso) : undefined,
      outcomes,
      normalizedKey: `polymarket:${market.condition_id}`,
    };
  }

  private guessMarketType(question: string): MarketType {
    const q = question.toLowerCase();
    if (q.includes('spread') || q.includes('cover')) return 'spread';
    if (q.includes('over') || q.includes('under') || q.includes('total')) return 'total';
    if (q.includes('win') || q.includes('beat') || q.includes('defeat')) return 'moneyline';
    return 'yes_no';
  }

  private categorizeMarket(category: string): SportCategory {
    const cat = category.toLowerCase();
    if (cat.includes('football') || cat.includes('nfl') || cat.includes('soccer')) return 'football';
    if (cat.includes('basketball') || cat.includes('nba')) return 'basketball';
    if (cat.includes('baseball') || cat.includes('mlb')) return 'baseball';
    if (cat.includes('hockey') || cat.includes('nhl')) return 'hockey';
    if (cat.includes('tennis')) return 'tennis';
    if (cat.includes('mma') || cat.includes('ufc')) return 'mma';
    if (cat.includes('boxing')) return 'boxing';
    if (cat.includes('golf')) return 'golf';
    if (cat.includes('politic') || cat.includes('election')) return 'politics';
    if (cat.includes('crypto') || cat.includes('bitcoin') || cat.includes('eth')) return 'crypto';
    return 'other';
  }
}
