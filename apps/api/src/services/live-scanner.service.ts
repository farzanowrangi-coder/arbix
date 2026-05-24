import EventEmitter from 'events';
import { v5 as uuidv5 } from 'uuid';
import type {
  LiveMatch,
  LiveArbitrageOpportunity,
  SportCategory,
  LiveStoppageType,
  StakeAllocation,
  BookmakerSlug,
} from '@arbix/shared';
import { logger } from '../logger';

const NAMESPACE = '7d3e4b1a-9f2c-4a8d-b6e5-1c0a3f7d9e2b';
const POLL_INTERVAL_MS = 30_000;
const BASE_STAKE = 1000;

// ─── ESPN endpoints ───────────────────────────────────────────────────────────

const ESPN_CONFIGS = [
  { sport: 'basketball' as SportCategory, espnSport: 'basketball', espnLeague: 'nba', leagueName: 'NBA', pinnacleLeagueId: 487 },
  { sport: 'hockey'     as SportCategory, espnSport: 'hockey',     espnLeague: 'nhl', leagueName: 'NHL', pinnacleLeagueId: 1456 },
  { sport: 'baseball'   as SportCategory, espnSport: 'baseball',   espnLeague: 'mlb', leagueName: 'MLB', pinnacleLeagueId: 246 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'eng.1', leagueName: 'EPL', pinnacleLeagueId: 1980 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'esp.1', leagueName: 'La Liga', pinnacleLeagueId: 1983 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'ger.1', leagueName: 'Bundesliga', pinnacleLeagueId: 1990 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'ita.1', leagueName: 'Serie A', pinnacleLeagueId: 1984 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'fra.1', leagueName: 'Ligue 1', pinnacleLeagueId: 1985 },
  { sport: 'soccer'     as SportCategory, espnSport: 'soccer',     espnLeague: 'fifa.world',  leagueName: 'FIFA World Cup', pinnacleLeagueId: 2921 },
  { sport: 'tennis'     as SportCategory, espnSport: 'tennis',     espnLeague: 'atp',         leagueName: 'ATP',           pinnacleLeagueId: 1488 },
  { sport: 'tennis'     as SportCategory, espnSport: 'tennis',     espnLeague: 'wta',         leagueName: 'WTA',           pinnacleLeagueId: 1487 },
  { sport: 'tennis'     as SportCategory, espnSport: 'tennis',     espnLeague: 'french-open', leagueName: 'French Open',   pinnacleLeagueId: 1488 },
] as const;

// ESPN status names that indicate a stoppage long enough to place bets
const STOPPAGE_STATUS: Record<string, LiveStoppageType> = {
  STATUS_HALFTIME:   'halftime',
  STATUS_END_PERIOD: 'period_break',
  STATUS_RAIN_DELAY: 'inning_break',
};

const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PINNACLE_HEADERS = {
  'X-Api-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
  Referer: 'https://www.pinnacle.com/',
  Origin: 'https://www.pinnacle.com',
};

// ─── ESPN types ───────────────────────────────────────────────────────────────

interface EspnStatusType {
  name: string;
  description: string;
  detail: string;
  completed: boolean;
  state: string;
}

interface EspnEvent {
  id: string;
  name: string;
  status: {
    clock: number;
    displayClock: string;
    period: number;
    type: EspnStatusType;
  };
  competitions: Array<{
    competitors: Array<{
      homeAway: 'home' | 'away';
      team: { displayName: string; shortDisplayName: string };
      score: string;
    }>;
  }>;
}

interface EspnScoreboard {
  events?: EspnEvent[];
}

// ─── Pinnacle live types ──────────────────────────────────────────────────────

interface PinnacleParticipant {
  id: number;
  name: string;
  alignment: 'home' | 'away' | 'neutral';
}

interface PinnacleMatchup {
  id: number;
  startTime: string;
  type?: string;
  participants: PinnacleParticipant[];
  periods: Array<{
    number: number;
    moneyline?: { home: number; away: number; draw?: number };
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class LiveScannerService extends EventEmitter {
  private pollTimer?: ReturnType<typeof setInterval>;
  private liveMatches = new Map<string, LiveMatch>();
  private liveOpportunities = new Map<string, LiveArbitrageOpportunity>();

  start(): void {
    logger.info('[live-scanner] Starting');
    this.poll().catch((err) => logger.error('[live-scanner] Initial poll error', { error: (err as Error).message }));
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) =>
        logger.error('[live-scanner] Poll error', { error: (err as Error).message }),
      );
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    logger.info('[live-scanner] Stopped');
  }

  getLiveMatches(): LiveMatch[] {
    return Array.from(this.liveMatches.values());
  }

  getLiveOpportunities(): LiveArbitrageOpportunity[] {
    return Array.from(this.liveOpportunities.values());
  }

  // ─── Main poll loop ─────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const allMatches: LiveMatch[] = [];

    await Promise.all(
      ESPN_CONFIGS.map(async (cfg) => {
        try {
          const matches = await this.fetchEspnLive(cfg);
          allMatches.push(...matches);
        } catch (err) {
          logger.debug(`[live-scanner] ESPN ${cfg.leagueName} error: ${(err as Error).message}`);
        }
      }),
    );

