import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium text-sm rounded-md',
    'transition-all duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50 focus-visible:ring-offset-2',
    'disabled:opacity-50 disabled:pointer-events-none',
    'active:scale-[0.97]',
  ],
  {
    variants: {
      variant: {
        default: [
          'bg-accent-600 text-text-inverse',
          'hover:bg-accent-700',
          'active:bg-accent-800',
        ],
        secondary: [
          'border border-border bg-transparent text-text-primary',
          'hover:bg-surface-bg1',
          'active:bg-surface-bg2',
        ],
        outline: [
          'border border-border bg-transparent text-text-primary',
          'hover:bg-surface-bg1 hover:border-border',
          'active:bg-surface-bg2',
        ],
        ghost: [
          'bg-transparent text-text-primary',
          'hover:bg-surface-bg1',
          'active:bg-surface-bg2',
        ],
        destructive: [
          'bg-danger-solid text-text-inverse',
          'hover:bg-red-600',
          'active:bg-red-700',
        ],
        icon: [
          'bg-transparent text-text-secondary',
          'hover:bg-surface-bg1 hover:text-text-primary',
          'active:bg-surface-bg2',
        ],
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        default: 'h-11 px-4 text-sm',
        lg: 'h-[52px] px-6 text-base',
        icon: 'h-11 w-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
