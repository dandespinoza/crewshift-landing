import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const skeletonVariants = cva(
  'animate-pulse-subtle bg-surface-bg3',
  {
    variants: {
      shape: {
        text: 'h-3 w-full rounded',
        circle: 'rounded-full',
        card: 'h-full w-full rounded-md',
      },
    },
    defaultVariants: {
      shape: 'text',
    },
  }
);

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, shape, ...props }, ref) => {
    return (
      <div
        className={cn(skeletonVariants({ shape, className }))}
        ref={ref}
        aria-hidden="true"
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

export { Skeleton, skeletonVariants };
