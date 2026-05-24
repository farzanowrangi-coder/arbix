import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const updatePreferencesSchema = z.object({
  filterPreferences: z.object({
    minRoi: z.number().optional(),
    maxRoi: z.number().optional(),
    sports: z.array(z.string()).optional(),
    marketTypes: z.array(z.string()).optional(),
    bookmakers: z.array(z.string()).optional(),
    confidenceLevels: z.array(z.string()).optional(),
  }).optional(),
  defaultStake: z.number().min(1).optional(),
});

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/me', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const result = await db.query(
      `SELECT id, email, username, subscription_tier, notification_settings,
              filter_preferences, default_stake, created_at
       FROM users WHERE id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    const row = result.rows[0];
    return reply.send({
      success: true,
      data: {
        id: row.id,
        email: row.email,
        username: row.username,
        subscriptionTier: row.subscription_tier,
        notificationSettings: row.notification_settings,
        filterPreferences: row.filter_preferences,
        defaultStake: parseFloat(row.default_stake),
        createdAt: row.created_at,
      },
    });
  });

  fastify.put('/preferences', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const parsed = updatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message });
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (parsed.data.filterPreferences !== undefined) {
      updates.push(`filter_preferences = $${idx++}`);
      params.push(JSON.stringify(parsed.data.filterPreferences));
    }
    if (parsed.data.defaultStake !== undefined) {
      updates.push(`default_stake = $${idx++}`);
      params.push(parsed.data.defaultStake);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ success: false, error: 'Nothing to update' });
    }

    params.push(user.id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);

    return reply.send({ success: true, message: 'Preferences updated' });
  });

  // GET /user/bets
  fastify.get('/bets', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const result = await db.query(
      `SELECT b.*, a.event_name, a.sport, a.roi
       FROM user_bets b
       LEFT JOIN arbitrage_opportunities a ON a.id = b.opportunity_id
       WHERE b.user_id = $1
       ORDER BY b.placed_at DESC
       LIMIT 100`,
      [user.id]
    );

    return reply.send({ success: true, data: result.rows });
  });

  // PATCH /user/bets/:id — settle a bet
  fastify.patch('/bets/:id', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const { id } = req.params as { id: string };
    const { status, actualProfit } = req.body as any;

    const result = await db.query(
      `UPDATE user_bets SET status = $1, actual_profit = $2, settled_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [status, actualProfit ?? null, id, user.id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ success: false, error: 'Bet not found' });
    }

    return reply.send({ success: true, data: result.rows[0] });
  });
}
