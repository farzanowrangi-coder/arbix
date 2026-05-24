import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.service';

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify);

  fastify.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message });
    }

    try {
      const { user, tokens } = await authService.register(
        parsed.data.email,
        parsed.data.username,
        parsed.data.password
      );
      return reply.code(201).send({ success: true, data: { user, tokens } });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.includes('already taken') ? 409 : 500;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  fastify.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid request' });
    }

    try {
      const { user, tokens } = await authService.login(
        parsed.data.email,
        parsed.data.password
      );
      return reply.send({ success: true, data: { user, tokens } });
    } catch {
      return reply.code(401).send({ success: false, error: 'Invalid email or password' });
    }
  });

  fastify.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'refreshToken required' });
    }

    try {
      const tokens = await authService.refreshToken(parsed.data.refreshToken);
      return reply.send({ success: true, data: { tokens } });
    } catch (err) {
      return reply.code(401).send({ success: false, error: (err as Error).message });
    }
  });

  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user as { id: string };
      const { refreshToken } = (req.body as any) ?? {};

      if (refreshToken) {
        await authService.logout(user.id, refreshToken);
      } else {
        await authService.logoutAll(user.id);
      }

      return reply.send({ success: true, message: 'Logged out' });
    }
  );
}
