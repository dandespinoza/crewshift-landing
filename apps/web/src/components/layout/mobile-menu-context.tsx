'use client';

import { createContext, useContext } from 'react';

/* ------------------------------------------------------------------ */
/*  Mobile menu context                                                */
/* ------------------------------------------------------------------ */

/**
 * Context that carries the "open mobile menu" callback from the
 * dashboard layout down to any Header rendered inside a page.
 */
const MobileMenuContext = createContext<(() => void) | undefined>(undefined);

/**
 * Provider -- wrap children in the dashboard layout.
 */
const MobileMenuProvider = MobileMenuContext.Provider;

/**
 * Hook consumed by Header (or any child) to get the mobile-menu toggle.
 * Returns `undefined` when not inside a dashboard layout (safe to ignore).
 */
function useMobileMenuToggle() {
  return useContext(MobileMenuContext);
}

export { MobileMenuProvider, useMobileMenuToggle };
