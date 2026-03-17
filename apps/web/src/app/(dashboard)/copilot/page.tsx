'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Sparkles, Loader2, FileText, CheckCircle2,
  Calendar, DollarSign, AlertTriangle, Users, TrendingUp, Wrench,
  Phone, Mail, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  statCards, financeOverview, jobsPipeline, quotesPipeline,
  customerRequests, activityFeed, agentPerformance,
} from '@/lib/mock-data';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actions?: MessageAction[];
  data?: MessageData;
}

interface MessageAction {
  label: string;
  variant: 'default' | 'outline' | 'destructive';
  done?: boolean;
  result?: string;
}

interface MessageData {
  type: 'invoice-created' | 'table' | 'jobs-list' | 'invoice-form';
  payload?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Fuzzy intent matching                                              */
/* ------------------------------------------------------------------ */

interface Intent {
  name: string;
  keywords: string[];
  handler: () => { content: string; actions?: MessageAction[]; data?: MessageData };
}

// Simple fuzzy check: does the query contain something similar to any keyword?
function fuzzyMatch(query: string, keyword: string): boolean {
  const q = query.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const k = keyword.toLowerCase();

  // Direct inclusion
  if (q.includes(k)) return true;

  // Check each word in query against keyword (handles typos by checking if >60% chars match)
  const words = q.split(/\s+/);
  for (const word of words) {
    if (word.length < 3) continue;
    // Levenshtein-lite: if word is close enough to keyword
    if (k.length >= 3 && word.length >= 3) {
      let matches = 0;
      const shorter = word.length < k.length ? word : k;
      const longer = word.length < k.length ? k : word;
      for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) matches++;
      }
      if (matches / shorter.length > 0.7 && shorter.length >= 3) return true;
    }
  }
  return false;
}

