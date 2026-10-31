import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";

import { AdminView } from "@/app/(dashboard)/admin/_components/admin-view";
import { DashboardView } from "@/app/(dashboard)/dashboard/_components/dashboard-view";
import { DeadManSwitchView } from "@/app/(dashboard)/dead-man-switch/_components/dead-man-switch-view";
import { EmergencyAccessView } from "@/app/(dashboard)/emergency-access/_components/emergency-access-view";
import { WizardView } from "@/app/(dashboard)/legacy-plan/wizard/_components/wizard-view";

/**
 * Smoke-renders the main authenticated views inside the shell, the way the
 * (dashboard) layout does once Clerk is configured. Catches runtime errors in
 * hydration, Base UI usage and query wiring.
 *
 * The API is stubbed rather than mocked per hook: these assert that the views
 * render against the real envelope shape, not that a particular hook was called.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span data-testid="user-button" />,
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  useUser: () => ({ user: null, isLoaded: true }),
  useSession: () => ({ session: null, isLoaded: true }),
  // The re-auth gate only reaches Clerk when the API asks for verification,
  // which none of these read-only renders do.
  useClerk: () => ({ __internal_openReverification: () => {} }),
}));

/** Minimal API envelope, so views that fetch render against a predictable server. */
function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "test" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "aarav@example.com",
  emailVerified: true,
  name: "Aarav Mehta",
  mfaEnabled: false,
  role: "USER",
  dateOfBirth: null,
  phone: null,
  alternateEmail: null,
  address: null,
  familyInfo: null,
  preferences: {},
  notificationPreferences: {},
  securityPreferences: {},
  hasIdentificationDetails: false,
  onboardingCompletedAt: null,
  lastLoginAt: null,
  deletionRequestedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const DRAFT_PLAN = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "DRAFT",
  version: 1,
  currentStep: 4,
  stepsData: {},
  completionStatus: {},
  lockVersion: 0,
  finalizedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function stubPlanApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/legacy-plans/current")) return apiResponse(DRAFT_PLAN);
      if (url.includes("/versions")) return apiResponse({ items: [] });
      if (url.includes("/beneficiaries"))
        return apiResponse({ items: [], total: 0, page: 1, limit: 50 });
      if (url.includes("/assets/"))
        return apiResponse({ items: [], total: 0, page: 1, limit: 100 });
      if (url.includes("/documents/folders")) return apiResponse({ items: [] });
      if (url.includes("/documents"))
        return apiResponse({ items: [], total: 0, page: 1, limit: 50 });
      if (url.includes("/videos")) return apiResponse({ items: [], total: 0, page: 1, limit: 50 });
      if (url.includes("/notifications/unread-count")) return apiResponse({ count: 0 });
      if (url.includes("/notifications"))
        return apiResponse({ items: [], total: 0, unreadCount: 0, page: 1, limit: 30 });
      if (url.includes("/dead-man-switch")) return apiResponse(null);
      if (url.includes("/emergency-access")) return apiResponse({ contacts: [], requests: [] });
      if (url.includes("/users/me/activity"))
        return apiResponse({ items: [], total: 0, page: 1, limit: 25 });
      if (url.includes("/admin/analytics"))
        return apiResponse({
          users: { total: 3, active: 2, pendingDeletion: 0, superAdmins: 1 },
          registrations: [{ day: "2026-09-24", count: 1 }],
          storage: { documents: { count: 2, bytes: 2048 }, videos: { count: 0, bytes: 0 } },
          protection: { switchesActive: 1, switchesReleased: 0, emergencyPending: 0 },
          jobs: { queued: 0, running: 0, dead: 1, succeededLastDay: 4 },
        });
      if (url.includes("/admin/operations"))
        return apiResponse({
          deadJobs: [
            {
              id: "job-1",
              type: "access.deliver",
              attempts: 5,
              lastError: "provider unavailable",
              runAt: "2026-09-24T00:00:00.000Z",
              finishedAt: "2026-09-24T00:05:00.000Z",
              accessTokenId: null,
              beneficiaryId: null,
            },
          ],
          undeliveredTokens: [],
        });
      if (url.includes("/admin/audit-logs"))
        return apiResponse({ items: [], total: 0, page: 1, limit: 50 });
      if (url.includes("/admin/users"))
        return apiResponse({
          items: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              email: "member@example.com",
              name: "A Member",
              role: "USER",
              emailVerified: true,
              mfaEnabled: false,
              onboardingCompletedAt: null,
              lastLoginAt: null,
              deletionRequestedAt: null,
              deletedAt: null,
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
        });
      if (url.includes("/users/me")) return apiResponse(PROFILE);
      if (url.includes("/system-status"))
        return apiResponse({
          overall: "degraded",
          checkedAt: "2026-09-30T00:00:00.000Z",
          services: [
            { id: "database", label: "Database", state: "operational", message: "ok" },
            { id: "ai", label: "AI services", state: "not_configured", message: "No provider" },
          ],
        });
      return apiResponse({});
    }),
  );
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderInShell(ui: React.ReactNode) {
  return render(
    <Providers>
      <AppShell
        user={{ name: "Aarav Mehta", email: "aarav@example.com", imageUrl: null }}
        clerkEnabled={false}
      >
        {ui}
      </AppShell>
    </Providers>,
  );
}

