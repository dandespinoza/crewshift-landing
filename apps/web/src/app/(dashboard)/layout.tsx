'use client';

import { useState, useCallback } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileMenuProvider } from '@/components/layout/mobile-menu-context';
import { CopilotTrigger } from '@/components/copilot/copilot-trigger';

/* ------------------------------------------------------------------ */
/*  Dashboard layout                                                   */
/* ------------------------------------------------------------------ */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openMobileMenu = useCallback(() => setMobileMenuOpen(true), []);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  return (
    <MobileMenuProvider value={openMobileMenu}>
      <div className="flex h-screen overflow-hidden bg-surface-bg1">
        {/* Dark sidebar */}
        <Sidebar isOpen={mobileMenuOpen} onClose={closeMobileMenu} />

        {/* Main content area — slightly gray bg so white cards pop */}
        <main
          id="main-content"
          className="flex-1 overflow-y-auto"
        >
          {children}
        </main>

        {/* Floating copilot button — always visible */}
        <CopilotTrigger hasNotification />
      </div>
    </MobileMenuProvider>
  );
}
