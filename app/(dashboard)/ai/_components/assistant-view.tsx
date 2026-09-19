"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  FlaskConical,
  Lightbulb,
  RotateCcw,
  ScrollText,
  Sparkles,
  UserRound,
} from "lucide-react";

import { AiDisclaimer, AiGeneratedLabel } from "@/components/shared/ai-disclaimer";
import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useDemoWorkspace } from "@/hooks/use-demo-workspace";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { SUGGESTED_PROMPTS, generateAssistantReply } from "@/lib/demo/assistant";
import { getPlanCompleteness, unassignedAssets } from "@/lib/demo/selectors";
import { useDemoStore } from "@/lib/demo/store";
import { cn } from "@/lib/utils";

interface PendingReply {
  flags: string[];
  suggestions: string[];
}

/** AI Assistant (task T112 — UI; streaming Route Handler + provider pending T108–T110). */
export function AssistantView() {
  const { workspace: ws, ready } = useDemoWorkspace();
  const append = useDemoStore((s) => s.appendChatMessage);
  const clear = useDemoStore((s) => s.clearChat);
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [meta, setMeta] = useState<Record<string, PendingReply>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [ws.chat.length, typing, reduced]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!ready) return <PageSkeleton stats={0} />;

  const send = (text: string) => {
    const message = text.trim();
    if (!message || typing) return;
    append({ role: "user", content: message });
    setDraft("");
    setTyping(true);
    const reply = generateAssistantReply(message, ws);
    timer.current = window.setTimeout(
      () => {
        append({ role: "assistant", content: reply.content });
        setTyping(false);
        // Attach flags/suggestions to the newest assistant message once it exists.
        const latest = useDemoStore.getState().workspace.chat.at(-1);
        if (latest?.role === "assistant")
          setMeta((prev) => ({
            ...prev,
            [latest.id]: { flags: reply.flags, suggestions: reply.suggestions },
          }));
      },
      900 + Math.min(1400, reply.content.length * 4),
    );
  };

  const plan = getPlanCompleteness(ws);
  const unassigned = unassignedAssets(ws);
  const contextual = [
    ...(plan.incompleteSections.length
      ? [`My plan is ${plan.percent}% complete — what should I do next?`]
      : []),
    ...(unassigned.length
      ? [`Which of my ${unassigned.length} unassigned assets should I handle first?`]
      : []),
    ...(!ws.security.mfaEnabled ? ["How do I make my account more secure?"] : []),
  ];

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <PageHeader
        eyebrow="AI"
        title="AI Assistant"
        description="Organize, review and draft with an assistant that reads your workspace, flags what it cannot know and never changes an authoritative record on its own."
        actions={
          <>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 text-xs font-medium text-warning">
              <FlaskConical className="size-3.5" aria-hidden /> Demo responses · provider not
              connected
            </span>
            <Button variant="ghost" size="sm" onClick={clear} disabled={ws.chat.length === 0}>
              <RotateCcw data-icon="inline-start" />
              New conversation
            </Button>
          </>
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col glass">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div
            className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6"
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            {ws.chat.length === 0 && (
              <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-10 text-center">
                <span className="flex size-16 items-center justify-center rounded-3xl bg-gradient-brand text-primary-foreground shadow-glow-purple">
                  <Bot className="size-8" aria-hidden />
                </span>
                <div className="space-y-2">
                  <p className="text-xl font-semibold">How can I help with your legacy today?</p>
                  <p className="text-sm text-muted-foreground">
                    I answer from what is in your workspace. Conversations are session-scoped and
                    are not stored on the server.
                  </p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => send(prompt)}
                      className="motion-safe-transition glass-highlight flex items-start gap-2 rounded-xl p-3 text-left text-sm glass outline-none hover:-translate-y-0.5 hover:shadow-glow-blue focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-purple" aria-hidden />
                      {prompt}
                    </button>
                  ))}
                </div>
                {contextual.length > 0 && (
                  <div className="w-full space-y-2 text-left">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Lightbulb className="size-3.5" aria-hidden /> Suggested for you
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {contextual.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => send(prompt)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <AnimatePresence initial={false}>
              {ws.chat.map((message) => {
                const isUser = message.role === "user";
                const extra = meta[message.id];
                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduced ? 0 : 0.25 }}
                    className={cn("flex gap-3", isUser && "flex-row-reverse")}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        isUser
                          ? "bg-muted text-muted-foreground"
                          : "bg-gradient-brand text-primary-foreground",
                      )}
                    >
                      {isUser ? (
                        <UserRound className="size-4" aria-hidden />
                      ) : (
                        <Bot className="size-4" aria-hidden />
                      )}
                    </span>
                    <div
                      className={cn("max-w-[85%] space-y-2 sm:max-w-[75%]", isUser && "items-end")}
                    >
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
                          isUser
                            ? "rounded-tr-sm bg-primary text-primary-foreground"
                            : "rounded-tl-sm border border-border bg-background/60",
                        )}
                      >
                        {message.content}
                      </div>
                      {!isUser && (
                        <div className="flex flex-wrap items-center gap-2">
                          <AiGeneratedLabel />
                          {extra?.flags.map((flag) => (
                            <span
                              key={flag}
                              className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning"
                            >
                              <AlertCircle className="size-3" aria-hidden /> {flag}
                            </span>
                          ))}
                        </div>
                      )}
                      {!isUser && extra?.suggestions.length ? (
                        <div className="flex flex-wrap gap-2">
                          {extra.suggestions.map((s) =>
                            s === "Open the will wizard" ? (
                              <Link
                                key={s}
                                href="/legacy-plan/wizard"
                                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                              >
                                <ScrollText className="mr-1 inline size-3" aria-hidden /> {s}
                              </Link>
                            ) : s === "Open emergency access" ? (
                              <Link
                                key={s}
                                href="/emergency-access"
                                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                              >
                                {s}
                              </Link>
                            ) : s === "Open the Security Center" ? (
                              <Link
                                key={s}
                                href="/security-center"
                                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                              >
                                {s}
                              </Link>
                            ) : s.startsWith("Take me to ") ? (
                              <Link
                                key={s}
                                href="/legacy-plan"
                                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                              >
                                {s}
                              </Link>
                            ) : (
                              <button
                                key={s}
                                type="button"
                                onClick={() => send(s)}
                                className="rounded-full border border-border px-3 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {s}
                              </button>
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {typing && (
              <div className="flex gap-3" aria-label="Assistant is typing">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-primary-foreground">
                  <Bot className="size-4" aria-hidden />
                </span>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-background/60 px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="space-y-3 border-t border-border p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-end gap-2"
            >
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={1}
                placeholder="Ask about your plan, beneficiaries, assets or protection…"
                aria-label="Message the assistant"
                className="max-h-40 min-h-10 flex-1 resize-none"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={!draft.trim() || typing}
                className="shadow-glow-blue"
              >
                <ArrowUp />
              </Button>
            </form>
            <AiDisclaimer compact />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
