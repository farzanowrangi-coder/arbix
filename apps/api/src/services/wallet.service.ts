import { query } from '../db';

export async function getOrCreateWallet(userId: string) {
  await query(
    `INSERT INTO wallet (user_id, balance, is_demo) VALUES ($1, 0, true) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const res = await query(`SELECT * FROM wallet WHERE user_id = $1`, [userId]);
  return res.rows[0];
}

export async function getBalance(userId: string) {
  const w = await getOrCreateWallet(userId);
  return { balance: parseFloat(w.balance), isDemo: w.is_demo };
}

export async function deposit(userId: string, amount: number) {
  if (amount <= 0) throw new Error('Amount must be positive');
  await getOrCreateWallet(userId);
  const res = await query(
    `UPDATE wallet SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance`,
    [amount, userId],
  );
  const newBalance = parseFloat(res.rows[0].balance);
  await query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1, 'deposit', $2, $3, $4)`,
    [userId, amount, newBalance, 'Manual deposit'],
  );
  return newBalance;
}

export async function setDemoMode(userId: string, isDemo: boolean) {
  await getOrCreateWallet(userId);
  await query(`UPDATE wallet SET is_demo = $1, updated_at = NOW() WHERE user_id = $2`, [isDemo, userId]);
}

export async function deductStake(userId: string, amount: number, description: string): Promise<number> {
  const res = await query(
    `UPDATE wallet SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2 AND balance >= $1 RETURNING balance`,
    [amount, userId],
  );
  if (res.rows.length === 0) throw new Error('Insufficient balance');
  const newBalance = parseFloat(res.rows[0].balance);
  await query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1, 'bet_placed', $2, $3, $4)`,
    [userId, amount, newBalance, description],
  );
  return newBalance;
}

export async function creditWinnings(userId: string, amount: number, description: string): Promise<number> {
  const res = await query(
    `UPDATE wallet SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance`,
    [amount, userId],
  );
  const newBalance = parseFloat(res.rows[0].balance);
  await query(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1, 'bet_won', $2, $3, $4)`,
    [userId, amount, newBalance, description],
  );
  return newBalance;
}

export async function getTransactions(userId: string, limit = 50) {
  const res = await query(
    `SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return res.rows;
}
