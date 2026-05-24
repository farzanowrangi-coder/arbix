'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useState, useEffect } from 'react';

const FEATURES = [
  {
    icon: '◈',
    title: 'Real-Time Scanning',
    desc: 'Monitors 8+ sportsbooks and Polymarket simultaneously. Detects opportunities within seconds.',
  },
  {
    icon: '◉',
    title: 'Guaranteed Profit',
    desc: 'Pure arbitrage — not gambling. Mathematical certainty regardless of which outcome wins.',
  },
  {
    icon: '◎',
    title: 'Smart Confidence Scoring',
    desc: 'Every opportunity rated 0–100 based on liquidity, odds freshness, and market conditions.',
  },
  {
    icon: '◍',
    title: 'Instant Alerts',
    desc: 'Browser, Telegram, Discord, and Email notifications the moment an opportunity appears.',
  },
];

const BOOKS = ['Polymarket', 'Pinnacle', 'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Bet365', 'Bovada'];

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: ['5 opportunities/day', 'Basic sport filter', 'Browser alerts'],
    cta: 'Get Started',
    highlight: false,
  },
  {
    name: 'Basic',
    price: '$29',
    period: '/month',
    features: ['Unlimited opportunities', 'All sports & markets', 'Telegram alerts', '7-day history'],
    cta: 'Start Free Trial',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/month',
    features: [
      'Everything in Basic',
      'Discord + Email alerts',
      'AI opportunity analysis',
      '<1s detection latency',
      'API access',
      'Unlimited history',
    ],
    cta: 'Go Pro',
    highlight: true,
  },
];

