import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();

    const payload = req.user as { id: string; email: string; tier: string };
    const result = await db.query(
      'SELECT id, email, username, subscription_tier FROM users WHERE id = $1',
      [payload.id]
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ success: false, error: 'User not found' });
    }

    (req as any).currentUser = result.rows[0];
  } catch {
    return reply.code(401).send({ success: false, error: 'Unauthorized' });
  }
}

export async function requirePro(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = (req as any).currentUser;
  if (!user || user.subscription_tier !== 'pro') {
    return reply.code(403).send({ success: false, error: 'Pro subscription required' });
  }
}

export async function requireBasicOrPro(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = (req as any).currentUser;
  if (!user || user.subscription_tier === 'free') {
    return reply.code(403).send({ success: false, error: 'Paid subscription required' });
  }
}
