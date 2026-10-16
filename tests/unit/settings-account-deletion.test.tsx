import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/components/providers";

import { SettingsView } from "@/app/(dashboard)/settings/_components/settings-view";

/**
 * The two deletion options in Settings → Account: they are separate controls
 * calling separate endpoints, the permanent one stays disabled until the exact
 * phrase is typed and the acknowledgement ticked, and its outcome — complete
 * or still finishing — is what the landing page is told, never more.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=account"),
}));

const signOut = vi.hoisted(() => vi.fn(async (_options?: { redirectUrl?: string }) => undefined));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut, openUserProfile: vi.fn(), __internal_openReverification: vi.fn() }),
  useUser: () => ({
    isLoaded: true,
    user: { id: "clerk_user_1", twoFactorEnabled: true, getSessions: async () => [] },
  }),
}));

const PROFILE = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "aarav@example.com",
  emailVerified: true,
  name: "Aarav Mehta",
  mfaEnabled: true,
  role: "USER",
  preferences: {},
  notificationPreferences: {},
  securityPreferences: {},
  onboardingCompletedAt: "2026-09-01T00:00:00.000Z",
  deletionRequestedAt: null as string | null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

let requests: { url: string; method: string; body: unknown }[];

function stubApi(profile = PROFILE, deleteNowStatus = "DELETED") {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const data = url.includes("/users/me/delete-now")
        ? { status: deleteNowStatus }
        : url.includes("/users/me")
          ? profile
          : { items: [], total: 0, page: 1, limit: 50 };
      return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "t" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

async function openAccountTab() {
  render(
    <Providers>
      <SettingsView user={{ name: "Aarav Mehta", email: null, imageUrl: null }} clerkEnabled />
    </Providers>,
  );
  await screen.findByText("Delete account permanently now");
}

beforeEach(() => {
  signOut.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia ||= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as MediaQueryList;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
});

describe("settings — account deletion", () => {
  it("shows the scheduled and the permanent option as separate controls", async () => {
    stubApi();
    await openAccountTab();
    expect(screen.getByText("Schedule account deletion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule deletion" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete permanently now" })).toBeInTheDocument();
  });

  it("keeps permanent deletion disabled until the phrase and acknowledgement are given", async () => {
    stubApi();
    await openAccountTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently now" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently now" });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    const phrase = within(dialog).getByLabelText(/to confirm/);
    fireEvent.change(phrase, { target: { value: "delete permanently" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(phrase, { target: { value: "DELETE PERMANENTLY" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    const call = requests.find((request) => request.url.includes("/delete-now"));
    expect(call).toMatchObject({ method: "POST", body: { confirmation: "DELETE PERMANENTLY" } });
    // The scheduled endpoint was never called.
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(signOut.mock.calls[0]?.[0]).toEqual({ redirectUrl: "/account-deleted?status=complete" });
  });

  it("tells the landing page when cleanup is still finishing", async () => {
    stubApi(PROFILE, "CLEANUP_PENDING");
    await openAccountTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently now" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), {
      target: { value: "DELETE PERMANENTLY" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently now" }));
    await waitFor(() =>
      expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/account-deleted?status=pending" }),
    );
  });

  it("shows the exact deletion date and the cancel control while scheduled", async () => {
    stubApi({ ...PROFILE, deletionRequestedAt: "2026-10-01T10:00:00.000Z" });
    await openAccountTab();
    expect(await screen.findByText("31 Oct 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel scheduled deletion" })).toBeInTheDocument();
    // Permanent deletion stays available, to bring the deletion forward.
    expect(screen.getByRole("button", { name: "Delete permanently now" })).toBeInTheDocument();
  });
});
