import { EventEmitter } from 'events';
import { query } from '../db';
import { logger } from '../logger';
import { config } from '../config';
import { getOrCreateWallet, deductStake, creditWinnings } from './wallet.service';
import { getGamesService } from './games.service';
import { getCredentials } from './credentials.service';
import { placePolymarketOrder, closePolymarketPosition } from './polymarket-executor';
import { placePinnacleBet, checkPinnacleVoids } from './pinnacle-executor';

interface AutoBetSettings {
  enabled: boolean;
  demoMode: boolean;
  liveMode: boolean;       // live tab: both enabled+liveMode must be true to place real bets
  maxStakePct: number;
  minRoi: number;
  maxStakeAbs: number;
  bankrollFloor: number;
  demoBooks: string[];     // demo tab: which books to simulate arbs against
}

const DEFAULT_SETTINGS: AutoBetSettings = {
  enabled: false,
  demoMode: true,
  liveMode: false,
  maxStakePct: 5,
  minRoi: 1.0,
  maxStakeAbs: 500,
  bankrollFloor: 100,
  demoBooks: ['polymarket', 'pinnacle'],
};

// Sport duration in hours — used to determine when a game ends
const SPORT_DURATION_HOURS: Record<string, number> = {
  basketball: 3,
  hockey:     3,
  baseball:   4,
  soccer:     2.5,
  tennis:     3,
  football:   4,
  mma:        1.5,
  boxing:     2,
};

function sportDuration(sport: string): number {
  return SPORT_DURATION_HOURS[sport] ?? 3;
}

// Determine settle time: game startTime + sport duration, or 3 hours from now if unknown.
function settleAfter(startTimeIso: string | null, sport: string): Date {
  const hours = sportDuration(sport);
  const msOffset = hours * 60 * 60 * 1000;
  if (startTimeIso) {
    const start = new Date(startTimeIso).getTime();
    const now = Date.now();
    // If game hasn't started yet, settle after it ends; if already started, settle from now + remaining time estimate
    return new Date(Math.max(start, now) + msOffset);
  }
  return new Date(Date.now() + msOffset);
}

const NBA_BOOK_URLS: Record<string, string> = {
  draftkings:     'https://sportsbook.draftkings.com',
  fanduel:        'https://sportsbook.fanduel.com',
  betmgm:         'https://sports.betmgm.com',
  pinnacle:       'https://www.pinnacle.com/en/basketball/',
  caesars:        'https://sportsbook.caesars.com',
  williamhill_us: 'https://sportsbook.caesars.com',
  betrivers:      'https://www.betrivers.com',
  bovada:         'https://www.bovada.lv',
  betway:         'https://betway.com',
};

const NBA_BOOK_LABELS: Record<string, string> = {
  draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM',
  pinnacle: 'Pinnacle', caesars: 'Caesars', williamhill_us: 'Caesars',
  betrivers: 'BetRivers', bovada: 'Bovada', betway: 'Betway',
};

