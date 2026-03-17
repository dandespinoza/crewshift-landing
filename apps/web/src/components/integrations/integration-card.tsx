'use client';

import Link from 'next/link';
import {
  CreditCard, Phone, Calendar, Truck, Calculator, Shield,
  Wrench, Users, FileText, Ruler, FolderKanban, Package,
  ShieldCheck, GraduationCap, Star, FileSignature, ClipboardCheck,
  Puzzle, Building2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConnectionStatusIndicator } from './connection-status';
import { cn } from '@/lib/utils';
import type { IntegrationEntry, ConnectionStatus, IntegrationTier } from '@/lib/integrations/types';

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

const tierBadgeVariant: Record<IntegrationTier, 'success' | 'accent' | 'warning' | 'danger' | 'info' | 'default'> = {
  1: 'success',
  2: 'accent',
  3: 'info',
  4: 'warning',
  5: 'danger',
  6: 'default',
};

const tierLabel: Record<IntegrationTier, string> = {
  1: 'Instant',
  2: 'Dev Account',
  3: 'Apply',
  4: 'Paid',
  5: 'Partner',
  6: 'Special',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

interface IntegrationCardProps {
  integration: IntegrationEntry;
  status?: ConnectionStatus;
  className?: string;
}

export function IntegrationCard({ integration, status = 'disconnected', className }: IntegrationCardProps) {
  const Icon = categoryIcons[integration.category] || Puzzle;

  return (
    <Link href={`/integrations/${integration.slug}`}>
      <Card interactive className={cn('h-full', className)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-bg1">
              <Icon className="h-5 w-5 text-text-secondary" />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {integration.name}
                </h3>
                <Badge variant={tierBadgeVariant[integration.tier]} size="sm">
                  {tierLabel[integration.tier]}
                </Badge>
              </div>

              <p className="mt-0.5 line-clamp-2 text-xs text-text-tertiary">
                {integration.description}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <ConnectionStatusIndicator status={status} />
                {integration.webhookSupport && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                    Webhooks
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
