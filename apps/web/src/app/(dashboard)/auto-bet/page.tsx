'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { walletApi, credentialsApi, autoBetApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WalletState { balance: number; isDemo: boolean }
interface Settings {
  enabled: boolean; demoMode: boolean;
  maxStakePct: number; minRoi: number;
  maxStakeAbs: number; bankrollFloor: number;
}
interface CredentialRow { bookmaker: string; is_active: boolean; last_verified: string | null; created_at: string }
interface BetRow {
  id: string; event_name: string; sport: string; roi: string;
  total_stake: string; guaranteed_profit: string; is_demo: boolean;
  status: string; placed_at: string; legs: any[];
}

const BOOKS = [
  { key: 'kalshi',   label: 'Kalshi',   color: 'text-cyan-400',   note: 'API supported' },
  { key: 'pinnacle', label: 'Pinnacle', color: 'text-blue-400',   note: 'Browser automation' },
  { key: 'stake',    label: 'Stake',    color: 'text-green-400',  note: 'Browser automation' },
  { key: 'betway',   label: 'Betway',   color: 'text-yellow-400', note: 'Browser automation' },
];

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀', hockey: '🏒', baseball: '⚾', soccer: '⚽', football: '🏈', tennis: '🎾',
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Wallet Section ───────────────────────────────────────────────────────────

