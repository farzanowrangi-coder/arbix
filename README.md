# ArbiX — Real-Time Sports Arbitrage Platform

**Professional-grade arbitrage betting scanner** that monitors Polymarket, DraftKings, FanDuel, Pinnacle, BetMGM, Caesars, Bet365, and more — detecting guaranteed-profit opportunities in real time.

---

## Architecture

```
arbix/
├── apps/
│   ├── api/          # Fastify backend — REST + WebSocket
│   └── web/          # Next.js 15 frontend
├── packages/
│   ├── shared/       # Shared TypeScript types
│   ├── odds-engine/  # Core arbitrage detection engine
│   └── ui/           # Shared UI components
├── docker-compose.yml
└── turbo.json
```

---

## Prerequisites

- Node.js ≥ 20
- Docker + Docker Compose (for PostgreSQL + Redis)
- npm ≥ 10

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourorg/arbix.git
cd arbix
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys and secrets
```

**Required variables:**
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Min 32-char secret for access tokens |
| `JWT_REFRESH_SECRET` | Min 32-char secret for refresh tokens |
| `STRIPE_SECRET_KEY` | Stripe API key (for subscriptions) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

**Optional (for notifications):**
| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `DISCORD_WEBHOOK_URL` | Discord incoming webhook URL |
| `SENDGRID_API_KEY` | SendGrid API key for email alerts |
| `OPENAI_API_KEY` | OpenAI key for AI assistant |

### 3. Start infrastructure

```bash
docker-compose up -d postgres redis
```

### 4. Initialize database

```bash
npm run db:migrate
```

### 5. Run in development

```bash
npm run dev
```

This starts both the API (port 3001) and web app (port 3000) via Turborepo.

Open [http://localhost:3000](http://localhost:3000)

---

## Production Deployment

### Docker (full stack)

```bash
docker-compose up -d
```

### Vercel (frontend) + Railway (API)

**Frontend (Vercel):**
```bash
cd apps/web
vercel deploy
```
Set env vars in Vercel dashboard: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`

**API (Railway):**
1. Connect your GitHub repo to Railway
2. Set root directory to `apps/api`
3. Add PostgreSQL and Redis services
4. Set all environment variables

**AWS (ECS):**
```bash
# Build and push API image
docker build -t arbix-api ./apps/api
docker tag arbix-api:latest YOUR_ECR_URI/arbix-api:latest
docker push YOUR_ECR_URI/arbix-api:latest
```

---

## How It Works

### Arbitrage Formula

An arbitrage opportunity exists when:
```
Σ (1 / decimalOdds_i) < 1.0
```

Where `i` iterates over all outcomes of a market across different bookmakers.

**Profit margin:**
```
margin = 1 - Σ (1 / decimalOdds_i)
```

**Optimal stake for each outcome:**
```
stake_i = (bankroll × impliedProb_i) / totalImpliedProb
```

**Example:**
```
Polymarket: Team A wins → 60% implied prob → decimal odds 1.667
DraftKings: Team B wins → 38% implied prob → decimal odds 2.632

Total implied = 60% + 38% = 98% (< 100% = ARBITRAGE!)
Profit margin = 2%

$1,000 bankroll:
  - Bet $612 on Team A at 1.667 → returns $1,020
  - Bet $388 on Team B at 2.632 → returns $1,021
  Guaranteed profit: ~$20 regardless of outcome
```

---

## Sportsbook Coverage

| Bookmaker | Method | Markets |
|---|---|---|
| Polymarket | Public REST API | Politics, Crypto, Sports (Yes/No) |
| Pinnacle | Public API | Full sportsbook |
| DraftKings | Public odds API | Full sportsbook |
| FanDuel | Public odds API | Full sportsbook |
| BetMGM | Scraped | Full sportsbook |
| Caesars | Scraped | Full sportsbook |
| Bet365 | Playwright scraping | Full sportsbook |

---

## Features

### Free Tier
- View up to 5 live arbitrage opportunities per day
- Basic sport filtering
- Email notifications (1/day)

### Basic ($29/mo)
- Unlimited opportunities
- All sports and market types
- Browser + Telegram notifications
- 7-day history

### Pro ($99/mo)
- Everything in Basic
- Discord webhook integration
- AI assistant explanations
- Real-time alerts (< 1 second latency)
- API access
- Unlimited history
- Priority scraping

---

## Testing

```bash
# Run all tests
npm run test

# Test just the odds engine
cd packages/odds-engine && npm test

# Test API
cd apps/api && npm test
```

---

## Confidence Scoring

Every opportunity is scored 0–100 and labeled High/Medium/Low confidence based on:

- **ROI range**: Opportunities 0.5–5% ROI are most likely real
- **Odds freshness**: Penalized if odds are >30 seconds old
- **Live markets**: -20 points (odds change very fast)
- **Low liquidity**: Penalized if market depth < $500
- **Max bet limits**: Penalized if max bet is very low
- **Event start time**: Penalized if < 5 minutes to start

---

## Anti-Fake Arb Protection

The system filters out likely fake opportunities caused by:
- Stale/delayed odds (tracked via timestamp)
- Markets with very low liquidity
- Lines with suspiciously high ROI (> 15% flagged)
- Markets near suspension (< 5min to game start)
- Max bet constraints that make profit negligible

---

## License

MIT
