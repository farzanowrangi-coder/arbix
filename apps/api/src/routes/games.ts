import { FastifyInstance } from 'fastify';
import { getGamesService } from '../services/games.service';

export async function gamesRoutes(fastify: FastifyInstance) {
  const svc = getGamesService();

  // Public — no auth so the live ticker on the games page loads fast on first visit
  fastify.get('/upcoming', async (_req, reply) => {
    const games = await svc.getGamesWithOdds();
    return reply.send({ success: true, data: games, timestamp: new Date().toISOString() });
  });
}
