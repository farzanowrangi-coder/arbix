import { FastifyInstance } from 'fastify';
import { requireAuth, requirePro } from '../middleware/auth';
import { getGamesService } from '../services/games.service';

export async function gamesRoutes(fastify: FastifyInstance) {
  const svc = getGamesService();

  fastify.get('/upcoming', { preHandler: [requireAuth, requirePro] }, async (_req, reply) => {
    const games = await svc.getGamesWithOdds();
    return reply.send({ success: true, data: games, timestamp: new Date().toISOString() });
  });
}