function WalletSection({ wallet, onRefresh }: { wallet: WalletState | null; onRefresh: () => void }) {
  const [depositAmount, setDepositAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      await walletApi.deposit(amount);
      setMsg(`+$${fmt(amount)} deposited`);
      setDepositAmount('');
      onRefresh();
    } catch { setMsg('Failed'); }
    finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const toggleDemo = async () => {
    if (!wallet) return;
    await walletApi.setDemoMode(!wallet.isDemo);
    onRefresh();
  };

  const PRESETS = [1000, 5000, 10000];

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-green-arb">◈</span>
        <h2 className="text-xs font-bold text-text-primary">Wallet</h2>
        <span className={`ml-auto text-2xs px-2 py-0.5 rounded-full border font-bold ${wallet?.isDemo ? 'border-yellow-arb/40 text-yellow-arb' : 'border-green-arb/40 text-green-arb'}`}>
          {wallet?.isDemo ? 'DEMO' : 'LIVE'}
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Balance */}
        <div className="text-center py-4">
          <div className="text-4xl font-bold text-text-primary tabular-nums">
            ${wallet ? fmt(wallet.balance) : '—'}
          </div>
          <div className="text-2xs text-text-muted mt-1">{wallet?.isDemo ? 'Demo balance' : 'Live balance'}</div>
        </div>

        {/* Deposit */}
        <div className="space-y-2">
          <label className="text-2xs text-text-muted">Deposit amount</label>
          <div className="flex gap-2">
            <div className="flex items-center border border-border rounded px-3 py-1.5 bg-terminal flex-1 focus-within:border-green-arb/50 transition-colors">
              <span className="text-text-muted text-xs mr-1">$</span>
              <input
                type="text"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-transparent text-xs text-text-primary w-full outline-none tabular-nums"
                placeholder="10000"
              />
            </div>
            <button
              onClick={handleDeposit}
              disabled={saving || !depositAmount}
              className="px-4 py-1.5 text-xs font-bold rounded border border-green-arb/40 text-green-arb hover:bg-green-arb/10 disabled:opacity-40 transition-all"
            >
              {saving ? '...' : 'Deposit'}
            </button>
          </div>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setDepositAmount(String(p))}
                className="text-2xs px-2.5 py-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-green-arb/30 transition-all">
                ${p >= 1000 ? `${p / 1000}k` : p}
              </button>
            ))}
          </div>
          {msg && <div className="text-2xs text-green-arb">{msg}</div>}
        </div>

        {/* Demo/Live toggle */}
        <div className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
          <div>
            <div className="text-xs font-medium text-text-primary">Demo Mode</div>
            <div className="text-2xs text-text-muted">Simulate bets without real money</div>
          </div>
          <button onClick={toggleDemo}
            className={`relative w-10 h-5 rounded-full transition-colors ${wallet?.isDemo ? 'bg-yellow-arb' : 'bg-green-arb'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-terminal rounded-full transition-all ${wallet?.isDemo ? 'left-0.5' : 'left-5'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Logins Section ───────────────────────────────────────────────────────────

function LoginsSection() {
  const [creds, setCreds] = useState<CredentialRow[]>([]);
  const [form, setForm] = useState<{ bookmaker: string; login: string; password: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const load = useCallback(async () => {
    try { const res = await credentialsApi.list(); setCreds(res.data ?? []); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await credentialsApi.save(form.bookmaker, form.login, form.password);
      setForm(null);
      await load();
    } catch {} finally { setSaving(false); }
  };

  const remove = async (book: string) => {
    await credentialsApi.remove(book);
    await load();
  };

  const hasCred = (key: string) => creds.find((c) => c.bookmaker === key);

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-blue-arb">⊕</span>
        <h2 className="text-xs font-bold text-text-primary">Bookmaker Logins</h2>
        <span className="text-2xs text-text-muted ml-auto">Encrypted with AES-256</span>
      </div>

      <div className="p-5 space-y-3">
        {BOOKS.map((book) => {
          const existing = hasCred(book.key);
          return (
            <div key={book.key} className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${existing ? 'bg-green-arb' : 'bg-text-muted'}`} />
                <div>
                  <div className={`text-xs font-medium ${book.color}`}>{book.label}</div>
                  <div className="text-2xs text-text-muted">{existing ? `Connected${existing.last_verified ? ' · verified' : ''}` : book.note}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {existing && (
                  <button onClick={() => remove(book.key)}
                    className="text-2xs text-red-400 hover:text-red-300 border border-red-400/30 rounded px-2 py-0.5 transition-colors">
                    Remove
                  </button>
                )}
                <button
                  onClick={() => setForm({ bookmaker: book.key, login: '', password: '' })}
                  className="text-2xs px-3 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-green-arb/40 transition-all"
                >
                  {existing ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Credential form modal */}
      <AnimatePresence>
        {form && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={(e) => e.target === e.currentTarget && setForm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-panel border border-border rounded-xl p-6 w-full max-w-sm space-y-4 mx-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary capitalize">{form.bookmaker} Login</h3>
                <button onClick={() => setForm(null)} className="text-text-muted hover:text-text-primary">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-2xs text-text-muted block mb-1">Email / Username</label>
                  <input type="text" value={form.login}
                    onChange={(e) => setForm({ ...form, login: e.target.value })}
                    className="w-full bg-terminal border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-green-arb/50"
                    placeholder="your@email.com"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-2xs text-text-muted block mb-1">Password</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full bg-terminal border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-green-arb/50 pr-10"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-text-muted hover:text-text-secondary">
                      {showPw ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-2xs text-text-muted flex items-center gap-1.5">
                <span className="text-green-arb">◈</span>
                Credentials are encrypted before storage and never sent to third parties.
              </div>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)}
                  className="flex-1 py-2 text-xs border border-border rounded text-text-secondary hover:text-text-primary transition-colors">
                  Cancel
                </button>
                <button onClick={save} disabled={saving || !form.login || !form.password}
                  className="flex-1 py-2 text-xs font-bold rounded bg-green-arb text-terminal hover:opacity-90 disabled:opacity-40 transition-all">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Auto-Bet Settings ────────────────────────────────────────────────────────

function AutoBetSettings({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setLocal(settings), [settings]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await autoBetApi.saveSettings(local);
      onChange(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {} finally { setSaving(false); }
  };

  const Row = ({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs text-text-primary">{label}</div>
        {sub && <div className="text-2xs text-text-muted">{sub}</div>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className={local.enabled ? 'text-green-arb animate-pulse' : 'text-text-muted'}>◉</span>
        <h2 className="text-xs font-bold text-text-primary">Auto-Bettor</h2>
        <span className={`ml-auto text-2xs font-bold px-2 py-0.5 rounded-full border ${
          local.enabled ? 'border-green-arb/40 text-green-arb bg-green-arb/10' : 'border-border text-text-muted'
        }`}>
          {local.enabled ? 'ACTIVE' : 'PAUSED'}
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Enable toggle */}
        <Row label="Enable Auto-Bettor" sub="Automatically places bets when arbs are found">
          <button onClick={() => setLocal({ ...local, enabled: !local.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${local.enabled ? 'bg-green-arb' : 'bg-border'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-terminal rounded-full transition-all ${local.enabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </Row>

        {/* Demo mode */}
        <Row label="Demo Mode" sub="Simulate bets — no real money placed">
          <button onClick={() => setLocal({ ...local, demoMode: !local.demoMode })}
            className={`relative w-10 h-5 rounded-full transition-colors ${local.demoMode ? 'bg-yellow-arb' : 'bg-border'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-terminal rounded-full transition-all ${local.demoMode ? 'left-5' : 'left-0.5'}`} />
          </button>
        </Row>

        <div className="border-t border-border pt-4 space-y-4">
          {/* Min ROI */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-2xs text-text-muted">Minimum ROI to bet</label>
              <span className="text-xs font-bold text-green-arb tabular-nums">{local.minRoi.toFixed(1)}%</span>
            </div>
            <input type="range" min="0.5" max="10" step="0.1" value={local.minRoi}
              onChange={(e) => setLocal({ ...local, minRoi: parseFloat(e.target.value) })}
              className="w-full accent-green-arb" />
            <div className="flex justify-between text-2xs text-text-muted">
              <span>0.5%</span><span>10%</span>
            </div>
          </div>

          {/* Max stake % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-2xs text-text-muted">Max stake per bet (% of bankroll)</label>
              <span className="text-xs font-bold text-text-primary tabular-nums">{local.maxStakePct.toFixed(0)}%</span>
            </div>
            <input type="range" min="1" max="25" step="1" value={local.maxStakePct}
              onChange={(e) => setLocal({ ...local, maxStakePct: parseFloat(e.target.value) })}
              className="w-full accent-green-arb" />
            <div className="flex justify-between text-2xs text-text-muted">
              <span>1%</span><span>25%</span>
            </div>
          </div>

          {/* Max stake absolute */}
          <div className="space-y-1">
            <label className="text-2xs text-text-muted block">Max stake per bet (absolute cap)</label>
            <div className="flex items-center border border-border rounded px-3 py-1.5 bg-terminal focus-within:border-green-arb/50 transition-colors">
              <span className="text-text-muted text-xs mr-1">$</span>
              <input type="text" value={local.maxStakeAbs}
                onChange={(e) => setLocal({ ...local, maxStakeAbs: parseFloat(e.target.value) || 0 })}
                className="bg-transparent text-xs text-text-primary w-full outline-none tabular-nums" />
            </div>
          </div>

          {/* Bankroll floor */}
          <div className="space-y-1">
            <label className="text-2xs text-text-muted block">Stop betting when balance drops below</label>
            <div className="flex items-center border border-border rounded px-3 py-1.5 bg-terminal focus-within:border-green-arb/50 transition-colors">
              <span className="text-text-muted text-xs mr-1">$</span>
              <input type="text" value={local.bankrollFloor}
                onChange={(e) => setLocal({ ...local, bankrollFloor: parseFloat(e.target.value) || 0 })}
                className="bg-transparent text-xs text-text-primary w-full outline-none tabular-nums" />
            </div>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-2 text-xs font-bold rounded bg-green-arb text-terminal hover:opacity-90 disabled:opacity-40 transition-all">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ─── Bet History ──────────────────────────────────────────────────────────────

function BetHistory({ stats, history }: { stats: any; history: BetRow[] }) {
  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-text-muted">◎</span>
        <h2 className="text-xs font-bold text-text-primary">Bet History</h2>
        <span className="text-2xs text-text-muted ml-auto">{history.length} bets</span>
      </div>

      {/* Stats bar */}
      {stats && parseInt(stats.total_bets) > 0 && (
        <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
          {[
            { label: 'Total Bets', value: stats.total_bets },
            { label: 'Total Staked', value: `$${fmt(parseFloat(stats.total_staked ?? 0))}` },
            { label: 'Total Profit', value: `+$${fmt(parseFloat(stats.total_profit ?? 0))}`, green: true },
            { label: 'Avg ROI', value: `${parseFloat(stats.avg_roi ?? 0).toFixed(2)}%`, green: true },
          ].map((s) => (
            <div key={s.label} className="px-4 py-3 text-center">
              <div className="text-2xs text-text-muted">{s.label}</div>
              <div className={`text-xs font-bold mt-0.5 ${s.green ? 'text-green-arb' : 'text-text-primary'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {history.length === 0 ? (
        <div className="py-12 text-center text-2xs text-text-muted">
          <div className="text-2xl text-green-arb mb-2">◈</div>
          No bets yet — enable the auto-bettor above to start.
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {history.map((bet) => (
            <div key={bet.id} className="px-5 py-3 flex items-center gap-3">
              <span className="text-base">{SPORT_ICON[bet.sport] ?? '🎯'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-text-primary truncate">{bet.event_name}</div>
                <div className="text-2xs text-text-muted">
                  {new Date(bet.placed_at).toLocaleString()}
                  {bet.is_demo && <span className="ml-1.5 text-yellow-arb font-bold">DEMO</span>}
                </div>
              </div>
              <div className="text-right flex-shrink-0 space-y-0.5">
                <div className="text-xs font-bold text-green-arb tabular-nums">+${fmt(parseFloat(bet.guaranteed_profit))}</div>
                <div className="text-2xs text-text-muted tabular-nums">${fmt(parseFloat(bet.total_stake))} staked · {parseFloat(bet.roi).toFixed(2)}% ROI</div>
              </div>
              <span className={`text-2xs px-2 py-0.5 rounded-full border flex-shrink-0 ${
                bet.status === 'placed' ? 'border-green-arb/40 text-green-arb' : 'border-border text-text-muted'
              }`}>
                {bet.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AutoBetPage() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [settings, setSettings] = useState<Settings>({
    enabled: false, demoMode: true,
    maxStakePct: 5, minRoi: 1.0,
    maxStakeAbs: 500, bankrollFloor: 100,
  });
  const [history, setHistory] = useState<BetRow[]>([]);
  const [stats, setStats] = useState<any>(null);

  const loadWallet = useCallback(async () => {
    try { const res = await walletApi.getBalance(); setWallet(res.data ?? null); } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    await loadWallet();
    try {
      const [sRes, hRes, stRes] = await Promise.all([
        autoBetApi.getSettings(), autoBetApi.getHistory(), autoBetApi.getStats(),
      ]);
      if (sRes.data) setSettings(sRes.data);
      if (hRes.data) setHistory(hRes.data);
      if (stRes.data) setStats(stRes.data);
    } catch {}
  }, [loadWallet]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, [loadAll]);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-text-primary">Auto-Bettor</h1>
          <p className="text-2xs text-text-muted mt-0.5">
            Deposit funds, add bookmaker logins, and let ArbiX bet for you automatically.
          </p>
        </div>
        {settings.enabled && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center gap-1.5 text-2xs text-green-arb font-bold"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse" />
            LIVE — scanning every 60s
          </motion.div>
        )}
      </div>

      <WalletSection wallet={wallet} onRefresh={loadWallet} />
      <LoginsSection />
      <AutoBetSettings settings={settings} onChange={setSettings} />
      <BetHistory stats={stats} history={history} />
    </div>
  );
}
