"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/client/api-client";

/**
 * Code entry, and then the wait (FR-J003–J005).
 *
 * Verifying proves the request came from the right mailbox; it grants nothing.
 * After that the page polls the request's own status — which says only what
 * state it is in — until the owner decides or their timeout rule does.
 */
type Status = "VERIFYING" | "VERIFIED" | "FAILED" | "EXPIRED" | string;

const POLL_MS = 15_000;

export function EmergencyVerifyForm() {
  const requestId = useSearchParams().get("r");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The request's own state, polled only while a decision is outstanding.
  const statusQuery = useQuery({
    queryKey: ["emergency-request-status", requestId ?? "none"],
    enabled: Boolean(requestId),
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<{ status: Status }>(
        `/emergency-access/requests/${requestId}/status`,
        { signal },
      );
      return data.status;
    },
    refetchInterval: (query) => (query.state.data === "VERIFIED" ? POLL_MS : false),
    retry: false,
  });

  const status = verified ?? statusQuery.data ?? null;

  const verify = async () => {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ status: Status }>("/emergency-access/verify", {
        requestId,
        code: code.trim(),
      });
      setVerified(data.status);
      if (data.status === "VERIFYING") {
        setVerified(null);
        setError("That code was not right. Try again.");
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "We could not check that code just now.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!requestId) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle>This link is incomplete</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Open the link from the email you received, or start again from the link the account holder
          sent you.
        </CardContent>
      </Card>
    );
  }

  if (status && status !== "VERIFYING") return <Outcome status={status} />;

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Enter your code</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We emailed you a six-digit code. It expires in 15 minutes, and three wrong attempts end
          the request.
        </p>
        <div className="space-y-2">
          <Label htmlFor="emergency-code">Verification code</Label>
          <Input
            id="emergency-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="text-center text-2xl tracking-[0.4em]"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === 6) void verify();
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          className="w-full"
          disabled={code.length !== 6 || busy}
          onClick={() => void verify()}
        >
          {busy ? "Checking…" : "Verify"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Outcome({ status }: { status: Status }) {
  const view = OUTCOMES[status] ?? OUTCOMES.EXPIRED;
  const Icon = view.icon;
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <span className={`flex size-10 items-center justify-center rounded-xl ${view.tone}`}>
          <Icon className="size-5" aria-hidden />
        </span>
        <CardTitle>{view.title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{view.body}</CardContent>
    </Card>
  );
}

const OUTCOMES: Record<string, { icon: typeof Clock; tone: string; title: string; body: string }> =
  {
    VERIFIED: {
      icon: Clock,
      tone: "bg-brand-purple/15 text-brand-purple",
      title: "Verified — waiting for a decision",
      body: "The account holder has been asked to approve. If they approve, your access link arrives by email. You can close this page; nothing is lost.",
    },
    APPROVED: {
      icon: CheckCircle2,
      tone: "bg-success/15 text-success",
      title: "Approved",
      body: "Your access link is on its way by email. It is read-only and expires.",
    },
    AUTO_GRANTED: {
      icon: CheckCircle2,
      tone: "bg-success/15 text-success",
      title: "Approved",
      body: "The account holder's timeout rule granted this request. Your access link is on its way by email.",
    },
    ACTIVE: {
      icon: CheckCircle2,
      tone: "bg-success/15 text-success",
      title: "Access granted",
      body: "Your access link was sent by email. If you cannot find it, ask the account holder to send it again.",
    },
    DENIED: {
      icon: ShieldAlert,
      tone: "bg-destructive/10 text-destructive",
      title: "Not approved",
      body: "The account holder did not approve this request. You can ask again later if the situation changes.",
    },
    FAILED: {
      icon: ShieldAlert,
      tone: "bg-destructive/10 text-destructive",
      title: "This request has ended",
      body: "The code was entered incorrectly too many times, or it expired. Start again from the link the account holder sent you.",
    },
    REVOKED: {
      icon: ShieldAlert,
      tone: "bg-destructive/10 text-destructive",
      title: "Access was revoked",
      body: "The account holder ended this access. Ask them directly if you still need it.",
    },
    EXPIRED: {
      icon: Clock,
      tone: "bg-muted text-muted-foreground",
      title: "This request has expired",
      body: "Requests are open for a limited time. Start again from the link the account holder sent you.",
    },
  };
