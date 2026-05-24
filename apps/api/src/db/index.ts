import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.db.url,
      max: config.db.maxConnections,
      idleTimeoutMillis: config.db.idleTimeoutMs,
      connectionTimeoutMillis: config.db.connectionTimeoutMs,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error', { error: err.message });
    });

    pool.on('connect', () => {
      logger.debug('PostgreSQL client connected');
    });
  }
  return pool;
}

export async function connectDb(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  client.release();
  logger.info('PostgreSQL connection established');
}

export async function disconnectDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool();
  const start = Date.now();
  try {
    const result = await p.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug('DB query executed', { duration, rows: result.rowCount });
    return result;
  } catch (err) {
    const error = err as Error;
    logger.error('DB query error', { text, error: error.message });
    throw err;
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Namespace object for routes that prefer `db.query(...)` style
export const db = { query, queryOne, withTransaction };

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query<{ now: Date }>('SELECT NOW()');
    return result.rows.length > 0;
  } catch {
    return false;
  }
}
