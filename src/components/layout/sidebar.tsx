'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  BarChart3,
  FileText,
  Calculator,
  DollarSign,
  Wrench,
  GitBranch,
  Briefcase,
  Receipt,
  Users,
  Settings,
  LogOut,
  X,
  MessageSquare,
  Plug,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

/* ------------------------------------------------------------------ */
/*  Navigation structure                                                */
/* ------------------------------------------------------------------ */

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

type NavGroup = {
  section: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    section: 'Agents',
    items: [
      { label: 'Invoice Agent', href: '/agents/invoice', icon: FileText },
      { label: 'Estimate Agent', href: '/agents/estimate', icon: Calculator },
      { label: 'Collections', href: '/agents/collections', icon: DollarSign },
      { label: 'Field Ops', href: '/agents/field-ops', icon: Wrench },
    ],
  },
  {
    section: 'Automation',
    items: [
      { label: 'Workflows', href: '/workflows', icon: GitBranch },
    ],
  },
  {
    section: 'Data',
    items: [
      { label: 'Jobs', href: '/jobs', icon: Briefcase },
      { label: 'Invoices', href: '/invoices', icon: Receipt },
      { label: 'Customers', href: '/customers', icon: Users },
    ],
  },
  {
    section: 'System',
    items: [
      { label: 'Integrations', href: '/integrations', icon: Plug },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  /** Mobile drawer open state (controlled by layout) */
  isOpen?: boolean;
  /** Callback to close the mobile drawer */
  onClose?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                             */
/* ------------------------------------------------------------------ */

function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  /* ================================================================ */
  /*  Nav item                                                          */
  /* ================================================================ */

  const renderNavItem = (item: NavItem, showLabel: boolean) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-md text-[13px] transition-all duration-150',
          showLabel ? 'px-3 py-2' : 'justify-center p-2.5',
          active
            ? 'text-sidebar-text-active font-bold'
            : 'text-sidebar-text font-normal hover:text-sidebar-text-hover hover:font-semibold',
        )}
        onClick={onClose}
      >
        <Icon className="h-[18px] w-[18px] flex-shrink-0" />

        {showLabel && <span className="flex-1">{item.label}</span>}

        {/* Tooltip for icon-only rail */}
        {!showLabel && (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md bg-sidebar-bg px-3 py-1.5 text-xs font-medium text-sidebar-text-active opacity-0 shadow-3 ring-1 ring-sidebar-border transition-opacity duration-150 group-hover:opacity-100"
          >
            {item.label}
          </span>
        )}
      </Link>
    );
  };

  /* ================================================================ */
  /*  Copilot shortcut                                                  */
  /* ================================================================ */

  const renderCopilot = (showLabel: boolean) => {
    const active = isActive('/copilot');

    return (
      <Link
        href="/copilot"
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-md text-[13px] transition-all duration-150',
          showLabel ? 'px-3 py-2' : 'justify-center p-2.5',
          active
            ? 'text-sidebar-text-active font-bold'
            : 'text-sidebar-text font-normal hover:text-sidebar-text-hover hover:font-semibold',
        )}
        onClick={onClose}
      >
        <MessageSquare className="h-[18px] w-[18px] flex-shrink-0 text-accent-500" />

        {showLabel && <span className="flex-1">Copilot</span>}

        {!showLabel && (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md bg-sidebar-bg px-3 py-1.5 text-xs font-medium text-sidebar-text-active opacity-0 shadow-3 ring-1 ring-sidebar-border transition-opacity duration-150 group-hover:opacity-100"
          >
            Copilot
          </span>
        )}
      </Link>
    );
  };

  /* ================================================================ */
  /*  Sign-out button                                                   */
  /* ================================================================ */

  const renderSignOut = (showLabel: boolean) => (
    <button
      onClick={handleSignOut}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-md text-[13px] font-normal text-sidebar-text transition-all duration-150 hover:text-red-400 hover:font-semibold',
        showLabel ? 'px-3 py-2' : 'justify-center p-2.5',
      )}
    >
      <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
      {showLabel && <span>Sign out</span>}

      {!showLabel && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md bg-sidebar-bg px-3 py-1.5 text-xs font-medium text-sidebar-text-active opacity-0 shadow-3 ring-1 ring-sidebar-border transition-opacity duration-150 group-hover:opacity-100"
        >
          Sign out
        </span>
      )}
    </button>
  );

  /* ================================================================ */
  /*  Section label / divider                                           */
  /* ================================================================ */

  const renderSectionLabel = (label: string, showLabel: boolean) =>
    showLabel ? (
      <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-text/40 first:mt-2">
        {label}
      </p>
    ) : (
      <div className="my-2 mx-2 border-t border-sidebar-border" />
    );

  /* ================================================================ */
  /*  Logo                                                              */
  /* ================================================================ */

  const renderLogo = (compact: boolean, withClose = false) => (
    <div
      className={cn(
        'flex items-center border-b border-sidebar-border',
        compact ? 'h-16 justify-center px-2' : 'h-[72px] px-5',
        withClose && 'justify-between',
      )}
    >
      <Link
        href="/dashboard"
        className="flex items-center"
        onClick={onClose}
      >
        <Image
          src="/logo-light.svg"
          alt="CrewShift"
          width={compact ? 32 : 160}
          height={compact ? 32 : 50}
          className={compact ? 'h-8 w-auto' : 'h-[38px] w-auto'}
          priority
        />
      </Link>

      {withClose && (
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-text transition-colors duration-150 hover:text-sidebar-text-active"
          aria-label="Close navigation menu"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  /* ================================================================ */
  /*  Nav content (shared between desktop, tablet, mobile)             */
  /* ================================================================ */

  const renderNavContent = (showLabel: boolean) => (
    <>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2.5 py-3">
        {navGroups.map((group, groupIndex) => (
          <div key={group.section}>
            {renderSectionLabel(group.section, showLabel)}
            <div className={cn('space-y-0.5', groupIndex < navGroups.length - 1 && 'mb-1')}>
              {group.items.map((item) => renderNavItem(item, showLabel))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-2.5 py-3 space-y-0.5">
        {renderCopilot(showLabel)}
        {renderSignOut(showLabel)}
      </div>
    </>
  );

  /* ================================================================ */
  /*  Desktop sidebar (lg+): w-60, full labels                         */
  /* ================================================================ */

  const desktopSidebar = (
    <aside className="hidden lg:flex h-screen w-60 flex-col bg-sidebar-bg">
      {renderLogo(false)}
      {renderNavContent(true)}
    </aside>
  );

  /* ================================================================ */
  /*  Tablet rail (md to lg): w-[60px], icon-only with tooltips        */
  /* ================================================================ */

  const tabletRail = (
    <aside className="hidden md:flex lg:hidden h-screen w-[60px] flex-col bg-sidebar-bg">
      {renderLogo(true)}
      {renderNavContent(false)}
    </aside>
  );

  /* ================================================================ */
  /*  Mobile drawer (<md): slide-out with Framer Motion                */
  /* ================================================================ */

  const mobileDrawer = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <motion.aside
            key="sidebar-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar-bg shadow-3 md:hidden"
          >
            {renderLogo(false, true)}
            {renderNavContent(true)}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  /* ================================================================ */
  /*  Render                                                            */
  /* ================================================================ */

  return (
    <>
      {desktopSidebar}
      {tabletRail}
      {mobileDrawer}
    </>
  );
}

export { Sidebar };
