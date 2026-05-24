import { EventEmitter } from 'events';
import { query } from '../db';
import { logger } from '../logger';
import { getOrCreateWallet, deductStake, creditWinnings } from './wallet.service';
import { getGamesService } from './games.service';

interface AutoBetSettings {
  enabled: boolean;
  demoMode: boolean;
  maxStakePct: number;
  minRoi: number;
  maxStakeAbs: number;
  bankrollFloor: number;
}

const DEFAULT_SETTINGS: AutoBetSettings = {
  enabled: false,
  demoMode: true,
  maxStakePct: 5,
  minRoi: 1.0,
  maxStakeAbs: 500,
  bankrollFloor: 100,
};

// Track already-bet game IDs per user in memory to avoid duplicate bets
const betPlacedFor = new Map<string, Set<string>>(); // userId -> Set<gameId>

class AutoBetService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    logger.info('[auto-bet] Service started, polling every 60s');
    this.poll();
    this.timer = setInterval(() => this.poll(), 60_000);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info('[auto-bet] Service stopped');
  }

  private async poll() {
    try {
      // Get all users who have auto-bet enabled
      const usersRes = await query(
        `SELECT abs.user_id, abs.enabled, abs.demo_mode, abs.max_stake_pct, abs.min_roi, abs.max_stake_abs, abs.bankroll_floor
         FROM auto_bet_settings abs WHERE abs.enabled = true`,
      );
      if (usersRes.rows.length === 0) return;

      // Fetch current arb opportunities — always bypass cache so odds are fresh
      const svc = getGamesService();
      svc.invalidateCache();
      const games = await svc.getGamesWithOdds();
      const arbGames = games.filter((g) => g.hasArb && g.arbRoi !== null && g.arbRoi > 0);
      if (arbGames.length === 0) return;

      logger.info(`[auto-bet] Found ${arbGames.length} arb opportunities, checking ${usersRes.rows.length} users`);

      for (const row of usersRes.rows) {
        const userId: string = row.user_id;
        const settings: AutoBetSettings = {
          enabled: row.enabled,
          demoMode: row.demo_mode,
          maxStakePct: parseFloat(row.max_stake_pct),
          minRoi: parseFloat(row.min_roi),
          maxStakeAbs: parseFloat(row.max_stake_abs),
          bankrollFloor: parseFloat(row.bankroll_floor),
        };

        if (!betPlacedFor.has(userId)) betPlacedFor.set(userId, new Set());
        const alreadyBet = betPlacedFor.get(userId)!;

        const wallet = await getOrCreateWallet(userId);
        const balance = parseFloat(wallet.balance);

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

          const totalImplied = game.outcomes.reduce((s, o) => {
            const best = o.books.find((b) => b.isBest);
            return best ? s + 1 / best.decimalOdds : s;
          }, 0);
          const guaranteedProfit = totalStake * (1 / totalImplied - 1);

          const legs = game.outcomes.map((o) => {
            const best = o.books.find((b) => b.isBest)!;
            const legStake = totalStake * (1 / best.decimalOdds) / totalImplied;
            return {
              outcomeName: o.name,
              bookmaker: best.bookmaker,
              bookmakerLabel: best.bookmakerLabel,
              decimalOdds: best.decimalOdds,
              americanOdds: best.americanOdds,
              legStake: Math.round(legStake * 100) / 100,
              betUrl: best.betUrl ?? null,
            };
          });

          try {
            // Re-validate with a second fresh fetch right before placing
            // This ensures the arb window hasn't closed in the last few seconds
            const freshGames = await getGamesService().getGamesWithOdds();
            const freshGame = freshGames.find((g) => g.id === game.id);
            if (!freshGame?.hasArb || (freshGame.arbRoi ?? 0) < settings.minRoi) {
              logger.info(`[auto-bet] Arb closed before placement for ${game.eventName} — skipping`);
              continue;
            }

            // Recalculate with fresh odds
            const freshImplied = freshGame.outcomes.reduce((s, o) => {
              const best = o.books.find((b) => b.isBest);
              return best ? s + 1 / best.decimalOdds : s;
            }, 0);
            const freshProfit = totalStake * (1 / freshImplied - 1);
            const freshLegs = freshGame.outcomes.map((o) => {
              const best = o.books.find((b) => b.isBest)!;
              return {
                outcomeName: o.name,
                bookmaker: best.bookmaker,
                bookmakerLabel: best.bookmakerLabel,
                decimalOdds: best.decimalOdds,
                americanOdds: best.americanOdds,
                legStake: Math.round(totalStake * (1 / best.decimalOdds) / freshImplied * 100) / 100,
                betUrl: best.betUrl ?? null,
              };
            });

            await this.placeBet(userId, game.id, {
              eventName: freshGame.eventName,
              sport: freshGame.sport,
              roi: freshGame.arbRoi!,
              totalStake,
              guaranteedProfit: freshProfit,
              legs: freshLegs,
              isDemo: settings.demoMode,
            });
            alreadyBet.add(game.id);
            this.emit('bet_placed', { userId, game: freshGame, totalStake, guaranteedProfit: freshProfit, isDemo: settings.demoMode });
          } catch (err) {
            logger.error(`[auto-bet] Failed to place bet for user ${userId}`, { error: (err as Error).message });
          }
        }
      }
    } catch (err) {
      logger.error('[auto-bet] Poll error', { error: (err as Error).message });
    }
  }

  private async placeBet(userId: string, gameId: string, bet: {
    eventName: string;
    sport: string;
    roi: number;
    totalStake: number;
    guaranteedProfit: number;
    legs: any[];
    isDemo: boolean;
  }) {
    logger.info(`[auto-bet] ${bet.isDemo ? '[DEMO]' : '[LIVE]'} Placing bet: ${bet.eventName} stake=$${bet.totalStake} roi=${bet.roi.toFixed(2)}%`);

    // Deduct stake from wallet
    await deductStake(userId, bet.totalStake, `${bet.isDemo ? 'DEMO' : 'LIVE'} bet: ${bet.eventName}`);

    // In demo mode: credit the guaranteed profit immediately (arb = guaranteed)
    if (bet.isDemo) {
      const returns = bet.totalStake + bet.guaranteedProfit;
      await creditWinnings(userId, returns, `DEMO win: ${bet.eventName} (+$${bet.guaranteedProfit.toFixed(2)})`);
    }
    // In live mode: actual bet placement would happen here
    // Kalshi: POST /trade-api/v2/portfolio/orders
    // Others: Playwright automation
    // For now, live mode deducts and waits for manual settlement

    // Log the bet
    await query(
      `INSERT INTO auto_bets (user_id, game_id, event_name, sport, roi, total_stake, guaranteed_profit, legs, is_demo, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'placed')`,
      [userId, gameId, bet.eventName, bet.sport, bet.roi, bet.totalStake, bet.guaranteedProfit, JSON.stringify(bet.legs), bet.isDemo],
    );

    if (bet.isDemo) {
      logger.info(`[auto-bet] [DEMO] Settled immediately: +$${bet.guaranteedProfit.toFixed(2)} profit`);
    }
  }

  async getSettings(userId: string): Promise<AutoBetSettings> {
    const res = await query(`SELECT * FROM auto_bet_settings WHERE user_id = $1`, [userId]);
    if (!res.rows[0]) return DEFAULT_SETTINGS;
    const r = res.rows[0];
    return {
      enabled: r.enabled,
      demoMode: r.demo_mode,
      maxStakePct: parseFloat(r.max_stake_pct),
      minRoi: parseFloat(r.min_roi),
      maxStakeAbs: parseFloat(r.max_stake_abs),
      bankrollFloor: parseFloat(r.bankroll_floor),
    };
  }

  async saveSettings(userId: string, settings: Partial<AutoBetSettings>) {
    const current = await this.getSettings(userId);
    const merged = { ...current, ...settings };
    await query(
      `INSERT INTO auto_bet_settings (user_id, enabled, demo_mode, max_stake_pct, min_roi, max_stake_abs, bankroll_floor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = $2, demo_mode = $3, max_stake_pct = $4, min_roi = $5, max_stake_abs = $6, bankroll_floor = $7, updated_at = NOW()`,
      [userId, merged.enabled, merged.demoMode, merged.maxStakePct, merged.minRoi, merged.maxStakeAbs, merged.bankrollFloor],
    );
    return merged;
  }

  async getBetHistory(userId: string, limit = 50) {
    const res = await query(
      `SELECT * FROM auto_bets WHERE user_id = $1 ORDER BY placed_at DESC LIMIT $2`,
      [userId, limit],
    );
    return res.rows;
  }

  async getStats(userId: string) {
    const res = await query(
      `SELECT
         COUNT(*) as total_bets,
         SUM(total_stake) as total_staked,
         SUM(guaranteed_profit) as total_profit,
         AVG(roi) as avg_roi,
         SUM(CASE WHEN is_demo THEN 1 ELSE 0 END) as demo_bets,
         SUM(CASE WHEN NOT is_demo THEN 1 ELSE 0 END) as live_bets
       FROM auto_bets WHERE user_id = $1`,
      [userId],
    );
    return res.rows[0];
  }
}

let _service: AutoBetService | null = null;

export function getAutoBetService(): AutoBetService {
  if (!_service) _service = new AutoBetService();
  return _service;
}
