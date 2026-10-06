# Design System — LegacyVault AI

**Purpose**: Record the established UI/UX direction so that implementation
tasks build one consistent interface. It describes direction and rules; it
contains no code, tokens values, components or pages.

**Canonical sources**: constitution v2.0.1 Principles XIII (UI/UX), XIV
(Accessibility and Responsiveness), XV (Performance); `spec.md` § UI/UX
Requirements (UX-001–UX-018), NFR-ACC-001–004, NFR-RSP-001, AC-UX1–UX4;
`docs/BRAIN.md` § 9; `plan.md` Phase 0 and Phase 11; tasks T010–T012, T017,
T045, T049, T050, T061–T063, T113, T164–T170, T173, T184, T237.

**Status**: 📐 specified / 📋 planned. As of 2026-09-18 the repository
contains only the default `create-next-app` styles (Geist fonts wired in
`app/layout.tsx`; a template page). **No design tokens, components or theme
exist yet.** `docs/UI_UX_GUIDELINES.md` (T234) will extend this document
once components exist.

---

## 1. Direction (constitution XIII, UX-001–UX-005, UX-018)

- **Dark-first** visual system with an optional **light mode** (theme toggle
  T184; default dark; respects `prefers-color-scheme` on first visit;
  persisted to `preferences.theme`).
- **Glassmorphism**, subtle gradients and restrained effects on deep-navy
  backgrounds. Colour roles are semantic (2026-10-06 refresh):
  - **Electric blue** `#0EA5FF` — primary action / technology; the dominant accent.
  - **Emerald** `#14D38F` — safe, active, verified, success.
  - **Violet** `#9D7CFF` — AI features only (assistant, AI badges, AI gradients).
  - **Amber** — pending / warning. **Red** — error / destructive.
  - Cyan is a secondary technology accent (emergency contacts, data viz).
  Glow is a state cue (primary CTA, active nav item, selected card), never a
  resting decoration on every surface.
- Strong, modern, high-contrast typography with a clear hierarchy.
- The visual system must inspire trust for sensitive legal-tech workflows:
  professional, secure, calm — never at the expense of accessibility,
  performance, usability or security (constitution XXII priority order).

## 2. Foundations (T010, T011, T017)

- **Tailwind CSS v4**, CSS-first: tokens are defined in `app/globals.css`
  with `@theme` (there is no `tailwind.config.ts`). Token groups planned:
  colour (dark-first surfaces, glass surfaces, blue/purple/cyan accents,
  semantic states), spacing scale, radii, typography scale, motion presets.
- Light-mode overrides live under `[data-theme="light"]`; the `data-theme`
  attribute is set on `<html>`.
- Typography: **Space Grotesk** (500–700) is the display face for headings and
  headline numbers (`font-heading`); **Geist Sans** for reading text and
  **Geist Mono** for data — all through `next/font`.
- Shared utilities in `styles/`: `glass`, `glass-strong`, `surface-interactive`
  (hover lift), `surface-selected`, `icon-tile` (tinted medallion that takes
  the semantic colour from `text-*`), `bg-gradient-brand` (blue),
  `bg-gradient-ai` / `border-gradient-ai` (blue→violet, AI only),
  `skeleton-shimmer`, and motion utilities that `prefers-reduced-motion` disables.
- Utilities for glass panels, gradients and animation base classes live in
  `styles/` and are imported by `app/globals.css`.

## 3. Components (T012 and feature tasks)

- Primitives: **shadcn/ui** in `components/ui/` — Button, Input, Card,
  Dialog, Sheet, Tabs, Table, Badge, Avatar, Dropdown, Toast, Skeleton,
  Tooltip, Progress — customized to the tokens above.
- Layout: auth layout (centered glass card), dashboard shell (sidebar +
  header with Clerk user menu and notification bell), admin layout.
