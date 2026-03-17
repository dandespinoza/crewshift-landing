'use client';

import { FileEdit, CheckCircle2, Clock, Percent, Zap, LayoutList } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { agentPerformance } from '@/lib/mock-data';

const { estimate } = agentPerformance;

const reviewQueue = [
  {
    id: 'EST-041',
    description: 'Draft estimate — Mark Torres, Whole-house repipe (polybutylene) ($9,400)',
    status: 'In Review' as const,
  },
  {
    id: 'EST-042',
    description: 'Draft estimate — Jennifer Walsh, Commercial drain cleaning — restaurant ($2,200)',
    status: 'In Review' as const,
  },
  {
    id: 'EST-043',
    description: 'Draft estimate — Angela Rivera, Sewer inspection & backyard repair ($4,600)',
    status: 'Ready to Send' as const,
  },
];

const recentActivity = [
  {
    time: '1 hour ago',
    event: 'Created draft estimate for Mark Torres — whole-house repipe ($9,400)',
    status: 'pending' as const,
  },
  {
    time: '2 hours ago',
    event: 'Sent estimate to Tom Henderson — bathroom remodel rough-in ($6,400)',
    status: 'success' as const,
  },
  {
    time: '3 hours ago',
    event: 'Customer accepted estimate — Sarah Mitchell, sewer line replacement ($8,900)',
    status: 'completed' as const,
  },
  {
    time: 'Yesterday',
    event: 'Drafted estimate for Jennifer Walsh — commercial drain cleaning ($2,200)',
    status: 'pending' as const,
  },
  {
    time: 'Yesterday',
    event: 'Followed up on unanswered estimate — Robert Kim, tankless water heater ($3,850)',
    status: 'success' as const,
  },
];

const statusDotClass = {
  success: 'bg-success-solid',
  pending: 'bg-text-tertiary',
  warning: 'bg-warning-solid',
  completed: 'bg-info-solid',
} as const;

export default function EstimateAgentPage() {
  return (
    <>
      <Header title="Estimate Agent" subtitle="Automated estimate drafting & follow-up" />

      <div className="p-6 lg:p-8 space-y-8">

        {/* Agent status */}
        <div className="flex items-center gap-3">
          <Badge variant="success">Active</Badge>
          <span className="text-sm text-text-tertiary">Running — last action 1 hour ago</span>
        </div>

        {/* Metric cards */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Performance Metrics</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Actions Today</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.actionsToday}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Accuracy</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.accuracy}%</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <FileEdit className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Total Processed (30d)</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.totalProcessed}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Avg Estimate Time</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.avgEstimateTime}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Percent className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Acceptance Rate</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.acceptanceRate}%</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <LayoutList className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Drafts In Progress</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{estimate.draftsInProgress}</p>
            </div>

          </div>
        </div>

        {/* Review queue */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Draft Estimates Queue</h2>
            <Badge variant="accent">
              {reviewQueue.filter((i) => i.status === 'In Review').length} in review
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
                    {item.status === 'In Review' ? (
                      <Clock className="h-4 w-4 text-warning-text" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success-text" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{item.description}</p>
                    <div className="mt-1">
                      <Badge
                        variant={item.status === 'In Review' ? 'warning' : 'success'}
                        size="sm"
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm">Reject</Button>
                  <Button variant="default" size="sm">Approve</Button>
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
