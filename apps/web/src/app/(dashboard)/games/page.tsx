'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gamesApi, type GameOddsEntry, type GameOutcome } from '@/lib/api';
import ArbCalculator, { type ArbLeg } from '@/components/ui/ArbCalculator';
import { useOddsFormat } from '@/context/OddsFormatContext';
import { useOpportunityStore } from '@/store';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀',
  hockey: '🏒',
  baseball: '⚾',
  soccer: '⚽',
  football: '🏈',
  tennis: '🎾',
};

const BOOK_LABEL: Record<string, string> = {
  pinnacle:          'Pinnacle',
  espn_bet:          'ESPN Bet',
  draftkings:        'DraftKings',
  fanduel:           'FanDuel',
  betmgm:            'BetMGM',
  caesars:           'Caesars',
  bet365:            'Bet365',
  betrivers:         'BetRivers',
  pointsbet:         'PointsBet',
  polymarket:        'Polymarket',
  kalshi:            'Kalshi',
  bovada:            'Bovada',
  stake:             'Stake',
  betway:            'Betway',
  sportsinteraction: 'SportsInteraction',
  williamhill:       'William Hill',
  unibet:            'Unibet',
  bwin:              'Bwin',
  odds_api:          'Aggregated',
};

// All selectable books for the filter panel
const SELECTABLE_BOOKS: { slug: string; label: string; color: string }[] = [
  { slug: 'pinnacle',          label: 'Pinnacle',          color: 'text-blue-400'   },
  { slug: 'draftkings',        label: 'DraftKings',        color: 'text-indigo-400' },
  { slug: 'fanduel',           label: 'FanDuel',           color: 'text-teal-400'   },
  { slug: 'betmgm',            label: 'BetMGM',            color: 'text-yellow-400' },
  { slug: 'caesars',           label: 'Caesars',           color: 'text-amber-400'  },
  { slug: 'bet365',            label: 'Bet365',            color: 'text-lime-400'   },
  { slug: 'betrivers',         label: 'BetRivers',         color: 'text-violet-400' },
  { slug: 'pointsbet',         label: 'PointsBet',         color: 'text-pink-400'   },
  { slug: 'polymarket',        label: 'Polymarket',        color: 'text-purple-400' },
  { slug: 'kalshi',            label: 'Kalshi',            color: 'text-cyan-400'   },
  { slug: 'bovada',            label: 'Bovada',            color: 'text-orange-400' },
  { slug: 'stake',             label: 'Stake',             color: 'text-emerald-400'},
  { slug: 'betway',            label: 'Betway',            color: 'text-green-400'  },
  { slug: 'sportsinteraction', label: 'SportsInteraction', color: 'text-sky-400'    },
  { slug: 'unibet',            label: 'Unibet',            color: 'text-green-400'  },
];

const BOOK_COLOR: Record<string, string> = {
  pinnacle:          'text-blue-400',
  espn_bet:          'text-red-400',
  draftkings:        'text-indigo-400',
  fanduel:           'text-teal-400',
  betmgm:            'text-yellow-400',
  caesars:           'text-amber-400',
  bet365:            'text-lime-400',
  betrivers:         'text-violet-400',
  pointsbet:         'text-pink-400',
  polymarket:        'text-purple-400',
  kalshi:            'text-cyan-400',
  bovada:            'text-orange-400',
  stake:             'text-emerald-400',
  betway:            'text-green-400',
  sportsinteraction: 'text-sky-400',
  williamhill:       'text-sky-400',
  unibet:            'text-green-400',
  bwin:              'text-rose-400',
};

const BOOK_URL: Record<string, string> = {
  pinnacle:   'https://www.pinnacle.com',
  espn_bet:   'https://espnbet.com',
  draftkings: 'https://sportsbook.draftkings.com',
  fanduel:    'https://sportsbook.fanduel.com',
  betmgm:     'https://sports.betmgm.com',
  kalshi:     'https://kalshi.com',
};

