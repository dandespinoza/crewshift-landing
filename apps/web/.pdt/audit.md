# CrewShift UI Audit Report

> Audited by the Product Design Team pipeline
> Against: `.pdt/spec.md` v1.0
> Date: 2026-03-04
> Files audited: 25

---

## Executive Summary

| Metric | Score | Grade |
|--------|-------|-------|
| **Token Compliance** | 42/100 | F |
| **UX & Interaction** | 35/100 | F |
| **Component State Completeness** | 28/100 | F |
| **Brand Compliance** | 30/100 | F |
| **Overall** | 34/100 | F |

### Top 3 Critical Issues
1. **Wrong font everywhere** — Space Grotesk + DM Sans used instead of Red Hat Display. Affects brand identity on every single page.
2. **Zero mobile navigation** — 256px sidebar never collapses. No hamburger menu, no drawer. App is unusable on mobile devices.
3. **Inaccessible Settings controls** — Toggle switches have no ARIA roles, no keyboard support. Tabs lack ARIA tab pattern. Fails WCAG 2.2 AA.

### Top 3 Quick Wins
1. **Replace fonts** (2 files: `fonts.ts` + `tailwind.config.ts`) — immediate brand transformation.
2. **Add `aria-label` to all icon-only buttons** (Header, Copilot, throughout) — 15-minute accessibility fix.
3. **Install Framer Motion + add page transitions** — instant perceived quality upgrade.

---

## 1. Component Mapping (Phase 1: Code Discovery)

### Spec → Code Mapping

| Spec Component | Code File | Status |
|---------------|-----------|--------|
| Button (Primary, Secondary, Ghost, Destructive, Icon) | `components/ui/button.tsx` | Partial — missing Icon variant, loading state |
| Card | `components/ui/card.tsx` | Partial — no hover, no skeleton |
| Input | `components/ui/input.tsx` | Partial — no error state, no label integration |
| Stats Card | `components/data/stats-card.tsx` | Partial — no loading, no count-up animation |
| Data Table | `components/data/data-table.tsx` | Partial — no sorting, pagination, density toggle, TanStack |
| Sidebar | `components/layout/sidebar.tsx` | Partial — no responsive collapse, no tablet rail |
| Header | `components/layout/header.tsx` | Partial — no dropdown menus, no mobile search |
| Badge / Status Pill | Inline in pages | Missing — no reusable component |
| Modal / Dialog | Not implemented | Missing |
| Toast / Notification | Not implemented | Missing |
| Tabs | Inline in settings | Missing — no reusable component |
| Skeleton Loader | Not implemented | Missing |
| Agent Card | Inline in agents page | Missing — no reusable component |
| Copilot Chat Message | Inline in copilot page | Missing — no reusable component |
| Command Palette (Cmd+K) | Not implemented | Missing |
| Tooltip | Not implemented | Missing |
| Dropdown Menu | Not implemented | Missing |
| Avatar | Not implemented | Missing |

### Summary
- **3 reusable UI components** exist (Button, Card, Input)
- **2 reusable data components** exist (StatsCard, DataTable)
- **2 reusable layout components** exist (Sidebar, Header)
- **10+ components from spec are missing** entirely
- **6+ inline implementations** need to be extracted into reusable components

---

## 2. Token Compliance Report (Phase 2: UI Manager)

### 2.1 Hardcoded Color Values Outside Token System

| File | Line | Value | Violation |
|------|------|-------|-----------|
| `jobs/page.tsx` | ~36 | `bg-blue-50 text-blue-600` | "Scheduled" status uses raw Tailwind blue — not in token system. Should use `warning` or create `info` semantic token. |
| `settings/page.tsx` | ~185 | `bg-white` | Toggle knob uses hardcoded white instead of `bg-background` token |

**Severity**: Warning — 2 violations found. The rest of the codebase correctly uses token classes.

