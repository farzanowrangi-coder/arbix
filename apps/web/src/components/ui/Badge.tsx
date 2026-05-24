import clsx from 'clsx';
import type { ConfidenceLevel, OpportunityStatus } from '@arbix/shared';

type BadgeVariant = 'confidence' | 'status' | 'sport' | 'bookmaker' | 'tier';

interface BadgeProps {
  variant?: BadgeVariant;
  confidence?: ConfidenceLevel;
  status?: OpportunityStatus;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}

function getConfidenceClasses(level: ConfidenceLevel) {
  switch (level) {
    case 'high':
      return 'bg-green-arb/10 text-green-arb border border-green-arb/30';
    case 'medium':
      return 'bg-yellow-arb/10 text-yellow-arb border border-yellow-arb/30';
    case 'low':
      return 'bg-red-arb/10 text-red-arb border border-red-arb/30';
  }
}

function getStatusClasses(status: OpportunityStatus) {
  switch (status) {
    case 'live':
      return 'bg-green-arb/10 text-green-arb border border-green-arb/30';
    case 'expired':
      return 'bg-border text-text-muted border border-border-bright';
    case 'completed':
      return 'bg-blue-arb/10 text-blue-arb border border-blue-arb/30';
    case 'suspicious':
      return 'bg-yellow-arb/10 text-yellow-arb border border-yellow-arb/30';
  }
}

export default function Badge({
  variant = 'sport',
  confidence,
  status,
  label,
  className,
  size = 'sm',
}: BadgeProps) {
  let classes = 'bg-border text-text-secondary border border-border-bright';

  if (variant === 'confidence' && confidence) {
    classes = getConfidenceClasses(confidence);
  } else if (variant === 'status' && status) {
    classes = getStatusClasses(status);
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded font-mono font-medium uppercase tracking-wider',
        size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-1 text-xs',
        classes,
        className,
      )}
    >
      {variant === 'status' && status === 'live' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-arb animate-pulse" />
      )}
      {label}
    </span>
  );
}

export function ConfidenceBadge({
  level,
  score,
  size = 'sm',
}: {
  level: ConfidenceLevel;
  score?: number;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge
      variant="confidence"
      confidence={level}
      label={score !== undefined ? `${level} ${score}%` : level}
      size={size}
    />
  );
}

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  return <Badge variant="status" status={status} label={status} />;
}
