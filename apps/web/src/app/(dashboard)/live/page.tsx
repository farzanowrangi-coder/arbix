'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LiveMatch, LiveArbitrageOpportunity } from '@arbix/shared';
import { useOpportunityStore } from '@/store';
import { liveApi } from '@/lib/api';
import { formatROI, formatCurrency } from '@/lib/formatters';

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀',
  hockey: '🏒',
  baseball: '⚾',
  soccer: '⚽',
  football: '🏈',
};

const STOPPAGE_LABEL: Record<string, string> = {
  halftime: 'HALF TIME',
  quarter_break: 'QTR BREAK',
  period_break: 'PERIOD BREAK',
  inning_break: 'INNING BREAK',
  timeout: 'TIMEOUT',
};

function ScoreBug({ match }: { match: LiveMatch }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right min-w-[80px]">
        <div className="text-xs font-semibold text-text-primary truncate">{match.awayTeam.split(' ').pop()}</div>
        <div className="text-2xs text-text-muted truncate">{match.awayTeam}</div>
      </div>
      <div className="text-center px-3 py-1 rounded bg-panel border border-border min-w-[60px]">
        <div className="text-base font-bold text-text-primary tabular-nums">
          {match.awayScore} – {match.homeScore}
        </div>
        <div className={`text-2xs tabular-nums ${match.inStoppage ? 'text-yellow-arb' : 'text-green-arb'}`}>
          {match.inStoppage && match.stoppageType
            ? STOPPAGE_LABEL[match.stoppageType] ?? 'BREAK'
            : match.clock
            ? `${match.clock} · ${getPeriodLabel(match)}`
            : getPeriodLabel(match)}
        </div>
      </div>
      <div className="min-w-[80px]">
        <div className="text-xs font-semibold text-text-primary truncate">{match.homeTeam.split(' ').pop()}</div>
        <div className="text-2xs text-text-muted truncate">{match.homeTeam}</div>
      </div>
    </div>
  );
}

function getPeriodLabel(match: LiveMatch): string {
  const p = match.period;
  if (!p) return '';
  if (match.sport === 'basketball') return `Q${p}`;
  if (match.sport === 'hockey') return `P${p}`;
  if (match.sport === 'baseball') return `Inn ${p}`;
  if (match.sport === 'soccer') return p === 1 ? '1st Half' : '2nd Half';
  return `${p}`;
}

