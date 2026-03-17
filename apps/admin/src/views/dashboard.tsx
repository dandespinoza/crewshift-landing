'use client'

import React, { useCallback, useEffect, useState } from 'react'

interface SystemStats {
  totalOrgs: number
  totalExecutions: number
  integrationHealth: {
    healthy: number
    degraded: number
    down: number
  }
  systemStatus: 'operational' | 'degraded' | 'outage'
}

const defaultStats: SystemStats = {
  totalOrgs: 0,
  totalExecutions: 0,
  integrationHealth: { healthy: 0, degraded: 0, down: 0 },
  systemStatus: 'operational',
}

const statusColors: Record<string, string> = {
  operational: '#22c55e',
  degraded: '#f59e0b',
  outage: '#ef4444',
}

const statusLabels: Record<string, string> = {
  operational: 'All Systems Operational',
  degraded: 'Degraded Performance',
  outage: 'System Outage',
}

export default function Dashboard() {
  const [stats, setStats] = useState<SystemStats>(defaultStats)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
      const response = await fetch(`${apiUrl}/api/admin/stats`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`)
      }

      const data: SystemStats = await response.json()
      setStats(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard stats'
      setError(message)
      console.error('Dashboard stats fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()

    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30_000)
    return () => clearInterval(interval)
  }, [fetchStats])

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>System Dashboard</h1>
        <p style={styles.subtitle}>CrewShift platform overview for super admins</p>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={fetchStats} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {/* Total Organizations */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF751F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span style={styles.cardLabel}>Total Organizations</span>
          </div>
          <div style={styles.cardValue}>
            {loading ? (
              <span style={styles.skeleton} />
            ) : (
              stats.totalOrgs.toLocaleString()
            )}
          </div>
          <div style={styles.cardFooter}>Client organizations managed</div>
        </div>

        {/* Total Executions */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF751F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
              </svg>
            </span>
            <span style={styles.cardLabel}>Total Executions</span>
          </div>
          <div style={styles.cardValue}>
            {loading ? (
              <span style={styles.skeleton} />
            ) : (
              stats.totalExecutions.toLocaleString()
            )}
          </div>
          <div style={styles.cardFooter}>Agent executions across all orgs</div>
        </div>

        {/* Integration Health */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF751F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
            <span style={styles.cardLabel}>Integration Health</span>
          </div>
          <div style={styles.cardValue}>
            {loading ? (
              <span style={styles.skeleton} />
            ) : (
              <div style={styles.healthRow}>
                <span style={{ ...styles.healthBadge, backgroundColor: '#22c55e20', color: '#22c55e' }}>
                  {stats.integrationHealth.healthy} healthy
                </span>
                <span style={{ ...styles.healthBadge, backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
                  {stats.integrationHealth.degraded} degraded
                </span>
                <span style={{ ...styles.healthBadge, backgroundColor: '#ef444420', color: '#ef4444' }}>
                  {stats.integrationHealth.down} down
                </span>
              </div>
            )}
          </div>
          <div style={styles.cardFooter}>Third-party integration statuses</div>
        </div>

        {/* System Status */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF751F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            <span style={styles.cardLabel}>System Status</span>
          </div>
          <div style={styles.cardValue}>
            {loading ? (
              <span style={styles.skeleton} />
            ) : (
              <div style={styles.statusRow}>
                <span
                  style={{
                    ...styles.statusDot,
                    backgroundColor: statusColors[stats.systemStatus] ?? '#888',
                  }}
                />
                <span style={{ color: statusColors[stats.systemStatus] ?? '#888' }}>
                  {statusLabels[stats.systemStatus] ?? stats.systemStatus}
                </span>
              </div>
            )}
          </div>
          <div style={styles.cardFooter}>Current platform health</div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '32px',
    maxWidth: '1280px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '32px',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '20px',
  },
  card: {
    backgroundColor: '#141414',
    border: '1px solid #303030',
    borderRadius: '12px',
    padding: '24px',
    transition: 'border-color 0.2s ease',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  cardIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 117, 31, 0.1)',
  },
  cardLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#888888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  cardValue: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#FAFAFA',
    marginBottom: '8px',
    minHeight: '40px',
  },
  cardFooter: {
    fontSize: '12px',
    color: '#666666',
  },
  skeleton: {
    display: 'inline-block',
    width: '80px',
    height: '32px',
    backgroundColor: '#262626',
    borderRadius: '4px',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  healthRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    fontSize: '14px',
  },
  healthBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 600,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '18px',
    fontWeight: 600,
  },
  statusDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    display: 'inline-block',
  },
}