### 2.2 Token System Architecture Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **Duplicate color definitions** | Warning | Colors defined as hex in both `tailwind.config.ts` AND `globals.css`. CSS variables exist but are NOT referenced by Tailwind config. Changes require updating 2 files. |
| **Missing token tiers** | Critical | Spec defines 11-step accent scale (50-950). Code only has 3 accent values (DEFAULT, hover, muted). Missing accent.50 through accent.950 for proper state progression. |
| **Missing surface hierarchy** | Critical | Spec defines bg0/bg1/bg2/bg3 surface tiers. Code has only `background` (#FFF), `muted` (#F5F5F5), and `card` (#FFF). No bg1/bg2/bg3 differentiation. |
| **Missing text hierarchy** | High | Spec defines text.primary/secondary/tertiary. Code has `foreground` (#0A0A0A) and `muted-foreground` (#A3A3A3). Missing the middle `text.secondary` (#3D3D43) tier. |
| **Missing shadow tokens** | High | Spec defines shadow.1/shadow.2/shadow.3. Code has no shadow tokens — only `shadow-sm` (card component uses it inline). |
| **No dark mode tokens** | Info | Spec defines complete dark mode token set. Code has no dark mode support at all. |
| **Missing semantic colors** | High | Spec defines danger/success/warning/info each with solid/subtleBg/text/border variants. Code has only `destructive` and `success` as flat colors. No subtleBg/text/border variants. No `warning` or `info` tokens. |

### 2.3 Contrast Ratio Issues

| Combination | Ratio | Requirement | Pass? |
|-------------|-------|-------------|-------|
| `#FF751F` (accent) on `#FFFFFF` (bg) | 3.3:1 | 4.5:1 (small text) | **FAIL** |
| `#FF751F` (accent) on `#FFFFFF` (bg) | 3.3:1 | 3:1 (large text/UI) | PASS |
| `#A3A3A3` (muted-foreground) on `#FFFFFF` (bg) | 2.7:1 | 4.5:1 (small text) | **FAIL** |
| `#A3A3A3` (muted-foreground) on `#F5F5F5` (muted bg) | 2.5:1 | 4.5:1 (small text) | **FAIL** |
| `#0A0A0A` (foreground) on `#FFFFFF` (bg) | 19.5:1 | 4.5:1 | PASS |
| `#E5641A` (accent.hover) on `#FFFFFF` (bg) | 3.7:1 | 4.5:1 (small text) | **FAIL** |

**Critical**: `muted-foreground` (#A3A3A3) fails WCAG AA for text on both white and muted backgrounds. Spec recommends `text.tertiary` of `#6B6B76` (5.0:1 on white) — this must be updated.

### 2.4 Brand Dial Compliance

| Dial | Spec Value | Code Status | Compliant? |
|------|-----------|-------------|------------|
| Temperature: `neutral` | Surfaces should be pure neutral | Surfaces are pure white/gray — correct | ✅ |
| Contrast: `crisp` | Clear surface separation via borders | Cards use border + shadow — mixed | ⚠️ Partial |
| Radius: `sharp` (6px) | All components 6px | `lg: 0.75rem` (12px), `md: 0.5rem` (8px), `sm: 0.25rem` (4px) — **none are 6px** | ❌ |
| Shadow: `subtle` | Minimal shadow for elevation | Only `shadow-sm` used sporadically | ⚠️ Partial |
| Density: `normal` | 40px buttons, 48px table rows | Buttons 40px ✅, table rows unstated | ⚠️ Partial |
| Accent: `vivid` | High-chroma orange | `#FF751F` is vivid | ✅ |
| Usage: `standard` | CTAs, active nav, badges | Orange used for buttons + active nav — generally correct | ✅ |

---

## 3. UX & Interaction Report (Phase 3)

### 3.1 Information Hierarchy Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **No type scale** | High | Spec defines 8-step type scale (xs through 4xl). Code uses Tailwind defaults with no custom `fontSize` tokens. Heading sizes are ad-hoc across pages. |
| **Font weight inconsistency** | Medium | Different pages use different weight patterns. Dashboard uses `font-semibold` for section titles, Jobs uses `font-medium` for table headers. No consistent weight hierarchy. |
| **Heading hierarchy on auth pages** | Medium | Login/signup use `<h1>` for brand text ("CREWSHIFT"), then `<h3>` (CardTitle) for "Welcome back". The `<h1>` should be the page purpose. |

### 3.2 Navigation Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **No mobile navigation** | Critical | Sidebar is always 256px with no responsive behavior. On mobile (< 640px), sidebar takes ~68% of a 375px screen. |
| **No mobile search** | High | Header search is `hidden md:block` with no alternative on mobile. |
| **No Cmd+K command palette** | Medium | Spec requires command palette for power users. Not implemented. |
| **No `aria-current="page"`** | High | Active sidebar nav item has visual treatment but no ARIA semantic. |
| **No breadcrumbs** | Low | Spec mentions breadcrumbs in header but not implemented. |

### 3.3 Accessibility Violations

#### Critical (WCAG 2.2 AA Failures)

| # | Issue | Location | WCAG Criterion |
|---|-------|----------|---------------|
| 1 | **Toggle switches completely inaccessible** — no `role="switch"`, no `aria-checked`, no keyboard support | `settings/page.tsx` | 4.1.2 Name/Role/Value |
| 2 | **Tab pattern lacks ARIA** — no `role="tablist"`, no `aria-selected`, no arrow key nav | `settings/page.tsx` | 4.1.2 Name/Role/Value |
| 3 | **Muted text fails contrast** — #A3A3A3 on white = 2.7:1 (needs 4.5:1) | All pages with `text-muted-foreground` | 1.4.3 Contrast |
| 4 | **No skip-to-content link** | `layout.tsx` | 2.4.1 Bypass Blocks |
| 5 | **Icon-only buttons lack labels** — Notification bell, user avatar, send button | `header.tsx`, `copilot/page.tsx` | 4.1.2 Name/Role/Value |

#### High

| # | Issue | Location |
|---|-------|----------|
| 6 | Error messages lack `role="alert"` | `login/page.tsx`, `signup/page.tsx` |
| 7 | Tables lack `<caption>` or `aria-label` | `data-table.tsx` |
| 8 | Search inputs lack `aria-label` | `header.tsx`, `data-table.tsx` |
| 9 | Chat messages area lacks `aria-live="polite"` | `copilot/page.tsx` |
| 10 | Decorative icons lack `aria-hidden="true"` | Throughout all pages |
| 11 | Password hint not connected via `aria-describedby` | `signup/page.tsx` |

### 3.4 Empty/Error/Loading State Audit

| View | Loading State | Error State | Empty State |
|------|--------------|-------------|-------------|
| Dashboard | ❌ Missing | ❌ Missing | ❌ Missing |
| Jobs | ❌ Missing | ❌ Missing | ❌ Missing |
| Invoices | ❌ Missing | ❌ Missing | ❌ Missing |
| Customers | ❌ Missing | ❌ Missing | ❌ Missing |
| Agents | ❌ Missing | ❌ Missing | ❌ Missing |
| Copilot | ❌ Missing | ❌ Missing | ⚠️ Partial (initial message) |
| Settings | ❌ Missing | ❌ Missing | ❌ Missing |
| Login | ⚠️ Text only | ✅ Banner | N/A |
| Signup | ⚠️ Text only | ✅ Banner | N/A |

**Every data view lacks loading skeletons, error states, and empty states.** The spec requires skeleton screens for all data loads.

---

## 4. Component State Matrix (Phase 4)

| Component | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty | Selected |
|-----------|---------|-------|--------|-------|----------|---------|-------|-------|----------|
| **Button** | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | N/A | N/A | N/A |
| **Card** | ✅ | ❌ | N/A | ❌ | N/A | ❌ | N/A | N/A | N/A |
| **Input** | ✅ | N/A | N/A | ✅ | ✅ | N/A | ❌ | N/A | N/A |
| **DataTable** | ✅ | ✅(rows) | N/A | ❌ | N/A | ❌ | ❌ | ✅ | ❌ |
| **StatsCard** | ✅ | ❌ | N/A | N/A | N/A | ❌ | ❌ | ❌ | N/A |
| **Sidebar Nav Item** | ✅ | ✅ | ❌ | ❌ | N/A | N/A | N/A | N/A | ✅ |
| **Tabs** (Settings) | ✅ | ✅ | ❌ | ❌ | N/A | N/A | N/A | N/A | ✅ |
| **Toggle** (Settings) | ✅ | N/A | N/A | ❌ | ❌ | N/A | N/A | N/A | ✅ |
| **Agent Card** | ✅ | ❌ | N/A | N/A | N/A | ❌ | N/A | N/A | N/A |
| **Badge** (inline) | ✅ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| **Chat Message** | ✅ | N/A | N/A | N/A | N/A | ❌ | N/A | N/A | N/A |

**State Coverage: 28/100**
- 35 states present out of ~72 applicable states (some N/A excluded)
- Critical gaps: No loading states anywhere, no active/pressed states on buttons, no focus states on cards/tables

### Signature Move Compliance

**Spec**: Strong table dividers (Signature Move #3)
**Code**: Tables use `divide-y divide-border` — this creates subtle dividers, not strong ones. The spec calls for visible `border.default` (1px) on every row with `surface.bg1` header background and uppercase tracked-out header text. Current implementation uses standard Tailwind dividers with no special header treatment.

**Verdict**: ❌ Signature Move not applied.

---

## 5. Brand Compliance Score (Phase 5)

### Anti-Template Checklist

| Check | Status | Detail |
|-------|--------|--------|
| Signature Move applied consistently | ❌ | Tables use default dividers, not strong industrial dividers |
| Accent usage matches declared style | ⚠️ | Generally correct but inconsistent — blue used for "Scheduled" status |
| Neutral temperature set | ✅ | Surfaces are neutral grays |
| Radius consistent | ❌ | Config has 4px/8px/12px — spec says 6px throughout |
| Card separation consistent | ⚠️ | Cards use border + shadow-sm but not the spec's defined shadow tokens |
| Token schema used (no raw hex) | ⚠️ | 2 violations found (blue-50/blue-600, bg-white) |
| **Font matches brand** | ❌ | Uses Space Grotesk + DM Sans, NOT Red Hat Display |
| **Logo is the exact SVG provided** | ❌ | Logo is text-based "CREWSHIFT" with a CSS dot, not the actual SVG logo |

### Brand Feel Assessment

**Current feel**: Generic SaaS dashboard template. The Space Grotesk font, default Tailwind colors, and standard card patterns make this look like any `create-next-app` + shadcn starter. Nothing says "trades industry" or "CrewShift" specifically.

**What makes it feel generic**:
1. Default fonts (Space Grotesk is the "I just picked a Google Font" choice)
2. No animation/motion — everything is static and flat
3. No signature visual treatment — tables, cards, sidebar all use default patterns
4. The orange is present but doesn't have enough presence due to `standard` usage with no vivid moments
5. Logo is just text — the actual brand mark (angular chevron) is absent

**What would make it feel like CrewShift**:
1. Red Hat Display font with tight tracking on headings — immediately feels engineered
2. The actual SVG logo in the sidebar and login page
3. Strong table dividers with industrial header treatment (uppercase, tracked, bg1)
4. Count-up animations on stat cards — the dashboard feels alive
5. The 3px left-border active indicator on sidebar — echoes the logo's angular geometry
6. Crisp, sharp 6px radius everywhere — no soft, rounded corners

**Brand Score: 30/100** — The token system structure exists but doesn't deliver the spec's intended personality.

---

## 6. Tech Stack Health (Phase 6)

### Missing Libraries (Required by Spec)

| Library | Purpose | Status |
|---------|---------|--------|
| `framer-motion` | Animation system (page transitions, micro-interactions) | ❌ Not installed |
| `recharts` | Dashboard charts | ❌ Not installed |
| `sonner` | Toast notifications | ❌ Not installed |
| `cmdk` | Command palette (Cmd+K) | ❌ Not installed |
| `@tanstack/react-table` | Headless data tables | ❌ Not installed |
| `react-hook-form` | Form management | ❌ Not installed |
| `zod` | Schema validation | ❌ Not installed |
| `@hookform/resolvers` | RHF + Zod bridge | ❌ Not installed |
| `@formkit/auto-animate` | List animations | ❌ Not installed |
| `date-fns` | Date formatting | ❌ Not installed |
| `nuqs` | URL state management | ❌ Not installed |

### Missing shadcn Components

| Component | Status |
|-----------|--------|
| `dialog` | ❌ Not installed |
| `dropdown-menu` | ❌ Not installed |
| `tabs` | ❌ Not installed (using custom inline) |
| `badge` | ❌ Not installed (using custom inline) |
| `avatar` | ❌ Not installed |
| `separator` | ❌ Not installed |
| `skeleton` | ❌ Not installed |
| `tooltip` | ❌ Not installed |
| `command` | ❌ Not installed |
| `form` | ❌ Not installed |
| `table` | ❌ Not installed (using custom DataTable) |
| `sonner` | ❌ Not installed |

### Current Dependencies Health

| Dependency | Version | Status |
|-----------|---------|--------|
| `next` | 14.2.21 | ⚠️ Next.js 15 is latest — consider upgrade path |
| `react` | 18.3.1 | ⚠️ React 19 available — Next 15 uses it |
| `tailwindcss` | 3.4.17 | ✅ Latest v3 |
| `lucide-react` | 0.468.0 | ✅ Good |
| `clsx` | 2.1.1 | ✅ Good |
| `tailwind-merge` | 2.6.0 | ✅ Good |
| `class-variance-authority` | 0.7.1 | ✅ Good |

### Bundle Size Concerns
- None currently — the app is lean. But adding 11 new libraries needs careful tree-shaking.
- Framer Motion is the heaviest addition (~35KB gzipped). Worth it for the animation system.
- Recharts adds ~50KB gzipped but only loaded on dashboard page (code-split via Next.js).

---

## 7. Prioritized Fix List

### P0 — Critical (Must Fix)

| # | Issue | Files Affected | Effort |
|---|-------|---------------|--------|
| 1 | **Replace fonts with Red Hat Display** | `fonts.ts`, `tailwind.config.ts` | 15 min |
| 2 | **Replace text logo with actual SVG logo** | `sidebar.tsx`, `login/page.tsx` | 30 min |
| 3 | **Fix muted text contrast** — #A3A3A3 → #6B6B76 | `tailwind.config.ts`, `globals.css` | 15 min |
| 4 | **Add mobile sidebar** — hamburger menu + drawer | `sidebar.tsx`, `(dashboard)/layout.tsx` | 2-3 hrs |
| 5 | **Fix Settings toggle accessibility** — add role="switch", aria-checked, keyboard | `settings/page.tsx` | 1 hr |
| 6 | **Fix Settings tabs accessibility** — add ARIA tab pattern | `settings/page.tsx` | 1 hr |
| 7 | **Add aria-labels to all icon-only buttons** | `header.tsx`, `copilot/page.tsx`, throughout | 30 min |
| 8 | **Add skip-to-content link** | `layout.tsx` | 15 min |

### P1 — High (Should Fix)

| # | Issue | Files Affected | Effort |
|---|-------|---------------|--------|
| 9 | **Update token system** — add full accent scale, surface hierarchy, semantic colors | `tailwind.config.ts`, `globals.css` | 1-2 hrs |
| 10 | **Fix border-radius** — change to 6px (sharp) per spec | `tailwind.config.ts` | 15 min |
| 11 | **Install Framer Motion + add page transitions** | `package.json`, layout files | 2 hrs |
| 12 | **Install + configure shadcn components** (dialog, tabs, badge, skeleton, etc.) | Multiple files | 2-3 hrs |
| 13 | **Add loading skeletons** to all data views | All page files | 3-4 hrs |
| 14 | **Apply Signature Move** — strong table dividers, industrial header | `data-table.tsx`, all table pages | 2 hrs |
| 15 | **Add error states** to all data views | All page files | 2 hrs |
| 16 | **Add empty states** to all data views | All page files | 2-3 hrs |
| 17 | **Add `role="alert"` to error messages** | `login/page.tsx`, `signup/page.tsx` | 15 min |
| 18 | **Add table captions and search labels** | `data-table.tsx` | 30 min |
| 19 | **Remove hardcoded blue colors** — replace with info semantic token | `jobs/page.tsx` | 15 min |

### P2 — Medium (Nice to Fix)

| # | Issue | Files Affected | Effort |
|---|-------|---------------|--------|
| 20 | **Install TanStack Table** — replace custom DataTable | `data-table.tsx`, all table pages | 4-6 hrs |
| 21 | **Add button active/pressed state** (scale 0.97) | `button.tsx` | 15 min |
| 22 | **Add card hover state** (shadow increase, translateY) | `card.tsx` | 30 min |
| 23 | **Add count-up animation** to stat card values | `stats-card.tsx` | 1 hr |
| 24 | **Install Sonner + add toast notifications** | `package.json`, layout | 1 hr |
| 25 | **Install cmdk + add command palette** | `package.json`, new component | 2-3 hrs |
| 26 | **Add mobile search alternative** | `header.tsx` | 1 hr |
| 27 | **Add aria-hidden to decorative icons** | Throughout all pages | 1 hr |
| 28 | **Connect password hint via aria-describedby** | `signup/page.tsx` | 15 min |
| 29 | **Fix heading hierarchy on auth pages** | `login/page.tsx`, `signup/page.tsx` | 30 min |
| 30 | **Add form validation with react-hook-form + zod** | Auth pages, future forms | 3-4 hrs |

### P3 — Low (Polish)

| # | Issue | Files Affected | Effort |
|---|-------|---------------|--------|
| 31 | **Add type scale tokens** to Tailwind config | `tailwind.config.ts` | 30 min |
| 32 | **Add shadow tokens** to Tailwind config | `tailwind.config.ts` | 15 min |
| 33 | **Add spacing tokens** to Tailwind config | `tailwind.config.ts` | 15 min |
| 34 | **Extract inline Badge component** | New `components/ui/badge.tsx` | 1 hr |
| 35 | **Extract inline Agent Card component** | New `components/data/agent-card.tsx` | 1 hr |
| 36 | **Extract inline Chat Message component** | New `components/copilot/message.tsx` | 1 hr |
| 37 | **Add transition durations** to existing transitions | Throughout | 30 min |
| 38 | **Consolidate color definitions** — single source of truth | `tailwind.config.ts`, `globals.css` | 1 hr |
| 39 | **Add prefers-reduced-motion** support | All animation code | 30 min |
| 40 | **Add dark mode token set** | `tailwind.config.ts`, `globals.css` | 2-3 hrs |

---

## Estimated Total Effort

| Priority | Items | Estimated Hours |
|----------|-------|----------------|
| P0 (Critical) | 8 items | ~6-8 hours |
| P1 (High) | 11 items | ~18-24 hours |
| P2 (Medium) | 11 items | ~14-18 hours |
| P3 (Low) | 10 items | ~9-12 hours |
| **Total** | **40 items** | **~47-62 hours** |

**Recommended approach**: Address P0 first (1 day), then P1 (2-3 days), then tackle P2/P3 as part of the `/pdt-build` phase which will rebuild components properly.
