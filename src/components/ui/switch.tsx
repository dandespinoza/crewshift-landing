import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, disabled, ...props }, ref) => {
    const handleClick = React.useCallback(() => {
      if (!disabled) {
        onCheckedChange?.(!checked);
      }
    }, [checked, disabled, onCheckedChange]);

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) {
            onCheckedChange?.(!checked);
          }
        }
      },
      [checked, disabled, onCheckedChange]
    );

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        ref={ref}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full',
          'transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-accent-600' : 'bg-border',
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-1',
            'transition-transform duration-200',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          )}
        />
      </button>
    );
  }
);

Switch.displayName = 'Switch';

export { Switch };
