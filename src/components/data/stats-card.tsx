'use client';

import { ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  label: string;
  value: string;
  trend?: {
    value: number;
    direction: 'up' | 'down';
    label?: string;
  };
  icon?: LucideIcon;
  subDetail?: string;
  index?: number;
}

function StatsCard({ label, value, trend, icon: Icon, subDetail, index = 0 }: StatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        ease: 'easeOut',
        delay: index * 0.08,
      }}
      className="min-h-[120px] rounded-lg bg-surface-bg0 p-6 shadow-1"
    >
      <div className="flex items-start justify-between">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-50">
            <Icon className="h-5 w-5 text-accent-500" />
          </div>
        )}

        {trend && (
          <div
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5',
              trend.direction === 'up' ? 'bg-success-subtle-bg' : 'bg-danger-subtle-bg',
            )}
          >
            {trend.direction === 'up' ? (
              <ArrowUp className="h-3 w-3 text-success-text" />
            ) : (
              <ArrowDown className="h-3 w-3 text-danger-text" />
            )}
            <span
              className={cn(
                'text-xs font-medium',
                trend.direction === 'up' ? 'text-success-text' : 'text-danger-text',
              )}
            >
              {trend.value}%
            </span>
          </div>
        )}
      </div>

      <div className="mt-3">
        <p className="animate-count-up text-4xl font-bold text-text-primary">{value}</p>
        <p className="mt-1 text-sm text-text-tertiary">{label}</p>
      </div>

      {subDetail && (
        <p className="mt-2 text-xs text-text-tertiary">{subDetail}</p>
      )}
    </motion.div>
  );
}

export { StatsCard };
export type { StatsCardProps };
