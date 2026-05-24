import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalNumber(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number, got: ${val}`);
  return parsed;
}

function optionalBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalNumber('PORT', 3001),
  host: optional('HOST', '0.0.0.0'),

  // Database
  db: {
    host: optional('DB_HOST', 'localhost'),
    port: optionalNumber('DB_PORT', 5432),
    name: optional('DB_NAME', 'arbix'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', 'postgres'),
    maxConnections: optionalNumber('DB_MAX_CONNECTIONS', 20),
    idleTimeoutMs: optionalNumber('DB_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMs: optionalNumber('DB_CONNECTION_TIMEOUT_MS', 5000),
    ssl: optionalBool('DB_SSL', false),
    get url(): string {
      return (
        process.env['DATABASE_URL'] ??
        `postgresql://${this.user}:${this.password}@${this.host}:${this.port}/${this.name}`
      );
    },
  },

  // Redis
  redis: {
    host: optional('REDIS_HOST', 'localhost'),
    port: optionalNumber('REDIS_PORT', 6379),
    password: process.env['REDIS_PASSWORD'],
    db: optionalNumber('REDIS_DB', 0),
    get url(): string {
      return process.env['REDIS_URL'] ?? `redis://${this.host}:${this.port}/${this.db}`;
    },
  },

  // JWT
  jwt: {
    accessSecret: optional('JWT_ACCESS_SECRET', 'arbix-access-secret-change-in-production'),
    refreshSecret: optional('JWT_REFRESH_SECRET', 'arbix-refresh-secret-change-in-production'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '30d'),
    accessExpiresInSeconds: optionalNumber('JWT_ACCESS_EXPIRES_SECONDS', 900),
  },

  // Stripe
  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY', ''),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET', ''),
    basicPriceId: optional('STRIPE_BASIC_PRICE_ID', ''),
    proPriceId: optional('STRIPE_PRO_PRICE_ID', ''),
    successUrl: optional('STRIPE_SUCCESS_URL', 'http://localhost:3000/dashboard?checkout=success'),
    cancelUrl: optional('STRIPE_CANCEL_URL', 'http://localhost:3000/pricing'),
  },

  // OpenAI
  openai: {
    apiKey: optional('OPENAI_API_KEY', ''),
    model: optional('OPENAI_MODEL', 'gpt-4o-mini'),
  },

  // Telegram
  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN', ''),
    get apiUrl(): string {
      return `https://api.telegram.org/bot${this.botToken}`;
    },
  },

  // SendGrid
  sendgrid: {
    apiKey: optional('SENDGRID_API_KEY', ''),
    fromEmail: optional('SENDGRID_FROM_EMAIL', 'noreply@arbix.io'),
    fromName: optional('SENDGRID_FROM_NAME', 'ArbiX'),
  },

  // The Odds API
  oddsApi: {
    key: optional('ODDS_API_KEY', ''),
  },

  // Scanner
  scanner: {
    intervalMs: optionalNumber('SCAN_INTERVAL_MS', 5000),
    concurrencyLimit: optionalNumber('SCANNER_CONCURRENCY', 4),
    opportunityTtlSeconds: optionalNumber('OPPORTUNITY_TTL_SECONDS', 300),
    enabledAdapters: optional(
      'ENABLED_ADAPTERS',
      'odds_api,polymarket,pinnacle'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Proxies
  proxies: optional('PROXY_LIST', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // CORS
  cors: {
    origins: optional('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Rate limiting
  rateLimit: {
    max: optionalNumber('RATE_LIMIT_MAX', 100),
    windowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60000),
  },

  // Logging
  logLevel: optional('LOG_LEVEL', 'info') as 'error' | 'warn' | 'info' | 'debug',
} as const;

export type Config = typeof config;
