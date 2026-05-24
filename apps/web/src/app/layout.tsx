import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArbiX — Real-Time Sports Arbitrage',
  description: 'Professional arbitrage betting scanner. Find guaranteed profit across Polymarket, DraftKings, FanDuel, Pinnacle and more.',
  keywords: 'arbitrage betting, sports arbitrage, Polymarket, guaranteed profit',
  openGraph: {
    title: 'ArbiX — Real-Time Sports Arbitrage',
    description: 'Find guaranteed profit across prediction markets and sportsbooks.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-terminal font-mono antialiased">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#161616',
              color: '#e8e8e8',
              border: '1px solid #2a2a2a',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '12px',
            },
            success: { iconTheme: { primary: '#00ff88', secondary: '#0a0a0a' } },
            error: { iconTheme: { primary: '#ff4444', secondary: '#0a0a0a' } },
          }}
        />
      </body>
    </html>
  );
}