    // Update live matches map, broadcast changes
    const seenIds = new Set<string>();
    for (const match of allMatches) {
      seenIds.add(match.id);
      const prev = this.liveMatches.get(match.id);
      const changed = !prev ||
        prev.homeScore !== match.homeScore ||
        prev.awayScore !== match.awayScore ||
        prev.inStoppage !== match.inStoppage ||
        prev.statusDetail !== match.statusDetail;

      this.liveMatches.set(match.id, match);

      if (changed) {
        this.emit('ws:broadcast', {
          type: 'live:match',
          payload: match,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Remove matches that are no longer live
    for (const id of this.liveMatches.keys()) {
      if (!seenIds.has(id)) {
        this.liveMatches.delete(id);
      }
    }

    // For stoppages, fetch live odds and check arb
    const stoppages = allMatches.filter((m) => m.inStoppage);
    if (stoppages.length > 0) {
      logger.info(`[live-scanner] ${stoppages.length} games in stoppage — fetching live odds`);
      await Promise.all(stoppages.map((match) => this.checkArbitrage(match)));
    }

    // Expire stale live opportunities (> 3 minutes old)
    const now = Date.now();
    for (const [id, opp] of this.liveOpportunities.entries()) {
      if (now - new Date(opp.detectedAt).getTime() > 3 * 60_000) {
        this.liveOpportunities.delete(id);
      }
    }

    logger.debug(`[live-scanner] ${allMatches.length} live games, ${stoppages.length} in stoppage`);
  }

  // ─── ESPN ───────────────────────────────────────────────────────────────────

  private async fetchEspnLive(cfg: typeof ESPN_CONFIGS[number]): Promise<LiveMatch[]> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espnSport}/${cfg.espnLeague}/scoreboard`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = (await res.json()) as EspnScoreboard;

    const matches: LiveMatch[] = [];
    for (const event of data.events ?? []) {
      const status = event.status?.type;
      if (!status) continue;
      // Only in-progress or stoppage games
      if (status.state !== 'in' && !Object.keys(STOPPAGE_STATUS).includes(status.name)) continue;
      if (status.completed) continue;

      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;

      const stoppageType = STOPPAGE_STATUS[status.name];

      // Also detect NBA/NHL between-period stoppages via status name containing "End"
      const isEndOfPeriod =
        status.name === 'STATUS_END_PERIOD' ||
        status.description?.toLowerCase().includes('end of') ||
        status.detail?.toLowerCase().includes('end of');

      matches.push({
        id: `${cfg.leagueName}:${event.id}`,
        sport: cfg.sport,
        league: cfg.leagueName,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore: parseInt(home.score ?? '0', 10) || 0,
        awayScore: parseInt(away.score ?? '0', 10) || 0,
        period: event.status.period ?? 1,
        clock: event.status.displayClock ?? '',
        statusName: status.name,
        statusDetail: status.detail ?? status.description ?? '',
        inStoppage: !!stoppageType || isEndOfPeriod,
        stoppageType: stoppageType ?? (isEndOfPeriod ? 'period_break' : undefined),
        updatedAt: new Date().toISOString(),
      });
    }

    return matches;
  }

  // ─── Arb detection for a single live game ──────────────────────────────────

  private async checkArbitrage(match: LiveMatch): Promise<void> {
    try {
      // Find the Pinnacle league ID for this match
      const cfg = ESPN_CONFIGS.find((c) => c.leagueName === match.league);
      if (!cfg) return;

      const pinnacleOdds = await this.fetchPinnacleLiveOdds(
        cfg.pinnacleLeagueId,
        match.homeTeam,
        match.awayTeam,
      );
      if (!pinnacleOdds) return;

      // Check for arb across the two books (Pinnacle live vs any discrepancy)
      const { home: pinnacleHome, away: pinnacleAway, draw: pinnacleDraw } = pinnacleOdds;

      // Self-book arb detection (is any single outcome mispriced?)
      // More useful: compare Pinnacle live vs Pinnacle pre-match (odds shift during stoppages)
      // For now, check if the raw sum of implied probs reveals value
      const outcomes: Array<{ outcome: string; bookmaker: BookmakerSlug; decimalOdds: number; americanOdds: number }> = [];

      if (pinnacleHome) {
        const dec = this.americanToDecimal(pinnacleHome);
        outcomes.push({ outcome: match.homeTeam, bookmaker: 'pinnacle', decimalOdds: dec, americanOdds: pinnacleHome });
      }
      if (pinnacleAway) {
        const dec = this.americanToDecimal(pinnacleAway);
        outcomes.push({ outcome: match.awayTeam, bookmaker: 'pinnacle', decimalOdds: dec, americanOdds: pinnacleAway });
      }
      if (pinnacleDraw) {
        const dec = this.americanToDecimal(pinnacleDraw);
        outcomes.push({ outcome: 'Draw', bookmaker: 'pinnacle', decimalOdds: dec, americanOdds: pinnacleDraw });
      }

      if (outcomes.length < 2) return;

      const totalImplied = outcomes.reduce((sum, o) => sum + (1 / o.decimalOdds), 0);
      const profitMargin = 1 - totalImplied;
      const roi = (profitMargin / totalImplied) * 100;

      // During live stoppages, odds shift fast — capture any edge ≥ 0.3%
      if (roi < 0.3) return;

      const stakes: StakeAllocation[] = outcomes.map((o) => {
        const stake = (BASE_STAKE / o.decimalOdds) / totalImplied;
        return {
          outcome: o.outcome,
          bookmaker: o.bookmaker,
          decimalOdds: o.decimalOdds,
          stake: Math.round(stake * 100) / 100,
          potentialReturn: Math.round(stake * o.decimalOdds * 100) / 100,
          betUrl: `https://www.pinnacle.com/en/live`,
        };
      });

      const oppId = uuidv5(
        `live:${match.id}:${match.period}:${match.statusName}`,
        NAMESPACE,
      );

      const opp: LiveArbitrageOpportunity = {
        id: oppId,
        matchId: match.id,
        eventName: `${match.awayTeam} @ ${match.homeTeam}`,
        sport: match.sport,
        league: match.league,
        roi: Math.round(roi * 1000) / 1000,
        profitMargin: Math.round(profitMargin * 10000) / 10000,
        stakes,
        totalStake: Math.round(stakes.reduce((s, a) => s + a.stake, 0) * 100) / 100,
        guaranteedProfit: Math.round(profitMargin * BASE_STAKE * 100) / 100,
        bookmakers: ['pinnacle'],
        detectedAt: new Date().toISOString(),
        gameStatus: match.statusDetail,
      };

      this.liveOpportunities.set(oppId, opp);
      this.emit('ws:broadcast', {
        type: 'live:opportunity',
        payload: opp,
        timestamp: new Date().toISOString(),
      });

      logger.info(`[live-scanner] Live arb: ${opp.eventName} ROI=${roi.toFixed(3)}% during ${match.statusDetail}`);
    } catch (err) {
      logger.debug(`[live-scanner] Arb check failed for ${match.homeTeam}: ${(err as Error).message}`);
    }
  }

  // ─── Pinnacle live odds ─────────────────────────────────────────────────────

  private async fetchPinnacleLiveOdds(
    leagueId: number,
    homeTeam: string,
    awayTeam: string,
  ): Promise<{ home?: number; away?: number; draw?: number } | null> {
    try {
      const res = await fetch(
        `${PINNACLE_BASE}/leagues/${leagueId}/matchups/live`,
        { headers: PINNACLE_HEADERS, signal: AbortSignal.timeout(6_000) },
      );

      if (!res.ok) {
        // Try alternate endpoint format
        const res2 = await fetch(
          `${PINNACLE_BASE}/leagues/${leagueId}/matchups?type=live`,
          { headers: PINNACLE_HEADERS, signal: AbortSignal.timeout(6_000) },
        );
        if (!res2.ok) return null;
        const data2 = await res2.json() as PinnacleMatchup[];
        return this.extractOddsFromMatchups(data2, homeTeam, awayTeam);
      }

      const data = await res.json() as PinnacleMatchup[];
      return this.extractOddsFromMatchups(data, homeTeam, awayTeam);
    } catch {
      return null;
    }
  }

  private extractOddsFromMatchups(
    matchups: PinnacleMatchup[],
    homeTeam: string,
    awayTeam: string,
  ): { home?: number; away?: number; draw?: number } | null {
    if (!Array.isArray(matchups)) return null;

    const homeSlug = this.teamSlug(homeTeam);
    const awaySlug = this.teamSlug(awayTeam);

    for (const matchup of matchups) {
      const parts = matchup.participants ?? [];
      const home = parts.find((p) => p.alignment === 'home');
      const away = parts.find((p) => p.alignment === 'away');
      if (!home || !away) continue;

      const matchHome = this.teamSlug(home.name);
      const matchAway = this.teamSlug(away.name);

      // Fuzzy match — check if either team name overlaps significantly
      if (
        (this.isSameTeam(matchHome, homeSlug) && this.isSameTeam(matchAway, awaySlug)) ||
        (this.isSameTeam(matchHome, awaySlug) && this.isSameTeam(matchAway, homeSlug))
      ) {
        const period = matchup.periods?.find((p) => p.number === 0);
        if (!period?.moneyline) continue;

        const swapped = this.isSameTeam(matchHome, awaySlug);
        return {
          home: swapped ? period.moneyline.away : period.moneyline.home,
          away: swapped ? period.moneyline.home : period.moneyline.away,
          draw: period.moneyline.draw,
        };
      }
    }

    return null;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private teamSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private isSameTeam(a: string, b: string): boolean {
    if (a === b) return true;
    // Allow partial match for city+name vs just name
    return a.includes(b.split('_').pop()!) || b.includes(a.split('_').pop()!);
  }

  private americanToDecimal(american: number): number {
    if (american > 0) return 1 + american / 100;
    return 1 - 100 / american;
  }
}

let instance: LiveScannerService | null = null;

export function getLiveScanner(): LiveScannerService {
  if (!instance) instance = new LiveScannerService();
  return instance;
}
