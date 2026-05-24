/**
 * Odds Normalizer
 * Converts between American, Decimal, Fractional, and Probability formats.
 */

export class OddsNormalizer {
  static americanToDecimal(american: number): number {
    if (american > 0) {
      return parseFloat((american / 100 + 1).toFixed(4));
    } else {
      return parseFloat((100 / Math.abs(american) + 1).toFixed(4));
    }
  }

  static decimalToAmerican(decimal: number): number {
    if (decimal >= 2.0) {
      return Math.round((decimal - 1) * 100);
    } else {
      return Math.round(-100 / (decimal - 1));
    }
  }

  static decimalToImpliedProbability(decimal: number): number {
    if (decimal <= 1) return 1;
    return parseFloat((1 / decimal).toFixed(6));
  }

  static impliedProbabilityToDecimal(prob: number): number {
    if (prob <= 0 || prob > 1) throw new Error(`Invalid probability: ${prob}`);
    return parseFloat((1 / prob).toFixed(4));
  }

  static americanToImpliedProbability(american: number): number {
    const decimal = this.americanToDecimal(american);
    return this.decimalToImpliedProbability(decimal);
  }

  static fractionalToDecimal(numerator: number, denominator: number): number {
    return parseFloat((numerator / denominator + 1).toFixed(4));
  }

  static parseFractional(fractional: string): { numerator: number; denominator: number } {
    const parts = fractional.split('/');
    if (parts.length !== 2) throw new Error(`Invalid fractional odds: ${fractional}`);
    return { numerator: parseFloat(parts[0]), denominator: parseFloat(parts[1]) };
  }

  /**
   * Normalize any odds input into decimal odds.
   */
  static normalize(
    value: number | string,
    format: 'american' | 'decimal' | 'fractional' | 'probability'
  ): number {
    switch (format) {
      case 'american':
        return this.americanToDecimal(Number(value));
      case 'decimal':
        return parseFloat(Number(value).toFixed(4));
      case 'fractional': {
        const { numerator, denominator } = this.parseFractional(String(value));
        return this.fractionalToDecimal(numerator, denominator);
      }
      case 'probability': {
        const prob = Number(value);
        const normalized = prob > 1 ? prob / 100 : prob;
        return this.impliedProbabilityToDecimal(normalized);
      }
      default:
        throw new Error(`Unknown odds format: ${format}`);
    }
  }
}
