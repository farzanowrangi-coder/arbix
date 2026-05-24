'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gamesApi, type GameOddsEntry } from '@/lib/api';
import ArbCalculator, { type ArbLeg } from '@/components/ui/ArbCalculator';
import { useOddsFormat } from '@/context/OddsFormatContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american >= 100) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀', hockey: '🏒', baseball: '⚾',
  soccer: '⚽', football: '🏈', tennis: '🎾',
};

// ─── Manual Calculator ────────────────────────────────────────────────────────

function ManualCalculator() {
  const [odds1, setOdds1] = useState('');
  const [odds2, setOdds2] = useState('');
  const [stake, setStake] = useState('1000');
  const { displayOdds } = useOddsFormat();

  const parse = (raw: string) => {
    const n = parseInt(raw.replace(/[^0-9\-+]/g, ''), 10);
    if (isNaN(n) || n === 0) return null;
    return n;
  };

  const american1 = parse(odds1);
  const american2 = parse(odds2);
  const dec1 = american1 !== null ? americanToDecimal(american1) : null;
  const dec2 = american2 !== null ? americanToDecimal(american2) : null;
  const totalStake = parseFloat(stake) || 0;
  const totalImplied = dec1 && dec2 ? 1 / dec1 + 1 / dec2 : null;
  const hasArb = totalImplied !== null && totalImplied < 1;

  const bet1 = totalImplied && dec1 && totalStake > 0 ? totalStake * (1 / dec1) / totalImplied : null;
  const bet2 = totalImplied && dec2 && totalStake > 0 ? totalStake * (1 / dec2) / totalImplied : null;
  const profit = hasArb && bet1 && dec1 ? bet1 * dec1 - totalStake : null;
  const roi = hasArb && totalImplied ? (1 / totalImplied - 1) * 100 : null;

  const PRESETS = [100, 500, 1000, 5000];

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-green-arb text-xs">◆</span>
        <h2 className="text-xs font-bold text-text-primary">Manual Calculator</h2>
        <span className="text-2xs text-text-muted ml-auto">Enter odds on both sides</span>
      </div>

      <div className="p-5 space-y-5">
        {/* Odds inputs */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Side 1 odds', value: odds1, set: setOdds1, dec: dec1, american: american1 },
            { label: 'Side 2 odds', value: odds2, set: setOdds2, dec: dec2, american: american2 },
          ].map((side, i) => {
            const isValid = side.dec !== null && side.dec > 1;
            const hasInput = side.value.length > 0;
            return (
              <div key={i} className="space-y-1.5">
                <label className="text-2xs text-text-muted">{side.label}</label>
                <input
                  type="text"
                  value={side.value}
                  onChange={(e) => side.set(e.target.value)}
                  placeholder="+150 or -110"
                  className={`w-full bg-terminal border rounded-md px-3 py-2 text-sm font-mono outline-none transition-colors ${
                    hasInput && !isValid
                      ? 'border-red-400/50 text-red-400'
                      : isValid
                      ? 'border-green-arb/50 text-green-arb focus:border-green-arb'
                      : 'border-border text-text-primary focus:border-green-arb/50'
                  }`}
                />
                {isValid && (
                  <div className="text-2xs text-text-muted">
                    {(1 / side.dec! * 100).toFixed(1)}% implied · {side.dec!.toFixed(3)}x
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Stake */}
        <div className="space-y-2">
          <label className="text-2xs text-text-muted">Total bankroll to split</label>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border border-border rounded-md px-3 py-1.5 bg-terminal focus-within:border-green-arb/50 transition-colors">
              <span className="text-text-muted text-xs mr-1">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-transparent text-xs text-text-primary w-24 outline-none tabular-nums"
                placeholder="1000"
              />
            </div>
            <div className="flex items-center gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setStake(String(p))}
                  className={`text-2xs px-2.5 py-1 rounded border transition-all ${
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
        </div>

        {/* Result */}
        <AnimatePresence mode="wait">
          {dec1 && dec2 && totalStake > 0 && totalImplied && bet1 && bet2 ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {/* Bet splits */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Side 1', american: american1!, bet: bet1, dec: dec1 },
                  { label: 'Side 2', american: american2!, bet: bet2, dec: dec2 },
                ].map((side, i) => (
                  <div key={i} className={`rounded-md px-4 py-3 border ${hasArb ? 'bg-green-arb/5 border-green-arb/20' : 'bg-terminal border-border'}`}>
                    <div className="text-2xs text-text-muted mb-1">{side.label} · <span className={`font-mono ${side.american > 0 ? 'text-green-arb' : 'text-text-secondary'}`}>{displayOdds(side.dec, side.american)}</span></div>
                    <div className="text-lg font-bold text-text-primary tabular-nums">${fmt(side.bet)}</div>
                    <div className="text-2xs text-text-muted">wins ${fmt(side.bet * side.dec)}</div>
                  </div>
                ))}
              </div>

              {/* Summary bar */}
              <div className={`flex items-center justify-between rounded-md px-4 py-3 border ${hasArb ? 'bg-green-arb/10 border-green-arb/30' : 'bg-terminal border-border'}`}>
                <div>
                  <div className="text-2xs text-text-muted uppercase tracking-wider">{hasArb ? 'Guaranteed profit' : 'No arb — Σ implied'}</div>
                  <div className={`text-sm font-bold tabular-nums ${hasArb ? 'text-green-arb glow-green-sm' : 'text-yellow-arb'}`}>
                    {hasArb ? `+$${fmt(profit!)}` : `${(totalImplied * 100).toFixed(2)}%`}
                  </div>
                </div>
                {hasArb && (
                  <>
                    <div className="text-right">
                      <div className="text-2xs text-text-muted uppercase tracking-wider">ROI</div>
                      <div className="text-sm font-bold text-green-arb tabular-nums">+{roi!.toFixed(2)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xs text-text-muted uppercase tracking-wider">Σ implied</div>
                      <div className="text-sm font-medium text-text-secondary tabular-nums">{(totalImplied * 100).toFixed(2)}%</div>
                    </div>
                  </>
                )}
                {!hasArb && (
                  <div className="text-2xs text-text-muted">Implied &gt; 100% — no guaranteed profit</div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center py-4 text-2xs text-text-muted">
              Enter odds on both sides to see the split
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Live Game Calculator ─────────────────────────────────────────────────────

function LiveGameCalculator() {
  const [games, setGames] = useState<GameOddsEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { displayOdds } = useOddsFormat();

  const fetchGames = useCallback(async () => {
    try {
      const res = await gamesApi.getUpcoming();
      if (res.success && res.data) {
        setGames(res.data.filter((g) => !g.isCompleted));
      }
    } catch { /* ignore */ } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 60_000);
    return () => clearInterval(t);
  }, [fetchGames]);

  const filtered = games.filter((g) =>
    search.length === 0 || g.eventName.toLowerCase().includes(search.toLowerCase()) || g.league.toLowerCase().includes(search.toLowerCase())
  );

  const liveGames = filtered.filter((g) => g.isLive);
  const upcomingGames = filtered.filter((g) => !g.isLive);
  const selected = games.find((g) => g.id === selectedId) ?? null;

  const legs: ArbLeg[] = selected?.outcomes.map((o) => {
    const best = o.books.find((b) => b.isBest)!;
    return {
      outcomeName: o.name,
      bookmakerLabel: best.bookmakerLabel,
      decimalOdds: best.decimalOdds,
      americanOdds: best.americanOdds,
      betUrl: best.betUrl,
    };
  }) ?? [];

  return (
    <div className="border border-border rounded-lg bg-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-blue-arb text-xs">⊕</span>
        <h2 className="text-xs font-bold text-text-primary">Live Game Calculator</h2>
        <span className="text-2xs text-text-muted ml-auto">Select a game to see optimal stakes</span>
      </div>

      <div className="p-5 space-y-4">
        {/* Search / picker */}
        <div className="space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by team or league…"
            className="w-full bg-terminal border border-border rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-green-arb/50 transition-colors"
          />

          {isLoading ? (
            <div className="text-center py-6 text-2xs text-text-muted animate-pulse">Loading games…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-6 text-2xs text-text-muted">No games found.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
              {liveGames.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-panel/80 text-2xs text-text-muted uppercase tracking-widest flex items-center gap-1.5 sticky top-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    Live ({liveGames.length})
                  </div>
                  {liveGames.map((g) => (
                    <GameRow key={g.id} game={g} selected={selectedId === g.id} onSelect={() => setSelectedId(g.id === selectedId ? null : g.id)} />
                  ))}
                </>
              )}
              {upcomingGames.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-panel/80 text-2xs text-text-muted uppercase tracking-widest sticky top-0">
                    Upcoming ({upcomingGames.length})
                  </div>
                  {upcomingGames.map((g) => (
                    <GameRow key={g.id} game={g} selected={selectedId === g.id} onSelect={() => setSelectedId(g.id === selectedId ? null : g.id)} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Selected game result */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* Game header */}
              <div className="flex items-center gap-2">
                <span>{SPORT_ICON[selected.sport] ?? '🎯'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text-primary truncate">{selected.eventName}</div>
                  <div className="text-2xs text-text-muted">{selected.league}</div>
                </div>
                {selected.hasArb && selected.arbRoi !== null ? (
                  <span className="text-2xs font-bold bg-green-arb text-terminal px-2 py-0.5 rounded-full glow-green-sm">
                    ARB +{selected.arbRoi.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-2xs text-text-muted border border-border px-2 py-0.5 rounded-full">
                    Σ {selected.totalImplied !== null ? (selected.totalImplied * 100).toFixed(1) : '—'}%
                  </span>
                )}
              </div>

              {selected.hasArb ? (
                <ArbCalculator legs={legs} />
              ) : (
                <div className="space-y-2">
                  {/* Odds table even without arb */}
                  <div className="text-2xs text-text-muted mb-1">Best available odds — no arb at the moment</div>
                  <div className="space-y-1.5">
                    {selected.outcomes.map((o) => {
                      const best = o.books.find((b) => b.isBest)!;
                      return (
                        <div key={o.name} className="flex items-center justify-between bg-terminal rounded px-3 py-2 border border-border">
                          <div className="text-xs text-text-primary">{o.name}</div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-mono font-bold ${best.americanOdds > 0 ? 'text-green-arb' : 'text-text-secondary'}`}>
                              {displayOdds(best.decimalOdds, best.americanOdds)}
                            </span>
                            <span className="text-2xs text-text-muted">{best.bookmakerLabel}</span>
                            {best.betUrl && (
                              <a href={best.betUrl} target="_blank" rel="noopener noreferrer"
                                className="text-2xs text-blue-arb hover:underline">Bet →</a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-2xs text-text-muted text-center pt-1">
                    Checking every 60s — calculator will appear automatically if an arb opens up.
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center py-6 text-2xs text-text-muted">
              Select a game above to calculate stake splits
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function GameRow({ game, selected, onSelect }: { game: GameOddsEntry; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors ${
        selected ? 'bg-green-arb/10' : 'hover:bg-white/5'
      }`}
    >
      <span className="text-sm flex-shrink-0">{SPORT_ICON[game.sport] ?? '🎯'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary truncate">{game.eventName}</div>
        <div className="text-2xs text-text-muted">{game.league}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {game.isLive && (
          <span className="text-2xs font-bold text-yellow-arb">LIVE</span>
        )}
        {game.hasArb && (
          <span className="text-2xs font-bold text-green-arb">ARB +{game.arbRoi?.toFixed(1)}%</span>
        )}
        {selected && <span className="text-green-arb text-xs">✓</span>}
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalculatorPage() {
  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-sm font-bold text-text-primary">Calculator</h1>
        <p className="text-2xs text-text-muted mt-0.5">Manual odds entry or pick a live game to calculate your optimal stake splits.</p>
      </div>

      <ManualCalculator />
      <LiveGameCalculator />
    </div>
  );
}
