'use client';

import useSWR from 'swr';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api } from '@/lib/api';
import { formatCurrency, formatROI, formatTimeAgo } from '@/lib/formatters';

const fetcher = (url: string) => api.get(url).then((r) => r.data.data);

const STATUS_COLORS: Record<string, string> = {
  pending: '#888888',
  won: '#00ff88',
  lost: '#ff4444',
  void: '#ffb800',
};

export default function PortfolioPage() {
  const { data: bets = [], isLoading } = useSWR('/user/bets', fetcher);

  const totalBets = bets.length;
  const totalStaked = bets.reduce((s: number, b: any) => s + parseFloat(b.total_stake), 0);
  const totalProfit = bets
    .filter((b: any) => b.actual_profit !== null)
    .reduce((s: number, b: any) => s + parseFloat(b.actual_profit ?? 0), 0);

  const wonCount = bets.filter((b: any) => b.status === 'won').length;
  const winRate = totalBets > 0 ? (wonCount / totalBets) * 100 : 0;

  const sportData = Object.entries(
    bets.reduce((acc: Record<string, number>, b: any) => {
      const sport = b.sport ?? 'other';
      acc[sport] = (acc[sport] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const PIE_COLORS = ['#00ff88', '#00b4ff', '#ffb800', '#ff4444', '#888888'];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-base font-bold text-text-primary">Portfolio</h1>
        <p className="text-2xs text-text-muted mt-0.5">Track your arbitrage betting performance</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Bets', value: String(totalBets) },
          { label: 'Total Staked', value: formatCurrency(totalStaked) },
          { label: 'Total Profit', value: formatCurrency(totalProfit), green: totalProfit > 0 },
          { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, green: winRate > 50 },
        ].map((s) => (
          <div key={s.label} className="border border-border bg-card rounded-lg p-4">
            <div className="text-2xs text-text-muted mb-1">{s.label}</div>
            <div className={`font-bold text-base ${s.green ? 'text-green-arb' : 'text-text-primary'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {bets.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-border bg-card rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-3">Bets by Sport</div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={sportData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={50}>
                  {sportData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#161616', border: '1px solid #2a2a2a', fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="border border-border bg-card rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-3">Recent Profit/Loss</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={bets.slice(-10).map((b: any, i: number) => ({ i, profit: parseFloat(b.actual_profit ?? 0) }))}>
                <XAxis hide />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#161616', border: '1px solid #2a2a2a', fontSize: 11 }} formatter={(v: number) => [formatCurrency(v), 'Profit']} />
                <Bar dataKey="profit" fill="#00ff88" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bet table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-2 bg-panel text-2xs text-text-muted border-b border-border">
          <span>EVENT</span>
          <span>STAKED</span>
          <span>PROFIT</span>
          <span>STATUS</span>
          <span>DATE</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-xs animate-pulse">Loading bets...</div>
        ) : bets.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">
            No bets recorded yet. Place your first bet from an opportunity detail page.
          </div>
        ) : (
          bets.map((bet: any) => (
            <div key={bet.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-3 border-b border-border hover-row text-xs">
              <span className="text-text-primary truncate">{bet.event_name ?? 'Manual bet'}</span>
              <span className="text-text-primary">{formatCurrency(parseFloat(bet.total_stake))}</span>
              <span className={bet.actual_profit > 0 ? 'text-green-arb' : bet.actual_profit < 0 ? 'text-red-arb' : 'text-text-muted'}>
                {bet.actual_profit !== null ? formatCurrency(parseFloat(bet.actual_profit)) : '--'}
              </span>
              <span style={{ color: STATUS_COLORS[bet.status] }}>{bet.status.toUpperCase()}</span>
              <span className="text-text-muted">{formatTimeAgo(new Date(bet.placed_at))}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
