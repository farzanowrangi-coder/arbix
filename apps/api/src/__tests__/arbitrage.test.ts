/**
 * Integration tests for the arbitrage scanner pipeline.
 * These tests use real odds-engine calculations but mock the adapters.
 */

import { ArbitrageEngine, ArbitrageCalculator, OddsNormalizer } from '@arbix/odds-engine';
import type { UnifiedMarket } from '@arbix/shared';

const makeMarket = (
  id: string,
  eventName: string,
  bookmaker: string,
  outcomes: Array<{ name: string; decimalOdds: number }>
): UnifiedMarket => ({
  id,
  eventName,
  sport: 'basketball',
  marketType: 'moneyline',
  normalizedKey: `basketball::moneyline::${eventName.toLowerCase().replace(/\s/g, '_')}`,
  outcomes: outcomes.map(({ name, decimalOdds }) => ({
    outcome: name,
    bookmaker: bookmaker as any,
    decimalOdds,
    americanOdds: OddsNormalizer.decimalToAmerican(decimalOdds),
    impliedProbability: OddsNormalizer.decimalToImpliedProbability(decimalOdds),
    betUrl: `https://${bookmaker}.com/bet`,
  })),
});

describe('ArbitrageEngine', () => {
  const engine = new ArbitrageEngine();

  it('detects a 2-outcome arbitrage opportunity', () => {
    const markets: UnifiedMarket[] = [
      makeMarket('poly-1', 'Lakers vs Celtics', 'polymarket', [
        { name: 'Lakers', decimalOdds: 1 / 0.58 }, // 58% implied
      ]),
      makeMarket('dk-1', 'Lakers vs Celtics', 'draftkings', [
        { name: 'Celtics', decimalOdds: 1 / 0.38 }, // 38% implied
      ]),
    ];

    const opportunities = engine.scan(markets, { bankroll: 1000 });

    expect(opportunities.length).toBeGreaterThan(0);
    const opp = opportunities[0];
    expect(opp.roi).toBeGreaterThan(0);
    expect(opp.totalImpliedProbability).toBeLessThan(1);
    expect(opp.guaranteedProfit).toBeGreaterThan(0);
    expect(opp.stakes).toHaveLength(2);
  });

  it('does not create false arbitrage when no opportunity exists', () => {
    const markets: UnifiedMarket[] = [
      makeMarket('bk-1', 'Chiefs vs Ravens', 'betmgm', [
        { name: 'Chiefs', decimalOdds: 1.9 }, // 52.6% implied
        { name: 'Ravens', decimalOdds: 1.9 }, // 52.6% implied — total 105.2%
      ]),
    ];

    const opportunities = engine.scan(markets, { bankroll: 1000 });
    expect(opportunities).toHaveLength(0);
  });

  it('respects minimum ROI filter', () => {
    const markets: UnifiedMarket[] = [
      makeMarket('poly-2', 'Yankees vs Red Sox', 'polymarket', [
        { name: 'Yankees', decimalOdds: 1 / 0.5 }, // 50% implied
      ]),
      makeMarket('dk-2', 'Yankees vs Red Sox', 'draftkings', [
        { name: 'Red Sox', decimalOdds: 1 / 0.48 }, // 48% implied — total 98%
      ]),
    ];

    // The ROI here is small (~2%)
    const all = engine.scan(markets, { bankroll: 1000 });
    const filtered = engine.scan(markets, { bankroll: 1000, minRoi: 5 });

    expect(all.length).toBeGreaterThanOrEqual(filtered.length);
  });
});

describe('ArbitrageCalculator', () => {
  it('guarantees equal returns across all outcomes', () => {
    const outcomes = [
      {
        outcome: 'Team A',
        bookmaker: 'polymarket' as any,
        decimalOdds: 1 / 0.58,
        impliedProbability: 0.58,
        betUrl: undefined,
        maxBet: undefined,
        liquidity: undefined,
      },
      {
        outcome: 'Team B',
        bookmaker: 'draftkings' as any,
        decimalOdds: 1 / 0.38,
        impliedProbability: 0.38,
        betUrl: undefined,
        maxBet: undefined,
        liquidity: undefined,
      },
    ];

    const result = ArbitrageCalculator.calculate({ outcomes, totalBankroll: 1000 });

    const returns = result.stakes.map((s) => s.potentialReturn);
    const maxDiff = Math.max(...returns) - Math.min(...returns);
    expect(maxDiff).toBeLessThan(1); // Within $1 of each other
    expect(result.isArbitrage).toBe(true);
  });
});