- Shared: wizard system (provider, stepper, step wrapper), file upload
  (drag-and-drop with progress and clear rejection reasons), attached-
  documents panel, re-authentication gate (explains why step-up is needed
  before Clerk's UI), AI disclaimer / "AI-generated" label, page transition,
  skeleton loaders, empty states, confirmation dialog, theme toggle.
- Clerk-hosted components (`<SignIn/>`, `<SignUp/>`, `<UserProfile/>`,
  `<UserButton/>`) are themed through Clerk's `appearance` to match the
  system.

## 4. Motion (UX-006–UX-011, constitution XIII)

- **Framer Motion** for component and page transitions (fade/slide page
  transitions, staggered cards, list animations, dialog scale-in, badge
  bounce); **GSAP** for complex sequences (landing-page scroll animations).
- Motion is purposeful — it explains state change and builds confidence; it
  never blocks input, hides content or delays security-relevant feedback.
- `prefers-reduced-motion` disables or reduces non-essential animation
  everywhere (`hooks/use-reduced-motion.ts`, UX-009, AC-UX3).

## 5. State communication (UX-012–UX-014, constitution XIII)

- Loading: skeleton screens matching each layout, progress bars for uploads
  and long AI jobs (NFR-PER-004), save-status indicators in the wizard
  ("Saved", "Saving…", "Unsaved changes").
- Errors: visually distinct, informative, actionable — e.g. upload rejections
  state the reason (file type mismatch, too large, infected); conflicts
  offer a reload; never show internal details.
- Success: unambiguous confirmations for finalization, assignments,
  revocations and other authoritative actions; confirmation dialogs precede
  destructive or authoritative changes.
- Status must never rely on colour alone (NFR-ACC-003): pair colour with
  icon, text or badge.

## 6. Accessibility (constitution XIV, NFR-ACC-001–004, AC-UX2–UX4)

- WCAG 2.1 AA contrast for text and interactive elements in both themes.
- Semantic HTML and ARIA where needed; full keyboard operability (tab order,
  visible focus, Enter/Escape on dialogs, arrow keys in lists — T173).
- Automated checks with axe in Playwright across every route plus a manual
  screen-reader pass on the wizard, vault and access pages (T237).

## 7. Responsiveness (NFR-RSP-001, UX-015, AC-UX1)

Breakpoints from the specification: **desktop ≥ 1200 px**, **tablet
768–1199 px**, **mobile 320–767 px**. The sidebar collapses on mobile; the
wizard stepper is horizontal on desktop and vertical on mobile; tables adapt
to card/list views. A responsive audit at 1440 / 768 / 375 px is a required
task (T170).

## 8. Performance (constitution XV)

Lazy-load heavy libraries (GSAP, PDF rendering) and below-the-fold content;
avoid unnecessary client-side JavaScript; keep user data out of shared caches
(`Cache-Control: private, no-store`; no static prerendering of user-data route
groups).

## 9. Key surfaces (from the plan's route groups)

Landing (marketing); Clerk sign-in / sign-up; onboarding; dashboard; the
eleven-step legacy-plan wizard (Personal Details, Family Information,
Beneficiaries, Financial / Physical / Digital Assets, Witness Details,
Special Wishes, Document Attachments, Review, Confirmation); beneficiaries
(list, detail with assignments and access tokens); assets (overview +
financial / physical / digital); document vault (folder tree, grid/list,
upload, versions); Dead Man Switch (configuration, status, check-in landing);
emergency access (owner page; public request / verify / status pages); video
legacy; AI assistant, will generator, document analysis; Security Center;
settings (profile, security, audit log); notifications; admin (dashboard,
users, audit logs); public `/access` page for external recipients.

## 10. Open design decisions

- ~~Display typeface~~ — decided: Space Grotesk (see § 2).
- Visual treatment of confidence indicators and "AI-generated" labels
  (constraints are set by FR-M013, FR-R005, FR-R009; the rendering is not
  yet designed).
