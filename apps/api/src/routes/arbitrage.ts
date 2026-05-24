import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { getRedis } from '../redis';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { aiService } from '../services/ai.service';
import type { ArbitrageOpportunity } from '@arbix/shared';

const opportunitiesQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  sport: z.string().optional(),
  marketType: z.string().optional(),
  minRoi: z.coerce.number().min(0).optional(),
  maxRoi: z.coerce.number().optional(),
  bookmaker: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  status: z.union([
    z.enum(['live', 'expired', 'completed', 'suspicious']),
    z.array(z.enum(['live', 'expired', 'completed', 'suspicious'])).transform((arr) => arr[0]),
  ]).optional(),
  sortBy: z.enum(['roi', 'detected_at', 'guaranteed_profit']).default('roi'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export async function arbitrageRoutes(fastify: FastifyInstance) {
  // GET /opportunities — live opportunities
  fastify.get(
    '/',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = opportunitiesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: 'Invalid query parameters' });
      }

      const { page, pageSize, sport, marketType, minRoi, maxRoi, bookmaker, confidence, status, sortBy, sortDir } = parsed.data;
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      // Default to live opportunities
      conditions.push(`a.status = $${paramIdx++}`);
      params.push(status ?? 'live');

      if (sport) {
        conditions.push(`a.sport = $${paramIdx++}`);
        params.push(sport);
      }
      if (marketType) {
        conditions.push(`a.market_type = $${paramIdx++}`);
        params.push(marketType);
      }
      if (minRoi !== undefined) {
        conditions.push(`a.roi >= $${paramIdx++}`);
        params.push(minRoi);
      }
      if (maxRoi !== undefined) {
        conditions.push(`a.roi <= $${paramIdx++}`);
        params.push(maxRoi);
      }
      if (confidence) {
        conditions.push(`a.confidence = $${paramIdx++}`);
        params.push(confidence);
      }
      if (bookmaker) {
        conditions.push(`a.bookmakers @> $${paramIdx++}`);
        params.push(JSON.stringify([bookmaker]));
      }

      // Expire opportunities: either TTL exceeded, or game-level market where the game has already started
      await db.query(
        `UPDATE arbitrage_opportunities SET status = 'expired'
         WHERE status = 'live'
           AND (
             expires_at < NOW()
             OR (market_type != 'futures' AND start_time IS NOT NULL AND start_time < NOW())
           )`
      );

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const orderClause = `ORDER BY a.${sortBy} ${sortDir.toUpperCase()}`;

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM arbitrage_opportunities a ${whereClause}`,
        params
      );

      const result = await db.query(
        `SELECT a.* FROM arbitrage_opportunities a
         ${whereClause} ${orderClause}
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, pageSize, offset]
      );

      const total = parseInt(countResult.rows[0].total, 10);

      return reply.send({
        success: true,
        data: {
          items: result.rows.map(mapOpportunityRow),
          total,
          page,
          pageSize,
          hasMore: offset + pageSize < total,
        },
        timestamp: new Date().toISOString(),
      });
    }
  );

  // GET /opportunities/:id
  fastify.get(
    '/:id',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };

      // Try Redis first for speed
      const redis = getRedis();
      const cached = await redis.get(`arb:opp:${id}`).catch(() => null);
      if (cached) {
        return reply.send({ success: true, data: JSON.parse(cached), timestamp: new Date().toISOString() });
      }

      const result = await db.query(
        'SELECT * FROM arbitrage_opportunities WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, error: 'Opportunity not found' });
      }

      return reply.send({
        success: true,
        data: mapOpportunityRow(result.rows[0]),
        timestamp: new Date().toISOString(),
      });
    }
  );

  // GET /opportunities/:id/insight  (also /opportunities/:id/ai for compat)
  fastify.get(
    '/:id/insight',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };

      const result = await db.query(
        'SELECT * FROM arbitrage_opportunities WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, error: 'Not found' });
      }

      const opp = mapOpportunityRow(result.rows[0]) as ArbitrageOpportunity;
      const [explanation, duration, suspicious] = await Promise.all([
        aiService.explainOpportunity(opp),
        aiService.predictDuration(opp),
        aiService.detectSuspiciousLines(opp),
      ]);

      // Cache ai insight in DB
      await db.query(
        `UPDATE arbitrage_opportunities SET ai_insight = $1, estimated_duration_minutes = $2 WHERE id = $3`,
        [explanation, duration, id]
      );

      return reply.send({
        success: true,
        data: { explanation, estimatedDurationMinutes: duration, suspicious },
        timestamp: new Date().toISOString(),
      });
    }
  );

  // GET /arbitrage/history
  fastify.get(
    '/history',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as any;
      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(query.pageSize ?? '50', 10));
      const offset = (page - 1) * pageSize;

      const result = await db.query(
        `SELECT * FROM arbitrage_opportunities
         WHERE status IN ('expired', 'completed')
         ORDER BY detected_at DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM arbitrage_opportunities WHERE status IN ('expired', 'completed')`
      );

      return reply.send({
        success: true,
        data: {
          items: result.rows.map(mapOpportunityRow),
          total: parseInt(countResult.rows[0].total, 10),
          page,
          pageSize,
        },
        timestamp: new Date().toISOString(),
      });
    }
  );

  // POST /arbitrage/bets — record a placed bet
  fastify.post(
    '/bets',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).currentUser;
      const { opportunityId, stakeAllocations, totalStake } = req.body as any;

      if (!stakeAllocations || !totalStake) {
        return reply.code(400).send({ success: false, error: 'stakeAllocations and totalStake required' });
      }

      const result = await db.query(
        `INSERT INTO user_bets (user_id, opportunity_id, stake_allocations, total_stake)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [user.id, opportunityId ?? null, JSON.stringify(stakeAllocations), totalStake]
      );

      return reply.code(201).send({ success: true, data: result.rows[0], timestamp: new Date().toISOString() });
    }
  );

  // GET /arbitrage/stats
  fastify.get(
    '/stats',
    { preHandler: [requireAuth] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const result = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'live')           AS live_count,
          COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '24 hours') AS today_count,
          MAX(roi) FILTER (WHERE detected_at > NOW() - INTERVAL '24 hours') AS best_roi_today,
          AVG(roi) FILTER (WHERE status IN ('live','expired')) AS avg_roi,
          AVG(estimated_duration_minutes)                   AS avg_duration
        FROM arbitrage_opportunities
      `);

      return reply.send({ success: true, data: result.rows[0], timestamp: new Date().toISOString() });
    }
  );
}

function mapOpportunityRow(row: Record<string, unknown>): Partial<ArbitrageOpportunity> {
  return {
    id: row.id as string,
    eventName: row.event_name as string,
    sport: row.sport as any,
    marketType: row.market_type as any,
    league: row.league as string | undefined,
    startTime: row.start_time ? new Date(row.start_time as string) : undefined,
    totalImpliedProbability: parseFloat(row.total_implied_probability as string),
    profitMargin: parseFloat(row.profit_margin as string),
    roi: parseFloat(row.roi as string),
    stakes: row.stakes as any,
    totalStake: parseFloat(row.total_stake as string),
    guaranteedProfit: parseFloat(row.guaranteed_profit as string),
    detectedAt: new Date(row.detected_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    status: row.status as any,
    confidence: row.confidence as any,
    confidenceScore: parseFloat(row.confidence_score as string),
    confidenceReasons: row.confidence_reasons as string[],
    bookmakers: row.bookmakers as any,
    aiInsight: row.ai_insight as string | undefined,
    estimatedDurationMinutes: row.estimated_duration_minutes as number | undefined,
  };
}
