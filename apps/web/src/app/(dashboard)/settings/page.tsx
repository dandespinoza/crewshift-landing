'use client';

import { useState } from 'react';
import { Plug, Users, Bell, ExternalLink } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'notifications', label: 'Notifications', icon: Bell },
] as const;

type TabId = (typeof tabs)[number]['id'];

const integrations = [
  { name: 'ServiceTitan', description: 'Sync jobs, customers, and invoices', connected: true },
  { name: 'QuickBooks', description: 'Accounting and financial data sync', connected: false },
  { name: 'Google Calendar', description: 'Technician scheduling sync', connected: true },
  { name: 'Twilio', description: 'SMS and voice communications', connected: false },
  { name: 'Stripe', description: 'Payment processing', connected: true },
  { name: 'Slack', description: 'Team notifications and alerts', connected: false },
];

const teamMembers = [
  { name: 'Dan Espinoza', email: 'dan@crewshift.ai', role: 'Owner' },
  { name: 'Mike Torres', email: 'mike@crewshift.ai', role: 'Technician' },
  { name: 'Sarah Chen', email: 'sarah@crewshift.ai', role: 'Technician' },
  { name: 'James Wright', email: 'james@crewshift.ai', role: 'Technician' },
  { name: 'Carlos Ruiz', email: 'carlos@crewshift.ai', role: 'Technician' },
];

interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

const initialNotificationSettings: NotificationSetting[] = [
  { id: 'new-job', label: 'New job assigned', description: 'When a new job is created or assigned', enabled: true },
  { id: 'job-complete', label: 'Job completed', description: 'When a technician marks a job as done', enabled: true },
  { id: 'agent-action', label: 'Agent actions', description: 'When an AI agent takes an action requiring review', enabled: true },
  { id: 'invoice-paid', label: 'Invoice paid', description: 'When a customer pays an invoice', enabled: false },
  { id: 'low-inventory', label: 'Low inventory', description: 'When parts inventory falls below threshold', enabled: true },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('integrations');
  const [notifications, setNotifications] = useState<NotificationSetting[]>(initialNotificationSettings);

  const handleToggle = (id: string, checked: boolean) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: checked } : n))
    );
  };

  return (
    <>
      <Header title="Settings" />
      <div className="p-6 space-y-6">
        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-border" role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-accent-600 text-accent-600'
                    : 'border-transparent text-text-tertiary hover:text-text-primary'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Integrations tab */}
        {activeTab === 'integrations' && (
          <div role="tabpanel" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {integrations.map((integration) => (
              <Card key={integration.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{integration.name}</CardTitle>
                    <Badge variant={integration.connected ? 'success' : 'default'}>
                      {integration.connected ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                  <CardDescription>{integration.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant={integration.connected ? 'outline' : 'default'}
                    size="sm"
                    className="w-full"
                  >
                    {integration.connected ? (
                      <>Configure</>
                    ) : (
                      <>
                        <ExternalLink className="mr-2 h-3 w-3" />
                        Connect
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Team tab */}
        {activeTab === 'team' && (
          <div role="tabpanel" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                Manage your team members and their roles
              </p>
              <Button size="sm">
                <Users className="mr-2 h-4 w-4" />
                Invite Member
              </Button>
            </div>
            <div className="rounded-lg border border-border">
              {teamMembers.map((member, idx) => (
                <div
                  key={member.email}
                  className={cn(
                    'flex items-center justify-between px-4 py-3',
                    idx !== teamMembers.length - 1 && 'border-b border-border'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-50 text-sm font-medium text-accent-600">
                      {member.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">{member.name}</p>
                      <p className="text-xs text-text-tertiary">{member.email}</p>
                    </div>
                  </div>
                  <Badge variant={member.role === 'Owner' ? 'accent' : 'default'}>
                    {member.role}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notifications tab */}
        {activeTab === 'notifications' && (
          <div role="tabpanel" className="space-y-4">
            <p className="text-sm text-text-secondary">
              Configure how and when you receive notifications
            </p>
            <div className="space-y-1">
              {notifications.map((setting) => (
                <div
                  key={setting.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{setting.label}</p>
                    <p className="text-xs text-text-tertiary">{setting.description}</p>
                  </div>
                  <Switch
                    checked={setting.enabled}
                    onCheckedChange={(checked) => handleToggle(setting.id, checked)}
                    aria-label={setting.label}
                  />
                </div>
              ))}
            </div>
            <div className="pt-4">
              <h3 className="font-heading text-base font-semibold text-text-primary mb-3">
                Email Preferences
              </h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <label htmlFor="notification-email" className="text-sm font-medium text-text-primary">
                    Notification email
                  </label>
                  <Input
                    id="notification-email"
                    type="email"
                    placeholder="you@company.com"
                    defaultValue="dan@crewshift.ai"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="settings-password" className="text-sm font-medium text-text-primary">
                    Confirm password
                  </label>
                  <Input
                    id="settings-password"
                    type="password"
                    placeholder="Enter password to save"
                    aria-describedby="password-hint"
                  />
                  <p id="password-hint" className="text-xs text-text-tertiary">
                    Enter your password to confirm changes
                  </p>
                </div>
                <Button size="sm">Save preferences</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
