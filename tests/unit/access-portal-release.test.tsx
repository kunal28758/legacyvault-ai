import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessPortal } from "@/app/(public)/access/_components/access-portal";

/**
 * The contact's side of an emergency release, in the browser: a release link
 * opens a code step, never the release itself; a wrong code is said plainly
 * and opens nothing; the right one shows why the contact has access, who
 * authorized it, when it ends — and only what was released.
 *
 * The API is stubbed with the real envelope shapes; the server side of the
 * same flow runs against the database in tests/integration/protection.test.ts.
 */
const TOKEN = "release-secret-token-value-0123456789";

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data, meta: { correlationId: "t" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(status: number, code: string, message: string) {
  return new Response(
    JSON.stringify({ success: false, error: { code, message }, meta: { correlationId: "t" } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

const SUMMARY = {
  ownerName: "Priya",
  beneficiaryName: "Asha",
  grantType: "DMS_RELEASE",
  expiresAt: "2026-11-06T12:00:00.000Z",
  issuedAt: "2026-10-07T12:00:00.000Z",
  verifiedAt: "2026-10-07T12:05:00.000Z",
  counts: { documents: 1, assets: 0, videos: 0, planSections: 0 },
};

const exchanges: Record<string, unknown>[] = [];

/** Where the address bar stood when each exchange request went out. */
const addressAtExchange: string[] = [];

beforeEach(() => {
  exchanges.length = 0;
  addressAtExchange.length = 0;
  // The emailed link: the secret is in the fragment, never in the request line.
  window.history.replaceState(null, "", `/access#t=${TOKEN}`);
  vi.spyOn(window.history, "replaceState");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/access/exchange")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        exchanges.push(body);
        addressAtExchange.push(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
        if (!body.code) {
          return ok({
            verificationRequired: true,
            sentTo: "a•••@example.com",
            codeExpiresAt: "2026-10-07T12:20:00.000Z",
          });
        }
        return body.code === "246810"
          ? ok(SUMMARY)
          : failure(
              422,
              "VALIDATION_ERROR",
              "That code is not right. Check the latest email and try again.",
            );
      }
      if (url.includes("/access/resources")) {
        return ok({
          grant: SUMMARY,
          documents: [
            { id: "d1", name: "Letter to Asha.pdf", mimeType: "application/pdf", sizeBytes: 2048 },
          ],
          assets: [],
          videos: [],
          planSections: [],
        });
      }
      return failure(404, "NOT_FOUND", "Not found");
    }),
  );
});

describe("release link in the portal", () => {
  it("asks for the emailed code first and shows nothing of the release", async () => {
    render(<AccessPortal />);

    expect(await screen.findByRole("heading", { name: "Confirm it is you" })).toBeInTheDocument();
    expect(screen.getByText(/a•••@example\.com/)).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    expect(screen.queryByText("Letter to Asha.pdf")).not.toBeInTheDocument();
    // The secret left the address bar before anything else happened: the
    // exchange went out from the bare path, with the secret in its body only.
    expect(window.history.replaceState).toHaveBeenCalled();
    expect(addressAtExchange).toEqual(["/access"]);
    expect(window.location.hash).toBe("");
    expect(exchanges).toEqual([{ token: TOKEN }]);
  });

  it("still opens a legacy query link, clearing it the same way", async () => {
    window.history.replaceState(null, "", `/access?t=${TOKEN}`);
    render(<AccessPortal />);

    expect(await screen.findByRole("heading", { name: "Confirm it is you" })).toBeInTheDocument();
    expect(addressAtExchange).toEqual(["/access"]);
    expect(window.location.search).toBe("");
    expect(exchanges).toEqual([{ token: TOKEN }]);
  });

  it("says a wrong code is wrong, then opens the release with the right one", async () => {
    render(<AccessPortal />);
    const input = await screen.findByLabelText("Verification code");
    const confirm = screen.getByRole("button", { name: "Confirm and open" });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "13579x" } });
    // Only digits are kept, so five digits cannot be submitted.
    expect(input).toHaveValue("13579");
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "135791" } });
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not right/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Letter to Asha.pdf")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "246810" } });
    fireEvent.click(confirm);
    expect(await screen.findByText("Letter to Asha.pdf")).toBeInTheDocument();
    expect(screen.getByText("Why you can see this")).toBeInTheDocument();
    expect(screen.getByText("Priya, in advance")).toBeInTheDocument();
    expect(screen.getByText(/identity confirmed by code/)).toBeInTheDocument();
    expect(screen.getByText(/nothing else in Priya/)).toBeInTheDocument();
    expect(exchanges.at(-1)).toEqual({ token: TOKEN, code: "246810" });
  });

  it("can send a new code without leaving the page", async () => {
    render(<AccessPortal />);
    await screen.findByLabelText("Verification code");
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(exchanges).toHaveLength(2));
    expect(exchanges[1]).toEqual({ token: TOKEN });
  });
});
