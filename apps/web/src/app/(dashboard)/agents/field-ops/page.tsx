'use client';

import { CalendarClock, CheckCircle2, RefreshCw, Users, AlertTriangle, Wrench } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { agentPerformance } from '@/lib/mock-data';

const { fieldOps } = agentPerformance;

const reviewQueue = [
  {
    id: 'FO-001',
    description: 'Scheduling conflict — Mike R. double-booked for drain callback (8 AM) and emergency burst pipe (2:30 PM)',
    status: 'Conflict' as const,
  },
  {
    id: 'FO-002',
    description: 'Reschedule request — David Chen slab leak detection moved from 10 AM to 12 PM (tech conflict resolved)',
    status: 'Resolved' as const,
  },
  {
    id: 'FO-003',
    description: 'Utilization gap — Jesse L. has no jobs scheduled after 1 PM; 2 unassigned afternoon jobs available',
    status: 'Pending' as const,
  },
];

const recentActivity = [
  {
    time: '2 hours ago',
    event: 'Rescheduled David Chen slab leak from 10 AM to 12 PM — tech conflict resolved',
    status: 'success' as const,
  },
  {
    time: '3 hours ago',
    event: 'Assigned Carlos S. to backflow preventer test at Phoenix Office Park (10:30 AM)',
    status: 'success' as const,
  },
  {
    time: '4 hours ago',
    event: 'Flagged Mike R. double-booking — drain callback and emergency burst pipe overlap',
    status: 'warning' as const,
  },
  {
    time: 'Yesterday',
    event: 'Optimized route for Tony M. — tankless water heater install, saved 22 min drive time',
    status: 'success' as const,
  },
  {
    time: 'Yesterday',
    event: 'Auto-assigned Jesse L. to disposal replacement (Frank Nguyen, 3:00 PM)',
    status: 'completed' as const,
  },
];

const statusDotClass = {
  success: 'bg-success-solid',
  pending: 'bg-text-tertiary',
  warning: 'bg-warning-solid',
  completed: 'bg-info-solid',
} as const;

export default function FieldOpsAgentPage() {
  return (
    <>
      <Header title="Field Ops Agent" subtitle="Automated scheduling, dispatch & route optimization" />

      <div className="p-6 lg:p-8 space-y-8">

        {/* Agent status */}
        <div className="flex items-center gap-3">
          <Badge variant="success">Active</Badge>
          <span className="text-sm text-text-tertiary">Running — last action 2 hours ago</span>
        </div>

        {/* Metric cards */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Performance Metrics</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <CalendarClock className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Actions Today</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.actionsToday}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Schedule Adherence</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.scheduleAdherence}%</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Reschedules Today</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.reschedules}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Tech Utilization</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.techUtilizationRate}%</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Conflicts Resolved</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.conflictsResolved}</p>
            </div>

            <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-text-tertiary" />
                <p className="text-xs text-text-tertiary">Open Conflicts</p>
              </div>
              <p className="text-2xl font-bold text-text-primary">{fieldOps.openConflicts}</p>
            </div>

          </div>
        </div>

        {/* Review queue */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Scheduling Conflicts</h2>
            <Badge variant="accent">
              {reviewQueue.filter((i) => i.status !== 'Resolved').length} open
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
                    {item.status === 'Conflict' ? (
                      <AlertTriangle className="h-4 w-4 text-danger-text" />
                    ) : item.status === 'Resolved' ? (
                      <CheckCircle2 className="h-4 w-4 text-success-text" />
                    ) : (
                      <CalendarClock className="h-4 w-4 text-warning-text" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{item.description}</p>
                    <div className="mt-1">
                      <Badge
                        variant={
                          item.status === 'Conflict'
                            ? 'danger'
                            : item.status === 'Resolved'
                            ? 'success'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                {item.status !== 'Resolved' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm">Reject</Button>
                    <Button variant="default" size="sm">Approve</Button>
                  </div>
                )}
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
