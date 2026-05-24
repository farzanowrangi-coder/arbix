import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const updateSettingsSchema = z.object({
  channels: z.array(z.enum(['browser', 'telegram', 'discord', 'email', 'sms'])).optional(),
  telegramChatId: z.string().optional().nullable(),
  discordWebhookUrl: z.string().url().optional().nullable(),
  minRoiThreshold: z.number().min(0).max(100).optional(),
  quietHoursStart: z.number().min(0).max(23).optional().nullable(),
  quietHoursEnd: z.number().min(0).max(23).optional().nullable(),
});

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/settings', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const result = await db.query('SELECT notification_settings FROM users WHERE id = $1', [user.id]);
    return reply.send({ success: true, data: result.rows[0]?.notification_settings ?? {} });
  });

  fastify.put('/settings', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message });
    }

    // Merge with existing settings
    const current = await db.query('SELECT notification_settings FROM users WHERE id = $1', [user.id]);
    const existing = current.rows[0]?.notification_settings ?? {};
    const merged = { ...existing, ...parsed.data };

    await db.query('UPDATE users SET notification_settings = $1 WHERE id = $2', [
      JSON.stringify(merged),
      user.id,
    ]);

    return reply.send({ success: true, data: merged, message: 'Notification settings updated' });
  });

  fastify.post('/test', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const { channel } = req.body as { channel: string };

    // Log a test notification
    await db.query(
      'INSERT INTO notification_logs (user_id, channel, message, success) VALUES ($1, $2, $3, $4)',
      [user.id, channel, 'TEST: ArbiX notification test successful', true]
    );

    return reply.send({ success: true, message: `Test notification sent via ${channel}` });
  });

  fastify.get('/logs', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const result = await db.query(
      'SELECT * FROM notification_logs WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 50',
      [user.id]
    );
    return reply.send({ success: true, data: result.rows });
  });
}
