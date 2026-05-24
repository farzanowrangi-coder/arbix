import type { FastifyInstance } from 'fastify';
import { getBalance, deposit, setDemoMode, getTransactions } from '../services/wallet.service';

export async function walletRoutes(app: FastifyInstance) {
  const auth = (app as any).authenticate;

  app.get('/balance', { preHandler: [auth] }, async (req: any, reply) => {
    const data = await getBalance(req.user.id);
    return reply.send({ success: true, data });
  });

  app.post('/deposit', { preHandler: [auth] }, async (req: any, reply) => {
    const { amount } = req.body as { amount: number };
    if (!amount || amount <= 0) return reply.code(400).send({ success: false, error: 'Invalid amount' });
    const balance = await deposit(req.user.id, amount);
    return reply.send({ success: true, data: { balance } });
  });

  app.post('/demo-mode', { preHandler: [auth] }, async (req: any, reply) => {
    const { isDemo } = req.body as { isDemo: boolean };
    await setDemoMode(req.user.id, isDemo);
    return reply.send({ success: true });
  });

  app.get('/transactions', { preHandler: [auth] }, async (req: any, reply) => {
    const txns = await getTransactions(req.user.id, 100);
    return reply.send({ success: true, data: txns });
  });
}
