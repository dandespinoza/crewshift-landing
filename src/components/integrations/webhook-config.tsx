'use client';

import { useState } from 'react';
import { Copy, Check, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWebhookUrl } from '@/lib/integrations/webhook';

interface WebhookConfigProps {
  provider: string;
  webhookSupport: boolean;
}

export function WebhookConfig({ provider, webhookSupport }: WebhookConfigProps) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = getWebhookUrl(provider);

  if (!webhookSupport) {
    return (
      <div className="rounded-md border border-border bg-surface-bg1 px-4 py-3">
        <p className="text-sm text-text-tertiary">
          This integration does not support webhooks. Data will be synced on a schedule.
        </p>
      </div>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Webhook className="h-4 w-4 text-text-secondary" />
        <h4 className="text-sm font-medium text-text-primary">Webhook Endpoint</h4>
      </div>

      <p className="text-xs text-text-tertiary">
        Copy this URL and paste it into your {provider} webhook settings.
      </p>

      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md border border-border bg-surface-bg1 px-3 py-2 text-xs text-text-secondary">
          {webhookUrl}
        </code>
        <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