export default function LandingPage() {
  const [opportunityCount, setOpportunityCount] = useState(2847);

  useEffect(() => {
    const interval = setInterval(() => {
      setOpportunityCount((n) => n + Math.floor(Math.random() * 3));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-terminal text-text-primary">
      {/* ─── Nav ─────────────────────────────────────────────────── */}
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-green-arb font-bold text-lg glow-green-sm">ARBIX</span>
          <span className="text-text-muted text-xs">v1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="#pricing" className="text-text-secondary text-sm hover:text-text-primary transition-colors">Pricing</Link>
          <Link href="/login" className="text-text-secondary text-sm hover:text-text-primary transition-colors">Login</Link>
          <Link
            href="/register"
            className="px-4 py-1.5 bg-green-arb text-terminal text-sm font-bold rounded hover:bg-green-arb-dim transition-colors"
          >
            Start Free
          </Link>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-24 pb-20 text-center grid-bg">
        <div className="absolute inset-0 bg-glow-green opacity-30 pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 max-w-4xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-green-arb/30 rounded-full text-green-arb text-xs mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse-green inline-block" />
            LIVE — {opportunityCount.toLocaleString()} opportunities detected today
          </div>

          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            Find{' '}
            <span className="text-gradient-green">Guaranteed Profit</span>
            <br />in Every Market
          </h1>

          <p className="text-text-secondary text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
            ArbiX scans Polymarket, DraftKings, FanDuel, Pinnacle and 5+ more in real time —
            finding opportunities where combined implied probabilities fall below 100%,
            creating mathematically guaranteed profit.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="px-8 py-3 bg-green-arb text-terminal font-bold rounded hover:bg-green-arb-dim transition-colors shadow-neon-green text-sm"
            >
              Start Scanning Free
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 border border-border-bright text-text-primary rounded hover:border-green-arb/40 transition-colors text-sm"
            >
              View Live Demo
            </Link>
          </div>
        </motion.div>

        {/* ─── Example opportunity card ──────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="relative z-10 mt-16 max-w-lg mx-auto border border-green-arb/30 rounded-lg bg-card/80 backdrop-blur p-5 text-left shadow-neon-green"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-muted">LIVE OPPORTUNITY</span>
            <span className="text-xs text-green-arb font-bold glow-green-sm">+3.82% ROI</span>
          </div>
          <div className="font-bold text-text-primary mb-3">Lakers vs Celtics — Moneyline</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-text-muted">Lakers win</span>
              <span className="text-text-secondary">Polymarket</span>
              <span className="text-text-primary">$612 @ 1.724</span>
              <span className="text-green-arb">→ $1,054</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-text-muted">Celtics win</span>
              <span className="text-text-secondary">DraftKings</span>
              <span className="text-text-primary">$388 @ 2.721</span>
              <span className="text-green-arb">→ $1,056</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
            <span className="text-text-muted">Total stake: $1,000</span>
            <span className="text-green-arb font-bold">Guaranteed: +$55</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse-green inline-block" />
            <span className="text-xs text-text-muted">Detected 12s ago · Confidence: HIGH (87)</span>
          </div>
        </motion.div>
      </section>

      {/* ─── Bookmakers ──────────────────────────────────────────── */}
      <section className="px-6 py-10 border-t border-border">
        <p className="text-center text-text-muted text-xs mb-6 uppercase tracking-widest">Monitoring</p>
        <div className="flex flex-wrap items-center justify-center gap-6">
          {BOOKS.map((book) => (
            <span key={book} className="text-text-muted text-sm hover:text-text-secondary transition-colors">
              {book}
            </span>
          ))}
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────── */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12">
          Professional-Grade <span className="text-green-arb">Arbitrage Tools</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="border border-border bg-card rounded-lg p-6 hover:border-green-arb/30 transition-colors"
            >
              <div className="text-green-arb text-2xl mb-3">{f.icon}</div>
              <h3 className="font-bold text-text-primary mb-2">{f.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────────── */}
      <section className="px-6 py-20 bg-panel border-t border-b border-border">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">How Arbitrage Works</h2>
          <div className="space-y-8">
            {[
              { step: '01', title: 'ArbiX fetches live odds', desc: 'Every 5 seconds, we pull odds from 8+ books simultaneously. All formats (American, Decimal, Probability) normalized to implied probability.' },
              { step: '02', title: 'Detects when total implied < 100%', desc: 'If betting on all outcomes costs less than $1.00 in implied probability, guaranteed profit exists. Example: 58% + 38% = 96% → 4% margin.' },
              { step: '03', title: 'Calculates optimal stakes', desc: 'We compute the exact bet size for each outcome so all possible results return the same amount — locking in your profit.' },
            ].map((item) => (
              <div key={item.step} className="flex gap-6 items-start">
                <span className="text-green-arb font-bold text-2xl flex-shrink-0 glow-green-sm">{item.step}</span>
                <div>
                  <h3 className="font-bold text-text-primary mb-1">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="px-6 py-20 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12">Simple Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PRICING.map((plan) => (
            <div
              key={plan.name}
              className={`border rounded-lg p-6 relative ${
                plan.highlight
                  ? 'border-green-arb/50 shadow-neon-green bg-card'
                  : 'border-border bg-card'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-green-arb text-terminal text-xs font-bold rounded-full">
                  MOST POPULAR
                </div>
              )}
              <div className="mb-4">
                <div className="text-text-secondary text-sm mb-1">{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-text-primary">{plan.price}</span>
                  <span className="text-text-muted text-sm">{plan.period}</span>
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                    <span className="text-green-arb text-xs">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`block text-center py-2 rounded text-sm font-bold transition-colors ${
                  plan.highlight
                    ? 'bg-green-arb text-terminal hover:bg-green-arb-dim shadow-neon-green'
                    : 'border border-border text-text-primary hover:border-green-arb/40'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border px-6 py-8 text-center text-text-muted text-xs">
        <div className="mb-2">
          <span className="text-green-arb font-bold">ARBIX</span> — Real-Time Sports Arbitrage Platform
        </div>
        <div>For informational purposes only. Arbitrage opportunities may not always be executable. Always verify odds before placing bets.</div>
      </footer>
    </div>
  );
}
