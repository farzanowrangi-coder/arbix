/**
 * GamesService — per-bookmaker moneyline odds across multiple sources.
 *
 * Sources (in priority order, all merged per game):
 *   1. Pinnacle guest API — tightest lines, 3-way soccer
 *   2. ESPN scoreboard — DraftKings moneyline (home/away/draw) embedded free
 *   3. The Odds API — when key has quota: FanDuel, BetMGM, Caesars, Bet365, DraftKings…
 *
 * Arb rules:
 *   - 2-way market (NBA/NHL/MLB/Tennis): arb when best home + best away < 100%
 *   - 3-way market (Soccer): arb ONLY when home + draw + away are all present and < 100%
 */

import type { SportCategory } from '@arbix/shared';
import { logger } from '../logger';

const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PINNACLE_HEADERS = {
  'X-Api-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
  Referer: 'https://www.pinnacle.com/',
  Origin: 'https://www.pinnacle.com',
};

// ─── League configs ───────────────────────────────────────────────────────────

interface LeagueCfg {
  id: number;
  sport: SportCategory;
  name: string;
  espnSport: string;
  espnLeague: string;
  oddsApiKey?: string; // The Odds API sport key
  hasDraw?: boolean;   // 3-way market (soccer)
  isTennis?: boolean;  // ESPN uses groupings structure; Pinnacle IDs fetched dynamically
}

const LEAGUES: LeagueCfg[] = [
  { id: 487,  sport: 'basketball', name: 'NBA',         espnSport: 'basketball', espnLeague: 'nba',         oddsApiKey: 'basketball_nba'          },
  { id: 1456, sport: 'hockey',     name: 'NHL',         espnSport: 'hockey',     espnLeague: 'nhl',         oddsApiKey: 'icehockey_nhl'            },
  { id: 246,  sport: 'baseball',   name: 'MLB',         espnSport: 'baseball',   espnLeague: 'mlb',         oddsApiKey: 'baseball_mlb'             },
  { id: 1980, sport: 'soccer',     name: 'EPL',         espnSport: 'soccer',     espnLeague: 'eng.1',       oddsApiKey: 'soccer_epl',         hasDraw: true },
  { id: 1983, sport: 'soccer',     name: 'La Liga',     espnSport: 'soccer',     espnLeague: 'esp.1',       oddsApiKey: 'soccer_spain_la_liga',hasDraw: true },
  { id: 1990, sport: 'soccer',     name: 'Bundesliga',  espnSport: 'soccer',     espnLeague: 'ger.1',       oddsApiKey: 'soccer_germany_bundesliga',hasDraw:true},
  { id: 1984, sport: 'soccer',     name: 'Serie A',     espnSport: 'soccer',     espnLeague: 'ita.1',       oddsApiKey: 'soccer_italy_serie_a',hasDraw: true },
  { id: 1985, sport: 'soccer',     name: 'Ligue 1',     espnSport: 'soccer',     espnLeague: 'fra.1',       oddsApiKey: 'soccer_france_ligue_one',hasDraw:true },
  { id: 2921, sport: 'soccer',     name: 'World Cup',   espnSport: 'soccer',     espnLeague: 'fifa.world',  oddsApiKey: 'soccer_fifa_world_cup',hasDraw: true },
  // Tennis: French Open only (ATP + WTA). Expand to Masters 1000+ when season continues.
  { id: 0, sport: 'tennis', name: 'French Open', espnSport: 'tennis', espnLeague: 'french-open', oddsApiKey: 'tennis_atp', isTennis: true },
];

const BOOK_DISPLAY: Record<string, string> = {
  draftkings: 'DraftKings',
  fanduel:    'FanDuel',
  betmgm:     'BetMGM',
  caesars:    'Caesars',
  bet365:     'Bet365',
  betrivers:  'BetRivers',
  pointsbet:  'PointsBet',
  bovada:     'Bovada',
  mybookie:   'MyBookie',
  betonline:  'BetOnline',
  pinnacle:   'Pinnacle',
  espn_bet:   'DraftKings (ESPN)',
  kalshi:     'Kalshi',
  williamhill: 'William Hill',
  unibet:     'Unibet',
  bwin:       'Bwin',
};

// Bovada sport path per league name
const BOVADA_PATHS: Record<string, string> = {
  NBA:        'basketball/nba',
  NHL:        'ice-hockey/nhl',
  MLB:        'baseball/mlb',
  EPL:        'soccer/england/premier-league',
  'La Liga':  'soccer/spain/la-liga',
  Bundesliga: 'soccer/germany/german-bundesliga',
  'Serie A':  'soccer/italy/serie-a',
  'Ligue 1':  'soccer/france/french-ligue-1',
};

// FanDuel competition IDs
const FANDUEL_COMPETITIONS: { competitionId: number; league: string }[] = [
  { competitionId: 42133, league: 'NBA' },
  { competitionId: 42401, league: 'NHL' },
  { competitionId: 42573, league: 'MLB' },
  { competitionId: 10932509, league: 'EPL' },
];

// BetMGM sport/league IDs
const BETMGM_LEAGUES: { sportId: number; leagueId: number; league: string }[] = [
  { sportId: 7,  leagueId: 4850,  league: 'NBA' },
  { sportId: 10, leagueId: 4316,  league: 'NHL' },
  { sportId: 23, leagueId: 11093, league: 'MLB' },
];

