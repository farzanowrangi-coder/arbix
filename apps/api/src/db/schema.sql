-- ArbiX PostgreSQL Schema
-- Run via: node -r ts-node/register src/db/migrate.ts

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                  VARCHAR(255) NOT NULL UNIQUE,
  username               VARCHAR(100) NOT NULL UNIQUE,
  password_hash          VARCHAR(255) NOT NULL,
  subscription_tier      VARCHAR(20)  NOT NULL DEFAULT 'free'
                           CHECK (subscription_tier IN ('free', 'basic', 'pro')),
  stripe_customer_id     VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  notification_settings  JSONB NOT NULL DEFAULT '{
    "channels": ["browser"],
    "minRoiThreshold": 1.0
  }',
  filter_preferences     JSONB NOT NULL DEFAULT '{}',
  default_stake          NUMERIC(12, 2) NOT NULL DEFAULT 100.00,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);

-- ─── Arbitrage Opportunities ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name               TEXT         NOT NULL,
  sport                    VARCHAR(50)  NOT NULL,
  market_type              VARCHAR(50)  NOT NULL,
  league                   VARCHAR(255),
  start_time               TIMESTAMPTZ,
  total_implied_probability NUMERIC(8, 6) NOT NULL,
  profit_margin            NUMERIC(8, 6) NOT NULL,
  roi                      NUMERIC(8, 4) NOT NULL,
  stakes                   JSONB        NOT NULL DEFAULT '[]',
  total_stake              NUMERIC(12, 2) NOT NULL,
  guaranteed_profit        NUMERIC(12, 2) NOT NULL,
  detected_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'live'
                             CHECK (status IN ('live', 'expired', 'completed', 'suspicious')),
  confidence               VARCHAR(10)  NOT NULL
                             CHECK (confidence IN ('high', 'medium', 'low')),
  confidence_score         NUMERIC(5, 4) NOT NULL,
  confidence_reasons       JSONB        NOT NULL DEFAULT '[]',
  bookmakers               JSONB        NOT NULL DEFAULT '[]',
  ai_insight               TEXT,
  estimated_duration_minutes INTEGER
);

CREATE INDEX IF NOT EXISTS idx_arb_opp_status ON arbitrage_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_arb_opp_sport ON arbitrage_opportunities(sport);
CREATE INDEX IF NOT EXISTS idx_arb_opp_roi ON arbitrage_opportunities(roi DESC);
CREATE INDEX IF NOT EXISTS idx_arb_opp_detected_at ON arbitrage_opportunities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arb_opp_expires_at ON arbitrage_opportunities(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_arb_opp_confidence ON arbitrage_opportunities(confidence);
CREATE INDEX IF NOT EXISTS idx_arb_opp_market_type ON arbitrage_opportunities(market_type);

-- ─── User Bets ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_bets (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id     UUID         REFERENCES arbitrage_opportunities(id) ON DELETE SET NULL,
  stake_allocations  JSONB        NOT NULL DEFAULT '[]',
  total_stake        NUMERIC(12, 2) NOT NULL,
  actual_profit      NUMERIC(12, 2),
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'won', 'lost', 'void')),
  placed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  settled_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_bets_user_id ON user_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bets_opportunity_id ON user_bets(opportunity_id)
  WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_bets_status ON user_bets(status);
CREATE INDEX IF NOT EXISTS idx_user_bets_placed_at ON user_bets(placed_at DESC);

-- ─── Refresh Tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ─── Notification Logs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_logs (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50)  NOT NULL,
  message TEXT         NOT NULL,
  sent_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  success BOOLEAN      NOT NULL DEFAULT TRUE,
  error   TEXT
);

CREATE INDEX IF NOT EXISTS idx_notif_logs_user_id ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_logs_sent_at ON notification_logs(sent_at DESC);

-- ─── Market Snapshots ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_snapshots (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bookmaker  VARCHAR(50)  NOT NULL,
  raw_data   JSONB        NOT NULL,
  fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_bookmaker ON market_snapshots(bookmaker);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_fetched_at ON market_snapshots(fetched_at DESC);

-- ─── Updated-at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
