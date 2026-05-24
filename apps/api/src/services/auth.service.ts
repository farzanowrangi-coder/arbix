import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthTokens, User } from '@arbix/shared';
import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';

const BCRYPT_ROUNDS = 12;

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  async register(
    email: string,
    username: string,
    password: string
  ): Promise<{ user: Partial<User>; tokens: AuthTokens }> {
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username]
    );

    if (existing.rows.length > 0) {
      throw new Error('Email or username already taken');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = await db.query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, subscription_tier, created_at`,
      [email.toLowerCase(), username, passwordHash]
    );

    const user = result.rows[0];
    const tokens = await this.generateTokens(user.id, user.email, user.subscription_tier);

    logger.info(`New user registered: ${email}`);
    return { user, tokens };
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: Partial<User>; tokens: AuthTokens }> {
    const result = await db.query(
      `SELECT id, email, username, password_hash, subscription_tier
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      throw new Error('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.subscription_tier);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        subscriptionTier: user.subscription_tier,
      },
      tokens,
    };
  }

  async refreshToken(
    refreshToken: string
  ): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(refreshToken);

    const result = await db.query(
      `SELECT rt.user_id, rt.expires_at, u.email, u.subscription_tier
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const row = result.rows[0];

    if (new Date(row.expires_at) < new Date()) {
      await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
      throw new Error('Refresh token expired');
    }

    // Rotate refresh token
    await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return this.generateTokens(row.user_id, row.email, row.subscription_tier);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2',
      [userId, tokenHash]
    );
  }

  async logoutAll(userId: string): Promise<void> {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  }

  private async generateTokens(
    userId: string,
    email: string,
    tier: string
  ): Promise<AuthTokens> {
    const accessToken = this.fastify.jwt.sign(
      { id: userId, email, tier },
      { expiresIn: config.jwt.accessExpiresIn }
    );

    const refreshTokenRaw = crypto.randomBytes(48).toString('hex');
    const tokenHash = hashRefreshToken(refreshTokenRaw);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt]
    );

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      expiresIn: config.jwt.accessExpiresInSeconds,
    };
  }
}
