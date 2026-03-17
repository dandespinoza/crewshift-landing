'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Bot, ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AISuggestion {
  suggestion: string;
  type: string;
  action: string;
}

interface AISuggestionsProps {
  suggestions: AISuggestion[];
}

function AISuggestions({ suggestions }: AISuggestionsProps) {
  const visible = suggestions.slice(0, 3);
  const [actedOn, setActedOn] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState<number | null>(null);

  const handleAction = async (idx: number, item: AISuggestion) => {
    if (actedOn.has(idx)) return;
    setLoading(idx);

    // Simulate AI performing the action
    await new Promise((r) => setTimeout(r, 1200));

    setLoading(null);
    setActedOn((prev) => new Set(prev).add(idx));
    toast.success(`${item.type}: ${item.action}`, {
      description: 'Action completed successfully by AI agent.',
    });
  };

  return (
    <div
      className={cn(
        'rounded-lg bg-accent-50 p-6 shadow-1',
        'border-l-[4px] border-accent-500',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent-500" />
        <h2 className="text-lg font-semibold text-text-primary">AI Suggestions</h2>
      </div>

      {/* Suggestions list */}
      <ul className="mt-4 space-y-3">
        {visible.map((item, idx) => (
          <li
            key={idx}
            className="flex gap-3 border-b border-accent-200/40 pb-3 last:border-0 last:pb-0"
          >
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-100">
              <Bot className="h-3.5 w-3.5 text-accent-600" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-secondary">{item.suggestion}</p>
              <button
                onClick={() => handleAction(idx, item)}
                disabled={actedOn.has(idx) || loading === idx}
                className={cn(
                  'mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium transition-colors',
                  actedOn.has(idx)
                    ? 'text-success-text cursor-default'
                    : 'text-accent-600 hover:text-accent-700',
                )}
              >
                {loading === idx ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Processing...</>
                ) : actedOn.has(idx) ? (
                  <><Check className="h-3 w-3" /> Done</>
                ) : (
                  item.action
                )}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Footer link */}
      {suggestions.length > 0 && (
        <div className="mt-4">
          <Link
            href="/copilot"
            className="flex items-center gap-1 text-xs font-medium text-accent-600 transition-colors hover:text-accent-700"
          >
            View all suggestions
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

export { AISuggestions };
export type { AISuggestion, AISuggestionsProps };
