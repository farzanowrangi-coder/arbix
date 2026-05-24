import type { FastifyInstance } from 'fastify';
import { saveCredentials, listCredentials, removeCredentials, SUPPORTED_BOOKS, type SupportedBook } from '../services/credentials.service';

export async function credentialsRoutes(app: FastifyInstance) {
  const auth = (app as any).authenticate;

  app.get('/', { preHandler: [auth] }, async (req: any, reply) => {
    const creds = await listCredentials(req.user.id);
    return reply.send({ success: true, data: creds });
  });

  app.post('/', { preHandler: [auth] }, async (req: any, reply) => {
    const { bookmaker, login, password } = req.body as { bookmaker: string; login: string; password: string };
    if (!SUPPORTED_BOOKS.includes(bookmaker as SupportedBook)) {
      return reply.code(400).send({ success: false, error: `Unsupported bookmaker. Supported: ${SUPPORTED_BOOKS.join(', ')}` });
    }
    if (!login || !password) return reply.code(400).send({ success: false, error: 'Login and password required' });
    await saveCredentials(req.user.id, bookmaker as SupportedBook, login, password);
    return reply.send({ success: true });
  });

  app.delete('/:bookmaker', { preHandler: [auth] }, async (req: any, reply) => {
    const { bookmaker } = req.params as { bookmaker: string };
    await removeCredentials(req.user.id, bookmaker as SupportedBook);
    return reply.send({ success: true });
  });
}
