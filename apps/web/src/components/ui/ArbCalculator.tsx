'use client';

import { useState, useCallback } from 'react';
import { useOddsFormat } from '@/context/OddsFormatContext';

export interface ArbLeg {
  outcomeName: string;
  bookmakerLabel: string;
  decimalOdds: number;
  americanOdds: number;
  betUrl?: string;
}

interface Props {
  legs: ArbLeg[];
  defaultStake?: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export default function ArbCalculator({ legs, defaultStake = 1000 }: Props) {
  const [stake, setStake] = useState<string>(String(defaultStake));
  const { displayOdds } = useOddsFormat();

  const totalStake = parseFloat(stake) || 0;
  const totalImplied = legs.reduce((s, l) => s + 1 / l.decimalOdds, 0);
  const guaranteedProfit = totalStake > 0 ? totalStake * (1 / totalImplied - 1) : 0;
  const roi = totalImplied < 1 ? ((1 / totalImplied - 1) * 100) : 0;

  // Stake on each leg = totalStake × (1/decimalOdds) / totalImplied
  const allocations = legs.map((leg) => ({
    ...leg,
    legStake: totalStake > 0 ? totalStake * (1 / leg.decimalOdds) / totalImplied : 0,
    payout: totalStake > 0 ? (totalStake * (1 / leg.decimalOdds) / totalImplied) * leg.decimalOdds : 0,
  }));

  const handleStakeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, '');
    setStake(val);
  }, []);

  const presets = [100, 500, 1000, 5000];

  return (
    <div className="mt-3 pt-3 border-t border-green-arb/20 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-2xs font-bold text-green-arb uppercase tracking-wider">
          <span className="glow-green-sm">◈</span>
          Stake Calculator
        </div>
        <div className="flex items-center gap-1">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setStake(String(p))}
              className={`text-2xs px-2 py-0.5 rounded border transition-all ${
                stake === String(p)
                  ? 'border-green-arb text-green-arb bg-green-arb/10'
                  : 'border-border text-text-muted hover:text-text-primary hover:border-green-arb/30'
              }`}
            >
              ${p >= 1000 ? `${p / 1000}k` : p}
            </button>
          ))}
        </div>
      </div>

      {/* Stake input */}
      <div className="flex items-center gap-2">
        <span className="text-text-muted text-xs">Total bankroll</span>
        <div className="flex items-center border border-border rounded px-2 py-1 bg-terminal focus-within:border-green-arb/50 transition-colors">
          <span className="text-text-muted text-xs mr-1">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={stake}
            onChange={handleStakeChange}
            className="bg-transparent text-xs text-text-primary w-24 outline-none tabular-nums"
            placeholder="1000"
          />
        </div>
        <span className="text-text-muted text-2xs">split across {legs.length} bets</span>
      </div>

      {/* Allocation table */}
      <div className="space-y-1.5">
        {allocations.map((a, i) => (
          <div key={i} className="flex items-center gap-3 bg-green-arb/5 rounded px-3 py-2 border border-green-arb/15">
            {/* Leg number */}
            <span className="text-2xs font-bold text-green-arb w-4 flex-shrink-0">#{i + 1}</span>

            {/* Outcome + book */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-text-primary truncate">{a.outcomeName}</div>
              <div className="text-2xs text-text-muted flex items-center gap-1">
                <span>@ {a.bookmakerLabel}</span>
                <span className="text-text-muted">·</span>
                <span className={`font-mono ${a.americanOdds > 0 ? 'text-green-arb' : 'text-text-secondary'}`}>
                  {displayOdds(a.decimalOdds, a.americanOdds)}
                </span>
              </div>
            </div>

            {/* Stake */}
            <div className="text-right flex-shrink-0">
              <div className="text-xs font-bold text-text-primary tabular-nums">
                ${totalStake > 0 ? fmt(a.legStake) : '—'}
              </div>
              <div className="text-2xs text-text-muted tabular-nums">
                wins ${totalStake > 0 ? fmt(a.payout) : '—'}
              </div>
            </div>

            {/* Bet link */}
            {a.betUrl && (
              <a
                href={a.betUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-2xs px-2 py-1 rounded border border-green-arb/40 text-green-arb hover:bg-green-arb/10 transition-colors"
              >
                Bet →
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Guaranteed profit summary */}
      <div className="flex items-center justify-between bg-green-arb/10 border border-green-arb/30 rounded px-3 py-2">
        <div className="space-y-0.5">
          <div className="text-2xs text-text-muted uppercase tracking-wider">Guaranteed profit</div>
          <div className="text-sm font-bold text-green-arb glow-green-sm tabular-nums">
            {totalStake > 0 ? `+$${fmt(guaranteedProfit)}` : '—'}
          </div>
        </div>
        <div className="text-right space-y-0.5">
          <div className="text-2xs text-text-muted uppercase tracking-wider">ROI</div>
          <div className="text-sm font-bold text-green-arb tabular-nums">
            +{roi.toFixed(2)}%
          </div>
        </div>
        <div className="text-right space-y-0.5">
          <div className="text-2xs text-text-muted uppercase tracking-wider">Total bet</div>
          <div className="text-xs font-medium text-text-secondary tabular-nums">
            ${totalStake > 0 ? fmt(totalStake) : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
