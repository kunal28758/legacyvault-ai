import { KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of the Clerk components while `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
 * / `CLERK_SECRET_KEY` are absent (checklist T195). There is no fallback sign-in:
 * Clerk is the only authentication system (ADR-003).
 */
export function AuthNotConfigured({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <Card className="glass-highlight glass-strong">
      <CardHeader>
        <CardTitle className="text-xl">
          {mode === "sign-in" ? "Sign in" : "Create your account"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Alert>
          <KeyRound />
          <AlertTitle>Authentication is not configured on this deployment</AlertTitle>
          <AlertDescription>
            Add the Clerk keys to <code className="font-mono text-xs">.env.local</code> (see{" "}
            <code className="font-mono text-xs">docs/DEPLOYMENT.md § Clerk</code>) and restart the
            app. The fastest path for local development is{" "}
            <code className="font-mono text-xs">npx -y clerk@latest init</code>, which provisions
            development keys.
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground">
          Sign-in, sign-up, email verification and multi-factor authentication are provided by
          Clerk; LegacyVault never stores passwords itself.
        </p>
      </CardContent>
    </Card>
  );
}
