import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIChat } from "@/components/ai/ai-chat";
import type { UploadOutcome } from "@/lib/types/document";

/**
 * The assistant composer's attachments (ADR-005, ADR-008 § 5).
 *
 * The upload itself is the vault's (covered by the upload-pipeline suites);
 * here it is scripted so each stage can be held and inspected. Asserted: a
 * file can only be sent once the server has promoted it, only its document id
 * is sent, a removed file is not sent, a refused file never starts an upload,
 * and files from earlier turns are carried visibly — and can be left out.
 */
type UploadRequest = {
  file: File;
  onPhase?: (phase: string, uploadId?: string) => void;
  onProgress?: (percent: number) => void;
};

const uploads = vi.hoisted(() => ({
  calls: [] as UploadRequest[],
  settle: [] as ((outcome: UploadOutcome) => void)[],
  retries: [] as { uploadId: string }[],
}));

vi.mock("@/hooks/use-documents", () => ({
  UploadCancelledError: class UploadCancelledError extends Error {},
  useUpload: () => ({
    mutateAsync: (request: UploadRequest) => {
      uploads.calls.push(request);
      request.onPhase?.("validating");
      request.onPhase?.("uploading", `upload-${uploads.calls.length}`);
      request.onProgress?.(100);
      request.onPhase?.("scanning", `upload-${uploads.calls.length}`);
      return new Promise<UploadOutcome>((resolve) => uploads.settle.push(resolve));
    },
  }),
  useRetryUpload: () => ({
    mutateAsync: async ({ uploadId }: { uploadId: string }) => {
      uploads.retries.push({ uploadId });
      return promoted(uploadId, "doc-retried");
    },
  }),
}));

function promoted(uploadId: string, documentId: string): UploadOutcome {
  return {
    uploadId,
    status: "PROMOTED",
    rejectionReason: null,
    scan: { status: "CLEAN", performed: true, provider: "clamav", scannedAt: null },
    retryable: false,
    inProgress: false,
    documentId,
  };
}

const sent: { message: string; attachmentIds: string[] }[] = [];

function ndjson(...events: unknown[]) {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

beforeEach(() => {
  uploads.calls.length = 0;
  uploads.settle.length = 0;
  uploads.retries.length = 0;
  sent.length = 0;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return ndjson(
        { type: "delta", text: "Here is what the file says." },
        { type: "done", truncated: false, provider: "gemini", model: "m" },
      );
    }),
  );
});

function renderChat() {
  const view = render(
    <AIChat
      endpoint="/ai/assistant/message"
      buildBody={(message, history, attachmentIds) => ({ message, history, attachmentIds })}
      suggestions={[]}
      placeholder="Ask"
      emptyTitle="How can I help?"
      emptyDescription=""
      allowAttachments
    />,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const choose = (...files: File[]) => fireEvent.change(input, { target: { files } });
  return { ...view, choose };
}

const pdf = () => new File(["%PDF-1.7"], "policy.pdf", { type: "application/pdf" });
const send = () => screen.getByRole("button", { name: "Send" });
const pending = () => screen.getByRole("list", { name: "Files to send" });

describe("assistant attachments", () => {
  it("has a labelled attach control that accepts only AI-readable types", () => {
    const { container } = renderChat();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeEnabled();
    const accept = container.querySelector('input[type="file"]')!.getAttribute("accept")!;
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("image/png");
    expect(accept).not.toContain(".exe");
    expect(accept).not.toContain("application/msword");
  });

  it("holds Send until the security scan promotes the file, then sends only its id", async () => {
    const { choose } = renderChat();
    choose(pdf());

    expect(within(pending()).getByText(/Scanning for malware/)).toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/uploaded and scanned/);

    await act(async () => uploads.settle[0]!(promoted("upload-1", "doc-1")));
    expect(within(pending()).getByText("Ready")).toBeInTheDocument();
    expect(send()).toBeEnabled();

    // An empty message with a file asks for a summary, visibly.
    fireEvent.click(send());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      message: "Summarize the attached file.",
      attachmentIds: ["doc-1"],
    });
    expect(screen.getByRole("list", { name: "Attached files" })).toHaveTextContent("policy.pdf");
    await screen.findByText("Here is what the file says.");
  });

  it("never starts an upload for a refused file, and blocks Send until it is removed", () => {
    const { choose } = renderChat();
    choose(new File(["MZ"], "setup.exe", { type: "application/x-msdownload" }));

    expect(uploads.calls).toHaveLength(0);
    expect(within(pending()).getByText(/not accepted/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    expect(send()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove setup.exe" }));
    expect(send()).toBeEnabled();
  });

  it("does not send a file removed before sending", async () => {
    const { choose } = renderChat();
    choose(pdf());
    await act(async () => uploads.settle[0]!(promoted("upload-1", "doc-1")));
    fireEvent.click(screen.getByRole("button", { name: "Remove policy.pdf" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Just a question" },
    });
    fireEvent.click(send());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.attachmentIds).toEqual([]);
  });

  it("carries earlier files into follow-ups, visibly, until the user leaves them out", async () => {
    const { choose } = renderChat();
    choose(pdf());
    await act(async () => uploads.settle[0]!(promoted("upload-1", "doc-1")));
    fireEvent.click(send());
    await screen.findByText("Here is what the file says.");

    const carried = screen.getByRole("list", {
      name: "Files from this conversation included with your next message",
    });
    expect(carried).toHaveTextContent("policy.pdf");

    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "When does it expire?" } });
    fireEvent.click(send());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ message: "When does it expire?", attachmentIds: ["doc-1"] });
    await waitFor(() => expect(screen.getAllByText("Here is what the file says.")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Stop including policy.pdf" }));
    fireEvent.change(box, { target: { value: "Unrelated question" } });
    fireEvent.click(send());
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]!.attachmentIds).toEqual([]);
  });

  it("sends one request for a double-clicked Send (no duplicate messages)", async () => {
    renderChat();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    const button = send();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
    await screen.findByText("Here is what the file says.");
    expect(sent).toHaveLength(1);
    expect(screen.getAllByText("Hello")).toHaveLength(1);
  });

  it("shows a malware rejection and keeps the file out of the message", async () => {
    const { choose } = renderChat();
    choose(pdf());
    await act(async () =>
      uploads.settle[0]!({
        uploadId: "upload-1",
        status: "REJECTED",
        rejectionReason: "The file was rejected by the malware scanner.",
        scan: { status: "INFECTED", performed: true, provider: "clamav", scannedAt: null },
        retryable: false,
        inProgress: false,
      }),
    );
    expect(within(pending()).getByText(/rejected by the malware scanner/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry scan" })).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it("offers a retry when the scanner was unavailable, and never treats the file as ready", async () => {
    const { choose } = renderChat();
    choose(pdf());
    await act(async () =>
      uploads.settle[0]!({
        uploadId: "upload-1",
        status: "UPLOADED",
        rejectionReason:
          "The malware scanner is unavailable. Your file is held securely in quarantine — try again.",
        scan: { status: "ERROR", performed: false, provider: "clamav", scannedAt: null },
        retryable: true,
        inProgress: false,
      }),
    );
    expect(within(pending()).getByText(/scanner is unavailable/)).toBeInTheDocument();
    expect(send()).toBeDisabled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry scan" })));
    expect(uploads.retries).toEqual([{ uploadId: "upload-1" }]);
    expect(within(pending()).getByText("Ready")).toBeInTheDocument();
  });
});
