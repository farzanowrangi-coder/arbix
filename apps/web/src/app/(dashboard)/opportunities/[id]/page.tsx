'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { AIInsightPanel } from '@/components/dashboard/AIInsightPanel';
import { ConfidenceBadge } from '@/components/ui/Badge';
import { formatROI, formatCurrency, formatTimeAgo } from '@/lib/formatters';
import type { ArbitrageOpportunity } from '@arbix/shared';

const fetcher = (url: string) => api.get(url).then((r) => r.data.data);

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: opp, isLoading } = useSWR<ArbitrageOpportunity>(`/arbitrage/opportunities/${id}`, fetcher);
  const [copied, setCopied] = useState(false);
  const [placing, setPlacing] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!opp) {
    return (
      <div className="p-6 text-center text-text-muted">
        <p>Opportunity not found or expired.</p>
        <Link href="/opportunities" className="text-green-arb text-sm mt-4 inline-block">← Back to opportunities</Link>
      </div>
    );
  }

  function copyStakes() {
    const text = opp!.stakes
      .map((s) => `${s.outcome} @ ${s.bookmaker}: $${s.stake} (${s.decimalOdds}x)`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Stakes copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  async function placeBet() {
    setPlacing(true);
    try {
      await api.post('/arbitrage/bets', {
        opportunityId: opp!.id,
        stakeAllocations: opp!.stakes,
        totalStake: opp!.totalStake,
      });
      toast.success('Bet recorded in portfolio');
    } catch {
      toast.error('Failed to record bet');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Back */}
      <Link href="/opportunities" className="text-2xs text-text-muted hover:text-text-secondary transition-colors">
        ← Back to opportunities
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-border bg-card rounded-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h1 className="text-base font-bold text-text-primary mb-1">{opp.eventName}</h1>
            <div className="flex items-center gap-2 text-2xs text-text-muted">
              <span>{opp.sport}</span>
              <span>·</span>
              <span>{opp.marketType}</span>
              {opp.league && <><span>·</span><span>{opp.league}</span></>}
            </div>
          </div>
          <ConfidenceBadge level={opp.confidence} score={opp.confidenceScore * 100} size="md" />
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-4 gap-4 p-4 bg-terminal rounded-lg">
          <div>
            <div className="text-2xs text-text-muted mb-1">ROI</div>
            <div className="text-green-arb font-bold text-lg glow-green-sm">{formatROI(opp.roi)}</div>
          </div>
          <div>
            <div className="text-2xs text-text-muted mb-1">Guaranteed Profit</div>
            <div className="text-green-arb font-bold">{formatCurrency(opp.guaranteedProfit)}</div>
          </div>
          <div>
            <div className="text-2xs text-text-muted mb-1">Total Stake</div>
            <div className="text-text-primary font-bold">{formatCurrency(opp.totalStake)}</div>
          </div>
          <div>
            <div className="text-2xs text-text-muted mb-1">Detected</div>
            <div className="text-text-secondary text-xs">{formatTimeAgo(new Date(opp.detectedAt))}</div>
          </div>
        </div>
      </motion.div>

      {/* Stake breakdown */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="border border-border bg-card rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-xs font-bold text-text-primary">Stake Allocation</h2>
          <button
            onClick={copyStakes}
            className="text-2xs text-green-arb hover:text-green-arb-dim transition-colors border border-green-arb/30 rounded px-2 py-1"
          >
            {copied ? 'Copied!' : 'Copy All'}
          </button>
        </div>

        <div className="divide-y divide-border">
          {opp.stakes.map((stake, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <div>
                <div className="text-xs text-text-primary font-medium">{stake.outcome}</div>
                <div className="text-2xs text-text-muted mt-0.5 capitalize">{stake.bookmaker}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-text-secondary">{stake.decimalOdds}x</div>
                <div className="text-2xs text-text-muted">decimal odds</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-text-primary">{formatCurrency(stake.stake)}</div>
                <div className="text-2xs text-green-arb">→ {formatCurrency(stake.potentialReturn)}</div>
              </div>
              {stake.betUrl && (
                <a
                  href={stake.betUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xs text-blue-arb hover:text-blue-arb-dim transition-colors border border-blue-arb/30 rounded px-2 py-1"
                >
                  Bet →
                </a>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-terminal/50 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">Total implied probability: {(opp.totalImpliedProbability * 100).toFixed(2)}%</span>
          <span className="text-xs font-bold text-green-arb">Guaranteed: {formatCurrency(opp.guaranteedProfit)}</span>
        </div>
      </motion.div>

      {/* Confidence */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="border border-border bg-card rounded-lg p-5">
        <h2 className="text-xs font-bold text-text-primary mb-3">Confidence Analysis</h2>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 bg-terminal rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                opp.confidence === 'high' ? 'bg-green-arb' : opp.confidence === 'medium' ? 'bg-yellow-arb' : 'bg-red-arb'
              }`}
              style={{ width: `${opp.confidenceScore * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-text-primary">{Math.round(opp.confidenceScore * 100)}/100</span>
        </div>
        <ul className="space-y-1">
          {opp.confidenceReasons.map((reason, i) => (
            <li key={i} className="text-2xs text-text-secondary flex items-start gap-1.5">
              <span className="text-green-arb mt-0.5">·</span>
              {reason}
            </li>
          ))}
        </ul>
      </motion.div>

      {/* AI Insight */}
      <AIInsightPanel opportunityId={opp.id} />

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={placeBet}
          disabled={placing}
          className="flex-1 py-2.5 bg-green-arb text-terminal font-bold text-sm rounded hover:bg-green-arb-dim transition-colors disabled:opacity-50 shadow-neon-green"
        >
          {placing ? 'Recording...' : 'Mark as Placed'}
        </button>
        <button
          onClick={copyStakes}
          className="px-6 py-2.5 border border-border rounded text-sm text-text-secondary hover:border-green-arb/40 transition-colors"
        >
          Copy Stakes
        </button>
      </div>
    </div>
  );
}
