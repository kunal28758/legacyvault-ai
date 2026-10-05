import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/use-beneficiaries", () => ({
  useBeneficiaries: () => ({
    data: {
      items: [
        {
          id: "b1",
          name: "Asha Rao",
          relationship: "Friend",
          email: "asha@example.com",
          phone: null,
          status: "PENDING",
          invitedAt: null,
          activatedAt: null,
          notes: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          roles: {
            assignmentCount: 0,
            isTrustedContact: false,
            isEmergencyContact: false,
            averageAllocation: 0,
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    },
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({ data: { shares: [] } }),
  useShareDocument: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
}));

import { ShareDocumentDialog } from "@/components/documents/share-document-dialog";

/**
 * Sharing a document, as the owner sees it.
 *
 * One request records the share, issues the link and sends the email, so the
 * dialog shows indeterminate work while it runs — never a staged percentage it
 * cannot observe — blocks a second submit, reports the real outcome, and on
 * failure stops with the server's error and a retry.
 */
const onOpenChange = vi.fn();

function renderDialog() {
  return render(<ShareDocumentDialog open onOpenChange={onOpenChange} documentId="doc-1" />);
}

async function chooseAsha() {
  const trigger = screen.getByRole("dialog").querySelector('[data-slot="select-trigger"]')!;
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: /Asha Rao/ }));
}

beforeEach(() => {
  state.isPending = false;
  state.mutateAsync.mockReset();
  onOpenChange.mockReset();
});

describe("ShareDocumentDialog progress", () => {
  it("shows indeterminate work, locks the form and refuses a second submit", () => {
    state.isPending = true;
    renderDialog();

    expect(screen.getByRole("status")).toHaveTextContent(/Sharing securely/);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    const button = screen.getByRole("button", { name: "Sharing…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog").querySelector('[data-slot="select-trigger"]'),
    ).toHaveAttribute("data-disabled");
  });

  it("reports success with the real email outcome and closes", async () => {
    state.mutateAsync.mockResolvedValue({ shares: [], accessEmailSent: true });
    renderDialog();
    await chooseAsha();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share document" }));
    });

    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    expect(state.mutateAsync).toHaveBeenCalledWith({ id: "doc-1", beneficiaryId: "b1" });
    expect(toast.success).toHaveBeenCalledWith(
      "Document shared",
      expect.objectContaining({ description: expect.stringMatching(/emailed them/) }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stops on failure with the server's error, and retries the same share", async () => {
    state.mutateAsync
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ shares: [], accessEmailSent: false });
    renderDialog();
    await chooseAsha();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share document" }));
    });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not share this document.");
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(2));
    expect(state.mutateAsync).toHaveBeenLastCalledWith({ id: "doc-1", beneficiaryId: "b1" });
    expect(toast.success).toHaveBeenCalledWith(
      "Document shared",
      expect.objectContaining({ description: expect.stringMatching(/could not be sent/) }),
    );
  });
});
