import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadOutcome } from "@/lib/types/document";

type Request = {
  onPhase?: (phase: "validating" | "uploading" | "saving", uploadId?: string) => void;
  onProgress?: (percent: number) => void;
};

const run = vi.hoisted(() => ({
  request: null as Request | null,
  settle: null as ((outcome: UploadOutcome) => void) | null,
  fail: null as ((error: unknown) => void) | null,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/use-documents", () => ({
  UploadCancelledError: class UploadCancelledError extends Error {},
  useFolders: () => ({ data: { items: [] } }),
  useRetryUpload: () => ({ mutateAsync: vi.fn() }),
  // The real hook reports phases and progress through these callbacks, from
  // the XMLHttpRequest that carries the bytes; the test drives them the same way.
  useUpload: () => ({
    mutateAsync: (request: Request) => {
      run.request = request;
      request.onPhase?.("validating");
      return new Promise<UploadOutcome>((resolve, reject) => {
        run.settle = resolve;
        run.fail = reject;
      });
    },
  }),
}));

import { UploadDialog } from "@/components/documents/upload-dialog";

/**
 * The production failure, reproduced: a normal-sized file finishes its
 * transfer before the browser reports any progress, so the old card showed
 * "0%" over an empty bar and then a finished file — which reads as nothing
 * happening. These drive the real dialog through the same callbacks the
 * XMLHttpRequest fires and assert what the owner sees at each step.
 */
const file = new File(["%PDF-1.7 test"], "deed.pdf", { type: "application/pdf" });
const promoted: UploadOutcome = {
  uploadId: "u1",
  status: "PROMOTED",
  rejectionReason: null,
  retryable: false,
  inProgress: false,
  documentId: "d1",
};

function startUpload() {
  render(<UploadDialog kind="document" open onOpenChange={vi.fn()} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
}

beforeEach(() => {
  run.request = null;
  toast.success.mockReset();
});

describe("UploadDialog progress, as the owner sees it", () => {
  it("shows the work the moment Upload is clicked, then real progress, then processing", async () => {
    startUpload();

    // Immediately visible, before any server answer or byte progress.
    expect(screen.getByText("Preparing upload…")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Preparing upload deed.pdf" }),
    ).not.toHaveAttribute("aria-valuenow");
    // The disabled drop zone no longer pushes the card below the fold.
    expect(screen.queryByText(/click to browse/i)).not.toBeInTheDocument();

    act(() => run.request!.onPhase!("uploading", "u1"));
    expect(screen.getByText("Preparing upload…")).toBeVisible();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();

    act(() => run.request!.onProgress!(42));
    expect(screen.getByText("42%")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Uploading deed.pdf" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );

    act(() => run.request!.onProgress!(100));
    expect(screen.getByText("99%")).toBeVisible();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();

    act(() => run.request!.onPhase!("saving", "u1"));
    expect(
      screen.getByText("Checking and saving…", { selector: "span.font-medium" }),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Checking and saving deed.pdf" }),
    ).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();

    await act(async () => run.settle!(promoted));
    expect(screen.getByRole("status")).toHaveTextContent("Stored privately");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Added to your vault");
  });

  it("still shows visible work for a fast upload that reports no progress at all", async () => {
    startUpload();
    act(() => run.request!.onPhase!("uploading", "u1"));
    expect(screen.getByRole("progressbar", { name: "Preparing upload deed.pdf" })).toBeVisible();
    act(() => run.request!.onPhase!("saving", "u1"));
    expect(screen.getByRole("progressbar", { name: "Checking and saving deed.pdf" })).toBeVisible();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();

    await act(async () => run.settle!(promoted));
    expect(screen.getByRole("status")).toHaveTextContent("Stored privately");
  });

  it("stops on failure with the real error and a retry", async () => {
    startUpload();
    act(() => run.request!.onPhase!("uploading", "u1"));
    act(() => run.request!.onProgress!(60));
    act(() => run.request!.onPhase!("saving", "u1"));

    await act(async () => run.fail!(new Error("The upload was interrupted.")));

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The upload was interrupted.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Upload failed");
  });
});
