import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { db } from '../db';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { logger } from '../logger';

function getStripe(): Stripe {
  if (!config.stripe.secretKey) throw new Error('Stripe not configured');
  return new Stripe(config.stripe.secretKey);
}

export async function subscriptionRoutes(fastify: FastifyInstance) {
  // POST /subscription/checkout
  fastify.post('/checkout', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const { tier } = req.body as { tier: 'basic' | 'pro' };

    if (!tier || !['basic', 'pro'].includes(tier)) {
      return reply.code(400).send({ success: false, error: 'tier must be basic or pro' });
    }

    const priceId = tier === 'pro' ? config.stripe.proPriceId : config.stripe.basicPriceId;
    if (!priceId) {
      return reply.code(500).send({ success: false, error: 'Stripe price ID not configured' });
    }

    try {
      const stripe = getStripe();

      // Get or create Stripe customer
      let customerId = user.stripe_customer_id as string | undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: config.stripe.successUrl,
        cancel_url: config.stripe.cancelUrl,
        metadata: { userId: user.id, tier },
      });

      return reply.send({ success: true, data: { url: session.url } });
    } catch (err) {
      logger.error('Stripe checkout error', { error: (err as Error).message });
      return reply.code(500).send({ success: false, error: 'Failed to create checkout session' });
    }
  });

  // POST /subscription/portal
  fastify.post('/portal', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;

    if (!user.stripe_customer_id) {
      return reply.code(400).send({ success: false, error: 'No active subscription' });
    }

    try {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${config.stripe.successUrl.replace('/dashboard?checkout=success', '/settings')}`,
      });
      return reply.send({ success: true, data: { url: session.url } });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /subscription/status
  fastify.get('/status', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).currentUser;
    const result = await db.query(
      'SELECT subscription_tier, stripe_subscription_id FROM users WHERE id = $1',
      [user.id]
    );
    const row = result.rows[0];
    return reply.send({
      success: true,
      data: {
        tier: row?.subscription_tier ?? 'free',
        subscriptionId: row?.stripe_subscription_id ?? null,
      },
    });
  });

  // POST /subscription/webhook — Stripe webhook
  fastify.post(
    '/webhook',
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!config.stripe.webhookSecret) {
        return reply.code(400).send('Webhook secret not configured');
      }

      const sig = req.headers['stripe-signature'] as string;
      if (!sig) return reply.code(400).send('Missing stripe-signature header');

      let event: Stripe.Event;
      try {
        const stripe = getStripe();
        event = stripe.webhooks.constructEvent(
          (req as any).rawBody ?? req.body,
          sig,
          config.stripe.webhookSecret
        );
      } catch (err) {
        logger.warn('Stripe webhook signature verification failed', { error: (err as Error).message });
        return reply.code(400).send(`Webhook error: ${(err as Error).message}`);
      }

      try {
        await handleStripeEvent(event);
        return reply.send({ received: true });
      } catch (err) {
        logger.error('Stripe webhook handler error', { event: event.type, error: (err as Error).message });
        return reply.code(500).send('Webhook handler failed');
      }
    }
  );
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const tier = session.metadata?.tier;
      if (userId && tier) {
        await db.query(
          'UPDATE users SET subscription_tier = $1, stripe_subscription_id = $2 WHERE id = $3',
          [tier, session.subscription, userId]
        );
        logger.info(`User ${userId} upgraded to ${tier}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db.query(
        'UPDATE users SET subscription_tier = $1, stripe_subscription_id = NULL WHERE stripe_subscription_id = $2',
        ['free', sub.id]
      );
      logger.info(`Subscription ${sub.id} cancelled — user downgraded to free`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status;
      if (status === 'past_due' || status === 'unpaid') {
        await db.query(
          'UPDATE users SET subscription_tier = $1 WHERE stripe_subscription_id = $2',
          ['free', sub.id]
        );
      }
      break;
    }

    default:
      logger.debug(`Unhandled Stripe event: ${event.type}`);
  }
}
