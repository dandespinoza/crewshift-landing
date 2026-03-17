'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Column<T> {
  /** Unique key for the column (must match a key on T for default rendering) */
  key: string;
  /** Header label text */
  header: string;
  /** Custom cell renderer */
  render?: (row: T) => React.ReactNode;
  /** Extra class names applied to both th and td */
  className?: string;
}

interface DataTableProps<T> {
  /** Column definitions */
  columns: Column<T>[];
  /** Row data */
  data: T[];
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Key on T used for client-side search filtering */
  searchKey?: string;
  /** Accessible label for the table (screen-reader caption) */
  tableLabel?: string;
}

/* ------------------------------------------------------------------ */
/*  DataTable                                                          */
/* ------------------------------------------------------------------ */

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  searchPlaceholder = 'Search...',
  searchKey,
  tableLabel = 'Data table',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');

  /* ---- Filtering ---- */
  const filteredData = searchKey
    ? data.filter((row) => {
        const cellValue = String(row[searchKey] ?? '').toLowerCase();
        return cellValue.includes(search.toLowerCase());
      })
    : data;

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={searchPlaceholder}
          className={cn(
            'h-10 w-full rounded-md border border-border bg-surface-bg0 pl-9 pr-3 text-sm text-text-primary',
            'placeholder:text-text-tertiary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2',
            'transition-colors duration-200',
          )}
        />
      </div>

      {/* Table container -- SIGNATURE MOVE: strong dividers */}
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm" aria-label={tableLabel}>
          {/* Header */}
          <thead>
            <tr className="border-b border-border bg-surface-bg1">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    {/* Illustration placeholder */}
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-bg2">
                      <Search className="h-5 w-5 text-text-tertiary" />
                    </div>
                    <p className="text-sm font-medium text-text-secondary">
                      No results found
                    </p>
                    <p className="text-xs text-text-tertiary">
                      Try adjusting your search to find what you&apos;re looking for.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredData.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-bg1"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3', col.className)}
                    >
                      {col.render
                        ? col.render(row)
                        : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { DataTable };