// Kalshi per-game series tickers (open game markets with binary Yes/No per outcome)
const KALSHI_SERIES: { ticker: string }[] = [
  { ticker: 'KXNBAGAME'       },
  { ticker: 'KXNHLGAME'       },
  { ticker: 'KXMLBGAME'       },
  { ticker: 'KXEPLGAME'       },
  { ticker: 'KXLALIGAGAME'    },
  { ticker: 'KXBUNDESLIGAGAME'},
  { ticker: 'KXSERIEAGAME'    },
  { ticker: 'KXLIGUE1GAME'    },
  { ticker: 'KXWCGAME'        },
  { ticker: 'KXATPGAME'       },
  { ticker: 'KXWTAGAME'       },
];

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BookOdds {
  bookmaker: string;
  bookmakerLabel: string;
  decimalOdds: number;
  americanOdds: number;
  isBest: boolean;
  betUrl?: string;
}

export interface GameOutcome {
  name: string;
  books: BookOdds[];
  bestBook: string;
  bestBookLabel: string;
  bestDecimalOdds: number;
  bestAmericanOdds: number;
}

export interface GameOddsEntry {
  id: string;
  eventName: string;
  sport: SportCategory;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string | null;
  isLive: boolean;
  isCompleted: boolean;
  homeScore: number | null;
  awayScore: number | null;
  statusDetail: string;
  outcomes: GameOutcome[];
  hasArb: boolean;
  arbRoi: number | null;
  totalImplied: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slug(name: string): string {
  return name.toLowerCase().replace(/^the\s+/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function gameKey(a: string, b: string): string {
  return [slug(a), slug(b)].sort().join(':');
}

function extractDkUrl(gatewayUrl: string | undefined): string {
  if (!gatewayUrl) return 'https://sportsbook.draftkings.com';
  try {
    const u = new URL(gatewayUrl);
    const preurl = u.searchParams.get('preurl');
    if (preurl) return decodeURIComponent(preurl);
  } catch { /* fall through */ }
  return 'https://sportsbook.draftkings.com';
}

function americanToDecimal(am: number): number {
  if (am > 0) return 1 + am / 100;
  if (am < 0) return 1 - 100 / am;
  return 0;
}

function decimalToAmerican(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

function parseAmericanStr(s: string): number | null {
  const n = parseInt(s.replace(/[^\d+\-]/g, '').replace(/(?<=\d)[+-].*/, ''), 10);
  // parseInt handles "+170" and "-205" directly
  const m = parseInt(s, 10);
  return isNaN(m) ? null : m;
}

type OutcomeMap = Map<string, Omit<BookOdds, 'isBest'>[]>;

function addOdds(map: OutcomeMap, outcomeName: string, bookmaker: string, americanOdds: number, betUrl?: string) {
  const dec = americanToDecimal(americanOdds);
  if (!dec || dec <= 1.001 || isNaN(dec)) return;
  const label = BOOK_DISPLAY[bookmaker] ?? bookmaker;
  const list = map.get(outcomeName) ?? [];
  // deduplicate — same book shouldn't appear twice for same outcome
  if (!list.some((b) => b.bookmaker === bookmaker)) {
    list.push({ bookmaker, bookmakerLabel: label, decimalOdds: Math.round(dec * 1000) / 1000, americanOdds, betUrl });
  }
  map.set(outcomeName, list);
}

function buildOutcomes(map: OutcomeMap): GameOutcome[] {
  return Array.from(map.entries()).map(([name, books]) => {
    const best = books.reduce((b, c) => c.decimalOdds > b.decimalOdds ? c : b);
    return {
      name,
      books: books.map((b) => ({ ...b, isBest: b.bookmaker === best.bookmaker && b.decimalOdds === best.decimalOdds })),
      bestBook: best.bookmaker,
      bestBookLabel: best.bookmakerLabel,
      bestDecimalOdds: best.decimalOdds,
      bestAmericanOdds: best.americanOdds,
    };
  });
}

function computeArb(outcomes: GameOutcome[], hasDraw: boolean): { hasArb: boolean; arbRoi: number | null; totalImplied: number } {
  // For 3-way soccer markets: only flag arb if draw is present. Without draw the
  // home+away odds naturally sum well below 100% (draw eats ~25-35% probability).
  if (hasDraw && !outcomes.find((o) => o.name === 'Draw')) {
    const totalImplied = outcomes.reduce((s, o) => s + 1 / o.bestDecimalOdds, 0);
    return { hasArb: false, arbRoi: null, totalImplied };
  }
  if (outcomes.length < 2) return { hasArb: false, arbRoi: null, totalImplied: 1 };

  // For genuine arb we also need outcomes from at least 2 different bookmakers
  const uniqueBooks = new Set(outcomes.flatMap((o) => o.books.map((b) => b.bookmaker)));
  const totalImplied = outcomes.reduce((s, o) => s + 1 / o.bestDecimalOdds, 0);
  const hasArb = uniqueBooks.size >= 2 && totalImplied < 1.0;
  const arbRoi = hasArb ? Math.round(((1 - totalImplied) / totalImplied) * 10000) / 100 : null;
  return { hasArb, arbRoi, totalImplied };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GamesService {
  private cache: { data: GameOddsEntry[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL = 60_000;

  invalidateCache() {
    this.cache = null;
  }

  async getGamesWithOdds(): Promise<GameOddsEntry[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data;

    const oddsApiKey = process.env['ODDS_API_KEY'] ?? '';

    const [pinnacleGames, espnMap, oddsApiGames, kalshiEvents, bovadaGames, fanDuelGames, betMgmGames] = await Promise.all([
      this.fetchPinnacle(),
      this.fetchEspn(),
      oddsApiKey ? this.fetchOddsApi(oddsApiKey) : Promise.resolve(new Map<string, Map<string, { bookmaker: string; american: number; betUrl?: string }[]>>()),
      this.fetchKalshi(),
      this.fetchBovada(),
      this.fetchFanDuel(),
      this.fetchBetMgm(),
    ]);

    // game key → {meta, outcomeMap}
    type GameEntry = {
      id: string; eventName: string; sport: SportCategory; league: string;
      homeTeam: string; awayTeam: string; startTime: string | null;
      isLive: boolean; isCompleted: boolean; homeScore: number | null;
      awayScore: number | null; statusDetail: string; hasDraw: boolean;
      outcomes: OutcomeMap;
    };
    const gameMap = new Map<string, GameEntry>();

    const getOrCreate = (k: string, meta: Omit<GameEntry, 'outcomes'>): GameEntry => {
      if (!gameMap.has(k)) gameMap.set(k, { ...meta, outcomes: new Map() });
      return gameMap.get(k)!;
    };

    // ── 1. Seed from Pinnacle ──────────────────────────────────────────────────
    for (const g of pinnacleGames) {
      const k = gameKey(g.awayTeam, g.homeTeam);
      const cfg = LEAGUES.find((l) => l.name === g.league);
      const entry = getOrCreate(k, {
        id: `pinnacle:${k}`, eventName: `${g.awayTeam} @ ${g.homeTeam}`,
        sport: g.sport, league: g.league,
        homeTeam: g.homeTeam, awayTeam: g.awayTeam, startTime: g.startTime,
        isLive: false, isCompleted: false, homeScore: null, awayScore: null,
        statusDetail: '', hasDraw: cfg?.hasDraw ?? false,
      });
      const pinnacleUrl = ({
        basketball: 'https://www.pinnacle.com/en/basketball/',
        hockey:     'https://www.pinnacle.com/en/hockey/',
        baseball:   'https://www.pinnacle.com/en/baseball/',
        soccer:     'https://www.pinnacle.com/en/soccer/',
        tennis:     'https://www.pinnacle.com/en/tennis/',
        football:   'https://www.pinnacle.com/en/american-football/',
      } as Record<string, string>)[g.sport] ?? 'https://www.pinnacle.com/en/live';
      for (const o of g.outcomes) {
        addOdds(entry.outcomes, o.name, 'pinnacle', o.americanOdds, pinnacleUrl);
      }
    }

    // ── 2. ESPN (DraftKings odds + live status) ────────────────────────────────
    for (const [k, eg] of espnMap) {
      const cfg = LEAGUES.find((l) => l.name === eg.league);
      const entry = getOrCreate(k, {
        id: eg.id, eventName: eg.eventName, sport: eg.sport, league: eg.league,
        homeTeam: eg.homeTeam, awayTeam: eg.awayTeam, startTime: eg.startTime,
        isLive: eg.isLive, isCompleted: eg.isCompleted,
        homeScore: eg.homeScore, awayScore: eg.awayScore,
        statusDetail: eg.statusDetail, hasDraw: cfg?.hasDraw ?? false,
      });
      // Update live state from ESPN
      entry.isLive = eg.isLive;
      entry.isCompleted = eg.isCompleted;
      entry.homeScore = eg.homeScore;
      entry.awayScore = eg.awayScore;
      entry.statusDetail = eg.statusDetail;
      if (eg.startTime) entry.startTime = eg.startTime;
      entry.id = eg.id;

      const betUrl = (outcome: 'home' | 'away' | 'draw') =>
        eg.dkUrls[outcome] || 'https://sportsbook.draftkings.com';

      if (eg.dkHome !== null) addOdds(entry.outcomes, eg.homeTeam, 'draftkings', eg.dkHome, betUrl('home'));
      if (eg.dkAway !== null) addOdds(entry.outcomes, eg.awayTeam, 'draftkings', eg.dkAway, betUrl('away'));
      if (eg.dkDraw !== null) addOdds(entry.outcomes, 'Draw', 'draftkings', eg.dkDraw, betUrl('draw'));
    }

    // ── 3. The Odds API (multi-book) ──────────────────────────────────────────
    for (const [k, bookMap] of oddsApiGames) {
      // bookMap: outcomeName → [{bookmaker, american, betUrl}]
      if (!gameMap.has(k)) continue; // only enrich existing games
      const entry = gameMap.get(k)!;
      for (const [outcomeName, entries] of bookMap) {
        for (const e of entries) {
          addOdds(entry.outcomes, outcomeName, e.bookmaker, e.american, e.betUrl);
        }
      }
    }

    // ── 4. Bovada ─────────────────────────────────────────────────────────────
    for (const g of bovadaGames) {
      const k = gameKey(g.awayTeam, g.homeTeam);
      if (!gameMap.has(k)) continue; // only enrich existing games
      const entry = gameMap.get(k)!;
      for (const o of g.outcomes) {
        addOdds(entry.outcomes, o.name, 'bovada', o.americanOdds, `https://www.bovada.lv/sports/${BOVADA_PATHS[entry.league] ?? ''}`);
      }
    }

    // ── 5. FanDuel ────────────────────────────────────────────────────────────
    for (const [k, outcomes] of fanDuelGames) {
      if (!gameMap.has(k)) continue;
      const entry = gameMap.get(k)!;
      for (const [name, american] of outcomes) {
        addOdds(entry.outcomes, name, 'fanduel', american, 'https://sportsbook.fanduel.com');
      }
    }

    // ── 6. BetMGM ─────────────────────────────────────────────────────────────
    for (const [k, outcomes] of betMgmGames) {
      if (!gameMap.has(k)) continue;
      const entry = gameMap.get(k)!;
      for (const [name, american] of outcomes) {
        addOdds(entry.outcomes, name, 'betmgm', american, 'https://sports.betmgm.com');
      }
    }

    // ── 7. Kalshi (prediction market — match by significant word overlap) ──────
    // Kalshi uses short names: "VGK Golden Knights", "New York", "COL Avalanche"
    // Strategy: an outcome matches a team if they share at least one significant word (>3 chars)
    const sigWords = (name: string) =>
      name.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length > 3);

    const teamMatchesKalshi = (fullName: string, kalshiName: string): boolean => {
      const fw = sigWords(fullName);
      const kw = sigWords(kalshiName);
      return fw.some((w) => kw.includes(w));
    };

    for (const [, eventMarkets] of kalshiEvents) {
      // Require date alignment: Kalshi occurrence must be within 24h of game startTime
      const kalshiOccurrence = eventMarkets.find((m) => m.occurrenceAt > 0)?.occurrenceAt ?? 0;

      // Exclude Draw/Tie outcomes from non-soccer markets for this pass
      const outcomeMarkets = eventMarkets.filter((m) => {
        const low = m.outcomeName.toLowerCase();
        return low !== 'draw' && low !== 'tie';
      });
      const drawMarket = eventMarkets.find((m) => {
        const low = m.outcomeName.toLowerCase();
        return low === 'draw' || low === 'tie';
      });

      if (outcomeMarkets.length < 2) continue;

      // Try to find a game where BOTH outcomes match different teams AND dates align
      for (const [, entry] of gameMap) {
        // Date guard: Kalshi occurrence vs game startTime must be within 24h
        if (kalshiOccurrence > 0 && entry.startTime) {
          const gameTime = new Date(entry.startTime).getTime();
          if (Math.abs(kalshiOccurrence - gameTime) > 24 * 60 * 60_000) continue;
        }

        const homeMatches = outcomeMarkets.filter((m) => teamMatchesKalshi(entry.homeTeam, m.outcomeName));
        const awayMatches = outcomeMarkets.filter((m) => teamMatchesKalshi(entry.awayTeam, m.outcomeName));
        if (homeMatches.length === 0 || awayMatches.length === 0) continue;
        // Make sure they don't cross-match to the same outcome
        const homeM = homeMatches[0];
        const awayM = awayMatches[0];
        if (homeM === awayM) continue;

        addOdds(entry.outcomes, entry.homeTeam, 'kalshi', homeM.americanOdds, homeM.betUrl);
        addOdds(entry.outcomes, entry.awayTeam, 'kalshi', awayM.americanOdds, awayM.betUrl);
        // Only add Draw to soccer games (hasDraw=true)
        if (drawMarket && entry.hasDraw) {
          addOdds(entry.outcomes, 'Draw', 'kalshi', drawMarket.americanOdds, drawMarket.betUrl);
        }
        break; // matched — move to next Kalshi event
      }
    }

    // ── Build final list ───────────────────────────────────────────────────────
    const games: GameOddsEntry[] = [];
    for (const entry of gameMap.values()) {
      if (entry.outcomes.size === 0) continue;
      const outcomes = buildOutcomes(entry.outcomes);
      const { hasArb, arbRoi, totalImplied } = computeArb(outcomes, entry.hasDraw);

      games.push({
        id: entry.id,
        eventName: entry.eventName,
        sport: entry.sport,
        league: entry.league,
        homeTeam: entry.homeTeam,
        awayTeam: entry.awayTeam,
        startTime: entry.startTime,
        isLive: entry.isLive,
        isCompleted: entry.isCompleted,
        homeScore: entry.homeScore,
        awayScore: entry.awayScore,
        statusDetail: entry.statusDetail,
        outcomes,
        hasArb,
        arbRoi,
        totalImplied: Math.round(totalImplied * 10000) / 10000,
      });
    }

    games.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      const ta = a.startTime ? new Date(a.startTime).getTime() : Infinity;
      const tb = b.startTime ? new Date(b.startTime).getTime() : Infinity;
      return ta - tb;
    });

    const arbCount = games.filter((g) => g.hasArb).length;
    const bookCount = new Set(games.flatMap((g) => g.outcomes.flatMap((o) => o.books.map((b) => b.bookmaker)))).size;
    logger.info(`[games] ${games.length} games, ${bookCount} books, ${arbCount} arbs`);

    this.cache = { data: games, expiresAt: Date.now() + this.CACHE_TTL };
    return games;
  }

  // ─── Pinnacle ──────────────────────────────────────────────────────────────

  private async fetchPinnacle(): Promise<{
    awayTeam: string; homeTeam: string; sport: SportCategory; league: string;
    startTime: string | null;
    outcomes: { name: string; americanOdds: number }[];
  }[]> {
    const all: ReturnType<GamesService['fetchPinnacle']> extends Promise<infer T> ? T : never = [];

    // Dynamically fetch active Pinnacle tennis leagues (IDs rotate per tournament/round)
    interface TennisLeagueRef { id: number; name: string }
    let tennisLeagues: TennisLeagueRef[] = [];
    try {
      const raw = await this.pinnacleGet<any[]>('/sports/33/leagues?all=false');
      // French Open only for now. To expand: also allow /Masters|ATP 1000|WTA 1000/i
      const TENNIS_ALLOW = /roland.garros|french.open/i;
      tennisLeagues = (raw ?? [])
        .filter((l: any) => l.matchupCount > 0 && TENNIS_ALLOW.test(l.name as string))
        .map((l: any) => ({ id: l.id as number, name: l.name as string }));
      logger.debug(`[games] Pinnacle tennis: ${tennisLeagues.length} active leagues (French Open filter)`);
    } catch {
      logger.debug('[games] Could not fetch Pinnacle tennis leagues');
    }

    // Fixed (non-tennis) leagues
    const fixedLeagues = LEAGUES.filter((l) => !l.isTennis && l.id > 0);

    await Promise.all([
      // ── Fixed leagues (NBA/NHL/MLB/Soccer) ──────────────────────────────────
      ...fixedLeagues.map(async (cfg) => {
        try {
          const [matchups, markets] = await Promise.all([
            this.pinnacleGet<any[]>(`/leagues/${cfg.id}/matchups`),
            this.pinnacleGet<any[]>(`/leagues/${cfg.id}/markets/straight`),
          ]);

          const matchupMeta = new Map<number, { homeTeam: string; awayTeam: string; startTime: string }>();
          for (const m of matchups ?? []) {
            if (m.type !== 'matchup') continue;
            const parts: any[] = m.participants ?? [];
            const home = parts.find((p: any) => p.alignment === 'home');
            const away = parts.find((p: any) => p.alignment === 'away');
            if (!home || !away) continue;
            // Skip prop/special markets — Pinnacle labels them "(Bookings)", "(Corners)", etc.
            if ((home.name as string).includes('(') || (away.name as string).includes('(')) continue;
            // Keep games within a 12h window of start (pre-game or just started)
            const st = new Date(m.startTime as string);
            if (st < new Date(Date.now() - 12 * 60 * 60_000)) continue;
            matchupMeta.set(m.id as number, {
              homeTeam: home.name as string,
              awayTeam: away.name as string,
              startTime: m.startTime as string,
            });
          }

          for (const mkt of markets ?? []) {
            if (mkt.type !== 'moneyline' || mkt.period !== 0 || mkt.isAlternate) continue;
            const meta = matchupMeta.get(mkt.matchupId as number);
            if (!meta) continue;

            const prices: any[] = mkt.prices ?? [];
            const outcomes: { name: string; americanOdds: number }[] = [];

            for (const p of prices) {
              const desig: string | undefined = p.designation;
              const partId: number | undefined = p.participantId;
              let outcomeName: string | null = null;

              if (desig === 'home')  outcomeName = meta.homeTeam;
              else if (desig === 'away') outcomeName = meta.awayTeam;
              else if (desig === 'draw') outcomeName = 'Draw';
              else if (partId !== undefined) {
                // fall back: check if this participantId matches a known "draw" participant
                // (rare — only some specials use participantId)
                continue;
              }

              if (outcomeName && p.price && !isNaN(p.price as number)) {
                outcomes.push({ name: outcomeName, americanOdds: p.price as number });
              }
            }

            if (outcomes.length >= 2) {
              (all as any[]).push({ ...meta, sport: cfg.sport, league: cfg.name, outcomes });
            }
          }
        } catch (err) {
          logger.debug(`[games] Pinnacle ${cfg.name}: ${(err as Error).message}`);
        }
      }),

      // ── Dynamic tennis leagues ──────────────────────────────────────────────
      ...tennisLeagues.map(async ({ id, name }) => {
        try {
          const [matchups, markets] = await Promise.all([
            this.pinnacleGet<any[]>(`/leagues/${id}/matchups`),
            this.pinnacleGet<any[]>(`/leagues/${id}/markets/straight`),
          ]);

          const matchupMeta = new Map<number, { homeTeam: string; awayTeam: string; startTime: string }>();
          for (const m of matchups ?? []) {
            if (m.type !== 'matchup') continue;
            const parts: any[] = m.participants ?? [];
            const home = parts.find((p: any) => p.alignment === 'home');
            const away = parts.find((p: any) => p.alignment === 'away');
            if (!home || !away) continue;
            if ((home.name as string).includes('(') || (away.name as string).includes('(')) continue;
            const st = new Date(m.startTime as string);
            if (st < new Date(Date.now() - 6 * 60 * 60_000)) continue;
            matchupMeta.set(m.id as number, {
              homeTeam: home.name as string,
              awayTeam: away.name as string,
              startTime: m.startTime as string,
            });
          }

          for (const mkt of markets ?? []) {
            if (mkt.type !== 'moneyline' || mkt.period !== 0 || mkt.isAlternate) continue;
            const meta = matchupMeta.get(mkt.matchupId as number);
            if (!meta) continue;
            const prices: any[] = mkt.prices ?? [];
            const outcomes: { name: string; americanOdds: number }[] = [];
            for (const p of prices) {
              const desig: string | undefined = p.designation;
              let outcomeName: string | null = null;
              if (desig === 'home') outcomeName = meta.homeTeam;
              else if (desig === 'away') outcomeName = meta.awayTeam;
              if (outcomeName && p.price && !isNaN(p.price as number)) {
                outcomes.push({ name: outcomeName, americanOdds: p.price as number });
              }
            }
            if (outcomes.length >= 2) {
              // Use the Pinnacle tournament name (e.g. "ATP French Open - R1") as league label
              (all as any[]).push({ ...meta, sport: 'tennis' as SportCategory, league: name, outcomes });
            }
          }
        } catch (err) {
          logger.debug(`[games] Pinnacle tennis ${name}: ${(err as Error).message}`);
        }
      }),
    ]);

    return all as any;
  }

  private async pinnacleGet<T>(path: string): Promise<T> {
    const res = await fetch(`${PINNACLE_BASE}${path}`, {
      headers: PINNACLE_HEADERS,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Pinnacle ${res.status} ${path}`);
    return res.json() as Promise<T>;
  }

  // ─── ESPN (with DraftKings embedded odds + draw) ──────────────────────────

  private async fetchEspn(): Promise<Map<string, {
    id: string; eventName: string; sport: SportCategory; league: string;
    homeTeam: string; awayTeam: string; startTime: string | null;
    isLive: boolean; isCompleted: boolean;
    homeScore: number | null; awayScore: number | null; statusDetail: string;
    dkHome: number | null; dkAway: number | null; dkDraw: number | null;
    dkUrls: { home?: string; away?: string; draw?: string };
  }>> {
    const result = new Map<string, any>();

    await Promise.all(
      LEAGUES.map(async (cfg) => {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espnSport}/${cfg.espnLeague}/scoreboard`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
          if (!res.ok) return;
          const data = await res.json() as { events?: any[] };

          for (const ev of data.events ?? []) {
            if (cfg.isTennis) {
              // Tennis ESPN structure: ev.groupings[].competitions[] with athlete.displayName
              for (const grouping of (ev.groupings ?? []) as any[]) {
                for (const comp of (grouping.competitions ?? []) as any[]) {
                  const status = comp.status?.type;
                  if (!status) continue;
                  if (status.completed) {
                    if (Date.now() - new Date((comp.date as string) ?? 0).getTime() > 3 * 60 * 60_000) continue;
                  }
                  const competitors: any[] = comp.competitors ?? [];
                  const p1 = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0];
                  const p2 = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1];
                  if (!p1 || !p2) continue;
                  const name1: string = p1.athlete?.displayName ?? p1.team?.displayName ?? '';
                  const name2: string = p2.athlete?.displayName ?? p2.team?.displayName ?? '';
                  if (!name1 || !name2 || name1 === 'TBD' || name2 === 'TBD') continue;
                  const k = gameKey(name2, name1);
                  result.set(k, {
                    id: `${cfg.name}:${comp.id as string}`,
                    eventName: `${name2} vs ${name1}`,
                    sport: cfg.sport, league: cfg.name,
                    homeTeam: name1, awayTeam: name2,
                    startTime: comp.date ? new Date(comp.date as string).toISOString() : null,
                    isLive: status.state === 'in',
                    isCompleted: status.completed ?? false,
                    homeScore: null, awayScore: null,
                    statusDetail: (status.detail ?? status.description ?? '') as string,
                    dkHome: null, dkAway: null, dkDraw: null,
                    dkUrls: {},
                  });
                }
              }
              continue; // skip regular competition parsing for tennis
            }

            const status = ev.status?.type;
            if (!status) continue;
            if (status.completed) {
              if (Date.now() - new Date((ev.date as string) ?? 0).getTime() > 3 * 60 * 60_000) continue;
            }
            const comp = ev.competitions?.[0];
            if (!comp) continue;

            const home = (comp.competitors as any[])?.find((c: any) => c.homeAway === 'home');
            const away = (comp.competitors as any[])?.find((c: any) => c.homeAway === 'away');
            if (!home || !away) continue;

            const homeTeam: string = home.team.displayName;
            const awayTeam: string = away.team.displayName;
            const k = gameKey(awayTeam, homeTeam);

            // ESPN embeds DraftKings odds at odds[0].moneyline.{home|away|draw}.close.odds
            const oddsObj: any = (comp.odds as any[])?.[0];
            const ml = oddsObj?.moneyline ?? {};

            const dkHome = ml.home?.close?.odds ? parseAmericanStr(ml.home.close.odds as string) : null;
            const dkAway = ml.away?.close?.odds ? parseAmericanStr(ml.away.close.odds as string) : null;
            const dkDraw = ml.draw?.close?.odds ? parseAmericanStr(ml.draw.close.odds as string) : null;

            result.set(k, {
              id: `${cfg.name}:${ev.id as string}`,
              eventName: `${awayTeam} @ ${homeTeam}`,
              sport: cfg.sport, league: cfg.name,
              homeTeam, awayTeam,
              startTime: ev.date ? new Date(ev.date as string).toISOString() : null,
              isLive: status.state === 'in',
              isCompleted: status.completed ?? false,
              homeScore: home.score != null ? parseInt(home.score as string, 10) : null,
              awayScore: away.score != null ? parseInt(away.score as string, 10) : null,
              statusDetail: (status.detail ?? status.description ?? '') as string,
              dkHome, dkAway, dkDraw,
              dkUrls: {
                home: extractDkUrl(ml.home?.close?.link?.href as string | undefined),
                away: extractDkUrl(ml.away?.close?.link?.href as string | undefined),
                draw: extractDkUrl(ml.draw?.close?.link?.href as string | undefined),
              },
            });
          }
        } catch (err) {
          logger.debug(`[games] ESPN ${cfg.name}: ${(err as Error).message}`);
        }
      }),
    );

    return result;
  }

