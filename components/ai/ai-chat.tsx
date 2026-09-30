"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Copy,
  RotateCcw,
  Square,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { AiGeneratedLabel } from "@/components/ai/ai-disclaimer";
import { MarkdownText } from "@/components/ai/markdown-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { streamAI } from "@/hooks/use-ai";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ApiError } from "@/lib/client/api-client";
import { MAX_CHAT_HISTORY_TURNS, type ChatTurn } from "@/lib/validators/ai.validators";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  truncated?: boolean;
}

interface AIChatProps {
  /** Streaming endpoint under /api/v1, e.g. `/ai/assistant/message`. */
  endpoint: string;
  /** Shapes the request body from the new message and the prior turns. */
  buildBody: (message: string, history: ChatTurn[]) => unknown;
  suggestions: string[];
  placeholder: string;
  emptyTitle: string;
  emptyDescription: string;
  /** When set, the chat is disabled and this explains why. */
  unavailableReason?: string | null;
  className?: string;
  maxHistory?: number;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="AI is thinking">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1.5 animate-bounce rounded-full bg-brand-cyan motion-reduce:animate-none"
          style={{ animationDelay: `${dot * 120}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Streaming chat (ADR-016 § 2): the conversation exists only in this
 * component's state. Each message sends at most the last N completed turns;
 * nothing is persisted on either side, and clearing the chat forgets it.
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
}: AIChatProps) {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const controller = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streaming = messages.some((message) => message.status === "streaming");
  const disabled = Boolean(unavailableReason);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [messages, reduced]);

  useEffect(() => () => controller.current?.abort(), []);

  const patch = (id: string, next: Partial<ChatMessage>) =>
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...next } : m)));

  const send = async (text: string, prior: ChatMessage[]) => {
    const message = text.trim();
    if (!message || streaming || disabled) return;

    const history: ChatTurn[] = prior
      .filter((m) => m.status === "done" && m.content.trim())
      .slice(-maxHistory)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8_000) }));

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      status: "done",
    };
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
    };
    setMessages([...prior, user, reply]);
    setDraft("");

    const abort = new AbortController();
    controller.current = abort;
    try {
      const done = await streamAI(endpoint, buildBody(message, history), {
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
      if (controller.current === abort) controller.current = null;
    }
  };

  const retryLast = () => {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;
    void send(messages[lastUserIndex]!.content, messages.slice(0, lastUserIndex));
  };

  const last = messages[messages.length - 1];

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
                  disabled={disabled}
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
            {messages.map((message) => (
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
                  {message.role === "user" ? (
                    <p className="text-sm leading-6 whitespace-pre-wrap">{message.content}</p>
                  ) : message.content ? (
                    <MarkdownText text={message.content} />
                  ) : message.status === "streaming" ? (
                    <TypingDots />
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
          void send(draft, messages);
        }}
      >
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft, messages);
              }
            }}
            placeholder={placeholder}
            aria-label="Message"
            rows={2}
            maxLength={4000}
            disabled={disabled}
            className="min-h-[3.25rem] resize-none pr-14"
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
              disabled={!draft.trim() || disabled}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Enter to send · Shift+Enter for a new line · not stored after you leave</span>
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
                onClick={() => setMessages([])}
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
