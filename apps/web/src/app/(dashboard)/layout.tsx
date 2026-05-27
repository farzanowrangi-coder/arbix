'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuthStore, useOpportunityStore } from '@/store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getAccessToken } from '@/lib/auth';
import { OddsFormatProvider } from '@/context/OddsFormatContext';

type Tier = 'free' | 'basic' | 'pro';

const NAV = [
  { href: '/dashboard',     label: 'Dashboard',     icon: '◈', tier: 'free'  as Tier },
  { href: '/opportunities', label: 'Opportunities', icon: '◉', tier: 'basic' as Tier },
  { href: '/games',         label: 'Best Odds',     icon: '⊕', tier: 'pro'   as Tier },
  { href: '/live',          label: 'Live Matches',  icon: '▶', tier: 'pro'   as Tier },
  { href: '/auto-bet',      label: 'Auto-Bettor',   icon: '◉', tier: 'pro'   as Tier },
  { href: '/calculator',    label: 'Calculator',    icon: '◆', tier: 'free'  as Tier },
  { href: '/history',       label: 'History',       icon: '◎', tier: 'free'  as Tier },
  { href: '/portfolio',     label: 'Portfolio',     icon: '◍', tier: 'free'  as Tier },
  { href: '/settings',      label: 'Settings',      icon: '◐', tier: 'free'  as Tier },
];

const TIER_RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2 };

function hasAccess(required: Tier, userTier: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required];
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const scannerStatus = useOpportunityStore((s) => s.scannerStatus);
  const liveCount = useOpportunityStore((s) => s.liveOpportunities.length);
  // Cast to any until store types propagate through TS cache
  const store = useOpportunityStore() as any;
  const liveMatchCount: number = store.liveMatches?.length ?? 0;
  const liveArbCount: number = store.liveArbitrageOpportunities?.length ?? 0;
  const { isConnected } = useWebSocket();

  useEffect(() => {
    const token = getAccessToken();
    if (!token && !user) {
      router.push('/login');
    }
  }, [user, router]);

  function handleLogout() {
    logout();
    router.push('/login');
  }

  return (
    <OddsFormatProvider>
    <div className="flex h-screen bg-terminal overflow-hidden">
      {/* ─── Sidebar ─────────────────────────────────────────────── */}
      <aside className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-panel">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-border">
          <div className="text-green-arb font-bold text-base glow-green-sm">ARBIX</div>
          <div className="text-text-muted text-2xs mt-0.5">Arbitrage Scanner</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2">
          {NAV.map((item) => {
            const userTier = (user?.subscriptionTier ?? 'free') as Tier;
            const accessible = hasAccess(item.tier, userTier);
            const active = accessible && (pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)));
            return (
              <Link
                key={item.href}
                href={accessible ? item.href : '/settings'}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs mb-1 transition-colors ${
                  active
                    ? 'bg-green-arb/10 text-green-arb border-l-2 border-green-arb'
                    : accessible
                    ? 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                    : 'text-text-muted/40 cursor-pointer'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {!accessible && (
                  <span className="ml-auto text-2xs border border-border/50 text-text-muted/50 px-1 py-0.5 rounded font-mono">
                    {item.tier.toUpperCase()}
                  </span>
                )}
                {accessible && item.label === 'Opportunities' && liveCount > 0 && (
                  <span className="ml-auto text-2xs bg-green-arb text-terminal px-1.5 py-0.5 rounded-full font-bold">
                    {liveCount}
                  </span>
                )}
                {accessible && item.label === 'Live Matches' && liveMatchCount > 0 && (
                  <span className={`ml-auto text-2xs px-1.5 py-0.5 rounded-full font-bold ${liveArbCount > 0 ? 'bg-yellow-arb text-terminal animate-pulse' : 'bg-red-500 text-white'}`}>
                    {liveMatchCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-border">
          <div className="text-text-secondary text-2xs mb-1">{user?.email ?? 'Loading...'}</div>
          <div className="flex items-center justify-between">
            <span className={`text-2xs px-2 py-0.5 rounded-full border ${
              user?.subscriptionTier === 'pro'
                ? 'border-green-arb/40 text-green-arb'
                : user?.subscriptionTier === 'basic'
                ? 'border-blue-arb/40 text-blue-arb'
                : 'border-border text-text-muted'
            }`}>
              {(user?.subscriptionTier ?? 'free').toUpperCase()}
            </span>
            <button
              onClick={handleLogout}
              className="text-2xs text-text-muted hover:text-red-arb transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Main ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-panel flex-shrink-0">
          <div className="flex items-center gap-4">
            {/* Scanner status */}
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  scannerStatus?.isRunning ? 'bg-green-arb animate-pulse-green' : 'bg-red-arb'
                }`}
              />
              <span className="text-2xs text-text-muted">
                {scannerStatus?.isRunning ? 'SCANNING' : 'OFFLINE'}
              </span>
            </div>

            {/* WS status */}
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-blue-arb' : 'bg-text-muted'}`} />
              <span className="text-2xs text-text-muted">{isConnected ? 'LIVE' : 'DISCONNECTED'}</span>
            </div>

            {/* Book statuses */}
            {scannerStatus?.bookmakers?.slice(0, 5).map((bm) => (
              <div key={bm.slug} className="flex items-center gap-1">
                <span
                  className={`w-1 h-1 rounded-full ${
                    bm.status === 'ok' ? 'bg-green-arb' : bm.status === 'rate_limited' ? 'bg-yellow-arb' : 'bg-red-arb'
                  }`}
                />
                <span className="text-2xs text-text-muted">{bm.slug}</span>
              </div>
            ))}
          </div>

          <div className="text-2xs text-text-muted">
            {scannerStatus?.lastScanAt
              ? `Last scan: ${new Date(scannerStatus.lastScanAt).toLocaleTimeString()}`
              : 'Waiting for scan...'}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {(() => {
              const userTier = (user?.subscriptionTier ?? 'free') as Tier;
              const currentNav = NAV.find((n) => pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(n.href)));
              if (currentNav && !hasAccess(currentNav.tier, userTier)) {
                return (
                  <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
                    <div className="text-4xl text-border">◧</div>
                    <div>
                      <div className="text-sm font-bold text-text-primary mb-1">{currentNav.label} requires {currentNav.tier === 'pro' ? 'Pro' : 'Basic'}</div>
                      <div className="text-2xs text-text-muted max-w-xs">
                        {currentNav.tier === 'pro'
                          ? 'Upgrade to Pro ($149/mo) to access Best Odds comparisons and the Auto-Bettor.'
                          : 'Upgrade to Basic to access this section.'}
                      </div>
                    </div>
                    <Link
                      href="/settings"
                      className="text-xs bg-green-arb text-terminal font-bold px-5 py-2 rounded hover:bg-green-arb/90 transition-colors shadow-neon-green"
                    >
                      View Plans
                    </Link>
                  </div>
                );
              }
              return children;
            })()}
          </motion.div>
        </main>
      </div>
    </div>
    </OddsFormatProvider>
  );
}
