'use client';

import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/lib/integrations/types';

const statusConfig: Record<ConnectionStatus, { label: string; dotClass: string; textClass: string }> = {
  connected: {
    label: 'Connected',
    dotClass: 'bg-green-500',
    textClass: 'text-green-700',
  },
  disconnected: {
    label: 'Not connected',
    dotClass: 'bg-surface-bg3',
    textClass: 'text-text-tertiary',
  },
  error: {
    label: 'Error',
    dotClass: 'bg-red-500',
    textClass: 'text-red-700',
  },
  pending: {
    label: 'Pending',
    dotClass: 'bg-yellow-500',
    textClass: 'text-yellow-700',
  },
};

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  className?: string;
}

export function ConnectionStatusIndicator({ status, className }: ConnectionStatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.textClass, className)}>
      <span className={cn('h-2 w-2 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  );
}
