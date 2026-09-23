import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { useDemoStore } from "@/lib/demo/store";

import { DashboardView } from "@/app/(dashboard)/dashboard/_components/dashboard-view";
import { DeadManSwitchView } from "@/app/(dashboard)/dead-man-switch/_components/dead-man-switch-view";
import { EmergencyAccessView } from "@/app/(dashboard)/emergency-access/_components/emergency-access-view";
import { WizardView } from "@/app/(dashboard)/legacy-plan/wizard/_components/wizard-view";

/**
 * Smoke-renders the main authenticated views inside the shell with the demo
 * workspace, the way the (dashboard) layout does once Clerk is configured.
 * Catches runtime errors in hydration, Base UI usage and store wiring.
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
}));

/** Minimal API envelope, so views that fetch render against a predictable server. */
function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "test" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const DRAFT_PLAN = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "DRAFT",
  version: 1,
  currentStep: 6,
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

describe("authenticated views (demo workspace)", () => {
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
    useDemoStore.getState().resetWorkspace();
    useDemoStore.getState().setHydrated(false);
  });

  it("renders the dashboard with readiness, protection and quick actions", async () => {
    renderInShell(<DashboardView firstName="Aarav" />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Aarav/),
    );
    expect(screen.getByText(/Legacy readiness/i)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: /legacy readiness score/i })).toBeInTheDocument();
    expect(screen.getByText(/Dead Man’s Switch/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Continue Will/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Demo workspace/)).toBeInTheDocument();
  });

  it("renders the will wizard on the saved step with the stepper", async () => {
    // The wizard is API-backed: it opens the draft over HTTP on mount.
    stubPlanApi();
    renderInShell(<WizardView />);
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: /plan steps/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Step 6 of 11/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Digital assets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/i })).toBeInTheDocument();
  });

  it("renders the Dead Man's Switch state machine and controls", async () => {
    renderInShell(<DeadManSwitchView />);
    await waitFor(() =>
      expect(screen.getByRole("list", { name: /escalation stages/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Check in$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Pause/i })).toBeEnabled();
    expect(screen.getByText(/Trusted contacts/)).toBeInTheDocument();
  });

  it("renders the pending emergency-access request with approve / deny", async () => {
    renderInShell(<EmergencyAccessView />);
    await waitFor(() =>
      expect(screen.getByText(/requested emergency access/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deny/i })).toBeInTheDocument();
  });
});
