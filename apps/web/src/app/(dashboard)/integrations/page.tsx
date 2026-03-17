'use client';

import { useState, useMemo } from 'react';
import { Search, Filter, SlidersHorizontal } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { INTEGRATIONS, CATEGORY_LABELS, TIER_LABELS } from '@/lib/integrations/registry';
import type { IntegrationCategory, IntegrationEntry, IntegrationTier } from '@/lib/integrations/types';

/* ------------------------------------------------------------------ */
/*  Integrations Marketplace                                            */
/* ------------------------------------------------------------------ */

const allCategories = Object.keys(CATEGORY_LABELS) as IntegrationCategory[];
const allTiers = [1, 2, 3, 4, 5, 6] as IntegrationTier[];

export default function IntegrationsPage() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<IntegrationCategory | 'all'>('all');
  const [selectedTier, setSelectedTier] = useState<IntegrationTier | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let results = INTEGRATIONS;

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.trades.some((t) => t.toLowerCase().includes(q)),
      );
    }

    if (selectedCategory !== 'all') {
      results = results.filter((i) => i.category === selectedCategory);
    }

    if (selectedTier !== 'all') {
      results = results.filter((i) => i.tier === selectedTier);
    }

    return results;
  }, [search, selectedCategory, selectedTier]);

  // Group by category for display
  const grouped = useMemo(() => {
    const map: Record<string, IntegrationEntry[]> = {};
    for (const integration of filtered) {
      if (!map[integration.category]) map[integration.category] = [];
      map[integration.category].push(integration);
    }
    return map;
  }, [filtered]);

  return (
    <>
      <Header
        title="Integrations"
        subtitle={`${INTEGRATIONS.length} tools for your trade business`}
      />

      <div className="p-6 space-y-6">
        {/* Search + Filters Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              placeholder="Search integrations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                'h-10 w-full rounded-md border border-border bg-surface-bg0 pl-10 pr-4 text-sm text-text-primary',
                'placeholder:text-text-tertiary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/50',
                'transition-all duration-200',
              )}
            />
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors',
              showFilters ? 'bg-surface-bg1 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {(selectedCategory !== 'all' || selectedTier !== 'all') && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-[10px] font-bold text-white">
                {(selectedCategory !== 'all' ? 1 : 0) + (selectedTier !== 'all' ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Expandable Filters */}
        {showFilters && (
          <div className="space-y-4 rounded-lg border border-border bg-surface-bg0 p-4">
            {/* Category filter */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    selectedCategory === 'all'
                      ? 'bg-accent-600 text-white'
                      : 'bg-surface-bg1 text-text-secondary hover:text-text-primary',
                  )}
                >
                  All
                </button>
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      selectedCategory === cat
                        ? 'bg-accent-600 text-white'
                        : 'bg-surface-bg1 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>

            {/* Tier filter */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Access Level
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedTier('all')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    selectedTier === 'all'
                      ? 'bg-accent-600 text-white'
                      : 'bg-surface-bg1 text-text-secondary hover:text-text-primary',
                  )}
                >
                  All Tiers
                </button>
                {allTiers.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => setSelectedTier(tier)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      selectedTier === tier
                        ? 'bg-accent-600 text-white'
                        : 'bg-surface-bg1 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    Tier {tier}: {TIER_LABELS[tier].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear filters */}
            {(selectedCategory !== 'all' || selectedTier !== 'all') && (
              <button
                onClick={() => {
                  setSelectedCategory('all');
                  setSelectedTier('all');
                }}
                className="text-xs font-medium text-accent-600 hover:text-accent-700"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-secondary">
            Showing <span className="font-semibold text-text-primary">{filtered.length}</span> of{' '}
            {INTEGRATIONS.length} integrations
          </p>
        </div>

        {/* Grouped results */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Filter className="h-10 w-10 text-text-tertiary" />
            <p className="mt-3 text-sm font-medium text-text-primary">No integrations found</p>
            <p className="mt-1 text-xs text-text-tertiary">
              Try adjusting your search or filters
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {CATEGORY_LABELS[category as IntegrationCategory]}
                  </h2>
                  <Badge size="sm">{items.length}</Badge>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((integration) => (
                    <IntegrationCard key={integration.slug} integration={integration} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