  // ─── The Odds API (FanDuel, BetMGM, Caesars, Bet365, etc.) ───────────────

  private async fetchOddsApi(apiKey: string): Promise<Map<string, Map<string, { bookmaker: string; american: number; betUrl?: string }[]>>> {
    // Returns: gameKey → outcomeName → [{bookmaker, american}]
    const result = new Map<string, Map<string, { bookmaker: string; american: number; betUrl?: string }[]>>();

    const sportsToFetch = [...new Set(LEAGUES.filter((l) => l.oddsApiKey).map((l) => l.oddsApiKey!))];

    await Promise.all(
      sportsToFetch.map(async (sportKey) => {
        try {
          const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us,eu&markets=h2h&oddsFormat=american`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) {
            if (res.status === 401 || res.status === 402 || res.status === 429) {
              logger.debug(`[games] Odds API quota/auth issue for ${sportKey}`);
            }
            return;
          }
          const games = await res.json() as any[];

          for (const g of games ?? []) {
            const homeTeam: string = g.home_team;
            const awayTeam: string = g.away_team;
            const k = gameKey(awayTeam, homeTeam);

            if (!result.has(k)) result.set(k, new Map());
            const outcomeMap = result.get(k)!;

            for (const bm of g.bookmakers ?? []) {
              const h2h = (bm.markets as any[])?.find((m: any) => m.key === 'h2h');
              if (!h2h) continue;
              for (const o of h2h.outcomes ?? []) {
                const name: string = o.name === 'Draw' ? 'Draw' : o.name;
                const list = outcomeMap.get(name) ?? [];
                list.push({ bookmaker: bm.key as string, american: Math.round(o.price as number) });
                outcomeMap.set(name, list);
              }
            }
          }
        } catch (err) {
          logger.debug(`[games] Odds API ${sportKey}: ${(err as Error).message}`);
        }
      }),
    );

    return result;
  }

  // ─── Kalshi (prediction market, per-game binary markets) ──────────────────

  private async fetchKalshi(): Promise<Map<string, { outcomeName: string; americanOdds: number; betUrl: string; occurrenceAt: number }[]>> {
    const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
    // Returns: eventTicker → [{outcomeName, americanOdds, betUrl, occurrenceAt}]
    const result = new Map<string, { outcomeName: string; americanOdds: number; betUrl: string; occurrenceAt: number }[]>();

    await Promise.all(
      KALSHI_SERIES.map(async ({ ticker }) => {
        try {
          const url = `${KALSHI_BASE}/markets?limit=200&series_ticker=${ticker}&status=open`;
          const res = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) return;
          const data = await res.json() as { markets: any[] };

          for (const m of data.markets ?? []) {
            const yesAsk = parseFloat(m.yes_ask_dollars ?? '0');
            if (!yesAsk || yesAsk <= 0.01 || yesAsk >= 0.99) continue;
            const outcomeName = (m.yes_sub_title ?? '') as string;
            // Skip prop/special markets (Bookings, Goals, Corners, etc.) — only want match winners
            if (!outcomeName || outcomeName === 'TBD' || outcomeName.includes('(')) continue;
            const eventTicker = m.event_ticker as string;
            if (!eventTicker) continue;

            // yes_ask_dollars = price to receive $1 if outcome resolves Yes
            // = implied probability = 1/decimal_odds
            const decimalOdds = 1 / yesAsk;
            const americanOdds = decimalToAmerican(decimalOdds);
            const betUrl = `https://kalshi.com/markets/${m.ticker as string}`;
            const occurrenceAt = m.occurrence_datetime
              ? new Date(m.occurrence_datetime as string).getTime()
              : 0;

            const list = result.get(eventTicker) ?? [];
            list.push({ outcomeName, americanOdds, betUrl, occurrenceAt });
            result.set(eventTicker, list);
          }
        } catch (err) {
          logger.debug(`[games] Kalshi ${ticker}: ${(err as Error).message}`);
        }
      }),
    );

