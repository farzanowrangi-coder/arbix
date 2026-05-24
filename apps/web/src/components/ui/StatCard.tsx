interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
  highlight?: boolean;
}

export default function StatCard({ label, value, change, positive, highlight }: StatCardProps) {
  return (
    <div className={`border rounded-lg p-4 bg-card ${highlight ? 'border-green-arb/30' : 'border-border'}`}>
      <div className="text-2xs text-text-muted mb-2 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mb-1 ${highlight && positive ? 'text-green-arb glow-green-sm' : 'text-text-primary'}`}>
        {value}
      </div>
      {change && (
        <div className={`text-2xs ${positive ? 'text-green-arb-muted' : 'text-text-muted'}`}>{change}</div>
      )}
    </div>
  );
}