function matchIntent(query: string, intents: Intent[]): Intent | null {
  let bestMatch: Intent | null = null;
  let bestScore = 0;

  for (const intent of intents) {
    let score = 0;
    for (const kw of intent.keywords) {
      if (fuzzyMatch(query, kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = intent;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/* ------------------------------------------------------------------ */
/*  Build intents with live data                                       */
/* ------------------------------------------------------------------ */

function buildIntents(): Intent[] {
  return [
    {
      name: 'create-invoice',
      keywords: ['create', 'invoice', 'invoic', 'invopice', 'invioce', 'bill', 'generate', 'new invoice', 'make invoice', 'draft invoice', 'project', 'porject', 'porjct'],
      handler: () => {
        const jobs = jobsPipeline.todaysJobs;
        return {
          content: `I'll create invoices for you. Here are **today's completed/in-progress jobs** that may need invoicing:\n\n` +
            jobs.map((j, i) => `${i + 1}. **${j.job}** — ${j.customer.split(',')[0]} (${j.tech}, ${j.time}) — *${j.status}*`).join('\n') +
            `\n\nWhich ones should I invoice? Or I can invoice **all completed jobs** at once.`,
          actions: [
            { label: 'Invoice all completed jobs', variant: 'default' },
            { label: 'Invoice in-progress jobs too', variant: 'outline' },
            { label: 'Let me pick specific ones', variant: 'outline' },
          ],
          data: { type: 'invoice-form' },
        };
      },
    },
    {
      name: 'schedule',
      keywords: ['schedule', 'today', 'jobs today', 'calendar', 'appointment', 'whats on', 'what do i have', 'lineup'],
      handler: () => {
        const jobs = jobsPipeline.todaysJobs;
        const inProgress = jobs.filter((j) => j.status === 'In Progress').length;
        const scheduled = jobs.filter((j) => j.status === 'Scheduled').length;
        return {
          content: `**Today's Schedule** — ${jobs.length} jobs (${inProgress} in progress, ${scheduled} scheduled)\n\n` +
            jobs.map((j) => `**${j.time}** · ${j.job}\n↳ ${j.customer.split(',')[0]} · ${j.tech} · *${j.status}*`).join('\n\n') +
            `\n\n⚠️ **Conflict:** Mike R. has back-to-back jobs (8 AM callback + 2:30 PM emergency). I recommend reassigning the emergency to Jesse L.`,
          actions: [
            { label: 'Reassign Mike\'s 2:30 PM to Jesse', variant: 'default' },
            { label: 'View full calendar', variant: 'outline' },
          ],
        };
      },
    },
    {
      name: 'revenue',
      keywords: ['revenue', 'money', 'income', 'financial', 'finance', 'report', 'profit', 'earnings', 'sales', 'how much', 'cash'],
      handler: () => {
        const f = financeOverview;
        return {
          content: `**Financial Snapshot — March 2026**\n\n` +
            `| Metric | Amount |\n|--------|--------|\n` +
            `| Revenue MTD | **$${f.revenueMTD.toLocaleString()}** |\n` +
            `| Expenses MTD | $${f.expensesMTD.toLocaleString()} |\n` +
            `| Gross Profit | **$${f.grossProfit.toLocaleString()}** (${f.grossMarginPct}%) |\n` +
            `| Cash in Bank | $${f.cashInBank.toLocaleString()} |\n` +
            `| AR Outstanding | $${f.arOutstanding.toLocaleString()} |\n` +
            `| AR Overdue | **$${f.arOverdue.toLocaleString()}** (${f.arOverdueCount} invoices) |\n` +
            `| AP Due This Week | $${f.apDueThisWeek.toLocaleString()} |\n\n` +
            `Revenue is **up 14%** vs last month. Your biggest concern is $${f.arOverdue.toLocaleString()} in overdue AR.`,
          actions: [
            { label: 'Start collections on overdue', variant: 'default' },
            { label: 'Email revenue report', variant: 'outline' },
            { label: 'View full analytics', variant: 'outline' },
          ],
        };
      },
    },
    {
      name: 'overdue',
      keywords: ['overdue', 'collection', 'outstanding', 'unpaid', 'late', 'ar', 'aging', 'owed', 'past due', 'delinquent'],
      handler: () => {
        const invoices = financeOverview.overdueInvoices;
        return {
          content: `**${invoices.length} Overdue Invoices** — $${financeOverview.arOverdue.toLocaleString()} total\n\n` +
            invoices.map((i) =>
              `**${i.invoiceNumber}** · ${i.customer}\n↳ ${i.service} · **$${i.amount.toLocaleString()}** · ${i.daysOverdue} days overdue`
            ).join('\n\n') +
            `\n\nCollections Agent has sent automated reminders for all three. Pacific Ridge HOA is the most urgent at 45 days.`,
          actions: [
            { label: 'Escalate Pacific Ridge to phone call', variant: 'destructive' },
            { label: 'Send reminders to all', variant: 'default' },
            { label: 'Generate aging report', variant: 'outline' },
          ],
        };
      },
    },
    {
      name: 'quotes',
      keywords: ['quote', 'quotes', 'estimate', 'estimates', 'pipeline', 'proposal', 'bid', 'follow up', 'followup', 'pending quote'],
      handler: () => {
        const stages = quotesPipeline.stages;
        const total = stages.reduce((a, s) => a + s.count, 0);
        return {
          content: `**Quotes Pipeline** — ${total} total\n\n` +
            stages.map((s) => `**${s.name}:** ${s.count}`).join(' → ') +
            `\n\n**Recent quotes:**\n` +
            quotesPipeline.recentQuotes.map((q) =>
              `- **${q.customer}** · ${q.service} · $${q.amount.toLocaleString()} · *${q.status}* · ${q.date}`
            ).join('\n') +
            `\n\n💡 Maria Santos' **$12,800 repipe** quote was *Viewed* — high close probability. Follow up now?`,
          actions: [
            { label: 'Follow up on Maria Santos', variant: 'default' },
            { label: 'Follow up on all viewed quotes', variant: 'outline' },
            { label: 'Create new quote', variant: 'outline' },
          ],
        };
      },
    },
    {
      name: 'problems',
      keywords: ['behind', 'delayed', 'problem', 'issue', 'wrong', 'attention', 'urgent', 'alert', 'flag', 'concern', 'risk', 'worry'],
      handler: () => ({
        content: `**Items Needing Attention:**\n\n` +
          `🔴 **High Priority:**\n` +
          `1. **Lisa Park callback** — drain backed up again since last week. Phone call 1 hour ago. Needs return visit today.\n` +
          `2. **Angela Rivera (new lead)** — sewer smell, needs emergency inspection. Called 30 min ago.\n` +
          `3. **Pacific Ridge HOA** — INV-1847, $3,400, 45 days overdue. Collections has sent 3 reminders.\n\n` +
          `🟡 **Medium Priority:**\n` +
          `4. **Mike R. scheduling conflict** — drain callback at 8 AM + emergency burst pipe at 2:30 PM\n` +
          `5. **3 quotes expiring this week** — $28,450 total pipeline value at risk\n` +
          `6. **AP due this week** — $8,900 to parts suppliers`,
        actions: [
          { label: 'Handle Lisa Park callback', variant: 'default' },
          { label: 'Schedule Angela Rivera', variant: 'default' },
          { label: 'Reassign Mike\'s emergency', variant: 'outline' },
          { label: 'Escalate Pacific Ridge', variant: 'destructive' },
        ],
      }),
    },
    {
      name: 'customers',
      keywords: ['customer', 'request', 'lead', 'crm', 'inbox', 'message', 'call', 'contact', 'who called', 'communication'],
      handler: () => ({
        content: `**Customer Requests** — ${customerRequests.length} active\n\n` +
          customerRequests.map((r) => {
            const icon = r.priority === 'High' ? '🔴' : r.priority === 'Medium' ? '🟡' : '🟢';
            return `${icon} **${r.customer}** · ${r.channel} · ${r.time}\n↳ "${r.request}"`;
          }).join('\n\n') +
          `\n\n**2 new leads** waiting for quotes (Mark Torres, Angela Rivera).`,
        actions: [
          { label: 'Reply to Lisa Park', variant: 'default' },
          { label: 'Schedule Angela Rivera', variant: 'default' },
          { label: 'Create quote for Mark Torres', variant: 'outline' },
        ],
      }),
    },
    {
      name: 'agents',
      keywords: ['agent', 'agents', 'performance', 'how are', 'status', 'ai status', 'bot', 'automation'],
      handler: () => {
        const a = agentPerformance;
        return {
          content: `**AI Agent Status:**\n\n` +
            `✅ **Invoice Agent** — ${a.invoice.actionsToday} actions today · ${a.invoice.accuracy}% accuracy · ${a.invoice.pendingReview} pending review\n\n` +
            `✅ **Estimate Agent** — ${a.estimate.actionsToday} actions today · ${a.estimate.accuracy}% accuracy · ${a.estimate.draftsInProgress} drafts in progress\n\n` +
            `✅ **Collections Agent** — ${a.collections.actionsToday} actions today · ${a.collections.recoveryRate}% recovery rate · ${a.collections.escalationsPending} escalations pending\n\n` +
            `✅ **Field Ops Agent** — ${a.fieldOps.actionsToday} actions today · ${a.fieldOps.scheduleAdherence}% schedule adherence · ${a.fieldOps.openConflicts} open conflict\n\n` +
            `All agents are **Active** and running. Collective accuracy: **${((a.invoice.accuracy + a.estimate.accuracy) / 2).toFixed(0)}%**`,
          actions: [
            { label: 'View Invoice Agent', variant: 'outline' },
            { label: 'View all agent details', variant: 'outline' },
          ],
        };
      },
    },
    {
      name: 'routes',
      keywords: ['route', 'optimize', 'driving', 'direction', 'distance', 'dispatch', 'assign', 'reassign', 'send tech', 'available tech'],
      handler: () => ({
        content: `**Optimized Tech Routes for Today:**\n\n` +
          `**Mike R.** (2 jobs — ⚠️ conflict):\n` +
          `1. 8:00 AM — Lisa Park, 4421 E Camelback Rd (drain callback)\n` +
          `2. 2:30 PM — Karen White, 3301 S Mill Ave (emergency burst pipe)\n\n` +
          `**Tony M.** (1 job):\n` +
          `1. 9:00 AM — James Cooper, 1892 W Glendale Ave (tankless water heater)\n\n` +
          `**Carlos S.** (1 job):\n` +
          `1. 10:30 AM — Phoenix Office Park, 2200 N Central (backflow test)\n\n` +
          `**Alex P.** (1 job):\n` +
          `1. 12:00 PM — David Chen, 7734 N Scottsdale Rd (slab leak detection)\n\n` +
          `**Jesse L.** (1 job — has capacity):\n` +
          `1. 3:00 PM — Frank Nguyen, 5510 E Thomas Rd (disposal replacement)\n\n` +
          `💡 Jesse finishes around 1:30 PM and is 15 min from Mill Ave. Reassign Mike's 2:30 emergency to Jesse?`,
        actions: [
          { label: 'Reassign Mike → Jesse for 2:30 PM', variant: 'default' },
          { label: 'Keep current assignments', variant: 'outline' },
        ],
      }),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Suggestion chips                                                   */
/* ------------------------------------------------------------------ */

const quickActions = [
  { label: "Today's schedule", icon: Calendar },
  { label: 'Create an invoice', icon: FileText },
  { label: 'Revenue report', icon: DollarSign },
  { label: 'Overdue invoices', icon: AlertTriangle },
  { label: 'Quote pipeline', icon: TrendingUp },
  { label: "What needs attention?", icon: Wrench },
];

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hey Dan! Here's your morning briefing for **Espinoza Plumbing Co.**:\n\n` +
        `📋 **${jobsPipeline.todaysJobs.length} jobs** on the schedule today (${jobsPipeline.todaysJobs.filter(j => j.status === 'In Progress').length} in progress)\n` +
        `📊 **${quotesPipeline.stages.reduce((a, s) => a + s.count, 0)} quotes** in the pipeline ($${quotesPipeline.recentQuotes.reduce((a, q) => a + q.amount, 0).toLocaleString()} value)\n` +
        `💰 **$${(financeOverview.revenueMTD / 1000).toFixed(0)}K revenue** this month (+14%)\n` +
        `⚠️ **${financeOverview.arOverdueCount} overdue invoices** ($${(financeOverview.arOverdue / 1000).toFixed(1)}K)\n` +
        `🔔 **${customerRequests.filter(r => r.priority === 'High').length} high-priority** customer requests\n\n` +
        `What would you like to tackle first?`,
      timestamp: 'Just now',
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const intents = useRef(buildIntents());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleActionClick = useCallback(async (messageId: string, actionIdx: number) => {
    // Mark action as processing
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.actions) return m;
      const newActions = [...m.actions];
      newActions[actionIdx] = { ...newActions[actionIdx], label: 'Processing...' };
      return { ...m, actions: newActions };
    }));

    // Simulate AI doing the action
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));

    // Mark as done
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId || !m.actions) return m;
      const newActions = [...m.actions];
      const action = newActions[actionIdx];
      newActions[actionIdx] = { ...action, done: true, label: action.label.replace('Processing...', ''), result: 'Done' };
      return { ...m, actions: newActions };
    }));

    // Add confirmation message
    const msg = messages.find((m) => m.id === messageId);
    const actionLabel = msg?.actions?.[actionIdx]?.label || 'Action';

    const confirmationMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `✅ **Done!** ${actionLabel.replace('Processing...', '')} has been completed.\n\nThe relevant agent has been notified and is processing the request. You'll see updates in the activity feed.`,
      timestamp: 'Just now',
    };

    setMessages((prev) => [...prev, confirmationMessage]);

    toast.success('Action completed', {
      description: actionLabel.replace('Processing...', ''),
    });
  }, [messages]);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: 'Just now',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate thinking
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));

    // Match intent
    const intent = matchIntent(messageText, intents.current);

    let response: { content: string; actions?: MessageAction[]; data?: MessageData };

    if (intent) {
      response = intent.handler();
    } else {
      // Fallback: still try to be helpful
      response = {
        content: `I understand you're asking about "${messageText}". Let me help with that.\n\n` +
          `Here's what I can do right now:\n\n` +
          `- **Create invoices** — "Create an invoice for Lisa Park"\n` +
          `- **Check schedule** — "What's on today?"\n` +
          `- **Revenue/finance** — "How's revenue this month?"\n` +
          `- **Collections** — "Any overdue invoices?"\n` +
          `- **Quotes** — "Quote pipeline status"\n` +
          `- **Customer requests** — "Who's called today?"\n` +
          `- **Tech routing** — "Optimize today's routes"\n` +
          `- **Agent status** — "How are the agents doing?"\n\n` +
          `Try asking in a different way, or click one of the quick actions below!`,
        actions: [
          { label: 'Show me everything', variant: 'default' },
          { label: "What needs attention?", variant: 'outline' },
        ],
      };
    }

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: response.content,
      timestamp: 'Just now',
      actions: response.actions,
      data: response.data,
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render markdown-like content
  const renderContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      let html = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');

      if (line.startsWith('- ')) {
        return <li key={i} className="ml-4 list-disc text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html.slice(2) }} />;
      }
      if (line.startsWith('↳')) {
        return <p key={i} className="text-xs text-text-tertiary ml-1 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      if (line.startsWith('|') && line.includes('|')) {
        // Table row
        if (line.includes('---')) return null; // separator
        const cells = line.split('|').filter(Boolean).map((c) => c.trim());
        const isHeader = i > 0 && content.split('\n')[i + 1]?.includes('---');
        return (
          <div key={i} className={cn('grid gap-2 text-xs py-1', `grid-cols-${cells.length}`, isHeader && 'font-semibold border-b border-border-subtle')}>
            {cells.map((cell, ci) => (
              <span key={ci} className={ci === 0 ? 'text-text-tertiary' : 'text-text-primary'} dangerouslySetInnerHTML={{ __html: cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            ))}
          </div>
        );
      }
      if (line.match(/^\d+\./)) {
        return <p key={i} className="text-sm leading-relaxed ml-1" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      if (line.trim() === '') return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  return (
    <>
      <Header title="Copilot" subtitle="AI Operations Assistant" />
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex items-start gap-3',
                  message.role === 'user' && 'flex-row-reverse',
                )}
              >
                <div
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full mt-1',
                    message.role === 'assistant' ? 'bg-accent-50' : 'bg-text-primary',
                  )}
                >
                  {message.role === 'assistant' ? (
                    <Bot className="h-4 w-4 text-accent-500" />
                  ) : (
                    <User className="h-4 w-4 text-text-inverse" />
                  )}
                </div>

                <div className={cn('max-w-[85%] space-y-2')}>
                  <div
                    className={cn(
                      'px-4 py-3',
                      message.role === 'assistant'
                        ? 'bg-surface-bg0 text-text-secondary rounded-2xl rounded-tl-sm shadow-1'
                        : 'bg-accent-600 text-text-inverse rounded-2xl rounded-tr-sm',
                    )}
                  >
                    {renderContent(message.content)}
                  </div>

                  {/* Action buttons */}
                  {message.actions && message.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-1">
                      {message.actions.map((action, idx) => (
                        <Button
                          key={idx}
                          variant={action.done ? 'ghost' : (action.variant as 'default' | 'outline' | 'destructive')}
                          size="sm"
                          disabled={action.done || action.label === 'Processing...'}
                          onClick={() => handleActionClick(message.id, idx)}
                          className={cn(
                            'gap-1.5 text-xs',
                            action.done && 'text-success-text',
                          )}
                        >
                          {action.label === 'Processing...' ? (
                            <><Loader2 className="h-3 w-3 animate-spin" /> Processing...</>
                          ) : action.done ? (
                            <><CheckCircle2 className="h-3 w-3" /> {action.result || 'Done'}</>
                          ) : (
                            action.label
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            <AnimatePresence>
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-50 mt-1">
                    <Bot className="h-4 w-4 text-accent-500" />
                  </div>
                  <div className="bg-surface-bg0 rounded-2xl rounded-tl-sm shadow-1 px-4 py-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-accent-500" />
                    <span className="text-sm text-text-tertiary">Analyzing your data...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Quick actions */}
        {messages.length <= 1 && (
          <div className="px-6 pb-3">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-accent-500" />
                <p className="text-xs font-medium text-text-tertiary">Quick actions</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {quickActions.map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <button
                      key={qa.label}
                      onClick={() => handleSend(qa.label)}
                      className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-bg0 px-3 py-2.5 text-left text-xs text-text-primary shadow-1 transition-all duration-200 hover:bg-surface-bg1 hover:shadow-2"
                    >
                      <Icon className="h-4 w-4 text-accent-500 flex-shrink-0" />
                      <span>{qa.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border-subtle bg-surface-bg0 p-4">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your business..."
              className="flex h-11 w-full flex-1 rounded-lg border border-border bg-surface-bg0 px-4 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:border-accent-500 transition-all duration-200"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              aria-label="Send message"
              className="h-11 w-11 rounded-lg bg-accent-600 text-text-inverse hover:bg-accent-700 disabled:opacity-50 inline-flex items-center justify-center transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