describe("authenticated views", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    window.matchMedia =
      window.matchMedia ||
      ((query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    // jsdom has no Web Animations API; Base UI ScrollArea calls it from a timer.
    if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
    window.scrollTo = vi.fn();
    // Every view is API-backed now, so each test stubs the endpoints it needs.
    stubPlanApi();
  });

  it("renders the dashboard with readiness, protection and quick actions", async () => {
    renderInShell(<DashboardView firstName="Aarav" />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Aarav/),
    );
    expect(screen.getByText(/Legacy readiness/i)).toBeInTheDocument();
    // The greeting renders immediately; readiness fills in once the account data loads.
    expect(
      await screen.findByRole("meter", { name: /legacy readiness score/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Dead Man’s Switch/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /(Continue|Create) Will/i }).length).toBeGreaterThan(
      0,
    );
  });

  it("renders the will wizard on the saved step with the stepper", async () => {
    renderInShell(<WizardView />);
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: /plan steps/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Step 4 of 7/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Special wishes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & continue/i })).toBeInTheDocument();
    // An optional step can be skipped; nothing has been saved yet, so nothing claims to be.
    expect(screen.getByRole("button", { name: /Skip for now/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it("shows the real system status in the shell, never a default green", async () => {
    renderInShell(<DashboardView firstName="Aarav" />);
    const trigger = await screen.findByRole("button", { name: /Partially available/i });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByText(/System online/i)).not.toBeInTheDocument();
  });

  it("renders the Dead Man's Switch state machine and controls", async () => {
    renderInShell(<DeadManSwitchView />);
    await waitFor(() =>
      expect(screen.getByRole("list", { name: /escalation stages/i })).toBeInTheDocument(),
    );
    // With no switch configured the page renders its disabled state: check-in
    // and pause are unavailable until it is enabled.
    expect(screen.getByRole("button", { name: /^Check in$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enable/i })).toBeInTheDocument();
    expect(screen.getByText(/Trusted contacts/)).toBeInTheDocument();
  });

  it("renders the operator console with platform counts and the dead-letter queue", async () => {
    renderInShell(<AdminView />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Platform administration/i })).toBeInTheDocument(),
    );
    expect(screen.getByText("A Member")).toBeInTheDocument();
    // The operator sees how much exists, never what it is.
    expect(screen.getByText(/2 documents · 0 videos/)).toBeInTheDocument();
    expect(screen.getByText(/1 dead ·/)).toBeInTheDocument();
  });

  it("renders emergency access with its empty state", async () => {
    renderInShell(<EmergencyAccessView />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Emergency Access/i })).toBeInTheDocument(),
    );
    // No contacts configured yet: the page offers to designate one.
    expect(screen.getAllByRole("button", { name: /Designate/i }).length).toBeGreaterThan(0);
  });
});