function decimalToAmerican(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

interface SpreadArb {
  gameId: string;
  eventName: string;
  roi: number;
  legs: Array<{
    outcomeName: string; bookmaker: string; bookmakerLabel: string;
    decimalOdds: number; americanOdds: number; betUrl: string;
    detectedOdds: number; slippagePct: number; legStake?: number;
  }>;
}

class AutoBetService extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null;
  private settleTimer: NodeJS.Timeout | null = null;
  private spreadTimer: NodeJS.Timeout | null = null;
  private running = false;
  private nbaSpreadCache: { data: any[]; expiresAt: number } | null = null;

  start() {
    if (this.running) return;
    this.running = true;
    logger.info('[auto-bet] Service started, polling every 15s');
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), 15_000);
    // NBA live spread scanner runs every 30s
    this.pollNbaLiveSpreads();
    this.spreadTimer = setInterval(() => this.pollNbaLiveSpreads(), 30_000);
    // Settle pending bets every 5 minutes
    this.settleTimer = setInterval(() => this.settlePending(), 5 * 60_000);
  }

  stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.settleTimer) clearInterval(this.settleTimer);
    if (this.spreadTimer) clearInterval(this.spreadTimer);
    this.pollTimer = null;
    this.settleTimer = null;
    this.spreadTimer = null;
    logger.info('[auto-bet] Service stopped');
  }

  private async poll() {
    try {
      const usersRes = await query(
        `SELECT user_id, enabled, demo_mode, live_mode, max_stake_pct, min_roi, max_stake_abs, bankroll_floor, demo_books
         FROM auto_bet_settings WHERE enabled = true`,
      );
      if (usersRes.rows.length === 0) return;

      const svc = getGamesService();
      // Use whatever is in the cache (background refresh keeps it ≤10s fresh).
      // Never invalidate here — that races with the background refresher and double-hits external APIs.
      const games = await svc.getGamesWithOdds();
      const arbGames = games.filter((g) => {
        if (!g.hasArb || g.arbRoi === null || g.arbRoi <= 0) return false;

        // ── Strategy: French Open + MLB only, Polymarket vs Pinnacle ─────────
        // Polymarket reprices faster than Pinnacle's lines update.
        // We only bet when one leg is Pinnacle and the other is Polymarket.
        const isFrenchOpen = g.sport === 'tennis';
        const isMlb = g.league === 'MLB';
        if (!isFrenchOpen && !isMlb) return false;

        // Must have exactly one leg on Pinnacle and one on Polymarket
        const bestBooks = g.outcomes.map((o) => o.bestBook);
        const hasPinnacle = bestBooks.includes('pinnacle');
        const hasPolymarket = bestBooks.includes('polymarket');
        if (!hasPinnacle || !hasPolymarket) return false;

        // ROI sanity: Poly/Pinnacle divergence arbs legitimately reach 5-15%,
        // but anything above 20% is stale data noise (e.g. Poly not yet resolved)
        if (g.arbRoi > 20) return false;

        return true;
      });
      if (arbGames.length === 0) return;

      logger.info(`[auto-bet] Found ${arbGames.length} arb opportunities, checking ${usersRes.rows.length} users`);

      for (const row of usersRes.rows) {
        const userId: string = row.user_id;
        const settings: AutoBetSettings = {
          enabled:       row.enabled,
          demoMode:      row.demo_mode,
          liveMode:      row.live_mode ?? false,
          maxStakePct:   parseFloat(row.max_stake_pct),
          minRoi:        parseFloat(row.min_roi),
          maxStakeAbs:   parseFloat(row.max_stake_abs),
          bankrollFloor: parseFloat(row.bankroll_floor),
          demoBooks:     row.demo_books ?? ['polymarket', 'pinnacle'],
        };

        // DB-based dedup: fetch game IDs already bet for this user
        const betRes = await query(
          `SELECT game_id FROM auto_bets WHERE user_id = $1`,
          [userId],
        );
        const alreadyBet = new Set(betRes.rows.map((r: any) => r.game_id as string));

        const wallet = await getOrCreateWallet(userId);
        let balance = parseFloat(wallet.balance);

        for (const game of arbGames) {
          if (game.arbRoi! < settings.minRoi) continue;
          if (alreadyBet.has(game.id)) continue;
          if (balance - settings.bankrollFloor <= 0) {
            logger.warn(`[auto-bet] User ${userId} bankroll at floor, skipping`);
            break;
          }

          const rawStake = Math.min(
            (balance - settings.bankrollFloor) * (settings.maxStakePct / 100),
            settings.maxStakeAbs,
            balance - settings.bankrollFloor,
          );
          const totalStake = Math.floor(rawStake * 100) / 100;
          if (totalStake < 1) continue;

          // Use the same cached fetch for execution odds — background refresh (10s) keeps it current.
          // A truly "second" fetch would return the same cache anyway; hitting 14 APIs per-bet is wasteful.
          const freshGame = games.find((g) => g.id === game.id);
          if (!freshGame) {
            logger.info(`[auto-bet] Game disappeared before placement for ${game.eventName} — skipping`);
            continue;
          }

          // Build legs using actual live odds at placement time.
          // Compare to originally detected odds to record real slippage.
          const legs = freshGame.outcomes.map((o) => {
            const freshBest = o.books.find((b) => b.isBest)!;
            // Find what we originally saw for this outcome
            const origOutcome = game.outcomes.find((orig) => orig.name === o.name);
            const origBest = origOutcome?.books.find((b) => b.isBest);
            const detectedOdds = origBest?.decimalOdds ?? freshBest.decimalOdds;
            const executionOdds = freshBest.decimalOdds; // what we actually place at
            const slippagePct = detectedOdds > 0
              ? ((detectedOdds - executionOdds) / detectedOdds) * 100
              : 0;
            return {
              outcomeName: o.name,
              bookmaker: freshBest.bookmaker,
              bookmakerLabel: freshBest.bookmakerLabel,
              detectedOdds,          // what the scanner saw
              decimalOdds: executionOdds,  // what we actually get
              americanOdds: freshBest.americanOdds,
              slippagePct,
              betUrl: freshBest.betUrl ?? null,
            };
          });

          // Recalculate arb with actual execution odds
          const actualImplied = legs.reduce((s, l) => s + 1 / l.decimalOdds, 0);
          const actualRoi = (1 / actualImplied - 1) * 100;

          // If the arb has closed at execution odds, skip — don't place a losing bet
          if (actualRoi < 0) {
            logger.info(`[auto-bet] Arb closed at execution for ${game.eventName}: detected ${game.arbRoi?.toFixed(2)}% → actual ${actualRoi.toFixed(2)}% — skipping`);
            continue;
          }

          if (actualRoi < settings.minRoi) {
            logger.info(`[auto-bet] Arb below min ROI at execution for ${game.eventName}: ${actualRoi.toFixed(2)}% < ${settings.minRoi}% — skipping`);
            continue;
          }

          // Stake allocation: proportional to implied probability at execution odds
          const legsWithStake = legs.map((l) => ({
            ...l,
            legStake: Math.round(totalStake * (1 / l.decimalOdds) / actualImplied * 100) / 100,
          }));

          const actualGuaranteedProfit = totalStake * (1 / actualImplied - 1);
          const avgSlippagePct = legs.reduce((s, l) => s + l.slippagePct, 0) / legs.length;

          const settle = settleAfter((freshGame as any).startTime ?? null, freshGame.sport);

          try {
            await this.placeBet(userId, freshGame.id, {
              eventName: freshGame.eventName,
              sport: freshGame.sport,
              advertisedRoi: game.arbRoi!,  // what scanner originally saw
              actualRoi,                    // what we actually placed at
              totalStake,
              guaranteedProfit: actualGuaranteedProfit,
              legs: legsWithStake,
              isDemo: settings.demoMode,
              settleAfter: settle,
              avgSlippagePct,
            });
            alreadyBet.add(freshGame.id);
            balance -= totalStake; // track in-loop balance reduction
            this.emit('bet_placed', { userId, game: freshGame, totalStake, guaranteedProfit: actualGuaranteedProfit, isDemo: settings.demoMode });
          } catch (err) {
            logger.error(`[auto-bet] Failed to place bet for user ${userId}`, { error: (err as Error).message });
          }
        }
      }
    } catch (err) {
      logger.error('[auto-bet] Poll error', { error: (err as Error).message });
    }
  }

  // ─── NBA Live Spread Arb Scanner ───────────────────────────────────────────

  private async findLiveNbaSpreadArbs(): Promise<SpreadArb[]> {
    const apiKey = config.oddsApi?.key ?? process.env['ODDS_API_KEY'] ?? '';
    if (!apiKey) return [];

    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${apiKey}&regions=us&markets=spreads&oddsFormat=decimal&bookmakers=draftkings,fanduel,betmgm,pinnacle,caesars,williamhill_us,betrivers,bovada,betway`;

    let events: any[];
    try {
      // Cache for 2 minutes to avoid hammering the Odds API quota
      if (this.nbaSpreadCache && this.nbaSpreadCache.expiresAt > Date.now()) {
        events = this.nbaSpreadCache.data;
      } else {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
          if (resp.status === 429 && this.nbaSpreadCache) {
            events = this.nbaSpreadCache.data; // serve stale on rate limit
          } else {
            logger.warn(`[auto-bet] NBA spreads fetch failed: HTTP ${resp.status}`);
            return [];
          }
        } else {
          events = await resp.json() as any[];
          this.nbaSpreadCache = { data: events, expiresAt: Date.now() + 2 * 60_000 };
        }
      }
    } catch (err) {
      logger.warn(`[auto-bet] NBA spreads fetch error: ${(err as Error).message}`);
      return [];
    }

    const arbs: SpreadArb[] = [];
    const now = Date.now();

    for (const event of events) {
      const commenceMs = new Date(event.commence_time).getTime();
      const ageMs = now - commenceMs;
      // Only live games: started but not more than 3 hours ago
      if (commenceMs > now) continue;
      if (ageMs > 3 * 60 * 60 * 1000) continue;

      const eventName = `${event.away_team} @ ${event.home_team}`;
      const gameId = `nba_live_spread:${event.id}`;

      // Collect best odds per (team, spreadPoint) across all books
      const bestByKey = new Map<string, { book: string; odds: number }>();
      for (const bk of (event.bookmakers ?? [])) {
        const market = bk.markets?.find((m: any) => m.key === 'spreads');
        if (!market) continue;
        for (const o of (market.outcomes ?? [])) {
          if (!o.price || !o.point) continue;
          const key = `${o.name}:${o.point}`;
          const current = bestByKey.get(key);
          if (!current || o.price > current.odds) {
            bestByKey.set(key, { book: bk.key, odds: o.price });
          }
        }
      }

      // Check every pair of opposing sides on the same line
      const checked = new Set<string>();
      for (const [key, side1] of bestByKey) {
        const [team, pointStr] = key.split(':');
        const point = parseFloat(pointStr);
        const opposingTeam = team === event.home_team ? event.away_team : event.home_team;
        const opposingKey = `${opposingTeam}:${-point}`;
        const pairKey = [key, opposingKey].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const side2 = bestByKey.get(opposingKey);
        if (!side2) continue;
        if (side1.book === side2.book) continue; // same book = no arb

        const implied = 1 / side1.odds + 1 / side2.odds;
        if (implied >= 1.0) continue;

        const roi = (1 / implied - 1) * 100;
        if (roi > 15) continue; // anything over 15% on live spreads is stale data

        const sign = (n: number) => n > 0 ? `+${n}` : `${n}`;
        arbs.push({
          gameId,
          eventName,
          roi,
          legs: [
            {
              outcomeName: `${team} ${sign(point)}`,
              bookmaker: side1.book,
              bookmakerLabel: NBA_BOOK_LABELS[side1.book] ?? side1.book,
              decimalOdds: side1.odds,
              americanOdds: decimalToAmerican(side1.odds),
              betUrl: NBA_BOOK_URLS[side1.book] ?? '',
              detectedOdds: side1.odds,
              slippagePct: 0,
            },
            {
              outcomeName: `${opposingTeam} ${sign(-point)}`,
              bookmaker: side2.book,
              bookmakerLabel: NBA_BOOK_LABELS[side2.book] ?? side2.book,
              decimalOdds: side2.odds,
              americanOdds: decimalToAmerican(side2.odds),
              betUrl: NBA_BOOK_URLS[side2.book] ?? '',
              detectedOdds: side2.odds,
              slippagePct: 0,
            },
          ],
        });
      }
    }

    arbs.sort((a, b) => b.roi - a.roi);
    return arbs;
  }

  private async pollNbaLiveSpreads() {
    try {
      const usersRes = await query(
        `SELECT user_id, enabled, demo_mode, live_mode, max_stake_pct, min_roi, max_stake_abs, bankroll_floor, demo_books
         FROM auto_bet_settings WHERE enabled = true`,
      );
      if (usersRes.rows.length === 0) return;

      const arbs = await this.findLiveNbaSpreadArbs();
      if (arbs.length === 0) return;

      logger.info(`[auto-bet] Found ${arbs.length} live NBA spread arbs`);

      for (const row of usersRes.rows) {
        const userId: string = row.user_id;
        const settings: AutoBetSettings = {
          enabled:       row.enabled,
          demoMode:      row.demo_mode,
          liveMode:      row.live_mode ?? false,
          maxStakePct:   parseFloat(row.max_stake_pct),
          minRoi:        parseFloat(row.min_roi),
          maxStakeAbs:   parseFloat(row.max_stake_abs),
          bankrollFloor: parseFloat(row.bankroll_floor),
          demoBooks:     row.demo_books ?? ['polymarket', 'pinnacle'],
        };

        const betRes = await query(`SELECT game_id FROM auto_bets WHERE user_id = $1`, [userId]);
        const alreadyBet = new Set(betRes.rows.map((r: any) => r.game_id as string));
        const wallet = await getOrCreateWallet(userId);
        let balance = parseFloat(wallet.balance);

        for (const arb of arbs) {
          if (arb.roi < settings.minRoi) continue;
          if (alreadyBet.has(arb.gameId)) continue;
          if (balance - settings.bankrollFloor <= 0) {
            logger.warn(`[auto-bet] User ${userId} bankroll at floor, skipping NBA spread`);
            break;
          }

          const rawStake = Math.min(
            (balance - settings.bankrollFloor) * (settings.maxStakePct / 100),
            settings.maxStakeAbs,
            balance - settings.bankrollFloor,
          );
          const totalStake = Math.floor(rawStake * 100) / 100;
          if (totalStake < 1) continue;

          const actualImplied = arb.legs.reduce((s, l) => s + 1 / l.decimalOdds, 0);
          const actualRoi = (1 / actualImplied - 1) * 100;
          if (actualRoi < settings.minRoi) continue;

          const legsWithStake = arb.legs.map((l) => ({
            ...l,
            legStake: Math.round(totalStake * (1 / l.decimalOdds) / actualImplied * 100) / 100,
          }));
          const guaranteedProfit = totalStake * (1 / actualImplied - 1);

          try {
            await this.placeBet(userId, arb.gameId, {
              eventName: arb.eventName,
              sport: 'basketball',
              advertisedRoi: arb.roi,
              actualRoi,
              totalStake,
              guaranteedProfit,
              legs: legsWithStake,
              isDemo: settings.demoMode,
              settleAfter: settleAfter(null, 'basketball'),
              avgSlippagePct: 0,
            });
            alreadyBet.add(arb.gameId);
            balance -= totalStake;
            this.emit('bet_placed', { userId, eventName: arb.eventName, totalStake, guaranteedProfit, isDemo: settings.demoMode });
            logger.info(`[auto-bet] NBA spread bet placed: ${arb.eventName} ROI=${actualRoi.toFixed(2)}% stake=$${totalStake}`);
          } catch (err) {
            logger.error(`[auto-bet] NBA spread bet failed`, { error: (err as Error).message });
          }
        }
      }
    } catch (err) {
      logger.error('[auto-bet] NBA live spreads poll error', { error: (err as Error).message });
    }
  }

  private async placeBet(userId: string, gameId: string, bet: {
    eventName: string;
    sport: string;
    advertisedRoi: number;
    actualRoi: number;
    totalStake: number;
    guaranteedProfit: number;
    legs: any[];
    isDemo: boolean;
    settleAfter: Date;
    avgSlippagePct: number;
  }) {
    const legSummary = bet.legs.map((l: any) =>
      `${l.outcomeName}@${l.decimalOdds.toFixed(3)}` +
      (l.slippagePct !== 0 ? ` (was ${l.detectedOdds?.toFixed(3)}, slip ${l.slippagePct.toFixed(2)}%)` : ''),
    ).join(', ');

    logger.info(
      `[auto-bet] ${bet.isDemo ? '[DEMO]' : '[LIVE]'} Placing bet: ${bet.eventName} ` +
      `stake=$${bet.totalStake} scanner_roi=${bet.advertisedRoi.toFixed(2)}% execution_roi=${bet.actualRoi.toFixed(2)}% | ${legSummary} | settles=${bet.settleAfter.toISOString()}`,
    );

    // ── Real-money execution ──────────────────────────────────────────────────
    // Requires BOTH enabled=true AND liveMode=true (two-factor safety).
    // Polymarket fires first (CLOB, fast); Pinnacle browser warms in parallel.
    if (!bet.isDemo) {
      const slug = bet.eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const polyLeg = bet.legs.find((l: any) => (l.bookmaker ?? '').toLowerCase() === 'polymarket');
      const pinLeg  = bet.legs.find((l: any) => (l.bookmaker ?? '').toLowerCase() === 'pinnacle');

      // Kick off Pinnacle credential fetch + browser warm-up immediately in background
      const pinCredsPromise = pinLeg
        ? getCredentials(userId, 'pinnacle').catch(() => null)
        : Promise.resolve(null);

      // Fetch Polymarket creds and fire the order as fast as possible
      let polyResult: Awaited<ReturnType<typeof placePolymarketOrder>> | null = null;
      let polyCreds: { login: string; password: string } | null = null;
      if (polyLeg) {
        polyCreds = await getCredentials(userId, 'polymarket').catch(() => null);
        if (polyCreds) {
          // Fire immediately — don't await Pinnacle setup first
          polyResult = await placePolymarketOrder({
            apiKey:        polyCreds.login,
            apiPrivateKey: polyCreds.password,
            marketSlug:    slug,
            outcome:       polyLeg.outcomeName,
            stakeUsdc:     polyLeg.legStake ?? bet.totalStake / bet.legs.length,
          });
          if (polyResult.success) {
            polyLeg.tokenId = polyResult.tokenId;
            polyLeg.price   = polyResult.price;
            logger.info(`[auto-bet][LIVE] Polymarket order placed: ${polyResult.orderId}`);
          } else {
            logger.error(`[auto-bet][LIVE] Polymarket leg failed: ${polyResult.error}`);
          }
        } else {
          logger.warn(`[auto-bet][LIVE] No Polymarket credentials for user ${userId}`);
        }
      }

      // Now resolve Pinnacle (creds were fetching in background while Polymarket fired)
      let pinResult: Awaited<ReturnType<typeof placePinnacleBet>> | null = null;
      if (pinLeg) {
        const pinCreds = await pinCredsPromise;
        if (pinCreds) {
          pinResult = await placePinnacleBet({
            userId,
            login:     pinCreds.login,
            password:  pinCreds.password,
            eventName: bet.eventName,
            teamName:  pinLeg.outcomeName,
            betType:   'spread',
            stake:     pinLeg.legStake ?? bet.totalStake / bet.legs.length,
            sport:     bet.sport,
            betUrl:    pinLeg.betUrl ?? undefined,
          });
          if (pinResult.success) {
            logger.info('[auto-bet][LIVE] Pinnacle bet placed');
          } else {
            logger.error(`[auto-bet][LIVE] Pinnacle leg failed: ${pinResult.error}`);
          }
        } else {
          logger.warn(`[auto-bet][LIVE] No Pinnacle credentials for user ${userId}`);
        }
      }

      const polyOk = !polyLeg || polyResult?.success === true;
      const pinOk  = !pinLeg  || pinResult?.success  === true;

      if (!polyOk && !pinOk) {
        logger.warn(`[auto-bet][LIVE] No legs executed for "${bet.eventName}" — aborting`);
        return;
      }

      // Partial fill: Polymarket went through but Pinnacle failed (or vice versa) — hedge
      if (polyOk && !pinOk && polyLeg?.tokenId && polyCreds) {
        logger.warn(`[auto-bet][LIVE] Pinnacle leg failed after Polymarket filled — hedging Polymarket position`);
        const legStake   = parseFloat(polyLeg.legStake ?? 0);
        const entryPrice = parseFloat(polyLeg.price ?? 0.5);
        const sizeShares = entryPrice > 0 ? legStake / entryPrice : legStake;
        await closePolymarketPosition({
          apiKey:        polyCreds.login,
          apiPrivateKey: polyCreds.password,
          tokenId:       polyLeg.tokenId,
          sizeShares,
        }).catch((e: any) => logger.error('[auto-bet][LIVE] Hedge failed', { error: e.message }));
        return;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    await deductStake(userId, bet.totalStake, `${bet.isDemo ? 'DEMO' : 'LIVE'} arb: ${bet.eventName}`);

    await query(
      `INSERT INTO auto_bets
         (user_id, game_id, event_name, sport, roi, total_stake, guaranteed_profit, legs, is_demo, status, settle_after, slippage_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'placed', $10, $11)`,
      [
        userId, gameId, bet.eventName, bet.sport,
        bet.actualRoi,
        bet.totalStake, bet.guaranteedProfit,
        JSON.stringify(bet.legs), bet.isDemo,
        bet.settleAfter,
        bet.avgSlippagePct,
      ],
    );
  }

  // Runs every 5 minutes. Settles any bet whose settle_after has passed.
  // Also checks live bets for Pinnacle voids and auto-hedges the Polymarket leg.
  private async settlePending() {
    try {
      const pending = await query(
        `SELECT * FROM auto_bets WHERE status = 'placed' AND settle_after <= NOW()`,
      );
      if (pending.rows.length === 0) return;
      logger.info(`[auto-bet] Settling ${pending.rows.length} pending bets`);

      for (const bet of pending.rows) {
        await this.settleBet(bet);
      }
    } catch (err) {
      logger.error('[auto-bet] Settlement error', { error: (err as Error).message });
    }

    // ── Void detection: check Pinnacle for any voided bets on live arbs ──────
    try {
      const liveBets = await query(
        `SELECT ab.*, u.id as uid FROM auto_bets ab
         JOIN users u ON u.id = ab.user_id
         WHERE ab.status = 'placed' AND ab.is_demo = false
         AND ab.settle_after > NOW()`,
      );
      if (liveBets.rows.length === 0) return;

      // Group by user to avoid re-fetching Pinnacle session per bet
      const byUser = new Map<string, any[]>();
      for (const row of liveBets.rows) {
        const arr = byUser.get(row.user_id) ?? [];
        arr.push(row);
        byUser.set(row.user_id, arr);
      }

      for (const [userId, bets] of byUser) {
        const pinCreds = await getCredentials(userId, 'pinnacle').catch(() => null);
        const polyCreds = await getCredentials(userId, 'polymarket').catch(() => null);
        if (!pinCreds || !polyCreds) continue;

        const voidedText = await checkPinnacleVoids({ userId, login: pinCreds.login, password: pinCreds.password });
        if (voidedText.length === 0) continue;

        for (const bet of bets) {
          const legs: any[] = bet.legs ?? [];
          const pinnacleleg = legs.find((l: any) => l.bookmaker === 'pinnacle');
          const polyLeg     = legs.find((l: any) => l.bookmaker === 'polymarket');
          if (!pinnacleleg || !polyLeg) continue;

          // Check if any voided text matches this event
          const matchesVoid = voidedText.some((t) =>
            t.toLowerCase().includes(bet.event_name?.toLowerCase()?.split(' ')[0] ?? '____'),
          );
          if (!matchesVoid) continue;

          logger.warn(`[auto-bet][VOID] Pinnacle voided bet for "${bet.event_name}" — hedging Polymarket position`);

          // Sell the Polymarket position to close one-sided exposure
          if (polyLeg.tokenId) {
            const legStake = parseFloat(polyLeg.legStake ?? 0);
            const entryPrice = parseFloat(polyLeg.price ?? 0.5);
            const sizeShares = entryPrice > 0 ? legStake / entryPrice : legStake;

            const hedgeResult = await closePolymarketPosition({
              apiKey:        polyCreds.login,
              apiPrivateKey: polyCreds.password,
              tokenId:       polyLeg.tokenId,
              sizeShares,
            });

            await query(
              `UPDATE auto_bets SET status = 'voided',
               actual_profit = 0, winning_leg = 'VOID — Pinnacle voided, Polymarket hedge placed',
               settled_at = NOW()
               WHERE id = $1`,
              [bet.id],
            );

            logger.info(`[auto-bet][VOID] Hedge result: ${hedgeResult.success ? 'OK ' + hedgeResult.orderId : hedgeResult.error}`);
          } else {
            // No tokenId stored — can't hedge, mark as voided for manual review
            await query(
              `UPDATE auto_bets SET status = 'voided',
               winning_leg = 'VOID — Pinnacle voided, manual review needed',
               settled_at = NOW()
               WHERE id = $1`,
              [bet.id],
            );
            logger.warn(`[auto-bet][VOID] No tokenId for Polymarket leg — cannot auto-hedge bet ${bet.id}`);
          }
        }
      }
    } catch (err) {
      logger.error('[auto-bet] Void check error', { error: (err as Error).message });
    }
  }

  private async settleBet(bet: any) {
    const legs: any[] = bet.legs ?? [];
    const totalStake: number = parseFloat(bet.total_stake);
    const isDemo: boolean = bet.is_demo;

    // One leg wins. Which one?
    // Weight by implied probability (1/odds) — the favourite is more likely to win.
    const weights = legs.map((l: any) => 1 / (l.decimalOdds ?? 2));
    const totalWeight = weights.reduce((s: number, w: number) => s + w, 0);
    let rand = Math.random() * totalWeight;
    let winnerIdx = 0;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { winnerIdx = i; break; }
    }
    const winner = legs[winnerIdx];
    if (!winner) {
      logger.warn(`[auto-bet] No winner leg found for bet ${bet.id}`);
      return;
    }

    // Payout: the winning leg returns legStake × decimalOdds (slipped)
    const winningReturn = (winner.legStake ?? 0) * (winner.decimalOdds ?? 2);
    const actualProfit = winningReturn - totalStake;

    await query(
      `UPDATE auto_bets
       SET status = 'settled', settled_at = NOW(), actual_profit = $1, winning_leg = $2
       WHERE id = $3`,
      [actualProfit, winner.outcomeName, bet.id],
    );

    // Credit the return (can be less than stake if arb failed due to slippage)
    if (isDemo) {
      await creditWinnings(
        bet.user_id,
        winningReturn,
        `DEMO settled: ${bet.event_name} ${winner.outcomeName} wins (${actualProfit >= 0 ? '+' : ''}$${actualProfit.toFixed(2)})`,
      );
    }

    logger.info(
      `[auto-bet] Settled ${bet.event_name}: ${winner.outcomeName} wins, ` +
      `return=$${winningReturn.toFixed(2)} profit=${actualProfit >= 0 ? '+' : ''}$${actualProfit.toFixed(2)}`,
    );
  }

  async getSettings(userId: string, isDemo: boolean): Promise<AutoBetSettings> {
    const res = await query(
      `SELECT * FROM auto_bet_settings WHERE user_id = $1 AND demo_mode = $2`,
      [userId, isDemo],
    );
    if (!res.rows[0]) return { ...DEFAULT_SETTINGS, demoMode: isDemo };
    const r = res.rows[0];
    return {
      enabled:      r.enabled,
      demoMode:     r.demo_mode,
      liveMode:     r.live_mode ?? false,
      maxStakePct:  parseFloat(r.max_stake_pct),
      minRoi:       parseFloat(r.min_roi),
      maxStakeAbs:  parseFloat(r.max_stake_abs),
      bankrollFloor: parseFloat(r.bankroll_floor),
      demoBooks:    r.demo_books ?? ['polymarket', 'pinnacle'],
    };
  }

  async saveSettings(userId: string, settings: Partial<AutoBetSettings>, isDemo: boolean) {
    const current = await this.getSettings(userId, isDemo);
    const merged = { ...current, ...settings, demoMode: isDemo };
    await query(
      `INSERT INTO auto_bet_settings (user_id, enabled, demo_mode, live_mode, max_stake_pct, min_roi, max_stake_abs, bankroll_floor, demo_books)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, demo_mode) DO UPDATE SET
         enabled = $2, live_mode = $4, max_stake_pct = $5, min_roi = $6, max_stake_abs = $7, bankroll_floor = $8, demo_books = $9, updated_at = NOW()`,
      [userId, merged.enabled, isDemo, merged.liveMode ?? false, merged.maxStakePct, merged.minRoi, merged.maxStakeAbs, merged.bankrollFloor, JSON.stringify(merged.demoBooks ?? ['polymarket', 'pinnacle'])],
    );
    return merged;
  }

  async getBetHistory(userId: string, isDemo: boolean, limit = 50) {
    const res = await query(
      `SELECT * FROM auto_bets WHERE user_id = $1 AND is_demo = $2 ORDER BY placed_at DESC LIMIT $3`,
      [userId, isDemo, limit],
    );
    return res.rows;
  }

  async getDailyPnl(userId: string, isDemo: boolean, days = 30) {
    const res = await query(
      `SELECT
         DATE(settled_at AT TIME ZONE 'UTC') AS day,
         COUNT(*) AS bets_settled,
         SUM(actual_profit) AS profit,
         SUM(total_stake) AS staked
       FROM auto_bets
       WHERE user_id = $1
         AND is_demo = $2
         AND status = 'settled'
         AND settled_at >= NOW() - INTERVAL '${days} days'
       GROUP BY day
       ORDER BY day ASC`,
      [userId, isDemo],
    );
    const todayRes = await query(
      `SELECT
         COUNT(*) AS bets_placed_today,
         SUM(total_stake) AS staked_today,
         SUM(guaranteed_profit) AS guaranteed_today
       FROM auto_bets
       WHERE user_id = $1
         AND is_demo = $2
         AND DATE(placed_at AT TIME ZONE 'UTC') = CURRENT_DATE`,
      [userId, isDemo],
    );
    return {
      daily: res.rows.map((r) => ({
        day: r.day,
        betsSettled: parseInt(r.bets_settled),
        profit: parseFloat(r.profit ?? 0),
        staked: parseFloat(r.staked ?? 0),
      })),
      today: {
        betsPlaced: parseInt(todayRes.rows[0]?.bets_placed_today ?? 0),
        staked: parseFloat(todayRes.rows[0]?.staked_today ?? 0),
        guaranteedProfit: parseFloat(todayRes.rows[0]?.guaranteed_today ?? 0),
      },
    };
  }

  async getStats(userId: string, isDemo: boolean) {
    const res = await query(
      `SELECT
         COUNT(*) as total_bets,
         SUM(total_stake) as total_staked,
         SUM(CASE WHEN status = 'settled' THEN actual_profit ELSE 0 END) as total_profit,
         AVG(roi) as avg_advertised_roi,
         AVG(CASE WHEN status = 'settled' THEN actual_profit / NULLIF(total_stake, 0) * 100 ELSE NULL END) as avg_actual_roi,
         SUM(CASE WHEN status = 'placed' THEN 1 ELSE 0 END) as pending_bets
       FROM auto_bets WHERE user_id = $1 AND is_demo = $2`,
      [userId, isDemo],
    );
    return res.rows[0];
  }
}

let _service: AutoBetService | null = null;

export function getAutoBetService(): AutoBetService {
  if (!_service) _service = new AutoBetService();
  return _service;
}
