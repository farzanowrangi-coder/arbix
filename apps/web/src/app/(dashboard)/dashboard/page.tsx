'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOpportunityStore } from '@/store';
import { useArbitrageOpportunities } from '@/hooks/useArbitrageOpportunities';
import StatCard from '@/components/ui/StatCard';
import { OpportunityRow } from '@/components/dashboard/OpportunityRow';
import { ScannerStatus } from '@/components/dashboard/ScannerStatus';
import ArbCalculator, { type ArbLeg } from '@/components/ui/ArbCalculator';
import { LiveTicker } from '@/components/dashboard/LiveTicker';
import { formatROI, formatCurrency } from '@/lib/formatters';
import { scannerApi, gamesApi, type GameOddsEntry } from '@/lib/api';
import { useOddsFormat } from '@/context/OddsFormatContext';

// ─── Game arb card ────────────────────────────────────────────────────────────

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀', hockey: '🏒', baseball: '⚾',
  soccer: '⚽', football: '🏈', tennis: '🎾',
};

function GameArbRow({ game }: { game: GameOddsEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { displayOdds } = useOddsFormat();
  const books = Array.from(new Set(
    game.outcomes.flatMap((o) => o.books.map((b) => b.bookmakerLabel))
  ));
  const legs: ArbLeg[] = game.outcomes.map((o) => {
    const best = o.books.find((b) => b.isBest)!;
    return {
      outcomeName: o.name,
      bookmakerLabel: best.bookmakerLabel,
      decimalOdds: best.decimalOdds,
      americanOdds: best.americanOdds,
      betUrl: best.betUrl,
    };
  });

  return (
    <div className="border-b border-border/50 last:border-0">
      {/* Summary row — click to expand calculator */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left hover:bg-white/5 transition-colors"
      >
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3">
          {/* Event */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{SPORT_ICON[game.sport] ?? '🎯'}</span>
              <span className="text-xs font-medium text-text-primary truncate">{game.eventName}</span>
              {game.isLive && (
                <span className="flex items-center gap-1 text-2xs font-bold text-yellow-arb flex-shrink-0">
                  <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="text-2xs text-text-muted mt-0.5 pl-5">{game.league}</div>
          </div>

          {/* ROI */}
          <div className="flex items-center">
            <span className="text-xs font-bold text-green-arb glow-green-sm">
              +{game.arbRoi!.toFixed(2)}%
            </span>
          </div>

          {/* Books */}
          <div className="flex items-center">
            <span className="text-2xs text-text-secondary truncate">{books.join(' / ')}</span>
          </div>

          {/* Bets */}
          <div className="space-y-0.5">
            {game.outcomes.map((o) => {
              const best = o.books.find((b) => b.isBest)!;
              return (
                <div key={o.name} className="text-2xs text-text-muted">
                  <span className="text-text-secondary">{o.name.split(' ').slice(-1)[0]}</span>
                  {' '}
                  <span className={`font-mono ${best.americanOdds > 0 ? 'text-green-arb' : 'text-text-secondary'}`}>
                    {displayOdds(best.decimalOdds, best.americanOdds)}
                  </span>
                  {' @ '}
                  <span className="text-text-muted">{best.bookmakerLabel}</span>
                </div>
              );
            })}
          </div>

          {/* Expand toggle */}
          <div className="flex items-center gap-2">
            <span className="text-2xs px-1.5 py-0.5 rounded border border-blue-arb/40 text-blue-arb">BOOK</span>
            <span className={`text-text-muted text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
          </div>
        </div>
      </button>

      {/* Calculator panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <ArbCalculator legs={legs} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Scanner arb row (wrapper to unify layout) ────────────────────────────────

function ScannerArbWrapper({ children }: { children: React.ReactNode }) {
  return <div className="relative">{children}</div>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { opportunities, stats, isLoading, refresh } = useArbitrageOpportunities();
  const scannerStatus = useOpportunityStore((s) => s.scannerStatus);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [gameArbs, setGameArbs] = useState<GameOddsEntry[]>([]);
  const [gameArbsLoading, setGameArbsLoading] = useState(true);

  // Fetch game arbs
  const fetchGameArbs = useCallback(async () => {
    try {
      const res = await gamesApi.getUpcoming();
      if (res.success && res.data) {
        setGameArbs(res.data.filter((g) => g.hasArb));
      }
    } catch { /* ignore */ } finally {
      setGameArbsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGameArbs();
    const t = setInterval(fetchGameArbs, 60_000);
    return () => clearInterval(t);
  }, [fetchGameArbs]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshMsg(null);
    try {
      await scannerApi.refresh();
      await new Promise((r) => setTimeout(r, 6000));
      await Promise.all([refresh(), fetchGameArbs()]);
      setRefreshMsg('Updated');
    } catch {
      setRefreshMsg('Error');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 3000);
    }
  }, [isRefreshing, refresh, fetchGameArbs]);

  const liveOpps = opportunities.filter((o) => o.status === 'live');
  const liveArbCount = liveOpps.length + gameArbs.length;
  const bestRoi = Math.max(
    liveOpps.length > 0 ? Math.max(...liveOpps.map((o) => o.roi)) : 0,
    gameArbs.length > 0 ? Math.max(...gameArbs.map((g) => g.arbRoi ?? 0)) : 0,
  );
  const totalCapital = liveOpps.reduce((s, o) => s + o.totalStake, 0);
  const avgDuration = (stats as any)?.avg_duration ? parseFloat((stats as any).avg_duration) : null;

  const isAnyLoading = isLoading && gameArbsLoading;

  return (
    <div className="p-6 space-y-6">
      {/* Live ticker */}
      {liveOpps.length > 0 && <LiveTicker opportunities={liveOpps.slice(0, 10)} />}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Live Opportunities"
          value={String(liveArbCount)}
          change={liveArbCount > 0 ? '+' + liveArbCount : '0'}
          positive={liveArbCount > 0}
        />
        <StatCard
          label="Best ROI"
          value={bestRoi > 0 ? formatROI(bestRoi) : 'N/A'}
          positive={bestRoi > 0}
          highlight
        />
        <StatCard
          label="Capital Required"
          value={formatCurrency(totalCapital)}
          change="for scanner opps"
        />
        <StatCard
          label="Avg Duration"
          value={avgDuration ? `${avgDuration.toFixed(0)}m` : '--'}
          change="minutes"
        />
      </div>

      {/* Scanner status */}
      {scannerStatus && <ScannerStatus status={scannerStatus} />}

      {/* Unified arb table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            All Arbitrage Opportunities
            {liveArbCount > 0 && (
              <span className="text-2xs bg-green-arb text-terminal px-1.5 py-0.5 rounded-full font-bold">
                {liveArbCount}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            <AnimatePresence>
              {refreshMsg && (
                <motion.span
                  key="msg"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className={`text-2xs ${refreshMsg === 'Updated' ? 'text-green-arb' : 'text-red-400'}`}
                >
                  {refreshMsg}
                </motion.span>
              )}
            </AnimatePresence>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-2xs font-medium text-text-secondary hover:text-text-primary hover:border-green-arb/40 hover:bg-green-arb/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <motion.svg
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 1, repeat: isRefreshing ? Infinity : 0, ease: 'linear' }}
                width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </motion.svg>
              {isRefreshing ? 'Scanning…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          {isAnyLoading ? (
            <div className="p-8 text-center text-text-muted text-xs">
              <div className="animate-pulse">Scanning markets...</div>
            </div>
          ) : liveArbCount === 0 ? (
            <div className="p-8 text-center text-text-muted text-xs">
              <div className="text-green-arb text-2xl mb-2">◈</div>
              No arbitrage opportunities right now.
              <br />
              Scanner is active — will alert you instantly when one appears.
            </div>
          ) : (
            <div>
              {/* Game arbs (Pinnacle/DK/Kalshi cross-book) */}
              {gameArbs.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-panel/80 border-b border-border text-2xs text-text-muted uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-arb" />
                    Cross-Book Opportunities ({gameArbs.length})
                  </div>
                  {gameArbs
                    .sort((a, b) => (b.arbRoi ?? 0) - (a.arbRoi ?? 0))
                    .map((g, i) => (
                      <motion.div
                        key={g.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                      >
                        <GameArbRow game={g} />
                      </motion.div>
                    ))}
                </div>
              )}

              {/* Scanner arbs */}
              {liveOpps.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-panel/80 border-b border-border text-2xs text-text-muted uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse" />
                    Scanner Opportunities ({liveOpps.length})
                  </div>
                  {/* Column headers for scanner rows */}
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 bg-panel text-2xs text-text-muted border-b border-border">
                    <span>EVENT</span>
                    <span>SPORT</span>
                    <span>ROI</span>
                    <span>PROFIT</span>
                    <span>BOOKS</span>
                    <span>CONFIDENCE</span>
                    <span>AGO</span>
                  </div>
                  {liveOpps.slice(0, 15).map((opp, i) => (
                    <motion.div
                      key={opp.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: (gameArbs.length + i) * 0.03 }}
                    >
                      <OpportunityRow opportunity={opp} />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
