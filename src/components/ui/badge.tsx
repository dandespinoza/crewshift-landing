import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center font-medium rounded-full',
  {
    variants: {
      variant: {
        default: 'bg-surface-bg2 text-text-secondary',
        success: 'bg-success-subtle-bg text-success-text',
        warning: 'bg-warning-subtle-bg text-warning-text',
        danger: 'bg-danger-subtle-bg text-danger-text',
        accent: 'bg-accent-50 text-accent-700',
        info: 'bg-info-subtle-bg text-info-text',
      },
      size: {
        default: 'h-6 px-2 text-xs',
        sm: 'h-5 px-1.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <span
        className={cn(badgeVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { Badge, badgeVariants };
