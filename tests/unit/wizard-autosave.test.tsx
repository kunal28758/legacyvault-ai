import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/components/providers";

import { WizardView } from "@/app/(dashboard)/legacy-plan/wizard/_components/wizard-view";

/**
 * The Create Will wizard's save contract, on the real components with a
 * scripted API: "Saved" only after the server confirms; a failed save keeps
 * the edit and offers Retry; leaving with unconfirmed edits is guarded; skip
 * is persisted; a mandatory step validates before anything is sent.
 */
const search = vi.hoisted(() => ({ step: "8" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/legacy-plan/wizard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`step=${search.step}`),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ __internal_openReverification: () => {} }),
}));

const PLAN = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "DRAFT",
  version: 1,
  currentStep: 8,
  stepsData: {},
  completionStatus: {},
  lockVersion: 0,
  finalizedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "t" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Scripted answers for PATCH /steps/*, consumed in order; every request is recorded. */
let saveAnswers: Array<() => Response>;
let saves: { url: string; body: { data: Record<string, unknown>; lockVersion: number } }[];

beforeEach(() => {
  search.step = "8";
  saves = [];
  saveAnswers = [];
  // jsdom gaps the components rely on (as in app-views.test.tsx).
  window.scrollTo = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/steps/") && init?.method === "PATCH") {
        saves.push({ url, body: JSON.parse(String(init.body)) });
        const answer = saveAnswers.shift();
        return answer
          ? answer()
          : envelope({ lockVersion: saves.length, step: url.split("/").pop(), complete: true });
      }
      if (url.includes("/legacy-plans/current")) return envelope(PLAN);
      if (url.includes("/review")) return envelope({});
      return envelope({ items: [], total: 0, page: 1, limit: 100 });
    }),
  );
});

const statusText = () => screen.getAllByRole("status").map((node) => node.textContent ?? "");

describe("create will — saving", () => {
  it("shows Saved only after the server confirms, and keeps a failed edit for Retry", async () => {
    saveAnswers.push(() => failure(503, "SERVICE_UNAVAILABLE", "The database is not responding."));
    render(
      <Providers>
        <WizardView />
      </Providers>,
    );
    const field = await screen.findByLabelText(/Instructions for my executor/i);
    fireEvent.change(field, { target: { value: "Donate my books to the library" } });

    // Debounced save fails: no "Saved", an explanation and a Retry.
    await waitFor(() => expect(statusText().join(" ")).toMatch(/Save failed/), { timeout: 5_000 });
    expect(statusText().join(" ")).not.toMatch(/Saved/);
    expect(screen.getByRole("alert")).toHaveTextContent(/not responding/);

    // Retry resends the same edit; only the confirmed save turns it green.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statusText().join(" ")).toMatch(/Saved/), { timeout: 5_000 });
    expect(saves).toHaveLength(2);
    expect(saves[1]!.body.data).toMatchObject({ instructions: "Donate my books to the library" });
  });

  it("guards leaving while an edit is unconfirmed, and not after it saved", async () => {
    render(
      <Providers>
        <WizardView />
      </Providers>,
    );
    const field = await screen.findByLabelText(/Personal messages/i);
    fireEvent.change(field, { target: { value: "Thank you for everything" } });

    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    await waitFor(() => expect(statusText().join(" ")).toMatch(/Saved/), { timeout: 5_000 });
    const later = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("persists Skip for now on an optional step and moves on", async () => {
    render(
      <Providers>
        <WizardView />
      </Providers>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", { level: 2, name: /Document attachments/i });
    expect(saves).toHaveLength(1);
    expect(saves[0]!.url).toMatch(/\/steps\/special-wishes$/);
    expect(saves[0]!.body.data).toMatchObject({ skipped: true });
  });

  it("validates a mandatory step before sending anything and offers no skip", async () => {
    search.step = "1";
    render(
      <Providers>
        <WizardView />
      </Providers>,
    );
    await screen.findByRole("heading", { level: 2, name: /Personal details/i });
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    await waitFor(() =>
      expect(screen.getByText("Enter the full legal name used in the plan")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: /Personal details/i }),
    ).toBeInTheDocument();
    expect(saves).toHaveLength(0);
  });

  it("explains what an untouched step needs instead of a generic error", async () => {
    search.step = "4";
    render(
      <Providers>
        <WizardView />
      </Providers>,
    );
    await screen.findByRole("heading", { level: 2, name: /Financial assets/i });
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/ }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/Include at least one asset, or mark this class as/).length,
      ).toBeGreaterThan(0),
    );
    expect(document.body.textContent).not.toMatch(/expected (string|array), received undefined/);
    expect(saves).toHaveLength(0);
  });
});