    logger.debug(`[games] Kalshi: ${result.size} events fetched`);
    return result;
  }

  // ─── Bovada ────────────────────────────────────────────────────────────────

  private async fetchBovada(): Promise<{ awayTeam: string; homeTeam: string; league: string; outcomes: { name: string; americanOdds: number }[] }[]> {
    const results: ReturnType<GamesService['fetchBovada']> extends Promise<infer T> ? T : never = [];

    await Promise.all(
      Object.entries(BOVADA_PATHS).map(async ([league, path]) => {
        try {
          const url = `https://www.bovada.lv/services/sports/event/coupon/events/A/description/${path}?marketFilterId=rank&preMatchOnly=false&eventsLimit=50&lang=en`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) return;
          const data = await res.json() as any[];

          for (const group of data ?? []) {
            for (const ev of group.events ?? []) {
              const comps: any[] = ev.competitors ?? [];
              const home = comps.find((c: any) => c.home);
              const away = comps.find((c: any) => !c.home);
              if (!home || !away) continue;
              if (ev.live && (ev.clock?.relativeGameTimeInSecs ?? 0) > 7200) continue;

              const moneyline = (ev.displayGroups as any[])
                ?.flatMap((g: any) => g.markets ?? [])
                ?.find((m: any) => /moneyline/i.test(m.description ?? ''));
              if (!moneyline) continue;

              const outcomes: { name: string; americanOdds: number }[] = [];
              for (const o of moneyline.outcomes ?? []) {
                const american = parseInt((o.price?.american ?? '').replace('+', ''), 10);
                if (isNaN(american) || american === 0) continue;
                const name = o.description === 'Draw' ? 'Draw' : (o.description as string);
                outcomes.push({ name, americanOdds: american });
              }
              if (outcomes.length >= 2) {
                (results as any[]).push({ awayTeam: away.name, homeTeam: home.name, league, outcomes });
              }
            }
          }
        } catch (err) {
          logger.debug(`[games] Bovada ${league}: ${(err as Error).message}`);
        }
      }),
    );

    logger.debug(`[games] Bovada: ${results.length} games`);
    return results as any;
  }

  // ─── FanDuel ───────────────────────────────────────────────────────────────

  private async fetchFanDuel(): Promise<Map<string, Map<string, number>>> {
    // gameKey → outcomeName → americanOdds
    const result = new Map<string, Map<string, number>>();
    const AK = 'FhMFpcPWXMeyZxOx';

    await Promise.all(
      FANDUEL_COMPETITIONS.map(async ({ competitionId, league }) => {
        try {
          const url = `https://sbapi.fanduel.com/api/content-managed-page?page=SPORT_EVENT_COMPETITION&competitionId=${competitionId}&_ak=${AK}&includeOutrights=false`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Origin: 'https://sportsbook.fanduel.com' },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = await res.json() as any;

          const attachedMarkets: any[] = data.attachedMarkets ?? [];
          const events: any[] = data.events ?? [];

          for (const ev of events) {
            const runners: any[] = ev.runners ?? [];
            const home = runners.find((r: any) => r.runnerRole === 'HOME' || r.handicap === 0);
            const away = runners.find((r: any) => r.runnerRole === 'AWAY');
            if (!home || !away) continue;

            const homeName = home.runnerName as string;
            const awayName = away.runnerName as string;
            const k = gameKey(awayName, homeName);
            if (!result.has(k)) result.set(k, new Map());
            const outcomeMap = result.get(k)!;

            // Find h2h market from attached markets for this event
            const evMarkets = attachedMarkets.filter((m: any) =>
              m.eventId === ev.eventId && /match winner|money line|moneyline|1x2/i.test(m.marketType ?? m.marketName ?? '')
            );
            for (const mkt of evMarkets) {
              for (const sel of mkt.runners ?? []) {
                const price = parseFloat(sel.winRunnerOdds?.americanDisplayOdds ?? '');
                if (isNaN(price)) continue;
                const name = sel.runnerName === 'Draw' ? 'Draw' : (sel.runnerName as string);
                outcomeMap.set(name, Math.round(price));
              }
            }
          }
          logger.debug(`[games] FanDuel ${league}: ${result.size} games`);
        } catch (err) {
          logger.debug(`[games] FanDuel ${league}: ${(err as Error).message}`);
        }
      }),
    );

    return result;
  }

  // ─── BetMGM ────────────────────────────────────────────────────────────────

  private async fetchBetMgm(): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();

    await Promise.all(
      BETMGM_LEAGUES.map(async ({ sportId, leagueId, league }) => {
        try {
          const url = `https://sports.betmgm.com/en/sports/api/fixtures/fixture-list?sportId=${sportId}&leagueId=${leagueId}&marketTypeIds=1_0_2_3&fixture-types=Standard&format=json`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://sports.betmgm.com' },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = await res.json() as any;

          const fixtures: any[] = data.fixtures ?? data.Fixtures ?? [];
          for (const fx of fixtures) {
            const participants: any[] = fx.participants ?? fx.Participants ?? [];
            const home = participants.find((p: any) => (p.position ?? p.Position) === 1);
            const away = participants.find((p: any) => (p.position ?? p.Position) === 2);
            if (!home || !away) continue;

            const homeName = (home.name?.value ?? home.Name ?? '') as string;
            const awayName = (away.name?.value ?? away.Name ?? '') as string;
            if (!homeName || !awayName) continue;

            const k = gameKey(awayName, homeName);
            if (!result.has(k)) result.set(k, new Map());
            const outcomeMap = result.get(k)!;

            // Find moneyline market (marketId=1 is usually moneyline)
            const markets: any[] = fx.markets ?? fx.Markets ?? [];
            const ml = markets.find((m: any) => [1, 2].includes(m.marketType ?? m.MarketType ?? -1));
            if (!ml) continue;

            const selections: any[] = ml.selections ?? ml.Selections ?? [];
            for (const sel of selections) {
              const price = sel.trueOdds ?? sel.TrueOdds ?? sel.nativeOdds ?? sel.NativeOdds;
              if (!price) continue;
              const decimal = parseFloat(price);
              if (isNaN(decimal) || decimal <= 1) continue;
              const american = decimalToAmerican(decimal);
              const name = (sel.name?.value ?? sel.Name ?? '') as string;
              if (!name || name === 'Draw') { if (name === 'Draw') outcomeMap.set('Draw', american); continue; }
              // Match by home/away position
              const pos = sel.participantPosition ?? sel.ParticipantPosition;
              if (pos === 1) outcomeMap.set(homeName, american);
              else if (pos === 2) outcomeMap.set(awayName, american);
              else outcomeMap.set(name, american);
            }
          }
          logger.debug(`[games] BetMGM ${league}: enriched`);
        } catch (err) {
          logger.debug(`[games] BetMGM ${league}: ${(err as Error).message}`);
        }
      }),
    );

    return result;
  }
}

let _instance: GamesService | null = null;
export function getGamesService(): GamesService {
  if (!_instance) _instance = new GamesService();
  return _instance;
}
