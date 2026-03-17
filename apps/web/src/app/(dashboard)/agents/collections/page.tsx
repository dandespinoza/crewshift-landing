'use client';

import { DollarSign, TrendingUp, Users, Clock, AlertTriangle, PhoneCall } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { agentPerformance } from '@/lib/mock-data';

const { collections } = agentPerformance;

const reviewQueue = [
  {
    id: 'COL-001',
    description: 'Payment reminder — Greg Thompson, INV-1862, slab leak repair ($1,850) — 38 days overdue',
    status: 'Sent' as const,
  },
  {
    id: 'COL-002',
    description: 'Escalation needed — Pacific Ridge HOA, INV-1847, backflow testing ($3,400) — 45 days overdue',
    status: 'Escalate' as const,
  },
  {
    id: 'COL-003',
    description: 'First reminder — Mesa School District, INV-1871, fixture replacement ($1,550) — 32 days overdue',
    status: 'Pending' as const,
  },
];

const recentActivity = [
  {
    time: '18 min ago',
    event: 'Sent payment reminder to Greg Thompson — INV-1862 ($1,850)',
    status: 'success' as const,
  },
  {
    time: '2 hours ago',
    event: 'Escalated INV-1847 (Pacific Ridge HOA, $3,400) — 45 days overdue',
    status: 'warning' as const,
  },
  {
    time: 'Yesterday',
    event: 'Collected payment from Karen White — INV-1858 ($620)',
    status: 'completed' as const,
  },
  {
    time: 'Yesterday',
    event: 'Sent follow-up SMS to Mesa School District — INV-1871 ($1,550)',
    status: 'success' as const,
  },
  {
    time: '2 days ago',
    event: 'Closed collection — Robert Kim paid outstanding balance ($340)',
    status: 'completed' as const,
  },
];

const statusDotClass = {
  success: 'bg-success-solid',
  pending: 'bg-text-tertiary',
  warning: 'bg-warning-solid',
  completed: 'bg-info-solid',
} as const;

export default function CollectionsAgentPage() {
  return (
    <>
      <Header title="Collections Agent" subtitle="Automated payment follow-up & recovery" />

      <div className="p-6 lg:p-8 space-y-8">

        {/* Agent status */}
        <div className="flex items-center gap-3">
          <Badge variant="success">Active</Badge>
          <span className="text-sm text-text-tertiary">Running — last action 18 min ago</span>
        </div>

        {/* Metric cards */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Performance Metrics</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <PhoneCall className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Actions Today</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{collections.actionsToday}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Recovery Rate</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{collections.recoveryRate}%</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Total Contacted (30d)</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{collections.totalContacted}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Amount Recovered</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">
                ${collections.amountRecovered.toLocaleString()}
              </p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Avg Days to Resolve</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{collections.avgDaysToResolve}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Escalations Pending</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{collections.escalationsPending}</p>
            </div>

          </div>
        </div>

        {/* Review queue */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Collection Reminders</h2>
            <Badge variant="accent">
              {reviewQueue.length} active
            </Badge>
          </div>
          <div className="space-y-3">
            {reviewQueue.map((item) => (
              <div
                key={item.id}
                className="rounded-lg bg-surface-bg0 p-4 shadow-1 flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="mt-0.5 flex-shrink-0">
                    {item.status === 'Escalate' ? (
                      <AlertTriangle className="h-4 w-4 text-danger-text" />
                    ) : item.status === 'Sent' ? (
                      <Clock className="h-4 w-4 text-warning-text" />
                    ) : (
                      <PhoneCall className="h-4 w-4 text-text-tertiary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{item.description}</p>
                    <div className="mt-1">
                      <Badge
                        variant={
                          item.status === 'Escalate'
                            ? 'danger'
                            : item.status === 'Sent'
                            ? 'warning'
                            : 'default'
                        }
                        size="sm"
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm">Dismiss</Button>
                  <Button variant="default" size="sm">
                    {item.status === 'Escalate' ? 'Escalate' : 'Send'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Recent Activity</h2>
          <ul>
            {recentActivity.map((item, idx) => (
              <li
                key={idx}
                className={
                  idx < recentActivity.length - 1
                    ? 'flex gap-3 py-3 border-b border-border-subtle'
                    : 'flex gap-3 py-3'
                }
              >
                <div className="mt-1.5 flex-shrink-0">
                  <span
                    className={`block h-2 w-2 rounded-full ${statusDotClass[item.status]}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">{item.event}</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">{item.time}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </>
  );
}
