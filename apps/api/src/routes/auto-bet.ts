import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePro } from '../middleware/auth';
import { getAutoBetService } from '../services/auto-bet.service';
import { getCredentials } from '../services/credentials.service';
import { getPolymarketBalance } from '../services/polymarket-executor';
import { getPinnacleBalance } from '../services/pinnacle-executor';

export async function autoBetRoutes(app: FastifyInstance) {
  const svc = getAutoBetService();

  app.get('/settings', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const isDemo = (req.query as any).mode === 'demo';
    const settings = await svc.getSettings(req.currentUser.id, isDemo);
    return reply.send({ success: true, data: settings });
  });

  app.put('/settings', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const isDemo = (req.query as any).mode === 'demo';
    const settings = await svc.saveSettings(req.currentUser.id, req.body as any, isDemo);
    return reply.send({ success: true, data: settings });
  });

  app.get('/history', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const isDemo = (req.query as any).mode === 'demo';
    const history = await svc.getBetHistory(req.currentUser.id, isDemo);
    return reply.send({ success: true, data: history });
  });

  app.get('/stats', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const isDemo = (req.query as any).mode === 'demo';
    const stats = await svc.getStats(req.currentUser.id, isDemo);
    return reply.send({ success: true, data: stats });
  });

  app.get('/daily-pnl', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const isDemo = (req.query as any).mode === 'demo';
    const days = Math.min(90, parseInt((req.query as any).days ?? '30', 10));
    const data = await svc.getDailyPnl(req.currentUser.id, isDemo, days);
    return reply.send({ success: true, data });
  });

  app.get('/book-balances', { preHandler: [requireAuth, requirePro] }, async (req: any, reply) => {
    const userId = req.currentUser.id;
    const [polyCreds, pinCreds] = await Promise.all([
      getCredentials(userId, 'polymarket').catch(() => null),
      getCredentials(userId, 'pinnacle').catch(() => null),
    ]);

    const [polyBalance, pinBalance] = await Promise.all([
      polyCreds ? getPolymarketBalance(polyCreds.password) : Promise.resolve(null),
      pinCreds  ? getPinnacleBalance({ userId, login: pinCreds.login, password: pinCreds.password }) : Promise.resolve(null),
    ]);

    return reply.send({
      success: true,
      data: {
        polymarket: polyBalance,
        pinnacle:   pinBalance,
      },
    });
  });
}
