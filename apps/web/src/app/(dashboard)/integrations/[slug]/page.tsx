'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, Globe, BookOpen, Zap, Clock,
  Shield, CreditCard, Phone, Calendar, Truck, Calculator,
  Wrench, Users, FileText, Ruler, FolderKanban, Package,
  ShieldCheck, GraduationCap, Star, FileSignature, ClipboardCheck,
  Puzzle, Building2,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectionStatusIndicator } from '@/components/integrations/connection-status';
import { OAuthConnectButton } from '@/components/integrations/oauth-connect-button';
import { ApiKeyForm } from '@/components/integrations/api-key-form';
import { WebhookConfig } from '@/components/integrations/webhook-config';
import { cn } from '@/lib/utils';
import { getIntegrationBySlug, CATEGORY_LABELS, TIER_LABELS } from '@/lib/integrations/registry';
import { testConnection } from '@/lib/integrations/oauth';
import type { ConnectionStatus } from '@/lib/integrations/types';

/* ------------------------------------------------------------------ */
/*  Icon mapping                                                        */
/* ------------------------------------------------------------------ */

const categoryIcons: Record<string, React.ElementType> = {
  payments: CreditCard,
  communication: Phone,
  scheduling: Calendar,
  fleet: Truck,
  accounting: Calculator,
  government: Shield,
  fsm: Wrench,
  crm: Users,
  estimating: FileText,
  measurement: Ruler,
  project_management: FolderKanban,
  inventory: Package,
  insurance: ShieldCheck,
  surety: Building2,
  training: GraduationCap,
  reputation: Star,
  proposals: FileSignature,
  compliance: ClipboardCheck,
  specialty: Puzzle,
};

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function IntegrationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const integration = getIntegrationBySlug(slug);

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  if (!integration) {
    return (
      <>
        <Header title="Integration Not Found" />
        <div className="flex flex-col items-center justify-center p-16 text-center">
          <p className="text-sm text-text-tertiary">
            No integration found with slug &quot;{slug}&quot;
          </p>
          <Link href="/integrations" className="mt-4 text-sm font-medium text-accent-600 hover:text-accent-700">
            Back to integrations
          </Link>
        </div>
      </>
    );
  }

  const Icon = categoryIcons[integration.category] || Puzzle;
  const tierInfo = TIER_LABELS[integration.tier];
  const isOAuth = integration.authType === 'oauth2';

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(integration.slug);
    setTestResult(result);
    setTesting(false);
  };

  return (
    <>
      <Header title={integration.name} subtitle={CATEGORY_LABELS[integration.category]} />

      <div className="p-6 space-y-6">
        {/* Back link */}
        <Link
          href="/integrations"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All integrations
        </Link>

        {/* Hero section */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface-bg1">
            <Icon className="h-8 w-8 text-text-secondary" />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-text-primary">{integration.name}</h2>
              <ConnectionStatusIndicator status={status} />
            </div>
            <p className="text-sm text-text-secondary">{integration.description}</p>

            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="accent">{CATEGORY_LABELS[integration.category]}</Badge>
              <Badge>Tier {integration.tier}: {tierInfo.name}</Badge>
              {integration.webhookSupport && <Badge variant="info">Webhooks</Badge>}
              <Badge>{integration.authType.replace('_', ' ').toUpperCase()}</Badge>
            </div>
          </div>

          {/* External links */}
          <div className="flex shrink-0 gap-2">
            <a
              href={`https://${integration.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <Globe className="h-3.5 w-3.5" />
              Website
            </a>
            <a
              href={integration.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              API Docs
            </a>
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column: Connection */}
          <div className="lg:col-span-2 space-y-6">
            {/* Authentication */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Authentication</CardTitle>
              </CardHeader>
              <CardContent>
                {isOAuth ? (
                  <div className="space-y-4">
                    <p className="text-sm text-text-tertiary">
                      This integration uses OAuth 2.0. Click the button below to authorize CrewShift
                      to access your {integration.name} account.
                    </p>
                    <OAuthConnectButton
                      provider={integration.slug}
                      status={status}
                      onStatusChange={setStatus}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-text-tertiary">
                      Enter your {integration.name} API credentials below. Credentials are encrypted
                      at rest.
                    </p>
                    <ApiKeyForm
                      provider={integration.slug}
                      authType={integration.authType}
                      status={status}
                      onStatusChange={setStatus}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Webhooks */}
            {integration.webhookSupport && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Webhooks</CardTitle>
                </CardHeader>
                <CardContent>
                  <WebhookConfig
                    provider={integration.slug}
                    webhookSupport={integration.webhookSupport}
                  />
                </CardContent>
              </Card>
            )}

            {/* Test connection */}
            {status === 'connected' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Test Connection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-text-tertiary">
                    Verify that CrewShift can communicate with {integration.name}.
                  </p>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" loading={testing} onClick={handleTest}>
                      <Zap className="mr-1.5 h-3.5 w-3.5" />
                      Test connection
                    </Button>
                    {testResult && (
                      <span className={cn('text-sm font-medium', testResult.success ? 'text-green-600' : 'text-red-600')}>
                        {testResult.success ? 'Connection successful' : testResult.error}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: Info */}
          <div className="space-y-6">
            {/* Details card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
                  <div>
                    <p className="text-xs font-medium text-text-primary">Rate Limits</p>
                    <p className="text-xs text-text-tertiary">{integration.rateLimits}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
                  <div>
                    <p className="text-xs font-medium text-text-primary">Auth Method</p>
                    <p className="text-xs text-text-tertiary">
                      {integration.authType.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
                  <div>
                    <p className="text-xs font-medium text-text-primary">API Base URL</p>
                    <p className="break-all text-xs text-text-tertiary">{integration.apiBaseUrl}</p>
                  </div>
                </div>

                {integration.notes && (
                  <div className="rounded-md border border-border bg-surface-bg1 p-3">
                    <p className="text-xs text-text-secondary">{integration.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Supported trades */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Supported Trades</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {integration.trades.map((trade) => (
                    <Badge key={trade} size="sm">
                      {trade === 'all'
                        ? 'All trades'
                        : trade.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Access tier info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Access Requirements</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium text-text-primary">
                  Tier {integration.tier}: {tierInfo.name}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">{tierInfo.description}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
