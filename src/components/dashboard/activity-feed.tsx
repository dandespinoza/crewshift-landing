'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type ActivityStatus = 'success' | 'warning' | 'completed' | 'pending';

interface Activity {
  time: string;
  agent: string;
  event: string;
  status: ActivityStatus;
}

interface ActivityFeedProps {
  activities: Activity[];
}

/**
 * Maps a status value to a Tailwind background class for the dot indicator.
 * Full class strings are written out so Tailwind's JIT includes them.
 */
const statusDotClass: Record<ActivityStatus, string> = {
  success:   'bg-success-solid',
  completed: 'bg-info-solid',
  warning:   'bg-warning-solid',
  pending:   'bg-text-tertiary',
};

function ActivityFeed({ activities }: ActivityFeedProps) {
  const visible = activities.slice(0, 5);

  return (
    <div>
      <ul>
        {visible.map((item, idx) => (
          <li
            key={idx}
            className={cn(
              'flex gap-3 py-3',
              idx < visible.length - 1 ? 'border-b border-border-subtle' : '',
            )}
          >
            {/* Status dot */}
            <div className="mt-1.5 flex-shrink-0">
              <span
                className={cn(
                  'block h-2 w-2 rounded-full',
                  statusDotClass[item.status],
                )}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">{item.event}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-xs font-medium text-accent-600">{item.agent}</span>
                <span className="text-xs text-text-tertiary">{item.time}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Footer link */}
      {activities.length > 0 && (
        <div className="mt-3">
          <Link
            href="#"
            className="flex items-center gap-1 text-xs font-medium text-accent-600 transition-colors hover:text-accent-700"
          >
            View full activity
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

export { ActivityFeed };
export type { Activity, ActivityStatus, ActivityFeedProps };
