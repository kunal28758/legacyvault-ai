"use client";

import { useState } from "react";
import { Siren } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api/client";

/**
 * The emergency request form (FR-J002).
 *
 * The confirmation is deliberately the same whatever happened: a wrong address,
 * an unknown link and a real request all end here. Nothing on this page reveals
 * whose vault it is or whether the person asking was expected.
 */
export function EmergencyRequestForm({ configId }: { configId: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"form" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setState("sending");
    setError(null);
    try {
      await apiClient.post("/emergency-access/request", { configId, email: email.trim() });
      setState("sent");
    } catch (caught) {
      setState("form");
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not submit that request. Please try again.",
      );
    }
  };

  if (state === "sent") {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            If this link was meant for {email.trim()}, a six-digit code is on its way. It expires in
            15 minutes.
          </p>
          <p>
            After you enter the code, the account holder is asked to approve. If they approve, a
            separate email brings your access link.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <Siren className="size-5" aria-hidden />
        </span>
        <CardTitle>Request emergency access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Someone named you as an emergency contact. Enter the email address this link was sent to
          and we will send you a one-time code.
        </p>
        <div className="space-y-2">
          <Label htmlFor="emergency-email">Your email address</Label>
          <Input
            id="emergency-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && email.trim()) void submit();
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          className="w-full"
          disabled={!email.trim() || state === "sending"}
          onClick={() => void submit()}
        >
          {state === "sending" ? "Sending…" : "Send me a code"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Access is never automatic. The account holder decides, and only the parts they chose in
          advance are ever shown.
        </p>
      </CardContent>
    </Card>
  );
}
