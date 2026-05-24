import type { ConfidenceLevel, SportCategory, OddsFormat } from '@arbix/shared';
import { formatDistanceToNow } from 'date-fns';

export function formatROI(roi: number): string {
  return `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
}

export function formatOdds(decimal: number, format: OddsFormat = 'decimal'): string {
  switch (format) {
    case 'decimal':
      return decimal.toFixed(2);
    case 'american': {
      if (decimal >= 2.0) {
        const american = Math.round((decimal - 1) * 100);
        return `+${american}`;
      } else {
        const american = Math.round(-100 / (decimal - 1));
        return `${american}`;
      }
    }
    case 'fractional': {
      const numerator = Math.round((decimal - 1) * 100);
      const denominator = 100;
      const gcd = getGCD(numerator, denominator);
      return `${numerator / gcd}/${denominator / gcd}`;
    }
    case 'probability':
      return `${(100 / decimal).toFixed(1)}%`;
    default:
      return decimal.toFixed(2);
  }
}

function getGCD(a: number, b: number): number {
  return b === 0 ? a : getGCD(b, a % b);
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'text-green-arb';
    case 'medium':
      return 'text-yellow-arb';
    case 'low':
      return 'text-red-arb';
    default:
      return 'text-text-secondary';
  }
}

export function getConfidenceBgColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'bg-green-arb/10 text-green-arb border-green-arb/30';
    case 'medium':
      return 'bg-yellow-arb/10 text-yellow-arb border-yellow-arb/30';
    case 'low':
      return 'bg-red-arb/10 text-red-arb border-red-arb/30';
    default:
      return 'bg-border text-text-secondary border-border-bright';
  }
}

export function getROIColor(roi: number): string {
  if (roi >= 5) return 'text-green-arb';
  if (roi >= 2) return 'text-green-arb-dim';
  if (roi >= 1) return 'text-yellow-arb';
  return 'text-text-secondary';
}

export function getSportLabel(sport: SportCategory): string {
  const labels: Record<SportCategory, string> = {
    football: 'NFL',
    basketball: 'NBA',
    baseball: 'MLB',
    hockey: 'NHL',
    soccer: 'Soccer',
    tennis: 'Tennis',
    mma: 'MMA',
    boxing: 'Boxing',
    golf: 'Golf',
    politics: 'Politics',
    crypto: 'Crypto',
    other: 'Other',
  };
  return labels[sport] ?? sport.toUpperCase();
}

export function getBookmakerLabel(slug: string): string {
  const labels: Record<string, string> = {
    polymarket: 'Polymarket',
    draftkings: 'DraftKings',
    fanduel: 'FanDuel',
    pinnacle: 'Pinnacle',
    betmgm: 'BetMGM',
    caesars: 'Caesars',
    bet365: 'Bet365',
    bovada: 'Bovada',
    mybookie: 'MyBookie',
    betonline: 'BetOnline',
  };
  return labels[slug] ?? slug;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
