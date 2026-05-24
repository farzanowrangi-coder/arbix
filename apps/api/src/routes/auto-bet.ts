import type { FastifyInstance } from 'fastify';
import { getAutoBetService } from '../services/auto-bet.service';

export async function autoBetRoutes(app: FastifyInstance) {
  const auth = (app as any).authenticate;
  const svc = getAutoBetService();

  app.get('/settings', { preHandler: [auth] }, async (req: any, reply) => {
    const settings = await svc.getSettings(req.user.id);
    return reply.send({ success: true, data: settings });
  });

  app.put('/settings', { preHandler: [auth] }, async (req: any, reply) => {
    const settings = await svc.saveSettings(req.user.id, req.body as any);
    return reply.send({ success: true, data: settings });
  });

  app.get('/history', { preHandler: [auth] }, async (req: any, reply) => {
    const history = await svc.getBetHistory(req.user.id);
    return reply.send({ success: true, data: history });
  });

  app.get('/stats', { preHandler: [auth] }, async (req: any, reply) => {
    const stats = await svc.getStats(req.user.id);
    return reply.send({ success: true, data: stats });
  });
}
