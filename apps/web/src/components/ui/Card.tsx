import { HTMLAttributes } from 'react';
import clsx from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  neonBorder?: boolean;
  neonBorderColor?: 'green' | 'blue' | 'red';
  glow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const borderGlowClasses = {
  green: 'border-green-arb/30 shadow-neon-green',
  blue: 'border-blue-arb/30 shadow-neon-blue',
  red: 'border-red-arb/30 shadow-neon-red',
};

export default function Card({
  neonBorder = false,
  neonBorderColor = 'green',
  glow = false,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={clsx(
        'bg-card rounded border border-border',
        paddingClasses[padding],
        neonBorder && ['border', borderGlowClasses[neonBorderColor]],
        glow && 'shadow-card',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('flex items-center justify-between mb-4 pb-3 border-b border-border', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={clsx('text-sm font-bold text-text-primary uppercase tracking-wider', className)}
      {...props}
    >
      {children}
    </h3>
  );
}
