import fs from 'fs';
import path from 'path';
import { getPool, connectDb, disconnectDb } from './index';
import { logger } from '../logger';

async function migrate(): Promise<void> {
  logger.info('Starting database migration...');

  await connectDb();
  const pool = getPool();

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Migration failed', { error: (err as Error).message });
    throw err;
  } finally {
    client.release();
    await disconnectDb();
  }
}

migrate().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
