import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { getLiveScanner } from '../services/live-scanner.service';

export async function liveRoutes(fastify: FastifyInstance) {
  const scanner = getLiveScanner();

  fastify.get('/matches', { preHandler: [requireAuth] }, async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        matches: scanner.getLiveMatches(),
        opportunities: scanner.getLiveOpportunities(),
      },
      timestamp: new Date().toISOString(),
    });
  });
}
