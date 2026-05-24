'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { formatROI, formatCurrency, formatTimeAgo } from '@/lib/formatters';
import { ConfidenceBadge } from '@/components/ui/Badge';
import type { ArbitrageOpportunity } from '@arbix/shared';

const fetcher = (url: string) => api.get(url).then((r) => r.data.data);

export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR<{ items: ArbitrageOpportunity[]; total: number }>(
    `/arbitrage/history?page=${page}&pageSize=50`,
    fetcher
  );
  const { data: stats } = useSWR('/arbitrage/stats', fetcher);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Build chart data from history
  const chartData = items.slice(0, 30).reverse().map((item, i) => ({
    i,
    roi: parseFloat(item.roi.toFixed(2)),
    profit: parseFloat(item.guaranteedProfit.toFixed(2)),
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-base font-bold text-text-primary">Opportunity History</h1>
        <p className="text-2xs text-text-muted mt-0.5">{total} expired opportunities</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Detected', value: stats?.today_count ?? '--' },
          { label: 'Avg ROI', value: stats?.avg_roi ? formatROI(parseFloat(stats.avg_roi)) : '--' },
          { label: 'Avg Duration', value: stats?.avg_duration ? `${parseFloat(stats.avg_duration).toFixed(0)}m` : '--' },
        ].map((s) => (
          <div key={s.label} className="border border-border bg-card rounded-lg p-4">
            <div className="text-2xs text-text-muted mb-1">{s.label}</div>
            <div className="text-text-primary font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="border border-border bg-card rounded-lg p-4">
          <div className="text-xs text-text-secondary mb-3">ROI — Last 30 Opportunities</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="roiGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00ff88" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(2)}%`, 'ROI']}
              />
              <Area type="monotone" dataKey="roi" stroke="#00ff88" fill="url(#roiGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-2 bg-panel text-2xs text-text-muted border-b border-border">
          <span>EVENT</span>
          <span>SPORT</span>
          <span>ROI</span>
          <span>PROFIT</span>
          <span>CONFIDENCE</span>
          <span>DETECTED</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-xs animate-pulse">Loading history...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No history yet.</div>
        ) : (
          items.map((opp) => (
            <div
              key={opp.id}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-3 border-b border-border hover-row text-xs"
            >
              <span className="text-text-primary truncate">{opp.eventName}</span>
              <span className="text-text-secondary capitalize">{opp.sport}</span>
              <span className="text-green-arb font-bold">{formatROI(opp.roi)}</span>
              <span className="text-text-primary">{formatCurrency(opp.guaranteedProfit)}</span>
              <ConfidenceBadge level={opp.confidence} />
              <span className="text-text-muted">{formatTimeAgo(new Date(opp.detectedAt))}</span>
            </div>
          ))
        )}
      </div>

      {total > 50 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-border rounded text-xs text-text-secondary hover:border-green-arb/40 disabled:opacity-30 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-text-muted">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={items.length < 50}
            className="px-3 py-1.5 border border-border rounded text-xs text-text-secondary hover:border-green-arb/40 disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
