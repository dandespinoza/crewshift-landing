'use client';

import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

interface PipelineStage {
  name: string;
  count: number;
  color: string;
}

interface PipelineStagesProps {
  stages: PipelineStage[];
}

/**
 * Maps a semantic color string to Tailwind bg / text utility classes.
 * The `color` prop should be one of the keys below (e.g. "accent", "success",
 * "warning", "info", "danger") so that Tailwind's JIT can detect the full
 * class names at build time.
 */
const colorMap: Record<
  string,
  { bg: string; text: string; dot: string }
> = {
  accent:  { bg: 'bg-accent-100',         text: 'text-accent-700',   dot: 'bg-accent-500'   },
  success: { bg: 'bg-success-subtle-bg',  text: 'text-success-text', dot: 'bg-success-solid' },
  warning: { bg: 'bg-warning-subtle-bg',  text: 'text-warning-text', dot: 'bg-warning-solid' },
  info:    { bg: 'bg-info-subtle-bg',     text: 'text-info-text',    dot: 'bg-info-solid'    },
  danger:  { bg: 'bg-danger-subtle-bg',   text: 'text-danger-text',  dot: 'bg-danger-solid'  },
  default: { bg: 'bg-surface-bg2',        text: 'text-text-secondary', dot: 'bg-text-tertiary' },
};

function PipelineStages({ stages }: PipelineStagesProps) {
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto">
      {stages.map((stage, idx) => {
        const colors = colorMap[stage.color] ?? colorMap.default;
        const isLast = idx === stages.length - 1;

        return (
          <div key={stage.name} className="flex items-center">
            {/* Stage box */}
            <div
              className={cn(
                'flex min-w-[100px] flex-col items-center justify-center gap-1 rounded-sm px-4 py-3',
                colors.bg,
              )}
            >
              <span className={cn('text-xs font-medium uppercase tracking-wide', colors.text)}>
                {stage.name}
              </span>
              <span className={cn('text-lg font-bold', colors.text)}>{stage.count}</span>
            </div>

            {/* Chevron separator */}
            {!isLast && (
              <ChevronRight className="mx-0.5 h-4 w-4 flex-shrink-0 text-text-tertiary/50" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export { PipelineStages };
export type { PipelineStage, PipelineStagesProps };
