'use client'

import React, { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = 'overview' | 'integrations' | 'team' | 'agents'

interface OrgOverview {
  id: string
  name: string
  tradeType: string
  tier: string
  status: string
  createdAt: string
  stats: {
    totalExecutions: number
    activeAgents: number
    teamMembers: number
    integrationsConnected: number
  }
}

interface Integration {
  id: string
  name: string
  provider: string
  status: 'connected' | 'disconnected' | 'error'
  lastSyncAt: string | null
}

interface TeamMember {
  id: string
  email: string
  name: string
  role: string
  joinedAt: string
}

interface Agent {
  id: string
  name: string
  type: string
  status: 'active' | 'paused' | 'draft'
  lastRunAt: string | null
  totalRuns: number
}

interface OrgDetailData {
  overview: OrgOverview
  integrations: Integration[]
  team: TeamMember[]
  agents: Agent[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrgDetailProps {
  orgId: string
  onBack?: () => void
}

export default function OrgDetail({ orgId, onBack }: OrgDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [data, setData] = useState<OrgDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)

  const fetchOrgData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
      const response = await fetch(`${apiUrl}/api/admin/orgs/${orgId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch org: ${response.status}`)
      }

      const result: OrgDetailData = await response.json()
      setData(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load organization details'
      setError(message)
      console.error('Org detail fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchOrgData()
  }, [fetchOrgData])

  // ---------------------------------------------------------------------------
  // Integration actions
  // ---------------------------------------------------------------------------

  const toggleIntegration = async (integrationId: string, action: 'connect' | 'disconnect') => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
      const response = await fetch(
        `${apiUrl}/api/admin/orgs/${orgId}/integrations/${integrationId}/${action}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to ${action} integration`)
      }

      // Refresh data
      fetchOrgData()
    } catch (err) {
      console.error(`Integration ${action} error:`, err)
    }
  }

  // ---------------------------------------------------------------------------
  // Invite team member
  // ---------------------------------------------------------------------------

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return

    try {
      setInviting(true)
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
      const response = await fetch(`${apiUrl}/api/admin/orgs/${orgId}/team/invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })

      if (!response.ok) {
        throw new Error('Failed to send invite')
      }

      setInviteEmail('')
      setInviteRole('member')
      fetchOrgData()
    } catch (err) {
      console.error('Invite error:', err)
    } finally {
      setInviting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'team', label: 'Team' },
    { key: 'agents', label: 'Agents' },
  ]

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderOverview = () => {
    if (!data) return null
    const { overview } = data

    return (
      <div style={styles.tabContent}>
        {/* Org info */}
        <div style={styles.infoGrid}>
          <div style={styles.infoCard}>
            <div style={styles.infoLabel}>Organization Name</div>
            <div style={styles.infoValue}>{overview.name}</div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoLabel}>Trade Type</div>
            <div style={styles.infoValue}>{overview.tradeType}</div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoLabel}>Tier</div>
            <div style={styles.infoValue} className="capitalize">
              {overview.tier}
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoLabel}>Status</div>
            <div style={styles.infoValue} className="capitalize">
              {overview.status}
            </div>
          </div>
          <div style={styles.infoCard}>
            <div style={styles.infoLabel}>Created</div>
            <div style={styles.infoValue}>
              {new Date(overview.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <h3 style={styles.sectionTitle}>Statistics</h3>
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{overview.stats.totalExecutions.toLocaleString()}</div>
            <div style={styles.statLabel}>Total Executions</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{overview.stats.activeAgents}</div>
            <div style={styles.statLabel}>Active Agents</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{overview.stats.teamMembers}</div>
            <div style={styles.statLabel}>Team Members</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{overview.stats.integrationsConnected}</div>
            <div style={styles.statLabel}>Integrations</div>
          </div>
        </div>
      </div>
    )
  }

  const renderIntegrations = () => {
    if (!data) return null

    return (
      <div style={styles.tabContent}>
        <h3 style={styles.sectionTitle}>Connected Integrations</h3>
        {data.integrations.length === 0 ? (
          <div style={styles.emptyState}>No integrations configured</div>
        ) : (
          <div style={styles.integrationList}>
            {data.integrations.map((integration) => (
              <div key={integration.id} style={styles.integrationCard}>
                <div style={styles.integrationInfo}>
                  <div style={styles.integrationName}>{integration.name}</div>
                  <div style={styles.integrationProvider}>{integration.provider}</div>
                  {integration.lastSyncAt && (
                    <div style={styles.integrationSync}>
                      Last sync:{' '}
                      {new Date(integration.lastSyncAt).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  )}
                </div>
                <div style={styles.integrationActions}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      backgroundColor:
                        integration.status === 'connected'
                          ? '#0a2e1a'
                          : integration.status === 'error'
                            ? '#2e0a0a'
                            : '#1E1E1E',
                      color:
                        integration.status === 'connected'
                          ? '#22c55e'
                          : integration.status === 'error'
                            ? '#ef4444'
                            : '#888',
                    }}
                  >
                    {integration.status}
                  </span>
                  <button
                    style={
                      integration.status === 'connected'
                        ? styles.disconnectButton
                        : styles.connectButton
                    }
                    onClick={() =>
                      toggleIntegration(
                        integration.id,
                        integration.status === 'connected' ? 'disconnect' : 'connect',
                      )
                    }
                  >
                    {integration.status === 'connected' ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderTeam = () => {
    if (!data) return null

    return (
      <div style={styles.tabContent}>
        <h3 style={styles.sectionTitle}>Team Members</h3>

        {/* Invite form */}
        <form onSubmit={handleInvite} style={styles.inviteForm}>
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            style={styles.inviteInput}
            required
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            style={styles.inviteSelect}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <button type="submit" disabled={inviting} style={styles.inviteButton}>
            {inviting ? 'Sending...' : 'Send Invite'}
          </button>
        </form>

        {/* Members table */}
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.team.length === 0 ? (
                <tr>
                  <td colSpan={4} style={styles.emptyTableState}>
                    No team members
                  </td>
                </tr>
              ) : (
                data.team.map((member) => (
                  <tr key={member.id}>
                    <td style={styles.td}>{member.name}</td>
                    <td style={styles.td}>{member.email}</td>
                    <td style={styles.td}>
                      <span style={styles.roleBadge}>{member.role}</span>
                    </td>
                    <td style={styles.td}>
                      {new Date(member.joinedAt).toLocaleDateString('en-US', {
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
      </div>
    )
  }

  const renderAgents = () => {
    if (!data) return null

    const agentStatusColors: Record<string, { bg: string; text: string }> = {
      active: { bg: '#0a2e1a', text: '#22c55e' },
      paused: { bg: '#2e1f0a', text: '#f59e0b' },
      draft: { bg: '#1E1E1E', text: '#888888' },
    }

    return (
      <div style={styles.tabContent}>
        <h3 style={styles.sectionTitle}>Agent Configurations</h3>
        {data.agents.length === 0 ? (
          <div style={styles.emptyState}>No agents configured</div>
        ) : (
          <div style={styles.agentGrid}>
            {data.agents.map((agent) => (
              <div key={agent.id} style={styles.agentCard}>
                <div style={styles.agentHeader}>
                  <div style={styles.agentName}>{agent.name}</div>
                  <span
                    style={{
                      ...styles.statusBadge,
                      backgroundColor: agentStatusColors[agent.status]?.bg ?? '#1E1E1E',
                      color: agentStatusColors[agent.status]?.text ?? '#888',
                    }}
                  >
                    {agent.status}
                  </span>
                </div>
                <div style={styles.agentType}>{agent.type}</div>
                <div style={styles.agentStats}>
                  <div>
                    <span style={styles.agentStatLabel}>Total Runs</span>
                    <span style={styles.agentStatValue}>{agent.totalRuns.toLocaleString()}</span>
                  </div>
                  <div>
                    <span style={styles.agentStatLabel}>Last Run</span>
                    <span style={styles.agentStatValue}>
                      {agent.lastRunAt
                        ? new Date(agent.lastRunAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>Loading organization details...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={fetchOrgData} style={styles.retryButton}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Header with back button */}
      <div style={styles.headerRow}>
        {onBack && (
          <button onClick={onBack} style={styles.backButton}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        )}
        <div>
          <h1 style={styles.title}>{data?.overview.name}</h1>
          <p style={styles.subtitle}>Organization ID: {orgId}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...styles.tabButton,
              ...(activeTab === tab.key ? styles.tabButtonActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'integrations' && renderIntegrations()}
      {activeTab === 'team' && renderTeam()}
      {activeTab === 'agents' && renderAgents()}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '32px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '6px',
    color: '#FAFAFA',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#FAFAFA',
    margin: 0,
  },
  subtitle: {
    fontSize: '13px',
    color: '#666666',
    margin: '4px 0 0 0',
    fontFamily: 'monospace',
  },
  loadingState: {
    textAlign: 'center' as const,
    padding: '64px',
    color: '#888888',
    fontSize: '14px',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
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

  // Tabs
  tabBar: {
    display: 'flex',
    gap: '4px',
    borderBottom: '1px solid #303030',
    marginBottom: '24px',
  },
  tabButton: {
    padding: '12px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#888888',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'color 0.15s ease, border-color 0.15s ease',
  },
  tabButtonActive: {
    color: '#FF751F',
    borderBottomColor: '#FF751F',
  },
  tabContent: {
    minHeight: '300px',
  },

  // Overview
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  infoCard: {
    backgroundColor: '#141414',
    border: '1px solid #303030',
    borderRadius: '8px',
    padding: '16px',
  },
  infoLabel: {
    fontSize: '11px',
    color: '#888888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '6px',
    fontWeight: 600,
  },
  infoValue: {
    fontSize: '16px',
    color: '#FAFAFA',
    fontWeight: 500,
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#FAFAFA',
    margin: '0 0 16px 0',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '16px',
  },
  statCard: {
    backgroundColor: '#141414',
    border: '1px solid #303030',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#FF751F',
    marginBottom: '4px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#888888',
    fontWeight: 500,
  },

  // Integrations
  integrationList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  integrationCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#141414',
    border: '1px solid #303030',
    borderRadius: '8px',
    padding: '16px 20px',
  },
  integrationInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  integrationName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#FAFAFA',
  },
  integrationProvider: {
    fontSize: '12px',
    color: '#888888',
  },
  integrationSync: {
    fontSize: '11px',
    color: '#666666',
  },
  integrationActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'capitalize' as const,
  },
  connectButton: {
    padding: '6px 16px',
    backgroundColor: '#FF751F',
    border: 'none',
    borderRadius: '6px',
    color: '#FFFFFF',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  disconnectButton: {
    padding: '6px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #444444',
    borderRadius: '6px',
    color: '#CCCCCC',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  },

  // Team
  inviteForm: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  inviteInput: {
    flex: '1 1 250px',
    padding: '10px 14px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '6px',
    color: '#FAFAFA',
    fontSize: '14px',
    outline: 'none',
  },
  inviteSelect: {
    padding: '10px 14px',
    backgroundColor: '#1E1E1E',
    border: '1px solid #303030',
    borderRadius: '6px',
    color: '#FAFAFA',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '120px',
  },
  inviteButton: {
    padding: '10px 20px',
    backgroundColor: '#FF751F',
    border: 'none',
    borderRadius: '6px',
    color: '#FFFFFF',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  tableWrapper: {
    overflowX: 'auto' as const,
    borderRadius: '8px',
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
    padding: '12px 16px',
    borderBottom: '1px solid #303030',
    color: '#888888',
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid #1E1E1E',
    color: '#CCCCCC',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: '#1E1E1E',
    color: '#AAAAAA',
    textTransform: 'capitalize' as const,
  },
  emptyTableState: {
    textAlign: 'center' as const,
    padding: '32px',
    color: '#666666',
    fontSize: '14px',
  },

  // Agents
  agentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px',
  },
  agentCard: {
    backgroundColor: '#141414',
    border: '1px solid #303030',
    borderRadius: '8px',
    padding: '20px',
  },
  agentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  agentName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#FAFAFA',
  },
  agentType: {
    fontSize: '13px',
    color: '#888888',
    marginBottom: '16px',
  },
  agentStats: {
    display: 'flex',
    justifyContent: 'space-between',
    borderTop: '1px solid #262626',
    paddingTop: '12px',
  },
  agentStatLabel: {
    display: 'block',
    fontSize: '11px',
    color: '#666666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '2px',
  },
  agentStatValue: {
    display: 'block',
    fontSize: '14px',
    color: '#CCCCCC',
    fontWeight: 500,
  },

  // Shared
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px',
    color: '#666666',
    fontSize: '14px',
  },
}
