"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompleteOnboarding, useUpdateProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/client/api-client";

/**
 * The three things the rest of the product actually reads (FR-B002).
 *
 * Nothing here is required: an empty answer is a fair answer on day one, and
 * every field is editable later in Settings. What matters is that the account
 * leaves this page marked as onboarded, so it is never asked again.
 */
export function OnboardingForm({ name }: { name: string }) {
  const router = useRouter();
  const updateProfile = useUpdateProfile();
  const complete = useCompleteOnboarding();
  const [form, setForm] = useState({ dateOfBirth: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string | null> = {};
      if (form.dateOfBirth) patch.dateOfBirth = form.dateOfBirth;
      if (form.phone.trim()) patch.phone = form.phone.trim();
      if (Object.keys(patch).length > 0) await updateProfile.mutateAsync(patch);

      await complete.mutateAsync();
      // The gate that sent the person here is evaluated on the server, so the
      // cached payload for the destination has to go before navigating to it.
      router.refresh();
      router.replace("/dashboard");
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof ApiError ? error.message : "We could not save that.");
    }
  };

  // Clerk may only know an email address on the first run; a mailbox is not a
  // name to greet someone by.
  const greeting = name.includes("@") ? "Welcome" : `Welcome, ${name.split(" ")[0]}`;

  return (
    <Card className="glass-strong">
      <CardHeader className="space-y-3">
        <BrandLogo />
        <CardTitle className="text-2xl">{greeting}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Two details to start with. You can change them, and add everything else, at any time.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <FormField label="Date of birth" hint="Used on your legacy plan, never shown publicly.">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
            />
          )}
        </FormField>

        <FormField label="Phone" hint="For account recovery and urgent notifications.">
          {(props) => (
            <Input
              {...props}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          )}
        </FormField>

        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
          Everything you store is private to you. Sensitive fields are encrypted, documents live in
          private storage, and nothing reaches anyone else unless you decide it should.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void finish()}>
            {busy ? "Saving…" : "Start building my vault"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
            Skip for now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
