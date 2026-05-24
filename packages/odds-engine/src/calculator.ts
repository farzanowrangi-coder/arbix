/**
 * Arbitrage Calculator
 * Computes optimal stake allocations for guaranteed profit.
 */

import type { MarketOutcome, StakeAllocation } from '@arbix/shared';

export interface ArbitrageCalcInput {
  outcomes: Pick<MarketOutcome, 'outcome' | 'bookmaker' | 'decimalOdds' | 'impliedProbability' | 'betUrl' | 'maxBet'>[];
  totalBankroll: number;
}

export interface ArbitrageCalcResult {
  totalImpliedProbability: number;
  profitMargin: number;
  roi: number;
  stakes: StakeAllocation[];
  totalStake: number;
  guaranteedProfit: number;
  isArbitrage: boolean;
}

export class ArbitrageCalculator {
  /**
   * Check if a set of outcomes forms an arbitrage opportunity.
   * Arbitrage exists when sum of implied probabilities < 1.
   */
  static isArbitrage(impliedProbabilities: number[]): boolean {
    const sum = impliedProbabilities.reduce((a, b) => a + b, 0);
    return sum < 1.0;
  }

  /**
   * Calculate optimal stakes to guarantee equal profit across all outcomes.
   * Formula: stake_i = (bankroll / decimal_i) / sum(1/decimal_j for all j)
   */
  static calculate(input: ArbitrageCalcInput): ArbitrageCalcResult {
    const { outcomes, totalBankroll } = input;

    const impliedProbs = outcomes.map((o) => o.impliedProbability);
    const totalImpliedProbability = parseFloat(
      impliedProbs.reduce((a, b) => a + b, 0).toFixed(6)
    );

    const isArbitrage = totalImpliedProbability < 1.0;
    const profitMargin = parseFloat((1 - totalImpliedProbability).toFixed(6));
    const roi = parseFloat(((profitMargin / totalImpliedProbability) * 100).toFixed(4));

    // Calculate stakes: stake_i = (bankroll * weight_i)
    // where weight_i = (1/decimal_i) / sum(1/decimal_j)
    const stakes: StakeAllocation[] = outcomes.map((outcome) => {
      const weight = outcome.impliedProbability / totalImpliedProbability;
      const stake = parseFloat((totalBankroll * weight).toFixed(2));
      const potentialReturn = parseFloat((stake * outcome.decimalOdds).toFixed(2));

      return {
        outcome: outcome.outcome,
        bookmaker: outcome.bookmaker,
        decimalOdds: outcome.decimalOdds,
        stake,
        potentialReturn,
        betUrl: outcome.betUrl,
      };
    });

    // Verify: all potential returns should be approximately equal (guaranteed profit)
    const minReturn = Math.min(...stakes.map((s) => s.potentialReturn));
    const guaranteedProfit = parseFloat((minReturn - totalBankroll).toFixed(2));

    // Apply max bet constraints and recalculate if needed
    const constrainedStakes = this.applyMaxBetConstraints(stakes, outcomes, totalBankroll);

    return {
      totalImpliedProbability,
      profitMargin,
      roi,
      stakes: constrainedStakes,
      totalStake: parseFloat(
        constrainedStakes.reduce((a, s) => a + s.stake, 0).toFixed(2)
      ),
      guaranteedProfit,
      isArbitrage,
    };
  }

  private static applyMaxBetConstraints(
    stakes: StakeAllocation[],
    outcomes: ArbitrageCalcInput['outcomes'],
    totalBankroll: number
  ): StakeAllocation[] {
    let limitingFactor = 1;

    for (let i = 0; i < stakes.length; i++) {
      const maxBet = outcomes[i].maxBet;
      if (maxBet && stakes[i].stake > maxBet) {
        const factor = maxBet / stakes[i].stake;
        if (factor < limitingFactor) limitingFactor = factor;
      }
    }

    if (limitingFactor < 1) {
      return stakes.map((s) => ({
        ...s,
        stake: parseFloat((s.stake * limitingFactor).toFixed(2)),
        potentialReturn: parseFloat((s.stake * limitingFactor * s.decimalOdds).toFixed(2)),
      }));
    }

    return stakes;
  }

  /**
   * Calculate for a specific desired profit target.
   */
  static calculateForProfit(
    outcomes: ArbitrageCalcInput['outcomes'],
    targetProfit: number
  ): ArbitrageCalcResult {
    const impliedProbs = outcomes.map((o) => o.impliedProbability);
    const totalImpliedProbability = impliedProbs.reduce((a, b) => a + b, 0);
    const profitMargin = 1 - totalImpliedProbability;

    if (profitMargin <= 0) {
      return this.calculate({ outcomes, totalBankroll: 0 });
    }

    // Profit = bankroll * (profitMargin / totalImplied), so bankroll = targetProfit * totalImplied / profitMargin
    const requiredBankroll = (targetProfit * totalImpliedProbability) / profitMargin;
    return this.calculate({ outcomes, totalBankroll: requiredBankroll });
  }
}
