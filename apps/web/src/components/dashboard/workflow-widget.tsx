import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowWidgetProps {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  children: React.ReactNode;
  className?: string;
}

function WorkflowWidget({
  title,
  actionLabel,
  actionHref,
  children,
  className,
}: WorkflowWidgetProps) {
  return (
    <div
      className={cn(
        'min-h-[280px] rounded-lg bg-surface-bg0 p-6 shadow-1',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>

        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="flex items-center gap-1 text-sm text-accent-500 transition-colors hover:text-accent-600"
          >
            {actionLabel}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Content */}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export { WorkflowWidget };
export type { WorkflowWidgetProps };
