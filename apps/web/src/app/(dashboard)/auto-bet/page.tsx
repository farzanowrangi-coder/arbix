'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { walletApi, credentialsApi, autoBetApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WalletState { balance: number; isDemo: boolean }
interface Settings {
  enabled: boolean; demoMode: boolean; liveMode: boolean;
  maxStakePct: number; minRoi: number;
  maxStakeAbs: number; bankrollFloor: number;
  demoBooks: string[];
}
interface CredentialRow { bookmaker: string; is_active: boolean; last_verified: string | null; created_at: string }
interface BetRow {
  id: string; event_name: string; sport: string; roi: string;
  total_stake: string; guaranteed_profit: string; actual_profit: string | null;
  slippage_pct: string | null; winning_leg: string | null;
  is_demo: boolean; status: string; placed_at: string; settled_at: string | null;
  settle_after: string | null; legs: any[];
}

const BOOKS = [
  { key: 'polymarket', label: 'Polymarket', color: 'text-purple-400', note: 'Polygon wallet', loginLabel: 'Wallet Address (0x…)', passwordLabel: 'Wallet Private Key (0x…)', loginPlaceholder: '0xabc123…', passwordPlaceholder: '0xprivatekey…' },
  { key: 'kalshi',     label: 'Kalshi',     color: 'text-cyan-400',   note: 'API supported',      loginLabel: 'Email / Username', passwordLabel: 'Password', loginPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••' },
  { key: 'pinnacle',   label: 'Pinnacle',   color: 'text-blue-400',   note: 'Browser automation', loginLabel: 'Email / Username', passwordLabel: 'Password', loginPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••' },
  { key: 'stake',      label: 'Stake',      color: 'text-green-400',  note: 'Browser automation', loginLabel: 'Email / Username', passwordLabel: 'Password', loginPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••' },
  { key: 'betway',     label: 'Betway',     color: 'text-yellow-400', note: 'Browser automation', loginLabel: 'Email / Username', passwordLabel: 'Password', loginPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••' },
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
  const [bookBalances, setBookBalances] = useState<Record<string, number | null>>({});
  const [form, setForm] = useState<{ bookmaker: string; login: string; password: string } | null>(null);
  const [pinnacleSessionCookie, setPinnacleSessionCookie] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const activeBook = form ? BOOKS.find((b) => b.key === form.bookmaker) : null;

  const load = useCallback(async () => {
    try { const res = await credentialsApi.list(); setCreds(res.data ?? []); } catch {}
  }, []);

  const loadBalances = useCallback(async () => {
    try {
      const res = await autoBetApi.getBookBalances();
      if (res.data) {
        setBookBalances({
          polymarket: res.data.polymarket,
          pinnacle:   res.data.pinnacle,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadBalances();
    const t = setInterval(loadBalances, 30_000);
    return () => clearInterval(t);
  }, [load, loadBalances]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await credentialsApi.save(form.bookmaker, form.login, form.password);
      // Save Pinnacle session cookie separately (used instead of password-based login)
      if (form.bookmaker === 'pinnacle' && pinnacleSessionCookie.trim()) {
        await credentialsApi.save('pinnacle_cookies', pinnacleSessionCookie.trim(), '_');
      }
      setForm(null);
      setPinnacleSessionCookie('');
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
          const balance = existing ? bookBalances[book.key] : undefined;
          return (
            <div key={book.key} className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${existing ? 'bg-green-arb' : 'bg-text-muted'}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${book.color}`}>{book.label}</span>
                    {existing && (
                      balance != null
                        ? <span className="text-xs font-bold text-green-arb tabular-nums">${fmt(balance)}</span>
                        : <span className="text-2xs text-text-muted/50">fetching…</span>
                    )}
                  </div>
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
                <button onClick={() => { setForm(null); setPinnacleSessionCookie(''); }} className="text-text-muted hover:text-text-primary">✕</button>
              </div>
              {/* Polymarket-specific hint */}
              {activeBook?.key === 'polymarket' && (
                <div className="bg-purple-400/10 border border-purple-400/30 rounded-lg px-3 py-2 text-2xs text-purple-300 space-y-1">
                  <div className="font-bold text-purple-400">Dedicated Polygon Wallet</div>
                  <div>1. Create a new wallet in MetaMask (keep it separate from your main wallet)</div>
                  <div>2. Send USDC to it on <span className="font-bold text-purple-300">Polygon network</span> (not Ethereum)</div>
                  <div>3. Connect it on polymarket.com once to approve trading (~$0.01 MATIC gas)</div>
                  <div>4. Paste the wallet address above and its private key below</div>
                  <div className="text-purple-400/70 pt-0.5">Never use your main wallet's private key here.</div>
                </div>
              )}
              {/* Pinnacle-specific hint */}
              {activeBook?.key === 'pinnacle' && (
                <div className="bg-blue-400/10 border border-blue-400/30 rounded-lg px-3 py-2 text-2xs text-blue-300 space-y-1">
                  <div className="font-bold text-blue-400">Pinnacle uses CAPTCHA — paste session cookies instead</div>
                  <div>1. Log into <span className="font-bold">pinnacle.com</span> in Chrome</div>
                  <div>2. Press <span className="font-bold text-white">F12</span> → Network tab → click any pinnacle.com request</div>
                  <div>3. In Request Headers, find <span className="font-bold text-white">Cookie:</span> → copy the entire value</div>
                  <div>4. Paste it in the Session Cookie field below</div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-2xs text-text-muted block mb-1">{activeBook?.loginLabel ?? 'Email / Username'}</label>
                  <input type="text" value={form.login}
                    onChange={(e) => setForm({ ...form, login: e.target.value })}
                    className="w-full bg-terminal border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-green-arb/50"
                    placeholder={activeBook?.loginPlaceholder ?? 'your@email.com'}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-2xs text-text-muted block mb-1">{activeBook?.passwordLabel ?? 'Password'}</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full bg-terminal border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-green-arb/50 pr-10"
                      placeholder={activeBook?.passwordPlaceholder ?? '••••••••'}
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-text-muted hover:text-text-secondary">
                      {showPw ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                {/* Pinnacle session cookie field */}
                {activeBook?.key === 'pinnacle' && (
                  <div>
                    <label className="text-2xs text-text-muted block mb-1">
                      Session Cookie <span className="text-blue-400">(Recommended — bypasses CAPTCHA)</span>
                    </label>
                    <textarea
                      value={pinnacleSessionCookie}
                      onChange={(e) => setPinnacleSessionCookie(e.target.value)}
                      className="w-full bg-terminal border border-blue-400/40 rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-blue-400/70 font-mono resize-none"
                      placeholder="Paste cookie string from browser DevTools Network → Request Headers → Cookie: ..."
                      rows={3}
                    />
                    <div className="text-2xs text-text-muted/60 mt-1">Optional but required for first run. Cookies expire after ~30 days.</div>
                  </div>
                )}
              </div>
              <div className="text-2xs text-text-muted flex items-center gap-1.5">
                <span className="text-green-arb">◈</span>
                Credentials are encrypted with AES-256 before storage and never sent to third parties.
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setForm(null); setPinnacleSessionCookie(''); }}
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

function AutoBetSettings({ settings, onChange, wallet, pendingBets, mode }: { settings: Settings; onChange: (s: Settings) => void; wallet: WalletState | null; pendingBets: BetRow[]; mode: 'live' | 'demo' }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setLocal(settings), [settings]);

  const pending = pendingBets.filter((b) => b.status === 'placed');
  const lockedStake = pending.reduce((s, b) => s + parseFloat(b.total_stake), 0);
  const guaranteedProfit = pending.reduce((s, b) => s + parseFloat(b.guaranteed_profit), 0);
  const projectedBalance = wallet ? wallet.balance + lockedStake + guaranteedProfit : null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await autoBetApi.saveSettings(local, mode);
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
        <span className={local.enabled ? (mode === 'live' ? 'text-green-arb animate-pulse' : 'text-yellow-arb animate-pulse') : 'text-text-muted'}>◉</span>
        <h2 className="text-xs font-bold text-text-primary">{mode === 'live' ? 'Live Settings' : 'Demo Settings'}</h2>
        <span className={`ml-auto text-2xs font-bold px-2 py-0.5 rounded-full border ${
          local.enabled
            ? mode === 'live'
              ? 'border-green-arb/40 text-green-arb bg-green-arb/10'
              : 'border-yellow-arb/40 text-yellow-arb bg-yellow-arb/10'
            : 'border-border text-text-muted'
        }`}>
          {local.enabled ? 'ACTIVE' : 'PAUSED'}
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Enable toggle */}
        <Row label={mode === 'live' ? 'Enable Auto-Bettor' : 'Enable Demo Bettor'} sub={mode === 'live' ? 'Turns the scanner on — also enable Live Mode below to place real bets' : 'Simulate bets with paper money — no real funds used'}>
          <button onClick={() => setLocal({ ...local, enabled: !local.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${local.enabled ? (mode === 'live' ? 'bg-green-arb' : 'bg-yellow-arb') : 'bg-border'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-terminal rounded-full transition-all ${local.enabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </Row>

        {/* Live Mode toggle — live tab only, both must be ON for real bets */}
        {mode === 'live' && (
          <Row label="Live Mode" sub="Both this and Enable must be ON to place real money bets">
            <button onClick={() => setLocal({ ...local, liveMode: !local.liveMode })}
              className={`relative w-10 h-5 rounded-full transition-colors ${local.liveMode ? 'bg-green-arb' : 'bg-border'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-terminal rounded-full transition-all ${local.liveMode ? 'left-5' : 'left-0.5'}`} />
            </button>
          </Row>
        )}

        {/* Warning if enabled but Live Mode is off */}
        {mode === 'live' && local.enabled && !local.liveMode && (
          <div className="flex items-center gap-2 border border-yellow-arb/30 bg-yellow-arb/5 rounded-lg px-3 py-2">
            <span className="text-yellow-arb text-xs">⚠</span>
            <span className="text-2xs text-yellow-arb">Scanner is running but Live Mode is off — no real bets will be placed</span>
          </div>
        )}

        {/* Demo book selector — demo tab only */}
        {mode === 'demo' && (
          <div className="space-y-2">
            <div className="text-2xs text-text-muted uppercase tracking-wide font-medium">Simulate arbs against</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'polymarket', label: 'Polymarket', color: 'text-purple-400' },
                { key: 'pinnacle',   label: 'Pinnacle',   color: 'text-blue-400'   },
                { key: 'draftkings', label: 'DraftKings', color: 'text-green-400'  },
                { key: 'fanduel',    label: 'FanDuel',    color: 'text-text-primary'},
                { key: 'betmgm',     label: 'BetMGM',     color: 'text-yellow-400' },
                { key: 'caesars',    label: 'Caesars',    color: 'text-orange-400' },
              ].map((book) => {
                const selected = (local.demoBooks ?? []).includes(book.key);
                return (
                  <button
                    key={book.key}
                    onClick={() => {
                      const books = local.demoBooks ?? [];
                      setLocal({
                        ...local,
                        demoBooks: selected ? books.filter((b) => b !== book.key) : [...books, book.key],
                      });
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                      selected
                        ? 'border-green-arb/40 bg-green-arb/5 text-text-primary'
                        : 'border-border text-text-muted hover:border-green-arb/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selected ? 'bg-green-arb' : 'bg-border'}`} />
                    <span className={selected ? book.color : ''}>{book.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Projected balance */}
        {projectedBalance !== null && pending.length > 0 && (
          <div className="border border-green-arb/20 rounded-lg bg-green-arb/5 px-4 py-3 space-y-1.5">
            <div className="text-2xs text-text-muted uppercase tracking-wide font-medium">Projected after settlements</div>
            <div className="flex items-center justify-between text-2xs text-text-muted">
              <span>{wallet!.isDemo ? 'Demo' : 'Live'} balance now</span>
              <span className="tabular-nums text-text-primary">${fmt(wallet!.balance)}</span>
            </div>
            <div className="flex items-center justify-between text-2xs text-text-muted">
              <span>Locked in {pending.length} pending bet{pending.length !== 1 ? 's' : ''}</span>
              <span className="tabular-nums">−${fmt(lockedStake)}</span>
            </div>
            <div className="flex items-center justify-between text-2xs text-text-muted">
              <span>Guaranteed returns</span>
              <span className="tabular-nums text-green-arb">+${fmt(lockedStake + guaranteedProfit)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-green-arb/20">
              <span className="text-xs font-bold text-text-primary">Projected balance</span>
              <div className="text-right">
                <span className="text-sm font-bold text-green-arb tabular-nums">${fmt(projectedBalance)}</span>
                <span className="text-2xs text-green-arb/60 ml-1.5">+${fmt(guaranteedProfit)}</span>
              </div>
            </div>
          </div>
        )}

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
            { label: 'Total Bets', value: `${stats.total_bets} (${stats.pending_bets ?? 0} pending)` },
            { label: 'Total Staked', value: `$${fmt(parseFloat(stats.total_staked ?? 0))}` },
            {
              label: 'Settled Profit',
              value: `${parseFloat(stats.total_profit ?? 0) >= 0 ? '+' : ''}$${fmt(parseFloat(stats.total_profit ?? 0))}`,
              green: parseFloat(stats.total_profit ?? 0) >= 0,
            },
            {
              label: 'Actual ROI',
              value: stats.avg_actual_roi != null ? `${parseFloat(stats.avg_actual_roi).toFixed(2)}%` : '—',
              green: parseFloat(stats.avg_actual_roi ?? 0) >= 0,
            },
          ].map((s) => (
            <div key={s.label} className="px-4 py-3 text-center">
              <div className="text-2xs text-text-muted">{s.label}</div>
              <div className={`text-xs font-bold mt-0.5 ${s.green ? 'text-green-arb' : 'text-red-400'}`}>{s.value}</div>
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
          {history.map((bet) => {
            const legs: any[] = Array.isArray(bet.legs) ? bet.legs : [];
            const isSettled = bet.status === 'settled';
            const isPending = bet.status === 'placed';
            const actualProfit = bet.actual_profit != null ? parseFloat(bet.actual_profit) : null;
            const theoreticalProfit = parseFloat(bet.guaranteed_profit);
            const slippage = bet.slippage_pct != null ? parseFloat(bet.slippage_pct) : null;
            const settleTime = bet.settle_after ? new Date(bet.settle_after) : null;
            const settlesIn = settleTime ? Math.max(0, settleTime.getTime() - Date.now()) : null;
            const settlesInStr = settlesIn != null && settlesIn > 0
              ? settlesIn > 3600000 ? `${Math.ceil(settlesIn / 3600000)}h` : `${Math.ceil(settlesIn / 60000)}m`
              : null;
            return (
              <div key={bet.id} className="px-5 py-3 space-y-2">
                {/* Top row */}
                <div className="flex items-center gap-3">
                  <span className="text-base">{SPORT_ICON[bet.sport] ?? '🎯'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate">{bet.event_name}</div>
                    <div className="text-2xs text-text-muted">
                      {new Date(bet.placed_at).toLocaleString()}
                      {bet.is_demo && <span className="ml-1.5 text-yellow-arb font-bold">DEMO</span>}
                      {slippage != null && <span className="ml-1.5 text-text-muted/60">slip {slippage.toFixed(2)}%</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    {isSettled && actualProfit != null ? (
                      <>
                        <div className={`text-xs font-bold tabular-nums ${actualProfit >= 0 ? 'text-green-arb' : 'text-red-400'}`}>
                          {actualProfit >= 0 ? '+' : ''}${fmt(actualProfit)}
                        </div>
                        <div className="text-2xs text-text-muted tabular-nums">
                          ${fmt(parseFloat(bet.total_stake))} staked · {parseFloat(bet.roi).toFixed(2)}% quoted
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs font-bold text-text-muted/60 tabular-nums">~+${fmt(theoreticalProfit)}</div>
                        <div className="text-2xs text-text-muted tabular-nums">
                          ${fmt(parseFloat(bet.total_stake))} staked
                          {settlesInStr && <span className="text-yellow-arb/70"> · settles in {settlesInStr}</span>}
                        </div>
                      </>
                    )}
                  </div>
                  <span className={`text-2xs px-2 py-0.5 rounded-full border flex-shrink-0 ${
                    isSettled && actualProfit != null && actualProfit >= 0 ? 'border-green-arb/40 text-green-arb' :
                    isSettled ? 'border-red-400/40 text-red-400' :
                    isPending ? 'border-yellow-arb/40 text-yellow-arb' :
                    'border-border text-text-muted'
                  }`}>
                    {isPending ? 'PENDING' : bet.status.toUpperCase()}
                  </span>
                </div>
                {/* Winner label for settled bets */}
                {isSettled && bet.winning_leg && (
                  <div className="ml-7 text-2xs text-green-arb/70">
                    ✓ {bet.winning_leg} won
                  </div>
                )}

                {/* Legs — where each side was placed */}
                {legs.length > 0 && (
                  <div className="ml-7 space-y-1">
                    {legs.map((leg, i) => (
                      <div key={i} className="flex items-center gap-2 text-2xs text-text-muted">
                        <span className="text-border">{i === legs.length - 1 ? '└─' : '├─'}</span>
                        <span className="text-text-primary font-medium truncate max-w-[140px]">{leg.outcomeName}</span>
                        <span className="text-border">→</span>
                        {leg.betUrl ? (
                          <a
                            href={leg.betUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-0.5 transition-colors"
                          >
                            {leg.bookmakerLabel ?? leg.bookmaker}
                            <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-blue-400 font-semibold">{leg.bookmakerLabel ?? leg.bookmaker}</span>
                        )}
                        <span className="ml-auto tabular-nums text-text-muted">${fmt(leg.legStake)}</span>
                        <span className={`tabular-nums ${leg.americanOdds > 0 ? 'text-green-arb' : 'text-text-muted'}`}>
                          {leg.americanOdds > 0 ? `+${leg.americanOdds}` : leg.americanOdds}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Daily P&L ────────────────────────────────────────────────────────────────

interface DailyRow { day: string; betsSettled: number; profit: number; staked: number }
interface DailyPnlData {
  daily: DailyRow[];
  today: { betsPlaced: number; staked: number; guaranteedProfit: number };
}

function DailyPnl({ data }: { data: DailyPnlData | null }) {
  const daily = data?.daily ?? [];
  const today = data?.today ?? { betsPlaced: 0, staked: 0, guaranteedProfit: 0 };

  const maxAbs = daily.length > 0 ? Math.max(...daily.map((d) => Math.abs(d.profit)), 1) : 1;
  const totalSettledProfit = daily.reduce((s, d) => s + d.profit, 0);
  const totalSettledBets = daily.reduce((s, d) => s + d.betsSettled, 0);

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-yellow-arb">◑</span>
        <h2 className="text-xs font-bold text-text-primary">Daily P&amp;L</h2>
        <span className="text-2xs text-text-muted ml-auto">Last 30 days</span>
      </div>

      {/* Today strip */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        {[
          { label: "Today's bets", value: today.betsPlaced },
          { label: 'Staked today', value: `$${fmt(today.staked)}` },
          { label: 'Guaranteed today', value: `+$${fmt(today.guaranteedProfit)}`, green: true },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3 text-center">
            <div className="text-2xs text-text-muted">{s.label}</div>
            <div className={`text-xs font-bold mt-0.5 ${s.green ? 'text-green-arb' : 'text-text-primary'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {daily.length === 0 ? (
        <div className="py-10 text-center text-2xs text-text-muted">
          No settled bets yet — P&L will appear here once bets settle.
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <span className="text-2xs text-text-muted">{totalSettledBets} settled bets</span>
            <span className={`text-xs font-bold tabular-nums ${totalSettledProfit >= 0 ? 'text-green-arb' : 'text-red-400'}`}>
              {totalSettledProfit >= 0 ? '+' : ''}${fmt(totalSettledProfit)} total
            </span>
          </div>

          {/* Bar chart */}
          <div className="space-y-1.5">
            {daily.map((row) => {
              const pct = Math.abs(row.profit) / maxAbs * 100;
              const isPos = row.profit >= 0;
              const dateLabel = new Date(row.day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <div key={row.day} className="flex items-center gap-3">
                  <span className="text-2xs text-text-muted w-12 flex-shrink-0 text-right tabular-nums">{dateLabel}</span>
                  <div className="flex-1 h-4 bg-terminal rounded overflow-hidden relative">
                    <div
                      className={`h-full rounded transition-all ${isPos ? 'bg-green-arb/40' : 'bg-red-400/40'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-2xs tabular-nums w-20 text-right flex-shrink-0 ${isPos ? 'text-green-arb' : 'text-red-400'}`}>
                    {isPos ? '+' : ''}${fmt(row.profit)}
                  </span>
                  <span className="text-2xs text-text-muted/50 w-12 text-right flex-shrink-0 tabular-nums">
                    {row.betsSettled}b
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Demo Wallet ──────────────────────────────────────────────────────────────

function DemoWallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const res = await walletApi.getBalance(); setBalance(res.data?.balance ?? null); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = async (amount: number) => {
    setSaving(true);
    try {
      // Reset demo balance by depositing the target amount (balance starts at 0 after reset)
      await walletApi.deposit(amount);
      setMsg(`Demo balance set to $${fmt(amount)}`);
      setInput('');
      load();
    } catch { setMsg('Failed'); }
    finally { setSaving(false); setTimeout(() => setMsg(null), 3000); }
  };

  const PRESETS = [1000, 5000, 10000];

  return (
    <div className="border border-yellow-arb/30 rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-yellow-arb/20 flex items-center gap-2">
        <span className="text-yellow-arb">◈</span>
        <h2 className="text-xs font-bold text-text-primary">Demo Wallet</h2>
        <span className="ml-auto text-2xs px-2 py-0.5 rounded-full border border-yellow-arb/40 text-yellow-arb font-bold">PAPER</span>
      </div>
      <div className="p-5 space-y-5">
        <div className="text-center py-3">
          <div className="text-4xl font-bold text-text-primary tabular-nums">
            ${balance != null ? fmt(balance) : '—'}
          </div>
          <div className="text-2xs text-text-muted mt-1">Simulated balance — no real money</div>
        </div>
        <div className="space-y-2">
          <label className="text-2xs text-text-muted">Set demo balance</label>
          <div className="flex gap-2">
            <div className="flex items-center border border-border rounded px-3 py-1.5 bg-terminal flex-1 focus-within:border-yellow-arb/50 transition-colors">
              <span className="text-text-muted text-xs mr-1">$</span>
              <input
                type="text" value={input}
                onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-transparent text-xs text-text-primary w-full outline-none tabular-nums"
                placeholder="10000"
              />
            </div>
            <button
              onClick={() => reset(parseFloat(input))}
              disabled={saving || !input}
              className="px-4 py-1.5 text-xs font-bold rounded border border-yellow-arb/40 text-yellow-arb hover:bg-yellow-arb/10 disabled:opacity-40 transition-all"
            >
              {saving ? '...' : 'Set'}
            </button>
          </div>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => reset(p)}
                className="text-2xs px-2.5 py-1 rounded border border-border text-text-muted hover:text-yellow-arb hover:border-yellow-arb/30 transition-all">
                ${p >= 1000 ? `${p / 1000}k` : p}
              </button>
            ))}
          </div>
          {msg && <div className="text-2xs text-yellow-arb">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Tab Panel ────────────────────────────────────────────────────────────────

function TabPanel({ mode, wallet, onRefreshWallet }: { mode: 'live' | 'demo'; wallet: WalletState | null; onRefreshWallet: () => void }) {
  const isLive = mode === 'live';
  const [settings, setSettings] = useState<Settings>({
    enabled: false, demoMode: !isLive, liveMode: false,
    maxStakePct: 20, minRoi: 1.0,
    maxStakeAbs: 35, bankrollFloor: 50,
    demoBooks: ['polymarket', 'pinnacle'],
  });
  const [history, setHistory] = useState<BetRow[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [dailyPnl, setDailyPnl] = useState<DailyPnlData | null>(null);

  const loadAll = useCallback(async () => {
    const [sRes, hRes, stRes, pnlRes] = await Promise.allSettled([
      autoBetApi.getSettings(mode),
      autoBetApi.getHistory(mode),
      autoBetApi.getStats(mode),
      autoBetApi.getDailyPnl(mode),
    ]);
    if (sRes.status === 'fulfilled' && sRes.value.data) setSettings(sRes.value.data);
    if (hRes.status === 'fulfilled' && hRes.value.data) setHistory(hRes.value.data);
    if (stRes.status === 'fulfilled' && stRes.value.data) setStats(stRes.value.data);
    if (pnlRes.status === 'fulfilled' && pnlRes.value.data) setDailyPnl(pnlRes.value.data);
  }, [mode]);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 15_000);
    return () => clearInterval(t);
  }, [loadAll]);

  return (
    <div className="space-y-6">
      {isLive && <WalletSection wallet={wallet} onRefresh={onRefreshWallet} />}
      {isLive && <LoginsSection />}
      {!isLive && <DemoWallet />}
      <AutoBetSettings settings={settings} onChange={setSettings} wallet={isLive ? wallet : null} pendingBets={history} mode={mode} />
      <DailyPnl data={dailyPnl} />
      <BetHistory stats={stats} history={history} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AutoBetPage() {
  const [tab, setTab] = useState<'live' | 'demo'>('live');
  const [wallet, setWallet] = useState<WalletState | null>(null);

  const loadWallet = useCallback(async () => {
    try { const res = await walletApi.getBalance(); setWallet(res.data ?? null); } catch {}
  }, []);

  useEffect(() => {
    loadWallet();
    const t = setInterval(loadWallet, 15_000);
    return () => clearInterval(t);
  }, [loadWallet]);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-sm font-bold text-text-primary">Auto-Bettor</h1>
        <p className="text-2xs text-text-muted mt-0.5">
          Live trades real money. Demo lets you backtest strategies risk-free.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-terminal rounded-lg border border-border w-fit">
        <button
          onClick={() => setTab('live')}
          className={`flex items-center gap-2 px-5 py-2 rounded-md text-xs font-bold transition-all ${
            tab === 'live'
              ? 'bg-green-arb text-terminal shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tab === 'live' ? 'bg-terminal' : 'bg-text-muted'}`} />
          Auto-Bettor Live
        </button>
        <button
          onClick={() => setTab('demo')}
          className={`flex items-center gap-2 px-5 py-2 rounded-md text-xs font-bold transition-all ${
            tab === 'demo'
              ? 'bg-yellow-arb text-terminal shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tab === 'demo' ? 'bg-terminal' : 'bg-text-muted'}`} />
          Auto-Bettor Demo
        </button>
      </div>

      {/* Tab content — keep both mounted so data doesn't reset on switch */}
      <div className={tab === 'live' ? '' : 'hidden'}>
        <TabPanel key="live" mode="live" wallet={wallet} onRefreshWallet={loadWallet} />
      </div>
      <div className={tab === 'demo' ? '' : 'hidden'}>
        <TabPanel key="demo" mode="demo" wallet={wallet} onRefreshWallet={loadWallet} />
      </div>
    </div>
  );
}
