import type { ArbitrageOpportunity } from '@arbix/shared';
import { formatROI } from '@/lib/formatters';

interface Props {
  opportunities: ArbitrageOpportunity[];
}

export function LiveTicker({ opportunities }: Props) {
  if (opportunities.length === 0) return null;

  const items = [...opportunities, ...opportunities]; // duplicate for seamless loop

  return (
    <div className="border border-green-arb/20 bg-green-arb/5 rounded overflow-hidden">
      <div className="flex overflow-hidden">
        <div className="flex-shrink-0 flex items-center px-3 py-2 border-r border-green-arb/20 bg-green-arb/10">
          <span className="w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse-green mr-2" />
          <span className="text-green-arb text-2xs font-bold">LIVE</span>
        </div>
        <div className="overflow-hidden">
          <div className="flex animate-ticker whitespace-nowrap">
            {items.map((opp, i) => (
              <span key={`${opp.id}-${i}`} className="inline-flex items-center gap-3 px-6 text-2xs">
                <span className="text-text-secondary">{opp.eventName}</span>
                <span className="text-green-arb font-bold">{formatROI(opp.roi)}</span>
                <span className="text-text-muted">{opp.bookmakers.join(' + ')}</span>
                <span className="text-border">|</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
