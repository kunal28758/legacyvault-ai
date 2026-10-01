import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/components/providers";

import { SettingsView } from "@/app/(dashboard)/settings/_components/settings-view";

/**
 * The Settings two-factor control (bug: "clicking Enable did nothing").
 *
 * Clerk owns MFA enrolment, so these assert the application integration — the
 * button opens Clerk's own account portal, the badge reflects Clerk's *live*
 * state rather than the possibly-stale database mirror, and the mirror is
 * re-synced when the two diverge. Nothing here fakes MFA success; the enrolment
 * itself is Clerk's and is covered at the integration boundary by E2E.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  // The Settings tab is URL-controlled; render directly on the security tab.
  useSearchParams: () => new URLSearchParams("tab=security"),
}));

const openUserProfile = vi.hoisted(() => vi.fn());
const clerkState = vi.hoisted(() => ({ twoFactorEnabled: false }));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ openUserProfile, __internal_openReverification: vi.fn() }),
  useUser: () => ({
    isLoaded: true,
    user: {
      id: "clerk_user_1",
      twoFactorEnabled: clerkState.twoFactorEnabled,
      getSessions: async () => [],
    },
  }),
}));

function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "t" } }), {
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
  onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
  lastLoginAt: null,
  deletionRequestedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

let refreshCalls: number;

function stubApi(profileOverride: Partial<typeof PROFILE> = {}) {
  refreshCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/users/me/refresh") && init?.method === "POST") {
        refreshCalls += 1;
        // The server re-reads Clerk; the mirror now matches the live state.
        return apiResponse({
          ...PROFILE,
          ...profileOverride,
          mfaEnabled: clerkState.twoFactorEnabled,
        });
      }
      if (url.includes("/users/me")) return apiResponse({ ...PROFILE, ...profileOverride });
      return apiResponse({ items: [], total: 0, page: 1, limit: 50 });
    }),
  );
}

async function openSecurityTab() {
  render(
    <Providers>
      <SettingsView
        user={{ name: "Aarav Mehta", email: "aarav@example.com", imageUrl: null }}
        clerkEnabled
      />
    </Providers>,
  );
  await screen.findByText("Two-factor authentication");
}

describe("settings — two-factor authentication", () => {
  beforeEach(() => {
    clerkState.twoFactorEnabled = false;
    openUserProfile.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
    window.scrollTo = vi.fn();
  });

  it("opens Clerk's account portal instead of doing nothing when Enable is clicked", async () => {
    stubApi();
    await openSecurityTab();

    const twofaRow = screen.getByText("Two-factor authentication").closest("div")!.parentElement!;
    const enable = screen.getByRole("button", { name: "Enable" });
    expect(enable).toBeEnabled();
    expect(twofaRow).toHaveTextContent("Off");

    fireEvent.click(enable);
    // The real fix: it starts Clerk's enrolment flow, not a toast.
    expect(openUserProfile).toHaveBeenCalledTimes(1);
  });

  it("shows Clerk's live MFA state even when the database mirror is stale, and re-syncs the mirror", async () => {
    // Clerk says MFA is on; the mirror still says off (webhook not yet caught up).
    clerkState.twoFactorEnabled = true;
    stubApi({ mfaEnabled: false });
    await openSecurityTab();

    // The badge reflects Clerk's authoritative live state, not the stale mirror.
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();

    // The mirror is re-synced so the dashboard/security score agree with Clerk.
    await waitFor(() => expect(refreshCalls).toBe(1));
  });

  it("does not re-sync when Clerk and the mirror already agree", async () => {
    clerkState.twoFactorEnabled = false;
    stubApi({ mfaEnabled: false });
    await openSecurityTab();
    expect(screen.getByText("Off")).toBeInTheDocument();
    // Give any effect a chance to (wrongly) fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refreshCalls).toBe(0);
  });
});
