'use client';

import { Bot, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const agents = [
  {
    name: 'Dispatch Agent',
    description: 'Automatically assigns technicians to jobs based on skills, location, and availability.',
    status: 'active' as const,
    actionsToday: 18,
    accuracy: '94%',
  },
  {
    name: 'Billing Agent',
    description: 'Generates invoices from completed jobs and tracks payment status.',
    status: 'active' as const,
    actionsToday: 12,
    accuracy: '98%',
  },
  {
    name: 'Comms Agent',
    description: 'Handles customer communications including scheduling confirmations and follow-ups.',
    status: 'active' as const,
    actionsToday: 34,
    accuracy: '96%',
  },
  {
    name: 'Inventory Agent',
    description: 'Monitors parts inventory levels and flags items needing reorder.',
    status: 'paused' as const,
    actionsToday: 0,
    accuracy: '91%',
  },
];

const reviewQueue = [
  {
    id: 'RQ-001',
    agent: 'Dispatch Agent',
    action: 'Assign Mike Torres to emergency HVAC repair at Apex Properties',
    priority: 'high' as const,
    timestamp: '2 min ago',
  },
  {
    id: 'RQ-002',
    agent: 'Billing Agent',
    action: 'Generate invoice for $3,800 - Panel Upgrade at Summit Office Park',
    priority: 'medium' as const,
    timestamp: '8 min ago',
  },
  {
    id: 'RQ-003',
    agent: 'Comms Agent',
    action: 'Send rescheduling notice to Metro Residential for plumbing job',
    priority: 'low' as const,
    timestamp: '15 min ago',
  },
  {
    id: 'RQ-004',
    agent: 'Dispatch Agent',
    action: 'Reassign 3 afternoon jobs due to technician sick leave',
    priority: 'high' as const,
    timestamp: '22 min ago',
  },
];

export default function AgentsPage() {
  return (
    <>
      <Header title="Agents" />
      <div className="p-6 space-y-6">
        {/* Agent cards */}
        <div>
          <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">
            AI Agents
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {agents.map((agent) => (
              <Card key={agent.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-50">
                      <Bot className="h-4 w-4 text-accent-500" />
                    </div>
                    <Badge variant={agent.status === 'active' ? 'success' : 'default'}>
                      {agent.status === 'active' ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-text-tertiary mb-3">
                    {agent.description}
                  </p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-tertiary">
                      {agent.actionsToday} actions today
                    </span>
                    <span className="font-medium text-text-primary">
                      {agent.accuracy} accuracy
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Review queue */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Review Queue
            </h2>
            <Badge variant="accent">
              {reviewQueue.length} pending
            </Badge>
          </div>
          <div className="space-y-3">
            {reviewQueue.map((item) => (
              <div
                key={item.id}
                className="border border-border rounded-md p-4 flex items-center justify-between"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="mt-0.5">
                    {item.priority === 'high' ? (
                      <AlertTriangle className="h-4 w-4 text-danger-text" />
                    ) : item.priority === 'medium' ? (
                      <Clock className="h-4 w-4 text-warning-text" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-text-tertiary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{item.action}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-accent-600">{item.agent}</span>
                      <span className="text-xs text-text-tertiary">{item.timestamp}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button variant="outline" size="sm">
                    Reject
                  </Button>
                  <Button variant="default" size="sm">
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
