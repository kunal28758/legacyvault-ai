import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/components/providers";

import { SettingsView } from "@/app/(dashboard)/settings/_components/settings-view";

/**
 * Settings → Account → Your data. Asserted: each format asks the server for
 * its own file; the download carries the server's file name; every export
 * button is disabled while one runs; success is announced only after a file
 * was handed to the browser, and a failure never downloads anything.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=account"),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({
    signOut: vi.fn(),
    openUserProfile: vi.fn(),
    __internal_openReverification: vi.fn(),
  }),
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
  deletionRequestedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let exportUrls: string[];
let downloads: string[];
let exportResponse: () => Promise<Response>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  exportUrls = [];
  downloads = [];
  exportResponse = async () =>
    new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      headers: {
        "Content-Type": XLSX,
        "Content-Disposition": 'attachment; filename="legacyvault-export-2026-10-16.xlsx"',
      },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/users/me/export")) {
        exportUrls.push(url);
        return url.includes("format=")
          ? exportResponse()
          : json({ success: true, data: { exportedAt: "x" }, meta: {} });
      }
      const data = url.includes("/users/me")
        ? PROFILE
        : { items: [], total: 0, page: 1, limit: 50 };
      return json({ success: true, data, meta: { correlationId: "t" } });
    }),
  );
  URL.createObjectURL = vi.fn(() => "blob:export");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
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
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => [];
});

async function openAccountTab() {
  render(
    <Providers>
      <SettingsView user={{ name: "Aarav Mehta", email: null, imageUrl: null }} clerkEnabled />
    </Providers>,
  );
  await screen.findByText("Excel workbook");
}

describe("settings — export", () => {
  it("downloads the Excel workbook under the server's file name, then says so", async () => {
    await openAccountTab();
    // Each button carries its format's description for screen readers.
    expect(screen.getByRole("button", { name: "Download .xlsx" })).toHaveAccessibleDescription(
      /One sheet per category/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    expect(await screen.findByText("Excel workbook downloaded")).toBeInTheDocument();
    expect(exportUrls).toEqual(["/api/v1/users/me/export?format=xlsx"]);
    expect(downloads).toEqual(["legacyvault-export-2026-10-16.xlsx"]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("asks for the CSV archive and the JSON file by their own formats", async () => {
    await openAccountTab();
    exportResponse = async () =>
      new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="legacyvault-export-2026-10-16-csv.zip"',
        },
      });
    fireEvent.click(screen.getByRole("button", { name: "Download .zip" }));
    await screen.findByText("CSV files downloaded");
    fireEvent.click(screen.getByRole("button", { name: "Download .json" }));
    await screen.findByText("JSON (advanced) downloaded");
    expect(exportUrls).toEqual(["/api/v1/users/me/export?format=csv", "/api/v1/users/me/export"]);
    expect(downloads[0]).toBe("legacyvault-export-2026-10-16-csv.zip");
    expect(downloads[1]).toMatch(/^legacyvault-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("disables every export while one runs", async () => {
    let release!: (response: Response) => void;
    exportResponse = () => new Promise((resolve) => (release = resolve));
    await openAccountTab();
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download .zip" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Download .json" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download your data/ })).toBeDisabled();
    expect(downloads).toEqual([]);
    release(json({ success: false, error: { code: "INTERNAL", message: "x" } }, 500));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download .zip" })).toBeEnabled(),
    );
  });

  it("shows the server's error and downloads nothing when the export fails", async () => {
    exportResponse = async () =>
      json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." },
        },
        429,
      );
    const success = vi.spyOn(toast, "success");
    await openAccountTab();
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    expect(await screen.findByText("Too many requests. Try again later.")).toBeInTheDocument();
    expect(downloads).toEqual([]);
    expect(success).not.toHaveBeenCalled();
    success.mockRestore();
  });

  it("offers a copy from the account-deletion card", async () => {
    await openAccountTab();
    fireEvent.click(screen.getByRole("button", { name: "Download your data (.xlsx)" }));
    await screen.findByText("Excel workbook downloaded");
    expect(exportUrls).toEqual(["/api/v1/users/me/export?format=xlsx"]);
  });
});
