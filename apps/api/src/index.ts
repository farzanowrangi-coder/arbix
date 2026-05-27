import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebSocket from '@fastify/websocket';
import { config } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './db';
import { connectRedis, disconnectRedis } from './redis';
import { wsManager } from './websocket';
import { getScanner } from './services/scanner.service';
import { getLiveScanner } from './services/live-scanner.service';
import { authRoutes } from './routes/auth';
import { arbitrageRoutes } from './routes/arbitrage';
import { marketRoutes } from './routes/markets';
import { notificationRoutes } from './routes/notifications';
import { subscriptionRoutes } from './routes/subscription';
import { userRoutes } from './routes/user';
import { liveRoutes } from './routes/live';
import { gamesRoutes } from './routes/games';
import { walletRoutes } from './routes/wallet';
import { credentialsRoutes } from './routes/credentials';
import { autoBetRoutes } from './routes/auto-bet';
import { getAutoBetService } from './services/auto-bet.service';

async function buildApp() {
  const app = Fastify({
    logger: false, // we use winston
    trustProxy: true,
    bodyLimit: 1048576, // 1MB
  });

  // ─── Plugins ────────────────────────────────────────────────────────────────

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  await app.register(fastifyCors, {
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyRateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // Auth routes get a separate generous limit — never lock out a login attempt
    keyGenerator: (req) => {
      const path = req.url ?? '';
      if (path.startsWith('/auth/')) return `auth:${req.ip}`;
      return req.ip;
    },
    allowList: ['127.0.0.1', '::1', '::ffff:127.0.0.1'], // never rate-limit localhost
    errorResponseBuilder: () => ({
      success: false,
      error: 'Too many requests — slow down',
    }),
  });

  await app.register(fastifyJwt, {
    secret: config.jwt.accessSecret,
  });

  // Attach jwtVerify shorthand to request
  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  await app.register(fastifyWebSocket);

  // ─── WebSocket ──────────────────────────────────────────────────────────────

  const scanner = getScanner();
  wsManager.initialize(app, () => scanner.getStatus());

  // Wire scanner events to WebSocket broadcasts
  scanner.on('ws:broadcast', (event) => wsManager.broadcast(event));

  // Wire GamesService background refresh → push fresh games/odds to all clients
  const gamesSvc = (await import('./services/games.service')).getGamesService();
  const origRefresh = (gamesSvc as any).refreshCache.bind(gamesSvc);
  (gamesSvc as any).refreshCache = async () => {
    await origRefresh();
    const cached = (gamesSvc as any).cache;
    if (cached?.data) {
      wsManager.broadcast({ type: 'games:update', payload: cached.data, timestamp: new Date().toISOString() });
    }
  };

  // ─── Routes ─────────────────────────────────────────────────────────────────

  app.register(authRoutes,         { prefix: '/auth' });
  app.register(arbitrageRoutes,    { prefix: '/opportunities' });
  app.register(marketRoutes,       { prefix: '/markets' });
  app.register(notificationRoutes, { prefix: '/notifications' });
  app.register(subscriptionRoutes, { prefix: '/subscription' });
  app.register(userRoutes,         { prefix: '/users' });
  app.register(userRoutes,         { prefix: '/user' }); // legacy alias
  app.register(liveRoutes,         { prefix: '/live' });
  app.register(gamesRoutes,        { prefix: '/games' });
  app.register(walletRoutes,       { prefix: '/wallet' });
  app.register(credentialsRoutes,  { prefix: '/credentials' });
  app.register(autoBetRoutes,      { prefix: '/auto-bet' });

  // History endpoint (forwards to arbitrage history query)
  app.get('/history', { preHandler: [(req: any, reply: any) => scanner && req.jwtVerify().catch(() => reply.code(401).send({ success: false, error: 'Unauthorized' }))] }, async (req: any, reply) => {
    const { page = '1', pageSize = '50' } = req.query as any;
    const p = Math.max(1, parseInt(page, 10));
    const ps = Math.min(100, parseInt(pageSize, 10));
    const { query: dbQuery } = await import('./db');
    const result = await dbQuery(
      `SELECT * FROM arbitrage_opportunities WHERE status IN ('expired','completed') ORDER BY detected_at DESC LIMIT $1 OFFSET $2`,
      [ps, (p - 1) * ps]
    );
    const count = await dbQuery(`SELECT COUNT(*) as total FROM arbitrage_opportunities WHERE status IN ('expired','completed')`);
    return reply.send({ success: true, data: { items: result.rows, total: parseInt(count.rows[0].total, 10), page: p, pageSize: ps }, timestamp: new Date().toISOString() });
  });

  // Portfolio endpoints
  app.get('/portfolio/bets', { preHandler: [(req: any, reply: any) => req.jwtVerify().catch(() => reply.code(401).send({ success: false, error: 'Unauthorized' }))] }, async (req: any, reply) => {
    const user = req.user as any;
    const { query: dbQuery } = await import('./db');
    const result = await dbQuery(`SELECT * FROM user_bets WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 50`, [user.id]);
    return reply.send({ success: true, data: { items: result.rows, total: result.rows.length }, timestamp: new Date().toISOString() });
  });

  app.get('/portfolio/stats', { preHandler: [(req: any, reply: any) => req.jwtVerify().catch(() => reply.code(401).send({ success: false, error: 'Unauthorized' }))] }, async (_req: any, reply) => {
    return reply.send({ success: true, data: { totalBets: 0, totalStaked: 0, totalProfit: 0, roi: 0, winRate: 0, bySport: [], byBookmaker: [], cumulativePnl: [] }, timestamp: new Date().toISOString() });
  });

  // History stats
  app.get('/history/stats', { preHandler: [(req: any, reply: any) => req.jwtVerify().catch(() => reply.code(401).send({ success: false, error: 'Unauthorized' }))] }, async (_req: any, reply) => {
    const { query: dbQuery } = await import('./db');
    const result = await dbQuery(`SELECT COUNT(*) AS total, AVG(roi) AS avg_roi, MAX(roi) AS max_roi FROM arbitrage_opportunities`);
    return reply.send({ success: true, data: result.rows[0], timestamp: new Date().toISOString() });
  });

  // Scanner status endpoint
  app.get('/scanner/status', async () => ({
    success: true,
    data: scanner.getStatus(),
    timestamp: new Date().toISOString(),
  }));

  // Manual scan trigger — kicks off an immediate scan outside the cron schedule
  app.post('/scanner/refresh', { preHandler: [(req: any, reply: any) => req.jwtVerify().catch(() => reply.code(401).send({ success: false, error: 'Unauthorized' }))] }, async (_req, reply) => {
    const started = scanner.triggerScan();
    return reply.send({
      success: true,
      data: { started, message: started ? 'Scan triggered' : 'Scan already in progress' },
      timestamp: new Date().toISOString(),
    });
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    scanner: scanner.getStatus().isRunning ? 'running' : 'stopped',
    connections: wsManager.connectedCount,
  }));

  // ─── Error handler ──────────────────────────────────────────────────────────

  app.setErrorHandler((err, _req, reply) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    reply.code(err.statusCode ?? 500).send({
      success: false,
      error: config.env === 'production' ? 'Internal server error' : err.message,
    });
  });

  return app;
}

async function main() {
  try {
    // Connect to infrastructure
    await connectDb();
    await connectRedis();

    const app = await buildApp();

    // Start scanners
    const scanner = getScanner();
    scanner.start();

    const liveScanner = getLiveScanner();
    liveScanner.on('ws:broadcast', (event) => wsManager.broadcast(event));
    liveScanner.start();

    const autoBet = getAutoBetService();
    autoBet.start();

    // Start server
    await app.listen({ port: config.port, host: config.host });
    logger.info(`ArbiX API running on http://${config.host}:${config.port}`);

    // ─── Graceful shutdown ───────────────────────────────────────────────────
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);
      scanner.stop();
      liveScanner.stop();
      wsManager.destroy();
      await app.close();
      await disconnectDb();
      await disconnectRedis();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Fatal startup error', { error: (err as Error).message });
    process.exit(1);
  }
}

main();
