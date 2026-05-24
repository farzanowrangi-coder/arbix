import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { getScanner } from '../services/scanner.service';

export async function marketRoutes(fastify: FastifyInstance) {
  fastify.get('/bookmakers', { preHandler: [requireAuth] }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const scanner = getScanner();
    const status = scanner.getStatus();
    return reply.send({ success: true, data: status.bookmakers, timestamp: new Date().toISOString() });
  });

  fastify.get('/scanner/status', { preHandler: [requireAuth] }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const scanner = getScanner();
    return reply.send({ success: true, data: scanner.getStatus(), timestamp: new Date().toISOString() });
  });

  fastify.post('/scanner/refresh', { preHandler: [requireAuth] }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const scanner = getScanner();
    const started = scanner.triggerScan();
    return reply.send({
      success: true,
      data: { started, message: started ? 'Scan triggered' : 'Scan already in progress' },
      timestamp: new Date().toISOString(),
    });
  });
}
