import OpenAI from 'openai';
import type { ArbitrageOpportunity } from '@arbix/shared';
import { config } from '../config';
import { logger } from '../logger';

export class AIService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      if (!config.openai.apiKey) {
        throw new Error('OpenAI API key not configured');
      }
      this.client = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return this.client;
  }

  async explainOpportunity(opp: ArbitrageOpportunity): Promise<string> {
    try {
      const client = this.getClient();

      const stakeDetails = opp.stakes
        .map(
          (s) =>
            `- Bet $${s.stake} on "${s.outcome}" at ${s.bookmaker} (${s.decimalOdds}x decimal odds) → returns $${s.potentialReturn}`
        )
        .join('\n');

      const response = await client.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert sports arbitrage analyst. Explain arbitrage opportunities clearly and concisely. Keep responses under 150 words. Use simple language.',
          },
          {
            role: 'user',
            content: `Explain this arbitrage opportunity:

Event: ${opp.eventName}
Sport: ${opp.sport}
Market: ${opp.marketType}
ROI: ${opp.roi.toFixed(2)}%
Profit Margin: ${(opp.profitMargin * 100).toFixed(2)}%

Stakes:
${stakeDetails}

Confidence: ${opp.confidence} (${opp.confidenceScore}/100)
Confidence factors: ${opp.confidenceReasons.join('; ')}

Explain why this is an arbitrage opportunity and what the bettor should do.`,
          },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content ?? 'Unable to generate explanation.';
    } catch (err) {
      logger.error('AI explain error', { error: (err as Error).message });
      return `This ${opp.roi.toFixed(2)}% ROI arbitrage exists because the combined implied probabilities across bookmakers total only ${(opp.totalImpliedProbability * 100).toFixed(1)}% instead of 100%. By betting on all outcomes proportionally, you lock in guaranteed profit.`;
    }
  }

  async predictDuration(opp: ArbitrageOpportunity): Promise<number> {
    // Heuristic model — use AI when available, fallback to rules
    const base = 5;

    let minutes = base;

    if (opp.roi > 5) minutes -= 2;
    if (opp.roi > 10) minutes -= 2;
    if (opp.confidence === 'high') minutes += 5;
    if (opp.confidence === 'low') minutes -= 2;
    if (opp.bookmakers.includes('polymarket')) minutes += 3;

    return Math.max(1, minutes);
  }

  async detectSuspiciousLines(opp: ArbitrageOpportunity): Promise<{
    suspicious: boolean;
    reason?: string;
  }> {
    if (opp.roi > 15) {
      return { suspicious: true, reason: `Unusually high ROI of ${opp.roi.toFixed(2)}% — likely stale odds` };
    }

    if (opp.confidenceScore < 30) {
      return { suspicious: true, reason: 'Very low confidence score' };
    }

    return { suspicious: false };
  }
}

export const aiService = new AIService();
