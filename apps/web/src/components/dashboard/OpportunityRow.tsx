'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { ConfidenceBadge } from '@/components/ui/Badge';
import { formatROI, formatCurrency, formatTimeAgo } from '@/lib/formatters';
import type { ArbitrageOpportunity } from '@arbix/shared';

interface Props {
  opportunity: ArbitrageOpportunity;
  showLink?: boolean;
}

export function OpportunityRow({ opportunity: opp, showLink }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [age, setAge] = useState('');

  useEffect(() => {
    const update = () => setAge(formatTimeAgo(new Date(opp.detectedAt)));
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [opp.detectedAt]);

  const roiColor =
    opp.roi >= 5 ? 'text-green-arb glow-green-sm' :
    opp.roi >= 2 ? 'text-green-arb' :
    'text-green-arb-muted';

  function copyStakes() {
    const text = opp.stakes.map((s) => `${s.outcome} @ ${s.bookmaker}: $${s.stake}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Stakes copied');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div
        onClick={() => setExpanded((e) => !e)}
        className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 border-b border-border hover-row cursor-pointer text-xs transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${opp.status === 'live' ? 'bg-green-arb animate-pulse-green' : 'bg-text-muted'}`} />
          <span className="text-text-primary truncate">{opp.eventName}</span>
        </div>
        <span className="text-text-secondary capitalize">{opp.sport}</span>
        <span className={`font-bold ${roiColor}`}>{formatROI(opp.roi)}</span>
        <span className="text-text-primary">{formatCurrency(opp.guaranteedProfit)}</span>
        <span className="text-text-muted truncate">{opp.bookmakers.slice(0, 2).join(', ')}</span>
        <ConfidenceBadge level={opp.confidence} />
        <span className="text-text-muted text-2xs">{age}</span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-border bg-terminal/50"
          >
            <div className="px-4 py-4 space-y-3">
              {/* Stakes table */}
              <div className="space-y-1.5">
                {opp.stakes.map((stake, i) => (
                  <div key={i} className="flex items-center justify-between text-2xs">
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted w-4">{i + 1}.</span>
                      <span className="text-text-primary font-medium">{stake.outcome}</span>
                      <span className="text-text-muted capitalize">{stake.bookmaker}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-text-secondary">{stake.decimalOdds}x</span>
                      <span className="text-text-primary w-20 text-right">{formatCurrency(stake.stake)}</span>
                      <span className="text-green-arb w-24 text-right">→ {formatCurrency(stake.potentialReturn)}</span>
                      {stake.betUrl && (
                        <a href={stake.betUrl} target="_blank" rel="noopener noreferrer"
                           className="text-blue-arb hover:text-blue-arb-dim transition-colors" onClick={(e) => e.stopPropagation()}>
                          Bet →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary + actions */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-4 text-2xs text-text-muted">
                  <span>Impl. prob: {(opp.totalImpliedProbability * 100).toFixed(2)}%</span>
                  <span>Margin: {(opp.profitMargin * 100).toFixed(2)}%</span>
                  <span>Capital: {formatCurrency(opp.totalStake)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); copyStakes(); }}
                    className="text-2xs border border-border rounded px-2 py-1 text-text-secondary hover:border-green-arb/40 transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy Stakes'}
                  </button>
                  {showLink && (
                    <Link
                      href={`/opportunities/${opp.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-2xs border border-green-arb/30 rounded px-2 py-1 text-green-arb hover:bg-green-arb/10 transition-colors"
                    >
                      Full Details →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
