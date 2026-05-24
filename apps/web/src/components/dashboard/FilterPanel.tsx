'use client';

import type { ArbitrageFilter, SportCategory, MarketType, BookmakerSlug } from '@arbix/shared';

const SPORTS: SportCategory[] = ['football', 'basketball', 'baseball', 'hockey', 'soccer', 'tennis', 'mma', 'boxing', 'golf', 'politics', 'crypto'];
const MARKET_TYPES: MarketType[] = ['moneyline', 'spread', 'total', 'yes_no', 'prop'];
const BOOKMAKERS: BookmakerSlug[] = ['polymarket', 'draftkings', 'fanduel', 'pinnacle', 'betmgm', 'caesars', 'bet365'];

interface Props {
  filters: ArbitrageFilter;
  onChange: (filters: ArbitrageFilter) => void;
}

export function FilterPanel({ filters, onChange }: Props) {
  function toggle<T>(arr: T[] | undefined, val: T): T[] {
    if (!arr) return [val];
    return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
  }

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-2xs border cursor-pointer transition-colors ${
      active ? 'border-green-arb text-green-arb bg-green-arb/10' : 'border-border text-text-muted hover:border-text-muted'
    }`;

  return (
    <div className="border border-border bg-card rounded-lg p-4 space-y-4">
      {/* Sports */}
      <div>
        <div className="text-2xs text-text-muted mb-2">SPORT</div>
        <div className="flex flex-wrap gap-1.5">
          {SPORTS.map((s) => (
            <button
              key={s}
              className={chip(filters.sports?.includes(s) ?? false)}
              onClick={() => onChange({ ...filters, sports: toggle(filters.sports, s) })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Market types */}
      <div>
        <div className="text-2xs text-text-muted mb-2">MARKET TYPE</div>
        <div className="flex flex-wrap gap-1.5">
          {MARKET_TYPES.map((m) => (
            <button
              key={m}
              className={chip(filters.marketTypes?.includes(m) ?? false)}
              onClick={() => onChange({ ...filters, marketTypes: toggle(filters.marketTypes, m) })}
            >
              {m.replace('_', '/')}
            </button>
          ))}
        </div>
      </div>

      {/* Bookmakers */}
      <div>
        <div className="text-2xs text-text-muted mb-2">BOOKMAKER</div>
        <div className="flex flex-wrap gap-1.5">
          {BOOKMAKERS.map((b) => (
            <button
              key={b}
              className={chip(filters.bookmakers?.includes(b) ?? false)}
              onClick={() => onChange({ ...filters, bookmakers: toggle(filters.bookmakers, b) })}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Min ROI + Confidence */}
      <div className="flex items-center gap-6">
        <div>
          <label className="block text-2xs text-text-muted mb-1.5">MIN ROI (%)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={filters.minRoi ?? ''}
            onChange={(e) => onChange({ ...filters, minRoi: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-24 bg-terminal border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-green-arb/50"
            placeholder="0.0"
          />
        </div>

        <div>
          <div className="text-2xs text-text-muted mb-1.5">CONFIDENCE</div>
          <div className="flex gap-1.5">
            {(['high', 'medium', 'low'] as const).map((c) => (
              <button
                key={c}
                className={chip(filters.confidenceLevels?.includes(c) ?? false)}
                onClick={() => onChange({ ...filters, confidenceLevels: toggle(filters.confidenceLevels, c) })}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => onChange({})}
          className="ml-auto text-2xs text-text-muted hover:text-red-arb transition-colors border border-border rounded px-3 py-1.5"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
}
