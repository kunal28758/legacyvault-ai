"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Copy,
  Paperclip,
  RotateCcw,
  Square,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import {
  AttachmentChip,
  SentAttachmentList,
  useChatAttachments,
  type SentAttachment,
} from "@/components/ai/chat-attachments";
import { AiGeneratedLabel } from "@/components/ai/ai-disclaimer";
import { MarkdownText } from "@/components/ai/markdown-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { streamAI } from "@/hooks/use-ai";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ApiError } from "@/lib/client/api-client";
import { MAX_DOCUMENT_BYTES } from "@/lib/uploads/file-types";
import {
  AI_ATTACHMENT_ACCEPT,
  AI_ATTACHMENT_TYPES_LABEL,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_HISTORY_TURNS,
  type ChatTurn,
} from "@/lib/validators/ai.validators";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  truncated?: boolean;
  /** Files attached with this message (shown on it). */
  attachments?: SentAttachment[];
  /** Every file sent with this message, including ones carried from earlier. */
  attachmentIds?: string[];
}

interface AIChatProps {
  /** Streaming endpoint under /api/v1, e.g. `/ai/assistant/message`. */
  endpoint: string;
  /** Shapes the request body from the new message, the prior turns and any attached files. */
  buildBody: (message: string, history: ChatTurn[], attachmentIds: string[]) => unknown;
  suggestions: string[];
  placeholder: string;
  emptyTitle: string;
  emptyDescription: string;
  /** When set, the chat is disabled and this explains why. */
  unavailableReason?: string | null;
  className?: string;
  maxHistory?: number;
  /** Lets the user attach files (uploaded to the vault first) to a message. */
  allowAttachments?: boolean;
}

/** After this long without a word, say the request is still alive. */
const SLOW_REPLY_MS = 10_000;

function TypingDots({ reading }: { reading: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_REPLY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <span className="inline-flex items-center gap-2 py-1">
      <span className="inline-flex items-center gap-1" aria-label="AI is thinking">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 animate-bounce rounded-full bg-brand-cyan motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </span>
      {(reading || slow) && (
        <span className="text-xs text-muted-foreground">
          {slow ? "Still working on it — the AI service is busy…" : "Reading your files…"}
        </span>
      )}
    </span>
  );
}

function defaultQuestion(count: number): string {
  return count === 1 ? "Summarize the attached file." : "Summarize the attached files.";
}

/**
 * Streaming chat (ADR-016 § 2): the conversation exists only in this
 * component's state. Each message sends at most the last N completed turns;
 * nothing is persisted on either side, and clearing the chat forgets it.
 *
 * With `allowAttachments`, files go through the vault's upload pipeline first
 * (private storage, size and type checks) and only their document ids are
 * sent. Files from earlier in the conversation are carried into the next
 * message — visibly, and removable — so follow-up questions can refer to them.
 */
