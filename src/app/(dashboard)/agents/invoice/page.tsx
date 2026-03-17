'use client';

import { useState, useCallback } from 'react';
import {
  FileText, CheckCircle2, Clock, Percent, Zap, ListChecks,
  Plus, X, DollarSign, User, Wrench, Send, Bot, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { agentPerformance, jobsPipeline } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

const { invoice: agentMetrics } = agentPerformance;

type QueueItemStatus = 'Pending' | 'Approved' | 'Rejected' | 'Auto-approved';

interface QueueItem {
  id: string;
  description: string;
  customer: string;
  service: string;
  amount: number;
  status: QueueItemStatus;
}

interface ActivityItem {
  time: string;
  event: string;
  status: 'success' | 'pending' | 'warning' | 'completed';
}

const initialQueue: QueueItem[] = [
  { id: 'INV-1924', description: 'Invoice #1924', customer: 'Lisa Park', service: 'Drain cleaning', amount: 280, status: 'Pending' },
  { id: 'INV-1925', description: 'Invoice #1925', customer: 'Frank Nguyen', service: 'Disposal replacement', amount: 420, status: 'Pending' },
  { id: 'INV-1923', description: 'Invoice #1923', customer: 'Tom Henderson', service: 'Bathroom fixture install', amount: 890, status: 'Auto-approved' },
];

const statusDotClass: Record<string, string> = {
  success: 'bg-success-solid',
  pending: 'bg-text-tertiary',
  warning: 'bg-warning-solid',
  completed: 'bg-info-solid',
};

export default function InvoiceAgentPage() {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [activities, setActivities] = useState<ActivityItem[]>([
    { time: '5 min ago', event: 'Auto-approved Invoice #1922 — James Cooper, water heater install ($3,850)', status: 'success' },
    { time: '18 min ago', event: 'Generated Invoice #1923 for bathroom fixture install ($890)', status: 'success' },
    { time: '42 min ago', event: 'Flagged Invoice #1924 for manual review — unusual line item', status: 'pending' },
    { time: '1 hour ago', event: 'Sent Invoice #1921 to Pacific Ridge HOA ($3,400)', status: 'success' },
    { time: '2 hours ago', event: 'Auto-approved Invoice #1920 — Alex P., backflow test ($850)', status: 'success' },
  ]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [metrics, setMetrics] = useState({ ...agentMetrics });

  // Form state
  const [formCustomer, setFormCustomer] = useState('');
  const [formService, setFormService] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const pendingCount = queue.filter((i) => i.status === 'Pending').length;

  const handleApprove = useCallback((id: string) => {
    const item = queue.find((i) => i.id === id);
    if (!item) return;

    setQueue((prev) => prev.map((i) => i.id === id ? { ...i, status: 'Approved' } : i));
    setMetrics((prev) => ({ ...prev, pendingReview: Math.max(0, prev.pendingReview - 1) }));
    setActivities((prev) => [
      { time: 'Just now', event: `Approved ${item.description} — ${item.customer}, ${item.service} ($${item.amount})`, status: 'success' },
      ...prev,
    ]);
    toast.success(`${item.description} approved`, {
      description: `Sending invoice to ${item.customer} for $${item.amount}`,
    });
  }, [queue]);

  const handleReject = useCallback((id: string) => {
    const item = queue.find((i) => i.id === id);
    if (!item) return;

    setQueue((prev) => prev.map((i) => i.id === id ? { ...i, status: 'Rejected' } : i));
    setMetrics((prev) => ({ ...prev, pendingReview: Math.max(0, prev.pendingReview - 1) }));
    setActivities((prev) => [
      { time: 'Just now', event: `Rejected ${item.description} — ${item.customer}, ${item.service} ($${item.amount})`, status: 'warning' },
      ...prev,
    ]);
    toast.error(`${item.description} rejected`, {
      description: 'Invoice returned for manual review.',
    });
  }, [queue]);

  const handleCreateInvoice = useCallback(async () => {
    if (!formCustomer.trim() || !formService.trim() || !formAmount.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsGenerating(true);

    // Simulate AI generation
    await new Promise((r) => setTimeout(r, 1800));

    const amount = parseFloat(formAmount) || 0;
    const newId = `INV-${1926 + queue.length}`;

    const newItem: QueueItem = {
      id: newId,
      description: `Invoice ${newId}`,
      customer: formCustomer,
      service: formService,
      amount,
      status: 'Pending',
    };

    setQueue((prev) => [newItem, ...prev]);
    setMetrics((prev) => ({
      ...prev,
      actionsToday: prev.actionsToday + 1,
      pendingReview: prev.pendingReview + 1,
      totalProcessed: prev.totalProcessed + 1,
    }));
    setActivities((prev) => [
      { time: 'Just now', event: `AI generated ${newId} — ${formCustomer}, ${formService} ($${amount.toLocaleString()})`, status: 'success' },
      ...prev,
    ]);

    setIsGenerating(false);
    setShowCreateForm(false);
    setFormCustomer('');
    setFormService('');
    setFormAmount('');
    setFormNotes('');

    toast.success(`${newId} created by Invoice Agent`, {
      description: `${formCustomer} — ${formService} ($${amount.toLocaleString()}). Ready for review.`,
    });
  }, [formCustomer, formService, formAmount, queue.length]);

  const handleAIGenerate = useCallback(() => {
    // Pick a random job from today's jobs for AI to generate
    const job = jobsPipeline.todaysJobs[Math.floor(Math.random() * jobsPipeline.todaysJobs.length)];
    setFormCustomer(job.customer.split(',')[0]);
    setFormService(job.job);
    setFormAmount(String(Math.floor(Math.random() * 3000) + 200));
    toast.info('AI populated fields', { description: `Based on today's job: ${job.job}` });
  }, []);

  return (
    <>
      <Header title="Invoice Agent" subtitle="Automated invoice generation & review" />

      <div className="p-6 lg:p-8 space-y-8">
        {/* Agent status + create button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="success">Active</Badge>
            <span className="text-sm text-text-tertiary">Running — last action 5 min ago</span>
          </div>
          <Button onClick={() => setShowCreateForm(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        </div>

        {/* Create Invoice Form (slide-down) */}
        <AnimatePresence>
          {showCreateForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-lg bg-surface-bg0 p-6 shadow-1 border-l-[3px] border-accent-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-accent-500" />
                    <h2 className="text-lg font-semibold text-text-primary">Create Invoice</h2>
                  </div>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-surface-bg2 transition-colors"
                  >
                    <X className="h-4 w-4 text-text-tertiary" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary mb-1.5">Customer *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                      <Input
                        value={formCustomer}
                        onChange={(e) => setFormCustomer(e.target.value)}
                        placeholder="e.g. Lisa Park"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary mb-1.5">Service *</label>
                    <div className="relative">
                      <Wrench className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                      <Input
                        value={formService}
                        onChange={(e) => setFormService(e.target.value)}
                        placeholder="e.g. Drain cleaning"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary mb-1.5">Amount *</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
                      <Input
                        type="number"
                        value={formAmount}
                        onChange={(e) => setFormAmount(e.target.value)}
                        placeholder="0.00"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary mb-1.5">Notes</label>
                    <Input
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-5">
                  <Button variant="ghost" size="sm" onClick={handleAIGenerate} className="gap-2 text-accent-600">
                    <Zap className="h-3.5 w-3.5" /> AI Auto-fill from today&apos;s jobs
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowCreateForm(false)}>Cancel</Button>
                    <Button onClick={handleCreateInvoice} loading={isGenerating} className="gap-2">
                      {isGenerating ? 'AI Generating...' : <><Send className="h-4 w-4" /> Generate Invoice</>}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Metric cards */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Performance Metrics</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Zap, label: 'Actions Today', value: metrics.actionsToday },
              { icon: CheckCircle2, label: 'Accuracy', value: `${metrics.accuracy}%` },
              { icon: FileText, label: 'Total Processed (30d)', value: metrics.totalProcessed },
              { icon: Clock, label: 'Avg Processing Time', value: metrics.avgProcessingTime },
              { icon: Percent, label: 'Auto-Approval Rate', value: `${metrics.autoApprovalRate}%` },
              { icon: ListChecks, label: 'Pending Review', value: metrics.pendingReview },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-surface-bg0 p-6 shadow-1">
                <div className="flex items-center gap-2 mb-2">
                  <m.icon className="h-4 w-4 text-text-tertiary" />
                  <p className="text-xs text-text-tertiary">{m.label}</p>
                </div>
                <p className="text-2xl font-bold text-text-primary">{m.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Review queue */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Review Queue</h2>
            {pendingCount > 0 && <Badge variant="accent">{pendingCount} pending</Badge>}
          </div>
          <div className="space-y-3">
            <AnimatePresence>
              {queue.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-surface-bg0 p-4 shadow-1 flex items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-0.5 flex-shrink-0">
                      {item.status === 'Pending' && <Clock className="h-4 w-4 text-warning-text" />}
                      {item.status === 'Approved' && <CheckCircle2 className="h-4 w-4 text-success-text" />}
                      {item.status === 'Auto-approved' && <CheckCircle2 className="h-4 w-4 text-success-text" />}
                      {item.status === 'Rejected' && <X className="h-4 w-4 text-danger-text" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary">
                        {item.description} — {item.customer}, {item.service} (${item.amount.toLocaleString()})
                      </p>
                      <div className="mt-1">
                        <Badge
                          variant={
                            item.status === 'Pending' ? 'warning' :
                            item.status === 'Rejected' ? 'danger' : 'success'
                          }
                          size="sm"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {item.status === 'Pending' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button variant="outline" size="sm" onClick={() => handleReject(item.id)}>Reject</Button>
                      <Button variant="default" size="sm" onClick={() => handleApprove(item.id)}>Approve</Button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-lg bg-surface-bg0 p-6 shadow-1">
          <h2 className="mb-4 text-lg font-semibold text-text-primary">Recent Activity</h2>
          <ul>
            {activities.slice(0, 8).map((item, idx) => (
              <li
                key={idx}
                className={cn(
                  'flex gap-3 py-3',
                  idx < Math.min(activities.length, 8) - 1 && 'border-b border-border-subtle',
                )}
              >
                <div className="mt-1.5 flex-shrink-0">
                  <span className={cn('block h-2 w-2 rounded-full', statusDotClass[item.status])} />
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
