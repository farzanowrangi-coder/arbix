import type { ScannerStatus as ScannerStatusType } from '@arbix/shared';

interface Props {
  status: ScannerStatusType;
}

export function ScannerStatus({ status }: Props) {
  return (
    <div className="border border-border bg-card rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${status.isRunning ? 'bg-green-arb animate-pulse-green' : 'bg-red-arb'}`} />
        <span className="text-2xs text-text-muted">{status.isRunning ? 'SCANNER ACTIVE' : 'SCANNER STOPPED'}</span>
      </div>

      <div className="h-3 w-px bg-border" />

      {status.bookmakers.map((bm) => (
        <div key={bm.slug} className="flex items-center gap-1.5">
          <span className={`w-1 h-1 rounded-full ${
            bm.status === 'ok' ? 'bg-green-arb' :
            bm.status === 'rate_limited' ? 'bg-yellow-arb animate-pulse' : 'bg-red-arb'
          }`} />
          <span className="text-2xs text-text-secondary capitalize">{bm.slug}</span>
          <span className="text-2xs text-text-muted">({bm.marketsCount})</span>
        </div>
      ))}

      <div className="ml-auto text-2xs text-text-muted">
        Last: {new Date(status.lastScanAt).toLocaleTimeString()}
      </div>
    </div>
  );
}
