'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
  fullWidth?: boolean;
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-green-arb text-terminal font-bold hover:bg-green-arb-dim active:bg-green-arb-muted shadow-neon-green hover:shadow-neon-green-lg',
  secondary: 'bg-panel border border-border-bright text-text-primary hover:border-green-arb/40 hover:text-green-arb',
  danger: 'bg-red-arb/10 border border-red-arb/30 text-red-arb hover:bg-red-arb/20 hover:shadow-neon-red',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-border',
  outline: 'bg-transparent border border-green-arb/30 text-green-arb hover:bg-green-arb/10 hover:border-green-arb/60',
};

const sizeClasses: Record<Size, string> = {
  xs: 'px-2 py-1 text-2xs',
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      fullWidth = false,
      htmlType = 'button',
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <motion.button
        ref={ref}
        type={htmlType}
        whileTap={{ scale: isDisabled ? 1 : 0.97 }}
        whileHover={{ scale: isDisabled ? 1 : 1.01 }}
        transition={{ duration: 0.1 }}
        disabled={isDisabled}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded font-mono transition-all duration-150 cursor-pointer select-none',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : leftIcon ? (
          <span className="flex-shrink-0">{leftIcon}</span>
        ) : null}
        {children}
        {!isLoading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
      </motion.button>
    );
  },
);

Button.displayName = 'Button';
export default Button;
