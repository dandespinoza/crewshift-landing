'use client';

import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { analyticsData } from '@/lib/mock-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US');
}

function formatPct(value: number): string {
  return value + '%';
}

// ---------------------------------------------------------------------------
// Revenue Trend: CSS bar chart
// ---------------------------------------------------------------------------

const MAX_BAR_HEIGHT = 200; // px

function RevenueTrendChart() {
  const data = analyticsData.revenueTrend6Months;
  const maxRevenue = Math.max(...data.map((d) => d.revenue));

  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-text-primary">Revenue Trend (6 Months)</h2>
      <div className="flex items-end justify-around gap-3">
        {data.map((point) => {
          const heightPx = Math.round((point.revenue / maxRevenue) * MAX_BAR_HEIGHT);
          return (
            <div key={point.month} className="flex flex-1 flex-col items-center gap-2">
              {/* Revenue label above bar */}
              <span className="text-xs font-medium text-text-secondary whitespace-nowrap">
                ${Math.round(point.revenue / 1000)}K
              </span>
              {/* The bar */}
              <div
                className="w-full rounded-t-md bg-accent-500 transition-all duration-300"
                style={{ height: `${heightPx}px` }}
              />
              {/* Month label below bar */}
              <span className="text-xs text-text-tertiary">{point.month}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Services table
// ---------------------------------------------------------------------------

function TopServicesTable() {
  const rows = analyticsData.topServicesByRevenue;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Top Services by Revenue</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-3 text-left text-xs font-medium text-text-tertiary">Service</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Revenue</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Jobs</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Avg Ticket</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.service} className={idx < rows.length - 1 ? 'border-b border-border-subtle' : ''}>
                <td className="py-3 text-text-primary font-medium">{row.service}</td>
                <td className="py-3 text-right text-text-primary">{formatCurrency(row.revenue)}</td>
                <td className="py-3 text-right text-text-secondary">{row.jobCount}</td>
                <td className="py-3 text-right text-text-secondary">{formatCurrency(row.avgTicket)}</td>
                <td className="py-3 text-right">
                  <span className={row.marginPct >= 50 ? 'text-success-text font-medium' : 'text-text-secondary'}>
                    {formatPct(row.marginPct)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tech Productivity table
// ---------------------------------------------------------------------------

function TechProductivityTable() {
  const rows = analyticsData.techProductivity;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Tech Productivity</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-3 text-left text-xs font-medium text-text-tertiary">Technician</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Jobs</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Revenue</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Avg Duration</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Rating</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Callback %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.tech} className={idx < rows.length - 1 ? 'border-b border-border-subtle' : ''}>
                <td className="py-3 text-text-primary font-medium">{row.tech}</td>
                <td className="py-3 text-right text-text-secondary">{row.jobsCompleted}</td>
                <td className="py-3 text-right text-text-primary">{formatCurrency(row.revenueGenerated)}</td>
                <td className="py-3 text-right text-text-secondary">{row.avgJobDuration}</td>
                <td className="py-3 text-right">
                  <span className={row.customerRating >= 4.8 ? 'text-success-text font-medium' : 'text-text-secondary'}>
                    {row.customerRating.toFixed(1)}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className={row.callbackRate > 5 ? 'text-danger-text' : 'text-text-secondary'}>
                    {formatPct(row.callbackRate)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer Acquisition table
// ---------------------------------------------------------------------------

function CustomerAcquisitionTable() {
  const rows = analyticsData.customerAcquisition;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Customer Acquisition by Channel</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-3 text-left text-xs font-medium text-text-tertiary">Channel</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Leads</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Converted</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Conv. Rate</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Avg Job Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.channel} className={idx < rows.length - 1 ? 'border-b border-border-subtle' : ''}>
                <td className="py-3 text-text-primary font-medium">{row.channel}</td>
                <td className="py-3 text-right text-text-secondary">{row.leads}</td>
                <td className="py-3 text-right text-text-secondary">{row.converted}</td>
                <td className="py-3 text-right">
                  <span className={row.conversionRate >= 75 ? 'text-success-text font-medium' : row.conversionRate < 40 ? 'text-danger-text' : 'text-text-secondary'}>
                    {formatPct(row.conversionRate)}
                  </span>
                </td>
                <td className="py-3 text-right text-text-primary">{formatCurrency(row.avgJobValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quote Conversion Funnel
// ---------------------------------------------------------------------------

function QuoteConversionFunnel() {
  const stages = analyticsData.quoteConversionFunnel;
  const maxCount = stages[0].count;

  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-text-primary">Quote Conversion Funnel</h2>
      <div className="flex flex-col gap-2">
        {stages.map((stage, idx) => {
          const widthPct = Math.round((stage.count / maxCount) * 100);
          const isLast = idx === stages.length - 1;
          return (
            <div key={stage.stage} className="flex items-center gap-4">
              {/* Funnel bar */}
              <div className="flex-1">
                <div
                  className={`flex h-10 items-center justify-between rounded-md px-4 ${
                    isLast ? 'bg-success-subtle-bg' : 'bg-accent-500/20'
                  }`}
                  style={{ width: `${widthPct}%`, minWidth: '40%' }}
                >
                  <span className={`text-sm font-medium ${isLast ? 'text-success-text' : 'text-accent-700'}`}>
                    {stage.stage}
                  </span>
                  <span className={`text-sm font-bold ${isLast ? 'text-success-text' : 'text-accent-700'}`}>
                    {stage.count}
                  </span>
                </div>
              </div>
              {/* Drop-off badge */}
              {stage.dropOffPct > 0 && (
                <Badge variant="danger" size="sm">
                  -{formatPct(stage.dropOffPct)}
                </Badge>
              )}
              {stage.dropOffPct === 0 && (
                <span className="w-14" />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-text-tertiary">
        Overall conversion: {Math.round((stages[stages.length - 1].count / maxCount) * 100)}% of quotes created become accepted jobs
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Flow table
// ---------------------------------------------------------------------------

function CashFlowTable() {
  const rows = analyticsData.cashFlow4Weeks;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">4-Week Cash Flow</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-3 text-left text-xs font-medium text-text-tertiary">Week</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Inflow</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Outflow</th>
              <th className="pb-3 text-right text-xs font-medium text-text-tertiary">Net Cash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.week} className={idx < rows.length - 1 ? 'border-b border-border-subtle' : ''}>
                <td className="py-3 text-text-secondary">{row.week}</td>
                <td className="py-3 text-right text-success-text font-medium">
                  {formatCurrency(row.inflow)}
                </td>
                <td className="py-3 text-right text-danger-text font-medium">
                  {formatCurrency(row.outflow)}
                </td>
                <td className="py-3 text-right">
                  <span className={row.netCash >= 0 ? 'text-success-text font-bold' : 'text-danger-text font-bold'}>
                    {row.netCash >= 0 ? '+' : ''}{formatCurrency(row.netCash)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  return (
    <>
      <Header title="Analytics" subtitle="Business Intelligence" />

      <div className="space-y-8 p-6 lg:p-8">
        {/* Revenue Trend */}
        <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <RevenueTrendChart />
        </section>

        {/* Top Services */}
        <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <TopServicesTable />
        </section>

        {/* Tech Productivity */}
        <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <TechProductivityTable />
        </section>

        {/* Customer Acquisition + Quote Funnel side by side on large screens */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
            <CustomerAcquisitionTable />
          </section>

          <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
            <QuoteConversionFunnel />
          </section>
        </div>

        {/* Cash Flow */}
        <section className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <CashFlowTable />
        </section>
      </div>
    </>
  );
}
