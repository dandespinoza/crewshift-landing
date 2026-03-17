'use client'

import React, { useCallback, useEffect, useState } from 'react'

interface Organization {
  id: string
  name: string
  tradeType: string
  tier: 'starter' | 'professional' | 'enterprise'
  status: 'active' | 'inactive' | 'suspended'
  integrations: number
  createdAt: string
}

interface OrgsResponse {
  orgs: Organization[]
  total: number
  page: number
  pageSize: number
}

const tierColors: Record<string, { bg: string; text: string }> = {
  starter: { bg: '#1e3a5f', text: '#60a5fa' },
  professional: { bg: '#2e1f0a', text: '#f59e0b' },
  enterprise: { bg: '#1a0a2e', text: '#a78bfa' },
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: '#0a2e1a', text: '#22c55e' },
  inactive: { bg: '#1E1E1E', text: '#888888' },
  suspended: { bg: '#2e0a0a', text: '#ef4444' },
}

interface OrgsListProps {
  onSelectOrg?: (orgId: string) => void
}

export default function OrgsList({ onSelectOrg }: OrgsListProps) {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20

  const fetchOrgs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })

      if (search) {
        params.set('search', search)
      }
      if (tierFilter !== 'all') {
        params.set('tier', tierFilter)
      }

      const response = await fetch(`${apiUrl}/api/admin/orgs?${params.toString()}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch organizations: ${response.status}`)
      }

      const data: OrgsResponse = await response.json()
      setOrgs(data.orgs)
      setTotal(data.total)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load organizations'
      setError(message)
      console.error('Orgs fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [page, search, tierFilter])

  useEffect(() => {
    fetchOrgs()
  }, [fetchOrgs])

  useEffect(() => {
    setPage(1)
  }, [search, tierFilter])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Organizations</h1>
        <p style={styles.subtitle}>
          Manage all client organizations across the platform
        </p>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.searchWrapper}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#888"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={styles.searchIcon}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          style={styles.select}
        >
          <option value="all">All Tiers</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={fetchOrgs} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Trade Type</th>
              <th style={styles.th}>Tier</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Integrations</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={`skeleton-${i}-${j}`} style={styles.td}>
                      <span style={styles.skeleton} />
                    </td>
                  ))}
                </tr>
              ))
            ) : orgs.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.emptyState}>
                  No organizations found
                </td>
              </tr>
            ) : (
              orgs.map((org) => (
                <tr
                  key={org.id}
                  style={styles.row}
                  onClick={() => onSelectOrg?.(org.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onSelectOrg?.(org.id)
                    }
                  }}
                >
                  <td style={styles.td}>
                    <span style={styles.orgName}>{org.name}</span>
                  </td>
                  <td style={styles.td}>{org.tradeType}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: tierColors[org.tier]?.bg ?? '#1E1E1E',
                        color: tierColors[org.tier]?.text ?? '#888',
                      }}
                    >
                      {org.tier}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: statusColors[org.status]?.bg ?? '#1E1E1E',
                        color: statusColors[org.status]?.text ?? '#888',
                      }}
                    >
                      {org.status}
                    </span>
                  </td>
                  <td style={styles.td}>{org.integrations}</td>
                  <td style={styles.td}>
                    {new Date(org.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              ...styles.pageButton,
              opacity: page === 1 ? 0.4 : 1,
            }}
          >
            Previous
          </button>
          <span style={styles.pageInfo}>
            Page {page} of {totalPages} ({total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              ...styles.pageButton,
              opacity: page === totalPages ? 0.4 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '32px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#FAFAFA',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#888888',
    margin: 0,
  },
  filters: {
    display: 'flex',
    gap: '12px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  searchWrapper: {
    position: 'relative' as const,
    flex: '1 1 300px',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 40px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '8px',
    color: '#FAFAFA',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    padding: '10px 16px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '8px',
    color: '#FAFAFA',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '150px',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    marginBottom: '24px',
    backgroundColor: '#2e0a0a',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#ef4444',
    fontSize: '14px',
  },
  retryButton: {
    padding: '6px 16px',
    backgroundColor: '#ef4444',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  tableWrapper: {
    overflowX: 'auto' as const,
    borderRadius: '12px',
    border: '1px solid #303030',
    backgroundColor: '#141414',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '14px 16px',
    borderBottom: '1px solid #303030',
    color: '#888888',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid #1E1E1E',
    color: '#CCCCCC',
    whiteSpace: 'nowrap' as const,
  },
  row: {
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  orgName: {
    fontWeight: 600,
    color: '#FAFAFA',
  },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'capitalize' as const,
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 16px',
    color: '#666666',
    fontSize: '14px',
  },
  skeleton: {
    display: 'inline-block',
    width: '80px',
    height: '16px',
    backgroundColor: '#262626',
    borderRadius: '4px',
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginTop: '24px',
  },
  pageButton: {
    padding: '8px 20px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '6px',
    color: '#FAFAFA',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  pageInfo: {
    fontSize: '13px',
    color: '#888888',
  },
}
