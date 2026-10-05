import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UploadItemCard, newUploadItem, type UploadItem } from "@/components/documents/file-upload";
import { OperationProgress, ProgressLine } from "@/components/shared/operation-progress";

/**
 * Progress is shown, never invented.
 *
 * A determinate bar carries the real percentage in `aria-valuenow`; work the
 * browser cannot measure renders an indeterminate bar with no number at all.
 * The upload card shows the byte percentage only while bytes are moving, and
 * never 100% before the server has stored the file.
 */
describe("OperationProgress", () => {
  it("exposes a real percentage as a determinate progressbar", () => {
    render(<OperationProgress label="Uploading will.pdf" value={68} />);

    const bar = screen.getByRole("progressbar", { name: "Uploading will.pdf" });
    expect(bar).toHaveAttribute("aria-valuenow", "68");
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading will.pdf");
  });

  it("shows unmeasurable work without inventing a number", () => {
    render(<OperationProgress label="Sharing securely…" />);

    const bar = screen.getByRole("progressbar", { name: "Sharing securely…" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("stops the bar on failure and offers a keyboard-reachable retry", () => {
    const onRetry = vi.fn();
    render(
      <OperationProgress
        state="error"
        label="The document was not shared."
        error="The beneficiary is inactive."
        onRetry={onRetry}
      />,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The beneficiary is inactive.");
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ends without a bar on success, and offers cancel only while running", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <OperationProgress label="Uploading" value={10} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<OperationProgress state="success" label="Shared successfully" onCancel={onCancel} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Shared successfully");
  });

  it("renders a bare line without a live region of its own", () => {
    render(<ProgressLine label="Checking" />);
    expect(screen.getByRole("progressbar", { name: "Checking" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("UploadItemCard progress", () => {
  const file = new File(["%PDF-1.7"], "will.pdf", { type: "application/pdf" });
  const card = (patch: Partial<UploadItem>) =>
    render(
      <ul>
        <UploadItemCard
          item={{ ...newUploadItem(file, null), ...patch }}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onRemove={vi.fn()}
        />
      </ul>,
    );

  it("reports the real byte percentage while uploading, with cancel", () => {
    card({ stage: "uploading", progress: 68 });

    expect(screen.getByRole("progressbar", { name: "Uploading will.pdf" })).toHaveAttribute(
      "aria-valuenow",
      "68",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // One live status line per card (the E2E journeys read it).
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("shows processing as indeterminate after the transfer — never 100% early", () => {
    card({ stage: "saving", progress: 100, uploaded: true });

    const bar = screen.getByRole("progressbar", { name: "Checking and saving will.pdf" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("status")).toHaveTextContent("Checking and saving…");
  });

  it("ends with no bar once stored", () => {
    card({ stage: "done", progress: 100, uploaded: true });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Stored privately");
  });

  it("stops on failure with the real error and a retry", () => {
    card({
      stage: "failed",
      progress: 100,
      uploaded: true,
      failedAt: "check",
      retryable: true,
      error: "Request failed (500).",
    });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Request failed (500).");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
