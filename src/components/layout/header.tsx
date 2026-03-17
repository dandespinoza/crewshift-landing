'use client';

import { Search, Bell, User, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileMenuToggle } from '@/components/layout/mobile-menu-context';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface HeaderProps {
  /** Page title displayed on the left */
  title: string;
  /** Optional subtitle / description */
  subtitle?: string;
  /** Callback fired when the mobile hamburger is pressed. */
  onMobileMenuToggle?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({ title, subtitle, onMobileMenuToggle: onToggleProp }: HeaderProps) {
  const contextToggle = useMobileMenuToggle();
  const onMobileMenuToggle = onToggleProp ?? contextToggle;

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border-subtle bg-white/80 px-4 backdrop-blur-md sm:px-6">
      {/* Left section: hamburger + title */}
      <div className="flex items-center gap-3">
        {/* Mobile hamburger -- visible below md */}
        {onMobileMenuToggle && (
          <button
            onClick={onMobileMenuToggle}
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors duration-200 hover:bg-surface-bg2 hover:text-text-primary md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <div>
          <h1 className="text-lg font-bold tracking-tight text-text-primary">{title}</h1>
          {subtitle && (
            <p className="text-xs text-text-tertiary">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Right section: search, notifications, avatar */}
      <div className="flex items-center gap-1.5">
        {/* Search -- hidden below md */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            placeholder="Search..."
            aria-label="Search"
            className={cn(
              'h-9 w-56 rounded-md border border-border-subtle bg-surface-bg1 pl-9 pr-3 text-sm text-text-primary',
              'placeholder:text-text-tertiary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:border-accent-500',
              'transition-all duration-200',
            )}
          />
        </div>

        {/* Notification bell */}
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors duration-200 hover:bg-surface-bg2 hover:text-text-primary"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          {/* Badge dot */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-white" />
          <span className="sr-only">You have notifications</span>
        </button>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-border-subtle hidden sm:block" />

        {/* User avatar */}
        <button
          className="flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200 hover:bg-surface-bg2"
          aria-label="User menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-text-primary">
            <User className="h-3.5 w-3.5 text-text-inverse" />
          </span>
        </button>
      </div>
    </header>
  );
}

export { Header };
