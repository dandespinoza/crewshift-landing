'use client';

import { FileText, Briefcase, Users, DollarSign } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { GreetingHeader } from '@/components/dashboard/greeting-header';
import { StatsCard } from '@/components/data/stats-card';
import { RevenueChart } from '@/components/dashboard/revenue-chart';
import { AISuggestions } from '@/components/dashboard/ai-suggestions';
import { WorkflowWidget } from '@/components/dashboard/workflow-widget';
import { PipelineStages } from '@/components/dashboard/pipeline-stages';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { Badge } from '@/components/ui/badge';
import {
  statCards,
  revenueChartData,
  quotesPipeline,
  jobsPipeline,
  customerRequests,
  financeOverview,
  aiSuggestions,
  activityFeed,
} from '@/lib/mock-data';

const statIcons = [FileText, Briefcase, Users, DollarSign] as const;

const priorityVariant = (p: string) => {
  switch (p) {
    case 'High': return 'danger' as const;
    case 'Medium': return 'warning' as const;
    default: return 'default' as const;
  }
};

const statusVariant = (s: string) => {
  switch (s) {
    case 'In Progress': return 'accent' as const;
    case 'Scheduled': return 'info' as const;
    case 'Completed': return 'success' as const;
    case 'Viewed': return 'warning' as const;
    case 'Sent': return 'info' as const;
    case 'Accepted': return 'success' as const;
    case 'Draft': return 'default' as const;
    default: return 'default' as const;
  }
};

export default function DashboardPage() {
  return (
    <>
      <Header title="Dashboard" subtitle="Espinoza Plumbing Co." />

      <div className="space-y-8 p-6 lg:p-8">
        {/* Section 1: Greeting */}
        <GreetingHeader />

        {/* Section 2: Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card, idx) => (
            <StatsCard
              key={card.title}
              label={card.title}
              value={String(card.value)}
              trend={
                card.changePercent
                  ? { value: parseFloat(card.changePercent), direction: card.changeDirection as 'up' | 'down' }
                  : undefined
              }
              icon={statIcons[idx]}
              subDetail={card.subLabel}
              index={idx}
            />
          ))}
        </div>

        {/* Section 3: Charts + AI Suggestions */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RevenueChart data={revenueChartData} />
          </div>
          <div>
            <AISuggestions suggestions={aiSuggestions} />
          </div>
        </div>

        {/* Section 4: Workflow Widgets (2x2 grid) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Quotes Pipeline */}
          <WorkflowWidget title="Quotes Pipeline" actionLabel="View all quotes" actionHref="/invoices">
            <PipelineStages stages={quotesPipeline.stages} />
            <div className="mt-4 space-y-2">
              {quotesPipeline.recentQuotes.slice(0, 4).map((q) => (
                <div key={q.customer} className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-surface-bg1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{q.customer}</p>
                    <p className="text-xs text-text-tertiary truncate">{q.service}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <span className="text-sm font-semibold text-text-primary">${q.amount.toLocaleString()}</span>
                    <Badge variant={statusVariant(q.status)} size="sm">{q.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </WorkflowWidget>

          {/* Jobs Pipeline */}
          <WorkflowWidget title="Jobs Pipeline" actionLabel="View all jobs" actionHref="/jobs">
            <PipelineStages stages={jobsPipeline.stages} />
            <div className="mt-4 space-y-2">
              {jobsPipeline.todaysJobs.slice(0, 4).map((j) => (
                <div key={j.job} className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-surface-bg1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{j.job}</p>
                    <p className="text-xs text-text-tertiary truncate">{j.tech} · {j.time}</p>
                  </div>
                  <Badge variant={statusVariant(j.status)} size="sm">{j.status}</Badge>
                </div>
              ))}
            </div>
          </WorkflowWidget>

          {/* Customer Requests (CRM) */}
          <WorkflowWidget title="Customer Requests" actionLabel="View all requests" actionHref="/customers">
            <div className="space-y-2">
              {customerRequests.slice(0, 4).map((r) => (
                <div key={r.customer + r.time} className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-bg1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{r.customer}</p>
                      <Badge variant={priorityVariant(r.priority)} size="sm">{r.priority}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary truncate">{r.request}</p>
                    <p className="mt-1 text-xs text-text-tertiary">{r.channel} · {r.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </WorkflowWidget>

          {/* Finance Overview */}
          <WorkflowWidget title="Finance Overview" actionLabel="View report" actionHref="/analytics">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-tertiary">Revenue MTD</p>
                <p className="text-xl font-bold text-text-primary">${(financeOverview.revenueMTD / 1000).toFixed(1)}K</p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Gross Profit</p>
                <p className="text-xl font-bold text-success-text">${(financeOverview.grossProfit / 1000).toFixed(1)}K</p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">AR Outstanding</p>
                <p className="text-xl font-bold text-text-primary">${(financeOverview.arOutstanding / 1000).toFixed(1)}K</p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary">Cash in Bank</p>
                <p className="text-xl font-bold text-text-primary">${(financeOverview.cashInBank / 1000).toFixed(1)}K</p>
              </div>
            </div>
            {financeOverview.overdueInvoices.length > 0 && (
              <div className="mt-4 rounded-md bg-danger-subtle-bg p-3">
                <p className="text-xs font-medium text-danger-text">
                  {financeOverview.arOverdueCount} overdue invoices (${(financeOverview.arOverdue / 1000).toFixed(1)}K)
                </p>
                <div className="mt-2 space-y-1">
                  {financeOverview.overdueInvoices.map((inv) => (
                    <p key={inv.invoiceNumber} className="text-xs text-danger-text/80">
                      {inv.invoiceNumber} · {inv.customer} · ${inv.amount.toLocaleString()} · {inv.daysOverdue}d
                    </p>
                  ))}
                </div>
              </div>
            )}
          </WorkflowWidget>
        </div>

        {/* Section 5: Activity Feed */}
        <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Recent Activity</h2>
          <ActivityFeed activities={activityFeed} />
        </div>
      </div>
    </>
  );
}
