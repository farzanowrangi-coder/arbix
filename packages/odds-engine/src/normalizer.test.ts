import { OddsNormalizer } from './normalizer';

describe('OddsNormalizer', () => {
  describe('americanToDecimal', () => {
    it('converts positive American odds', () => {
      expect(OddsNormalizer.americanToDecimal(200)).toBe(3.0);
      expect(OddsNormalizer.americanToDecimal(100)).toBe(2.0);
      expect(OddsNormalizer.americanToDecimal(150)).toBe(2.5);
    });

    it('converts negative American odds', () => {
      expect(OddsNormalizer.americanToDecimal(-200)).toBeCloseTo(1.5, 2);
      expect(OddsNormalizer.americanToDecimal(-100)).toBe(2.0);
      expect(OddsNormalizer.americanToDecimal(-150)).toBeCloseTo(1.667, 2);
    });
  });

  describe('decimalToImpliedProbability', () => {
    it('converts decimal odds to implied probability', () => {
      expect(OddsNormalizer.decimalToImpliedProbability(2.0)).toBe(0.5);
      expect(OddsNormalizer.decimalToImpliedProbability(4.0)).toBe(0.25);
      expect(OddsNormalizer.decimalToImpliedProbability(1.5)).toBeCloseTo(0.667, 2);
    });
  });

  describe('arbitrage detection', () => {
    it('detects arbitrage when sum of implied probs < 1', () => {
      // Polymarket: Team A at 58% implied
      // Sportsbook: Team B at 38% implied
      // Total: 96% < 100% = arbitrage
      const prob1 = OddsNormalizer.decimalToImpliedProbability(
        OddsNormalizer.impliedProbabilityToDecimal(0.58)
      );
      const prob2 = OddsNormalizer.decimalToImpliedProbability(
        OddsNormalizer.impliedProbabilityToDecimal(0.38)
      );
      expect(prob1 + prob2).toBeCloseTo(0.96, 2);
      expect(prob1 + prob2).toBeLessThan(1);
    });
  });
});
