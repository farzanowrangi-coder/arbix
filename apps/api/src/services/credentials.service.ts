import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { query } from '../db';

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '0fb85860cd83d5126d91d583a552b547dc645617372787cae875b605a70027ca', 'hex');

function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(':');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
}

export const SUPPORTED_BOOKS = ['kalshi', 'pinnacle', 'stake', 'betway'] as const;
export type SupportedBook = typeof SUPPORTED_BOOKS[number];

export async function saveCredentials(userId: string, bookmaker: SupportedBook, login: string, password: string) {
  const encLogin = encrypt(login);
  const encPassword = encrypt(password);
  await query(
    `INSERT INTO bookmaker_credentials (user_id, bookmaker, encrypted_login, encrypted_password, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (user_id, bookmaker)
     DO UPDATE SET encrypted_login = $3, encrypted_password = $4, is_active = true, last_verified = NULL`,
    [userId, bookmaker, encLogin, encPassword],
  );
}

export async function getCredentials(userId: string, bookmaker: SupportedBook): Promise<{ login: string; password: string } | null> {
  const res = await query(
    `SELECT encrypted_login, encrypted_password FROM bookmaker_credentials WHERE user_id = $1 AND bookmaker = $2 AND is_active = true`,
    [userId, bookmaker],
  );
  if (!res.rows[0]) return null;
  return {
    login: decrypt(res.rows[0].encrypted_login),
    password: decrypt(res.rows[0].encrypted_password),
  };
}

export async function listCredentials(userId: string) {
  const res = await query(
    `SELECT bookmaker, is_active, last_verified, created_at FROM bookmaker_credentials WHERE user_id = $1`,
    [userId],
  );
  return res.rows;
}

export async function removeCredentials(userId: string, bookmaker: SupportedBook) {
  await query(
    `DELETE FROM bookmaker_credentials WHERE user_id = $1 AND bookmaker = $2`,
    [userId, bookmaker],
  );
}

export async function markVerified(userId: string, bookmaker: SupportedBook) {
  await query(
    `UPDATE bookmaker_credentials SET last_verified = NOW() WHERE user_id = $1 AND bookmaker = $2`,
    [userId, bookmaker],
  );
}
