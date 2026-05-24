import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftAddon, rightAddon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-text-secondary uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3 text-text-muted flex items-center">{leftAddon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'w-full bg-terminal border rounded font-mono text-sm text-text-primary placeholder-text-muted',
              'px-3 py-2.5 transition-all duration-150',
              'focus:outline-none focus:ring-1',
              error
                ? 'border-red-arb/50 focus:border-red-arb focus:ring-red-arb/30'
                : 'border-border-bright focus:border-green-arb/50 focus:ring-green-arb/20',
              leftAddon && 'pl-9',
              rightAddon && 'pr-9',
              className,
            )}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3 text-text-muted flex items-center">{rightAddon}</div>
          )}
        </div>
        {error && <p className="text-xs text-red-arb">{error}</p>}
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
export default Input;

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="text-xs font-medium text-text-secondary uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={clsx(
            'w-full bg-terminal border rounded font-mono text-sm text-text-primary placeholder-text-muted',
            'px-3 py-2.5 transition-all duration-150 resize-none',
            'focus:outline-none focus:ring-1',
            error
              ? 'border-red-arb/50 focus:border-red-arb focus:ring-red-arb/30'
              : 'border-border-bright focus:border-green-arb/50 focus:ring-green-arb/20',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-arb">{error}</p>}
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-text-secondary uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={clsx(
            'w-full bg-terminal border rounded font-mono text-sm text-text-primary',
            'px-3 py-2.5 transition-all duration-150 cursor-pointer',
            'focus:outline-none focus:ring-1',
            error
              ? 'border-red-arb/50 focus:border-red-arb focus:ring-red-arb/30'
              : 'border-border-bright focus:border-green-arb/50 focus:ring-green-arb/20',
            className,
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-arb">{error}</p>}
      </div>
    );
  },
);

Select.displayName = 'Select';