const ALL_SPORTS = ['All', 'NBA', 'NHL', 'MLB', 'Soccer', 'Tennis'];

// ─── Book-filter helper ───────────────────────────────────────────────────────

function filterGameByBooks(game: GameOddsEntry, selectedBooks: Set<string>): GameOddsEntry | null {
  const filteredOutcomes: GameOutcome[] = [];

  for (const outcome of game.outcomes) {
    const filteredBooks = outcome.books.filter((b) => selectedBooks.has(b.bookmaker));
    if (filteredBooks.length === 0) continue;
    const best = filteredBooks.reduce((a, b) => b.decimalOdds > a.decimalOdds ? b : a);
    filteredOutcomes.push({
      ...outcome,
      books: filteredBooks.map((b) => ({
        ...b,
        isBest: b.bookmaker === best.bookmaker && b.decimalOdds === best.decimalOdds,
      })),
      bestBook: best.bookmaker,
      bestBookLabel: best.bookmakerLabel,
      bestDecimalOdds: best.decimalOdds,
      bestAmericanOdds: best.americanOdds,
    });
  }

  if (filteredOutcomes.length < 2) return null;

  const uniqueBooks = new Set(filteredOutcomes.flatMap((o) => o.books.map((b) => b.bookmaker)));
  const totalImplied = filteredOutcomes.reduce((s, o) => s + 1 / o.bestDecimalOdds, 0);
  const hasArb = uniqueBooks.size >= 2 && totalImplied < 1.0;
  const arbRoi = hasArb ? Math.round(((1 - totalImplied) / totalImplied) * 10000) / 100 : null;

  return {
    ...game,
    outcomes: filteredOutcomes,
    hasArb,
    arbRoi,
    totalImplied: Math.round(totalImplied * 10000) / 10000,
  };
}

function formatAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function impliedProb(decimal: number): string {
  return `${((1 / decimal) * 100).toFixed(1)}%`;
}

// ─── Odds comparison row ──────────────────────────────────────────────────────

