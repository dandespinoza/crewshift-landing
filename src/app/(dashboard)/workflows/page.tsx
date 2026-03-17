'use client';

import { useState } from 'react';
import { Header } from '@/components/layout/header';
import { WorkflowCanvas } from '@/components/workflows/workflow-canvas';
import { WorkflowToolbar } from '@/components/workflows/workflow-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Plus, Play, Pause, MoreHorizontal,
  Zap, FileText, DollarSign, Wrench, GitBranch, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  runs30d: number;
  successRate: number;
  icon: typeof Zap;
}

const workflows: Workflow[] = [
  {
    id: 'wf-1',
    name: 'Auto-Invoice on Job Complete',
    description: 'When a job is marked complete, Invoice Agent generates and sends the invoice.',
    status: 'active',
    runs30d: 82,
    successRate: 97,
    icon: FileText,
  },
  {
    id: 'wf-2',
    name: 'Quote Follow-Up Sequence',
    description: 'Automated follow-up emails when quotes aren\'t accepted within 3 days.',
    status: 'active',
    runs30d: 38,
    successRate: 94,
    icon: Clock,
  },
  {
    id: 'wf-3',
    name: 'Collections Escalation',
    description: 'Escalate overdue invoices: 30-day reminder, 60-day owner notification.',
    status: 'active',
    runs30d: 10,
    successRate: 72,
    icon: DollarSign,
  },
  {
    id: 'wf-4',
    name: 'Emergency Job Fast-Track',
    description: 'Auto-assign available tech and send customer ETA for high-priority requests.',
    status: 'active',
    runs30d: 14,
    successRate: 100,
    icon: Zap,
  },
  {
    id: 'wf-5',
    name: 'New Customer Onboarding',
    description: 'Send welcome email, create job template, assign to field ops.',
    status: 'paused',
    runs30d: 5,
    successRate: 88,
    icon: Wrench,
  },
  {
    id: 'wf-6',
    name: 'Weekly Revenue Report',
    description: 'Auto-generate and email weekly revenue summary every Monday.',
    status: 'draft',
    runs30d: 0,
    successRate: 0,
    icon: GitBranch,
  },
];

const statusConfig = {
  active: { label: 'Active', variant: 'success' as const, icon: Play },
  paused: { label: 'Paused', variant: 'warning' as const, icon: Pause },
  draft: { label: 'Draft', variant: 'default' as const, icon: MoreHorizontal },
};

export default function WorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);

  // If a workflow is selected, show the canvas
  if (selectedWorkflow) {
    const wf = workflows.find((w) => w.id === selectedWorkflow);
    return (
      <div className="flex h-screen flex-col">
        <Header title={wf?.name || 'Workflow'} subtitle="Visual Automation Builder" />
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border-subtle bg-surface-bg0">
          <button
            onClick={() => setSelectedWorkflow(null)}
            className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Workflows
          </button>
          {wf && (
            <Badge variant={statusConfig[wf.status].variant}>
              {statusConfig[wf.status].label}
            </Badge>
          )}
        </div>
        <div className="relative flex-1 overflow-hidden">
          <WorkflowCanvas />
          <WorkflowToolbar />
        </div>
      </div>
    );
  }

  // Workflow list view
  return (
    <>
      <Header title="Workflows" subtitle="Visual Automation Builder" />

      <div className="p-6 lg:p-8 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-tertiary">
              {workflows.filter((w) => w.status === 'active').length} active workflows running
            </p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> New Workflow
          </Button>
        </div>

        {/* Workflow cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((wf) => {
            const Icon = wf.icon;
            const config = statusConfig[wf.status];
            return (
              <button
                key={wf.id}
                onClick={() => setSelectedWorkflow(wf.id)}
                className="rounded-lg bg-surface-bg0 p-6 shadow-1 text-left transition-all duration-200 hover:shadow-2 hover:-translate-y-0.5 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50">
                    <Icon className="h-5 w-5 text-accent-500" />
                  </div>
                  <Badge variant={config.variant} size="sm">
                    {config.label}
                  </Badge>
                </div>

                <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent-600 transition-colors">
                  {wf.name}
                </h3>
                <p className="mt-1 text-xs text-text-tertiary line-clamp-2">
                  {wf.description}
                </p>

                {wf.status !== 'draft' && (
                  <div className="mt-4 flex items-center gap-4 text-xs text-text-tertiary">
                    <span>{wf.runs30d} runs (30d)</span>
                    <span
                      className={cn(
                        wf.successRate >= 90 ? 'text-success-text' : 'text-warning-text',
                      )}
                    >
                      {wf.successRate}% success
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