export function AIChat({
  endpoint,
  buildBody,
  suggestions,
  placeholder,
  emptyTitle,
  emptyDescription,
  unavailableReason,
  className,
  maxHistory = MAX_CHAT_HISTORY_TURNS,
  allowAttachments = false,
}: AIChatProps) {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const files = useChatAttachments(MAX_CHAT_ATTACHMENTS);
  const streaming = messages.some((message) => message.status === "streaming");
  const disabled = Boolean(unavailableReason);

  const ready: SentAttachment[] = files.pending.flatMap((a) =>
    a.state === "ready" && a.documentId
      ? [{ documentId: a.documentId, name: a.name, size: a.size, mimeType: a.mimeType }]
      : [],
  );
  const working = files.pending.some(
    (a) => a.state === "preparing" || a.state === "uploading" || a.state === "saving",
  );
  const failed = files.pending.some((a) => a.state === "failed");

  // Files from earlier messages, newest first, that the next message carries.
  const carried: SentAttachment[] = [];
  if (allowAttachments) {
    const seen = new Set(ready.map((a) => a.documentId));
    for (const message of [...messages].reverse()) {
      for (const attachment of message.attachments ?? []) {
        if (seen.has(attachment.documentId) || dropped.has(attachment.documentId)) continue;
        seen.add(attachment.documentId);
        carried.push(attachment);
      }
    }
    carried.splice(Math.max(0, MAX_CHAT_ATTACHMENTS - ready.length));
  }

  const canSend =
    !streaming && !disabled && !working && !failed && (draft.trim().length > 0 || ready.length > 0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [messages, reduced]);

  useEffect(() => () => controller.current?.abort(), []);

  const patch = (id: string, next: Partial<ChatMessage>) =>
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...next } : m)));

  const send = async (
    text: string,
    prior: ChatMessage[],
    resend?: { attachments: SentAttachment[]; attachmentIds: string[] },
  ) => {
    if (streaming || disabled || sending.current) return;
    const attachments = resend ? resend.attachments : ready;
    const attachmentIds = resend
      ? resend.attachmentIds
      : [...ready, ...carried].map((a) => a.documentId).slice(0, MAX_CHAT_ATTACHMENTS);
    if (!resend && (working || failed)) return;

    const message = text.trim() || (attachments.length ? defaultQuestion(attachments.length) : "");
    if (!message) return;
    sending.current = true;

    const history: ChatTurn[] = prior
      .filter((m) => m.status === "done" && m.content.trim())
      .slice(-maxHistory)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8_000) }));

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      status: "done",
      attachments,
      attachmentIds,
    };
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
    };
    setMessages([...prior, user, reply]);
    setDraft("");
    if (!resend) files.clear();

    const abort = new AbortController();
    controller.current = abort;
    try {
      const done = await streamAI(endpoint, buildBody(message, history, attachmentIds), {
        signal: abort.signal,
        onDelta: (delta) =>
          setMessages((current) =>
            current.map((m) => (m.id === reply.id ? { ...m, content: m.content + delta } : m)),
          ),
      });
      patch(reply.id, { status: "done", truncated: done.truncated });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        patch(reply.id, { status: "stopped" });
      } else {
        patch(reply.id, {
          status: "error",
          error:
            error instanceof ApiError
              ? error.isRateLimited
                ? `You've reached the AI limit for now. Try again${error.retryAfterSeconds ? ` in about ${Math.ceil(error.retryAfterSeconds / 60)} min` : " later"}.`
                : error.message
              : "The AI could not answer. Try again.",
        });
      }
    } finally {
      sending.current = false;
      if (controller.current === abort) controller.current = null;
    }
  };

  const submit = () => {
    if (canSend) void send(draft, messages);
  };

  const retryLast = () => {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;
    const original = messages[lastUserIndex]!;
    void send(original.content, messages.slice(0, lastUserIndex), {
      attachments: original.attachments ?? [],
      attachmentIds: original.attachmentIds ?? [],
    });
  };

  const chooseFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const refused = files.add([...list]);
    if (refused > 0) {
      toast.info(`Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`);
    }
  };

  const removeAttachment = (key: string) => {
    const removed = files.remove(key);
    if (removed?.state === "ready") {
      toast.info("Removed from this message", {
        description: "The file was already saved to your document vault and stays there.",
      });
    }
  };

  const last = messages[messages.length - 1];
  const statusHint = working
    ? "Your files are being uploaded. You can send once they are ready."
    : failed
      ? "Remove or retry the files that failed before sending."
      : null;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2"
        aria-live="polite"
        aria-busy={streaming}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow-purple">
              <Bot className="size-6" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="font-medium">{emptyTitle}</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">{emptyDescription}</p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={disabled || working || failed}
                  onClick={() => void send(suggestion, messages)}
                  className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs transition-colors outline-none hover:border-primary/50 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.2 }}
                className={cn("flex gap-3", message.role === "user" && "flex-row-reverse")}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-xl",
                    message.role === "user"
                      ? "bg-muted text-muted-foreground"
                      : "bg-gradient-brand text-primary-foreground",
                  )}
                  aria-hidden
                >
                  {message.role === "user" ? (
                    <UserRound className="size-4" />
                  ) : (
                    <Bot className="size-4" />
                  )}
                </span>
                <div
                  className={cn(
                    "max-w-[85%] min-w-0 rounded-2xl px-4 py-3",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background/70",
                  )}
                >
                  <span className="sr-only">
                    {message.role === "user" ? "You said:" : "Assistant:"}
                  </span>
                  {message.role === "user" && (
                    <SentAttachmentList
                      attachments={message.attachments ?? []}
                      label="Attached files"
                      className="mb-2"
                    />
                  )}
                  {message.role === "user" ? (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{message.content}</p>
                  ) : message.content ? (
                    <MarkdownText text={message.content} />
                  ) : message.status === "streaming" ? (
                    <TypingDots reading={(messages[index - 1]?.attachmentIds?.length ?? 0) > 0} />
                  ) : null}

                  {message.role === "assistant" && message.status === "error" && (
                    <p
                      role="alert"
                      className="mt-1 flex items-start gap-2 text-sm text-destructive"
                    >
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {message.error}
                    </p>
                  )}
                  {message.role === "assistant" && message.status === "stopped" && (
                    <p className="mt-2 text-xs text-muted-foreground">Stopped.</p>
                  )}
                  {message.role === "assistant" && message.truncated && (
                    <p className="mt-2 text-xs text-warning">
                      The answer reached its length limit and may be incomplete.
                    </p>
                  )}
                  {message.role === "assistant" && message.status === "done" && message.content && (
                    <div className="mt-2 flex items-center gap-2">
                      <AiGeneratedLabel />
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(message.content)
                            .then(() => toast.success("Copied"))
                            .catch(() => toast.error("Could not copy"))
                        }
                      >
                        <Copy className="size-3" aria-hidden /> Copy
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>

      {unavailableReason && (
        <p className="mb-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5">
          {unavailableReason}
        </p>
      )}

      <form
        className="space-y-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {allowAttachments && (files.pending.length > 0 || carried.length > 0) && (
          <div className="space-y-2" aria-live="polite">
            {files.pending.length > 0 && (
              <ul aria-label="Files to send" className="flex flex-wrap gap-2">
                {files.pending.map((attachment) => (
                  <AttachmentChip
                    key={attachment.key}
                    attachment={attachment}
                    onRemove={() => removeAttachment(attachment.key)}
                    onRetry={() => files.retry(attachment.key)}
                  />
                ))}
              </ul>
            )}
            {carried.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Also included from this conversation:</span>
                <SentAttachmentList
                  attachments={carried}
                  label="Files from this conversation included with your next message"
                  onRemove={(documentId) =>
                    setDropped((current) => new Set(current).add(documentId))
                  }
                />
              </div>
            )}
          </div>
        )}

        <div className="relative">
          {allowAttachments && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={AI_ATTACHMENT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                  chooseFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="absolute bottom-2 left-2"
                aria-label="Attach files"
                title={`Attach ${AI_ATTACHMENT_TYPES_LABEL}`}
                disabled={disabled || streaming || files.pending.length >= MAX_CHAT_ATTACHMENTS}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip />
              </Button>
            </>
          )}
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label="Message"
            rows={2}
            maxLength={4000}
            disabled={disabled}
            className={cn("min-h-[3.25rem] resize-none pr-14", allowAttachments && "pl-12")}
          />
          {streaming ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="absolute right-2 bottom-2"
              aria-label="Stop generating"
              onClick={() => controller.current?.abort()}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className="absolute right-2 bottom-2 shadow-glow-blue"
              aria-label="Send"
              disabled={!canSend}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
        {statusHint && (
          <p role="status" className="text-[11px] text-muted-foreground">
            {statusHint}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Enter to send · Shift+Enter for a new line · not stored after you leave
            {allowAttachments && (
              <span className="block">
                Attach {AI_ATTACHMENT_TYPES_LABEL} · up to {formatBytes(MAX_DOCUMENT_BYTES)} · files
                are saved to your private document vault
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            {last && (last.status === "error" || last.status === "stopped") && (
              <Button type="button" size="xs" variant="ghost" onClick={retryLast}>
                <RotateCcw data-icon="inline-start" /> Retry
              </Button>
            )}
            {messages.length > 0 && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={streaming}
                onClick={() => {
                  setMessages([]);
                  setDropped(new Set());
                }}
              >
                <Trash2 data-icon="inline-start" /> Clear
              </Button>
            )}
          </span>
        </div>
      </form>
    </div>
  );
}