function OutcomeRow({ outcome, allBooks }: { outcome: GameOutcome; allBooks: string[] }) {
  const { displayOdds } = useOddsFormat();
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `160px repeat(${allBooks.length}, 1fr) 80px` }}>
      {/* Outcome name */}
      <div className="text-xs font-medium text-text-primary truncate flex items-center">{outcome.name}</div>

      {/* Per-book odds */}
      {allBooks.map((book) => {
        const entry = outcome.books.find((b) => b.bookmaker === book);
        if (!entry) {
          return (
            <div key={book} className="text-center text-2xs text-text-muted py-1">—</div>
          );
        }
        const url = entry.betUrl ?? BOOK_URL[book];
        return (
          <div key={book} className={`text-center py-1 rounded ${entry.isBest ? 'bg-green-arb/15 ring-1 ring-green-arb/40' : ''}`}>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs font-bold tabular-nums ${entry.isBest ? 'text-green-arb glow-green-sm' : 'text-text-secondary hover:text-text-primary'} transition-colors`}
              >
                {displayOdds(entry.decimalOdds, entry.americanOdds)}
              </a>
            ) : (
              <span className={`text-xs font-bold tabular-nums ${entry.isBest ? 'text-green-arb glow-green-sm' : 'text-text-secondary'}`}>
                {displayOdds(entry.decimalOdds, entry.americanOdds)}
              </span>
            )}
            <div className="text-2xs text-text-muted">{impliedProb(entry.decimalOdds)}</div>
          </div>
        );
      })}

      {/* Best column */}
      <div className="text-center py-1">
        <div className={`text-xs font-bold tabular-nums text-green-arb`}>
          {displayOdds(outcome.bestDecimalOdds, outcome.bestAmericanOdds)}
        </div>
        <div className={`text-2xs ${BOOK_COLOR[outcome.bestBook] ?? 'text-text-muted'}`}>
          {BOOK_LABEL[outcome.bestBook] ?? outcome.bestBook}
        </div>
      </div>
    </div>
  );
}

// ─── Game card ────────────────────────────────────────────────────────────────

function GameCard({ game }: { game: GameOddsEntry }) {
  const allBooks = Array.from(
    new Set(game.outcomes.flatMap((o) => o.books.map((b) => b.bookmaker))),
  );

  const isArb = game.hasArb && game.arbRoi !== null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-lg overflow-hidden ${
        isArb
          ? 'border-green-arb/50 bg-green-arb/5'
          : game.isLive
          ? 'border-yellow-arb/40 bg-yellow-arb/5'
          : 'border-border bg-panel'
      }`}
    >
      {/* Card header */}
      <div className="px-4 py-3 flex items-center gap-3 justify-between border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{SPORT_ICON[game.sport] ?? '🎯'}</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary truncate">{game.eventName}</div>
            <div className="text-2xs text-text-muted">{game.league}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Score (live) */}
          {game.isLive && game.homeScore !== null && (
            <div className="text-sm font-bold tabular-nums text-text-primary">
              {game.awayScore} – {game.homeScore}
            </div>
          )}

          {/* Status badge */}
          {game.isLive ? (
            <span className="flex items-center gap-1 text-2xs font-bold text-yellow-arb">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {game.statusDetail || 'LIVE'}
            </span>
          ) : game.isCompleted ? (
            <span className="text-2xs text-text-muted">FINAL</span>
          ) : game.startTime ? (
            <span className="text-2xs text-text-muted">
              {new Date(game.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}

          {/* Arb badge */}
          {isArb && (
            <span className="text-2xs font-bold bg-green-arb text-terminal px-2 py-0.5 rounded-full glow-green-sm animate-pulse">
              ARB +{game.arbRoi!.toFixed(2)}%
            </span>
          )}

          {/* Market efficiency */}
          {game.totalImplied !== null && (
            <span className={`text-2xs tabular-nums ${game.totalImplied < 1 ? 'text-green-arb' : 'text-text-muted'}`}>
              Σ {(game.totalImplied * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Odds comparison table */}
      <div className="px-4 py-3 space-y-1">
        {/* Column headers */}
        <div
          className="grid gap-2 mb-2"
          style={{ gridTemplateColumns: `160px repeat(${allBooks.length}, 1fr) 80px` }}
        >
          <div className="text-2xs text-text-muted uppercase tracking-wider">Outcome</div>
          {allBooks.map((book) => (
            <div key={book} className={`text-center text-2xs font-medium uppercase tracking-wider ${BOOK_COLOR[book] ?? 'text-text-muted'}`}>
              {BOOK_LABEL[book] ?? book}
            </div>
          ))}
          <div className="text-center text-2xs text-green-arb uppercase tracking-wider">Best</div>
        </div>

        {game.outcomes.map((outcome) => (
          <OutcomeRow key={outcome.name} outcome={outcome} allBooks={allBooks} />
        ))}

        {/* Arb calculator */}
        {isArb && (
          <ArbCalculator
            legs={game.outcomes.map((o): ArbLeg => {
              const best = o.books.find((b) => b.isBest)!;
              return {
                outcomeName: o.name,
                bookmakerLabel: best.bookmakerLabel,
                decimalOdds: best.decimalOdds,
                americanOdds: best.americanOdds,
                betUrl: best.betUrl,
              };
            })}
          />
        )}
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GamesPage() {
  const wsGamesData = useOpportunityStore((s) => s.gamesData);
  const wsGamesUpdatedAt = useOpportunityStore((s) => s.gamesUpdatedAt);
  const [games, setGames] = useState<GameOddsEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [sport, setSport] = useState('All');
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(
    new Set(SELECTABLE_BOOKS.map((b) => b.slug)),
  );
  const [showBookFilter, setShowBookFilter] = useState(false);
  const notifPermRef = useRef(false);
  const prevArbIdsRef = useRef<Set<string>>(new Set());

  // Primary: consume WS-pushed games data the moment it arrives
  useEffect(() => {
    if (!wsGamesData || wsGamesData.length === 0) return;
    const incoming = wsGamesData as GameOddsEntry[];
    // Browser notifications for new arbs
    for (const g of incoming) {
      if (g.hasArb && !prevArbIdsRef.current.has(g.id) && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('⚡ Arbitrage Found!', {
          body: `${g.eventName} — ${g.arbRoi?.toFixed(2)}% ROI (${g.isLive ? 'LIVE' : 'Pre-game'})`,
          icon: '/favicon.ico',
          tag: g.id,
        });
      }
    }
    prevArbIdsRef.current = new Set(incoming.filter((g) => g.hasArb).map((g) => g.id));
    setGames(incoming);
    setLastUpdated(wsGamesUpdatedAt ?? new Date());
    setIsLoading(false);
  }, [wsGamesData, wsGamesUpdatedAt]);

  // Tick seconds-ago counter every second
  useEffect(() => {
    const t = setInterval(() => {
      setSecondsAgo(lastUpdated ? Math.round((Date.now() - lastUpdated.getTime()) / 1000) : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  // Request browser notification permission once
  useEffect(() => {
    if (notifPermRef.current) return;
    notifPermRef.current = true;
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Fallback: HTTP poll (fires if WS is down or data not yet pushed)
  const fetchGames = useCallback(async () => {
    try {
      const res = await gamesApi.getUpcoming();
      if (res.success && res.data) {
        // Only apply if WS hasn't given us fresher data
        setGames((prev) => {
          if (wsGamesUpdatedAt && lastUpdated && wsGamesUpdatedAt >= lastUpdated) return prev;
          for (const g of res.data!) {
            if (g.hasArb && !prevArbIdsRef.current.has(g.id) && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification('⚡ Arbitrage Found!', {
                body: `${g.eventName} — ${g.arbRoi?.toFixed(2)}% ROI (${g.isLive ? 'LIVE' : 'Pre-game'})`,
                icon: '/favicon.ico',
                tag: g.id,
              });
            }
          }
          prevArbIdsRef.current = new Set(res.data!.filter((g) => g.hasArb).map((g) => g.id));
          return res.data!;
        });
        setLastUpdated((prev) => {
          if (wsGamesUpdatedAt && wsGamesUpdatedAt > (prev ?? new Date(0))) return prev;
          return new Date();
        });
      }
    } catch { /* ignore */ } finally {
      setIsLoading(false);
    }
  }, [wsGamesUpdatedAt, lastUpdated]);

  useEffect(() => {
    fetchGames(); // initial load
    const t = setInterval(fetchGames, 15_000); // fallback poll
    return () => clearInterval(t);
  }, [fetchGames]);

  const toggleBook = (slug: string) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) { next.delete(slug); } else { next.add(slug); }
      return next;
    });
  };

  const sportFilter = (g: GameOddsEntry): boolean => {
    if (sport === 'All') return true;
    if (sport === 'NBA') return g.league === 'NBA';
    if (sport === 'NHL') return g.league === 'NHL';
    if (sport === 'MLB') return g.league === 'MLB';
    if (sport === 'Soccer') return ['EPL', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'World Cup'].includes(g.league);
    if (sport === 'Tennis') return g.sport === 'tennis' && /french.open/i.test(g.league);
    return true;
  };

  const filtered = games
    .filter(sportFilter)
    .map((g) => filterGameByBooks(g, selectedBooks))
    .filter((g): g is GameOddsEntry => g !== null);

  const liveGames = filtered.filter((g) => g.isLive && !g.isCompleted);
  const upcomingGames = filtered.filter((g) => !g.isLive && !g.isCompleted);
  const recentGames = filtered.filter((g) => g.isCompleted);
  const arbGames = filtered.filter((g) => g.hasArb);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-sm font-bold text-text-primary">Best Odds</h1>
          <p className="text-2xs text-text-muted mt-0.5">
            Moneyline comparison across Pinnacle &amp; ESPN Bet · updates every 15s
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className={`text-2xs ${secondsAgo <= 5 ? 'text-green-arb' : secondsAgo <= 15 ? 'text-text-muted' : 'text-yellow-arb'}`}>
              {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}
            </span>
          )}
          <button
            onClick={fetchGames}
            className="text-2xs px-3 py-1.5 rounded border border-border text-text-secondary hover:text-text-primary hover:border-green-arb/40 transition-all"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Sport filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {ALL_SPORTS.map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`text-2xs px-3 py-1 rounded-full border transition-all ${
              sport === s
                ? 'border-green-arb text-green-arb bg-green-arb/10'
                : 'border-border text-text-muted hover:text-text-primary hover:border-border/80'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Book selector */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowBookFilter((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-panel hover:bg-panel/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold text-text-primary uppercase tracking-widest">Sportsbooks</span>
            <span className="text-2xs text-text-muted">
              ({selectedBooks.size} of {SELECTABLE_BOOKS.length} selected)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedBooks(new Set(SELECTABLE_BOOKS.map((b) => b.slug))); }}
              className="text-2xs text-text-muted hover:text-green-arb transition-colors"
            >
              All
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedBooks(new Set()); }}
              className="text-2xs text-text-muted hover:text-red-400 transition-colors"
            >
              None
            </button>
            <svg
              className={`w-3.5 h-3.5 text-text-muted transition-transform ${showBookFilter ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        <AnimatePresence>
          {showBookFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2">
                {SELECTABLE_BOOKS.map((book) => {
                  const active = selectedBooks.has(book.slug);
                  return (
                    <button
                      key={book.slug}
                      onClick={() => toggleBook(book.slug)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-2xs font-medium transition-all ${
                        active
                          ? `border-current ${book.color} bg-current/10`
                          : 'border-border text-text-muted hover:border-border/80'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-sm border flex-shrink-0 transition-colors ${
                        active ? `bg-current border-transparent ${book.color}` : 'border-border'
                      }`} />
                      <span className={active ? book.color : ''}>{book.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Arb alert bar */}
      <AnimatePresence>
        {arbGames.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 border border-green-arb/40 bg-green-arb/10 rounded-lg px-4 py-3"
          >
            <span className="text-green-arb text-lg glow-green-sm animate-pulse">◈</span>
            <div>
              <div className="text-xs font-bold text-green-arb">
                {arbGames.length} Arbitrage {arbGames.length === 1 ? 'Opportunity' : 'Opportunities'} Available
              </div>
              <div className="text-2xs text-text-muted">
                Best odds across books don't add up to 100% — guaranteed profit available
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="py-16 text-center text-text-muted text-xs animate-pulse">
          Fetching odds from Pinnacle &amp; ESPN Bet...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-text-muted text-2xl mb-3">◎</div>
          <div className="text-text-muted text-xs">No games with odds found for this filter.</div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* LIVE */}
          {liveGames.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-2xs font-bold uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-yellow-arb">Live Now ({liveGames.length})</span>
              </h2>
              <div className="space-y-3">
                {liveGames.map((g) => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}

          {/* UPCOMING */}
          {upcomingGames.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-2xs font-bold text-text-muted uppercase tracking-widest">
                Upcoming ({upcomingGames.length})
              </h2>
              <div className="space-y-3">
                {upcomingGames.map((g) => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}

          {/* RECENT */}
          {recentGames.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-2xs font-bold text-text-muted uppercase tracking-widest">
                Recent ({recentGames.length})
              </h2>
              <div className="space-y-3">
                {recentGames.map((g) => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
