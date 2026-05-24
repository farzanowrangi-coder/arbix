import axios from 'axios';
import type { ArbitrageOpportunity, User } from '@arbix/shared';
import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';

function formatOpportunityMessage(opp: ArbitrageOpportunity): string {
  const stakeLines = opp.stakes
    .map((s) => `  • ${s.outcome} @ ${s.bookmaker}: $${s.stake} → $${s.potentialReturn}`)
    .join('\n');

  return [
    `🎯 ARBITRAGE OPPORTUNITY DETECTED`,
    ``,
    `Event: ${opp.eventName}`,
    `Sport: ${opp.sport} | Market: ${opp.marketType}`,
    ``,
    `ROI: +${opp.roi.toFixed(2)}%`,
    `Profit Margin: ${(opp.profitMargin * 100).toFixed(2)}%`,
    `Guaranteed Profit: $${opp.guaranteedProfit.toFixed(2)}`,
    `Total Stake: $${opp.totalStake.toFixed(2)}`,
    ``,
    `Stakes:`,
    stakeLines,
    ``,
    `Confidence: ${opp.confidence.toUpperCase()} (${opp.confidenceScore}/100)`,
    `Books: ${opp.bookmakers.join(', ')}`,
    ``,
    `View at: https://arbix.io/opportunities/${opp.id}`,
  ].join('\n');
}

function formatDiscordEmbed(opp: ArbitrageOpportunity) {
  return {
    embeds: [
      {
        title: `Arbitrage: ${opp.eventName}`,
        color: 0x00ff88,
        fields: [
          { name: 'ROI', value: `+${opp.roi.toFixed(2)}%`, inline: true },
          { name: 'Guaranteed Profit', value: `$${opp.guaranteedProfit.toFixed(2)}`, inline: true },
          { name: 'Total Stake', value: `$${opp.totalStake.toFixed(2)}`, inline: true },
          { name: 'Sport', value: opp.sport, inline: true },
          { name: 'Market', value: opp.marketType, inline: true },
          { name: 'Confidence', value: `${opp.confidence} (${opp.confidenceScore}/100)`, inline: true },
          {
            name: 'Stakes',
            value: opp.stakes
              .map((s) => `**${s.outcome}** @ ${s.bookmaker}: $${s.stake}`)
              .join('\n'),
          },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'ArbiX — Real-Time Arbitrage Scanner' },
      },
    ],
  };
}

export class NotificationService {
  async sendTelegramAlert(chatId: string, opp: ArbitrageOpportunity): Promise<void> {
    if (!config.telegram.botToken) {
      logger.debug('Telegram bot token not configured, skipping');
      return;
    }

    const message = formatOpportunityMessage(opp);

    try {
      await axios.post(`${config.telegram.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      logger.error('Failed to send Telegram alert', { error: (err as Error).message, chatId });
      throw err;
    }
  }

  async sendDiscordAlert(webhookUrl: string, opp: ArbitrageOpportunity): Promise<void> {
    try {
      await axios.post(webhookUrl, formatDiscordEmbed(opp));
    } catch (err) {
      logger.error('Failed to send Discord alert', { error: (err as Error).message });
      throw err;
    }
  }

  async sendEmailAlert(email: string, opp: ArbitrageOpportunity): Promise<void> {
    if (!config.sendgrid.apiKey) {
      logger.debug('SendGrid API key not configured, skipping email');
      return;
    }

    const subject = `ArbiX Alert: ${opp.roi.toFixed(2)}% ROI on ${opp.eventName}`;
    const text = formatOpportunityMessage(opp);

    try {
      await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email }] }],
          from: { email: config.sendgrid.fromEmail, name: config.sendgrid.fromName },
          subject,
          content: [{ type: 'text/plain', value: text }],
        },
        {
          headers: {
            Authorization: `Bearer ${config.sendgrid.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (err) {
      logger.error('Failed to send email alert', { error: (err as Error).message, email });
      throw err;
    }
  }

  async notifyUser(userId: string, opp: ArbitrageOpportunity): Promise<void> {
    const result = await db.query(
      'SELECT notification_settings, email, subscription_tier FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    const { notification_settings: settings, email, subscription_tier } = result.rows[0];

    if (opp.roi < (settings.minRoiThreshold ?? 1)) return;

    const channels: string[] = settings.channels ?? ['browser'];

    const tasks: Promise<void>[] = [];

    if (channels.includes('telegram') && settings.telegramChatId) {
      tasks.push(
        this.sendTelegramAlert(settings.telegramChatId, opp)
          .then(() => this.logNotification(userId, 'telegram', opp.id, true))
          .catch((err) => this.logNotification(userId, 'telegram', opp.id, false, err.message))
      );
    }

    if (channels.includes('discord') && settings.discordWebhookUrl && subscription_tier !== 'free') {
      tasks.push(
        this.sendDiscordAlert(settings.discordWebhookUrl, opp)
          .then(() => this.logNotification(userId, 'discord', opp.id, true))
          .catch((err) => this.logNotification(userId, 'discord', opp.id, false, err.message))
      );
    }

    if (channels.includes('email')) {
      tasks.push(
        this.sendEmailAlert(email, opp)
          .then(() => this.logNotification(userId, 'email', opp.id, true))
          .catch((err) => this.logNotification(userId, 'email', opp.id, false, err.message))
      );
    }

    await Promise.allSettled(tasks);
  }

  async notifyAll(opp: ArbitrageOpportunity): Promise<void> {
    const result = await db.query(
      `SELECT id FROM users
       WHERE (notification_settings->>'minRoiThreshold')::float <= $1`,
      [opp.roi]
    );

    await Promise.allSettled(result.rows.map((row) => this.notifyUser(row.id, opp)));
  }

  private async logNotification(
    userId: string,
    channel: string,
    opportunityId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO notification_logs (user_id, channel, message, success, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, channel, opportunityId, success, error ?? null]
    );
  }
}

export const notificationService = new NotificationService();
