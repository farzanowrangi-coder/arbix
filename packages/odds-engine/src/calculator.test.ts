import { ArbitrageCalculator } from './calculator';
import { OddsNormalizer } from './normalizer';

const mockOutcome = (
  name: string,
  bookmaker: string,
  decimalOdds: number,
  maxBet?: number
) => ({
  outcome: name,
  bookmaker: bookmaker as any,
  decimalOdds,
  impliedProbability: OddsNormalizer.decimalToImpliedProbability(decimalOdds),
  betUrl: undefined,
  maxBet,
  liquidity: undefined,
});

describe('ArbitrageCalculator', () => {
  describe('isArbitrage', () => {
    it('detects real arbitrage opportunity', () => {
      // 58% + 38% = 96% — arb!
      expect(ArbitrageCalculator.isArbitrage([0.58, 0.38])).toBe(true);
    });

    it('rejects non-arbitrage', () => {
      // 55% + 50% = 105% — no arb
      expect(ArbitrageCalculator.isArbitrage([0.55, 0.50])).toBe(false);
    });

    it('handles exactly 100%', () => {
      expect(ArbitrageCalculator.isArbitrage([0.5, 0.5])).toBe(false);
    });
  });

  describe('calculate', () => {
    it('computes correct stakes for 2-outcome arb', () => {
      const outcomes = [
        mockOutcome('Team A', 'polymarket', 1 / 0.58),  // ~1.724 decimal
        mockOutcome('Team B', 'draftkings', 1 / 0.38),  // ~2.632 decimal
      ];

      const result = ArbitrageCalculator.calculate({
        outcomes,
        totalBankroll: 1000,
      });

      expect(result.isArbitrage).toBe(true);
      expect(result.roi).toBeGreaterThan(0);
      expect(result.totalStake).toBeCloseTo(1000, 0);
      expect(result.guaranteedProfit).toBeGreaterThan(0);
      expect(result.stakes).toHaveLength(2);

      // All potential returns should be approximately equal
      const returns = result.stakes.map((s) => s.potentialReturn);
      const maxDiff = Math.max(...returns) - Math.min(...returns);
      expect(maxDiff).toBeLessThan(5); // Within $5
    });

    it('respects max bet constraints', () => {
      const outcomes = [
        mockOutcome('Team A', 'polymarket', 1 / 0.58, 200), // max $200
        mockOutcome('Team B', 'draftkings', 1 / 0.38),
      ];

      const result = ArbitrageCalculator.calculate({
        outcomes,
        totalBankroll: 1000,
      });

      for (let i = 0; i < outcomes.length; i++) {
        const maxBet = outcomes[i].maxBet;
        if (maxBet) {
          expect(result.stakes[i].stake).toBeLessThanOrEqual(maxBet + 0.01);
        }
      }
    });

    it('calculateForProfit targets specific profit', () => {
      const outcomes = [
        mockOutcome('Yes', 'polymarket', 1 / 0.58),
        mockOutcome('No', 'draftkings', 1 / 0.38),
      ];

      const result = ArbitrageCalculator.calculateForProfit(outcomes, 50);

      expect(result.isArbitrage).toBe(true);
      expect(result.guaranteedProfit).toBeCloseTo(50, 0);
    });
  });
});