function LiveMatchCard({ match, opportunities }: { match: LiveMatch; opportunities: LiveArbitrageOpportunity[] }) {
  const matchOpps = opportunities.filter((o) => o.matchId === match.id);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-lg overflow-hidden ${
        match.inStoppage ? 'border-yellow-arb/40 bg-yellow-arb/5' : 'border-border bg-panel'
      }`}
    >
      {/* Match header */}
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{SPORT_ICON[match.sport] ?? '🎯'}</span>
          <div className="min-w-0">
            <div className="text-2xs text-text-muted">{match.league}</div>
          </div>
        </div>

        <ScoreBug match={match} />

        <div className="flex items-center gap-2">
          {match.inStoppage ? (
            <span className="text-2xs font-bold text-yellow-arb border border-yellow-arb/40 px-2 py-0.5 rounded animate-pulse">
              {match.stoppageType ? STOPPAGE_LABEL[match.stoppageType] : 'BREAK'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-2xs text-green-arb">
              <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse-green" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Arb opportunities during stoppage */}
      <AnimatePresence>
        {matchOpps.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-yellow-arb/30"
          >
            {matchOpps.map((opp) => (
              <div key={opp.id} className="px-4 py-2.5 bg-green-arb/5">
                <div className="flex items-center justify-between gap-4 mb-1.5">
                  <span className="text-2xs text-green-arb font-bold glow-green-sm">
                    ARB DETECTED — {formatROI(opp.roi)} ROI
                  </span>
                  <span className="text-2xs text-text-muted">{opp.gameStatus}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {opp.stakes.map((s) => (
                    <div key={s.outcome} className="text-2xs bg-panel/60 rounded px-2 py-1.5 border border-border">
                      <div className="text-text-muted mb-0.5">{s.bookmaker.toUpperCase()}</div>
                      <div className="font-semibold text-text-primary">{s.outcome}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-green-arb">
                          {s.decimalOdds > 0 ? `${s.decimalOdds.toFixed(2)}x` : '—'}
                        </span>
                        <span className="text-text-muted">Stake: {formatCurrency(s.stake)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-4 text-2xs text-text-muted">
                  <span>Total stake: <span className="text-text-primary">{formatCurrency(opp.totalStake)}</span></span>
                  <span>Guaranteed: <span className="text-green-arb">+{formatCurrency(opp.guaranteedProfit)}</span></span>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function LivePage() {
  const wsMatches = useOpportunityStore((s) => s.liveMatches);
  const wsOpportunities = useOpportunityStore((s) => s.liveArbitrageOpportunities);

  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [opportunities, setOpportunities] = useState<LiveArbitrageOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await liveApi.getMatches();
      if (res.success && res.data) {
        setMatches(res.data.matches);
        setOpportunities(res.data.opportunities);
        setLastUpdated(new Date());
      }
    } catch {
      // ignore — we still show WS data
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Merge REST data with live WS updates
  const mergedMatches = [...matches];
  for (const wsMatch of wsMatches) {
    const idx = mergedMatches.findIndex((m) => m.id === wsMatch.id);
    if (idx >= 0) mergedMatches[idx] = wsMatch;
    else mergedMatches.unshift(wsMatch);
  }

  const mergedOpportunities = [...opportunities];
  for (const wsOpp of wsOpportunities) {
    const idx = mergedOpportunities.findIndex((o) => o.id === wsOpp.id);
    if (idx >= 0) mergedOpportunities[idx] = wsOpp;
    else mergedOpportunities.unshift(wsOpp);
  }

  const stoppageMatches = mergedMatches.filter((m) => m.inStoppage);
  const activeMatches = mergedMatches.filter((m) => !m.inStoppage);
  const activeOpps = mergedOpportunities.filter(
    (o) => Date.now() - new Date(o.detectedAt).getTime() < 3 * 60_000,
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Live Matches
          </h1>
          <p className="text-2xs text-text-muted mt-0.5">
            NBA · NHL · MLB · EPL · La Liga · Bundesliga · Serie A · Ligue 1 · FIFA World Cup
          </p>
        </div>
        {lastUpdated && (
          <span className="text-2xs text-text-muted">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Live arb alert bar */}
      <AnimatePresence>
        {activeOpps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border border-green-arb/40 bg-green-arb/10 rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <span className="text-green-arb text-base glow-green-sm">◈</span>
            <div>
              <div className="text-xs font-bold text-green-arb">
                {activeOpps.length} Live Arbitrage {activeOpps.length === 1 ? 'Opportunity' : 'Opportunities'} Detected
              </div>
              <div className="text-2xs text-text-muted mt-0.5">
                Found during in-game stoppages — act fast, odds shift quickly
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="text-center py-16 text-text-muted text-xs animate-pulse">
          Connecting to live match feeds...
        </div>
      ) : mergedMatches.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-text-muted text-2xl mb-3">◎</div>
          <div className="text-text-muted text-xs">No live matches right now.</div>
          <div className="text-text-muted text-2xs mt-1">
            Monitoring NBA, NHL, MLB, EPL, La Liga, Bundesliga, Serie A, Ligue 1 &amp; World Cup.
          </div>
        </div>
      ) : (
        <>
          {/* Stoppages first — this is where arb appears */}
          {stoppageMatches.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-2xs font-bold text-yellow-arb uppercase tracking-widest">
                ⏸ In Stoppage ({stoppageMatches.length})
              </h2>
              <div className="space-y-2">
                {stoppageMatches.map((match) => (
                  <LiveMatchCard
                    key={match.id}
                    match={match}
                    opportunities={activeOpps}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Active games */}
          {activeMatches.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-2xs font-bold text-text-muted uppercase tracking-widest">
                ▶ In Progress ({activeMatches.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {activeMatches.map((match) => (
                  <LiveMatchCard
                    key={match.id}
                    match={match}
                    opportunities={activeOpps}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
