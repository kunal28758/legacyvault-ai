"use client";

import { useState } from "react";
import {
  Check,
  Clock,
  KeyRound,
  Mail,
  Plus,
  ShieldCheck,
  Siren,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import {
  ScopePicker,
  describeScope,
  scopeSize,
  useScopeCatalog,
} from "@/components/security/scope-picker";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, SectionHeading } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useActivity } from "@/hooks/use-activity";
import {
  useConfigureEmergencyContact,
  useDecideEmergencyRequest,
  useEmergencyAccess,
  useRemoveEmergencyContact,
  useResendDesignation,
  useResendEmergencyAccess,
  useRevokeEmergencyRequest,
} from "@/hooks/use-emergency-access";
import { useNow } from "@/hooks/use-now";
import { isReverificationCancelled, useReverifiedAction } from "@/hooks/use-reverified-action";
import { ApiError } from "@/lib/client/api-client";
import { eaRequestView } from "@/lib/client/dms-presentation";
import type { AccessScope } from "@/lib/types/dms";
import type { EaOnTimeout, EmergencyContact, EmergencyRequest } from "@/lib/types/emergency-access";
import { formatDateTime, formatRelative } from "@/lib/format";

const EMPTY_SCOPE: AccessScope = { documents: [], assets: [], videos: [], planSections: [] };

const TIMEOUT_RULES: { value: EaOnTimeout; label: string; description: string }[] = [
  {
    value: "WAIT",
    label: "Wait for my decision",
    description: "The request expires if I do not respond in time.",
  },
  {
    value: "AUTO_GRANT",
    label: "Grant automatically after a timeout",
    description: "If I do not respond, access is granted after the timeout.",
  },
  {
    value: "DENY",
    label: "Deny automatically after a timeout",
    description: "If I do not respond, the request is denied.",
  },
];

/** Emergency access (tasks T136/T137/T140 — UI; `ea_*` guarded functions wired later via API). */
export function EmergencyAccessView() {
  const overview = useEmergencyAccess();
  const removeContactMutation = useRemoveEmergencyContact();
  const decideMutation = useDecideEmergencyRequest();
  const revokeMutation = useRevokeEmergencyRequest();

  const contacts = overview.data?.contacts ?? [];
  const requests = overview.data?.requests ?? [];
  const ready = !overview.isPending;
  const now = useNow(30_000);
  // Named only when a scope actually contains something.
  const reverified = useReverifiedAction();
  const resendDesignation = useResendDesignation();
  const resendAccess = useResendEmergencyAccess();
  const activity = useActivity(50);
  const scopeCatalog = useScopeCatalog(
    contacts.some((contact) => scopeSize(contact.accessScope) > 0),
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [decision, setDecision] = useState<{
    request: EmergencyRequest;
    kind: "APPROVE" | "DENY";
  } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EmergencyRequest | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EmergencyContact | null>(null);

  if (!ready) return <PageSkeleton stats={3} />;

  const scopeNamesFor = (scope: AccessScope) => {
    const described = describeScope(scope, scopeCatalog);
    return [
      ...described.documents,
      ...described.assets,
      ...described.videos,
      ...described.planSections,
    ];
  };
  const nameOf = (beneficiaryId: string) =>
    contacts.find((c) => c.beneficiaryId === beneficiaryId)?.beneficiaryName ?? "Contact";
  const contactOf = (configId: string) => contacts.find((c) => c.id === configId);
  const pending = requests.filter((r) => r.status === "VERIFIED");
  const active = requests.filter((r) => r.status === "ACTIVE");
  const history = [...requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Protection"
        title="Emergency access"
        description="Designated contacts can request access in an emergency. They verify with a one-time code sent to their email; you approve or deny — or set a timeout rule for when you cannot respond."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
          >
            <Plus data-icon="inline-start" />
            Designate contact
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Emergency contacts"
          value={contacts.length}
          icon={UserCheck}
          accent="cyan"
        />
        <StatCard
          label="Awaiting decision"
          value={pending.length}
          icon={Siren}
          accent={pending.length ? "warning" : "neutral"}
          hint={pending.length ? "Verified — needs you" : "Nothing pending"}
        />
        <StatCard
          label="Active grants"
          value={active.length}
          icon={KeyRound}
          accent={active.length ? "success" : "neutral"}
          hint="Time-limited, revocable"
        />
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <SectionHeading
            title="Requests awaiting your decision"
            description="The contact has proven control of their email. Approving issues a time-limited, scoped access link."
          />
          <ul className="space-y-3">
            {pending.map((request) => {
              const contact = contactOf(request.configId);
              return (
                <li key={request.id}>
                  <Card className="glass-highlight border-warning/30 glass-strong">
                    <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
                          <Siren className="size-5" aria-hidden />
                        </span>
                        <div className="space-y-1">
                          <p className="font-medium">
                            {contact ? nameOf(contact.beneficiaryId) : request.requesterEmail}{" "}
                            requested emergency access
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Identity verified {formatRelative(request.createdAt, now)} · expires{" "}
                            {formatRelative(request.requestExpiresAt, now)}
                            {contact &&
                              ` · ${contact.onTimeout === "WAIT" ? "waits for you" : `auto-${contact.onTimeout === "AUTO_GRANT" ? "grant" : "deny"} after ${contact.timeoutHours}h`}`}
                          </p>
                          {contact && (
                            <p className="text-xs text-muted-foreground">
                              Scope: {contact.accessScope.documents.length} documents ·{" "}
                              {contact.accessScope.assets.length} assets ·{" "}
                              {contact.accessScope.videos.length} videos ·{" "}
                              {contact.accessScope.planSections.length} plan sections ·{" "}
                              {contact.accessDurationHours} h access
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setDecision({ request, kind: "DENY" })}
                        >
                          <X data-icon="inline-start" />
                          Deny
                        </Button>
                        <Button onClick={() => setDecision({ request, kind: "APPROVE" })}>
                          <Check data-icon="inline-start" />
                          Approve
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <SectionHeading title="Designated contacts" />
          {contacts.length === 0 ? (
            <EmptyState
              icon={Siren}
              title="No emergency contact yet"
              description="Choose a beneficiary you trust to reach specific documents and assets in an emergency."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setSheetOpen(true);
                  }}
                >
                  <Plus data-icon="inline-start" />
                  Designate contact
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {contacts.map((contact) => {
                const open = requests.find(
                  (r) =>
                    r.configId === contact.id &&
                    ["VERIFIED", "ACTIVE", "PENDING", "VERIFYING"].includes(r.status),
                );
                return (
                  <li key={contact.id}>
                    <Card className="glass">
                      <CardContent className="space-y-4 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{nameOf(contact.beneficiaryId)}</p>
                            <p className="text-sm text-muted-foreground">
                              {contact.beneficiaryEmail}
                            </p>
                          </div>
                          {open ? (
                            <StatusBadge tone={eaRequestView(open.status).tone}>
                              {eaRequestView(open.status).label}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="success">Ready</StatusBadge>
                          )}
                        </div>
                        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                          <div>
                            <dt className="text-xs text-muted-foreground">Timeout rule</dt>
                            <dd className="font-medium">
                              {contact.onTimeout === "WAIT"
                                ? "Wait for me"
                                : contact.onTimeout === "AUTO_GRANT"
                                  ? `Auto-grant · ${contact.timeoutHours}h`
                                  : `Auto-deny · ${contact.timeoutHours}h`}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Request expiry</dt>
                            <dd className="font-medium">{contact.requestExpiryHours} h</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Access duration</dt>
                            <dd className="font-medium">{contact.accessDurationHours} h</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Designation sent</dt>
                            <dd className="font-medium">
                              {formatRelative(contact.lastDesignationSentAt, now)}
                            </dd>
                          </div>
                        </dl>
                        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Scope: </span>
                          {scopeNamesFor(contact.accessScope).join(", ") || "Nothing selected yet"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(contact);
                              setSheetOpen(true);
                            }}
                          >
                            Edit rules
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resendDesignation.isPending}
                            onClick={() => {
                              void (async () => {
                                try {
                                  await resendDesignation.mutateAsync(contact.id);
                                  toast.success("Designation email re-sent", {
                                    description: "It contains their personal request link.",
                                  });
                                } catch (error) {
                                  toast.error(
                                    error instanceof ApiError
                                      ? error.message
                                      : "Could not send that email.",
                                  );
                                }
                              })();
                            }}
                          >
                            <Mail data-icon="inline-start" />
                            Resend designation
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setRemoveTarget(contact)}
                          >
                            <Trash2 data-icon="inline-start" />
                            Remove
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3 lg:col-span-2">
          <SectionHeading title="How it stays safe" />
          <Card className="glass">
            <CardContent className="space-y-3 p-5 text-sm">
              {[
                {
                  icon: Mail,
                  text: "The contact requests access from their personal link; the email must match the one you designated.",
                },
                {
                  icon: ShieldCheck,
                  text: "A 6-digit one-time code (15 min, 3 attempts) proves they control that inbox.",
                },
                {
                  icon: Clock,
                  text: "You are notified immediately. Approve or deny with re-verification, or let your timeout rule decide.",
                },
                {
                  icon: KeyRound,
                  text: "Access is scoped to what you chose, time-limited, revocable and fully audited. Links are never stored in plaintext.",
                },
              ].map(({ icon: Icon, text }, index) => (
                <p key={index} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-cyan/15 text-brand-cyan">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-muted-foreground">{text}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading title="Request history" />
        {history.length === 0 ? (
          <EmptyState
            compact
            icon={Clock}
            title="No requests yet"
            description="Emergency requests and their outcomes appear here."
          />
        ) : (
          <Card className="glass">
            <CardContent className="divide-y divide-border p-0">
              {history.map((request) => {
                const view = eaRequestView(request.status);
                const contact = contactOf(request.configId);
                return (
                  <div
                    key={request.id}
                    className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {contact ? nameOf(contact.beneficiaryId) : request.requesterEmail}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Requested {formatDateTime(request.createdAt)}
                        {request.decidedAt && ` · decided ${formatDateTime(request.decidedAt)}`}
                        {request.expiresAt &&
                          request.status === "ACTIVE" &&
                          ` · access ends ${formatRelative(request.expiresAt, now)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                      {["APPROVED", "AUTO_GRANTED", "ACTIVE"].includes(request.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={resendAccess.isPending}
                          onClick={() => {
                            void (async () => {
                              try {
                                await resendAccess.mutateAsync(request.id);
                                toast.success("A replacement link is queued", {
                                  description:
                                    "The previous link is revoked — there is never more than one.",
                                });
                              } catch (error) {
                                toast.error(
                                  error instanceof ApiError
                                    ? error.message
                                    : "Could not resend that link.",
                                );
                              }
                            })();
                          }}
                        >
                          <Mail data-icon="inline-start" />
                          Resend link
                        </Button>
                      )}
                      {request.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevokeTarget(request)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-3">
        <SectionHeading title="Activity" />
        <Card className="glass">
          <CardContent className="p-5">
            <ActivityFeed
              items={(activity.data?.items ?? []).filter((entry) => entry.action.startsWith("ea."))}
              limit={6}
              emptyTitle="No emergency-access activity yet"
            />
          </CardContent>
        </Card>
      </div>

      {/* Designate / edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-md">
          <EmergencyContactForm editing={editing} onClose={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(decision)}
        onOpenChange={(open) => !open && setDecision(null)}
        title={decision?.kind === "APPROVE" ? "Approve emergency access?" : "Deny this request?"}
        description={
          decision?.kind === "APPROVE"
            ? `A scoped access link is issued by the delivery job and emailed to ${decision ? nameOf(contactOf(decision.request.configId)?.beneficiaryId ?? "") : "the contact"}. Access lasts ${decision ? (contactOf(decision.request.configId)?.accessDurationHours ?? 72) : 72} hours and you can revoke it at any time.`
            : "The contact is told the request was not approved. They can submit a new request later."
        }
        confirmLabel={decision?.kind === "APPROVE" ? "Approve access" : "Deny request"}
        variant={decision?.kind === "APPROVE" ? "default" : "destructive"}
        requiresReverification={decision?.kind === "APPROVE"}
        onConfirm={async () => {
          if (!decision) return;
          try {
            await reverified(() =>
              decideMutation.mutateAsync({
                id: decision.request.id,
                decision: decision.kind,
              }),
            );
            toast.success(
              decision.kind === "APPROVE"
                ? "Access approved — link queued for delivery"
                : "Request denied",
            );
          } catch (error) {
            if (isReverificationCancelled(error)) return;
            toast.error(
              error instanceof ApiError ? error.message : "Could not record that decision.",
            );
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke emergency access?"
        description="The access link stops working immediately. The contact would need a new request."
        confirmLabel="Revoke access"
        variant="destructive"
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await revokeMutation.mutateAsync(revokeTarget.id);
            toast.success("Access revoked");
          } catch (error) {
            toast.error(
              error instanceof ApiError ? error.message : "Could not revoke that access.",
            );
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget ? nameOf(removeTarget.beneficiaryId) : "contact"} as an emergency contact?`}
        description="They remain a beneficiary; only the emergency-access designation is removed."
        confirmLabel="Remove designation"
        variant="destructive"
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await removeContactMutation.mutateAsync(removeTarget.id);
            toast.success("Designation removed");
          } catch (error) {
            toast.error(
              error instanceof ApiError ? error.message : "Could not remove this designation.",
            );
          }
        }}
      />
    </div>
  );
}

/** Mounted with the sheet, so the form seeds from the contact being edited without effects. */
function EmergencyContactForm({
  editing,
  onClose,
}: {
  editing: EmergencyContact | null;
  onClose: () => void;
}) {
  const beneficiariesQuery = useBeneficiaries();
  const overview = useEmergencyAccess();
  const configure = useConfigureEmergencyContact();
  const [form, setForm] = useState({
    beneficiaryId: editing?.beneficiaryId ?? "",
    onTimeout: (editing?.onTimeout ?? "WAIT") as EaOnTimeout,
    timeoutHours: String(editing?.timeoutHours ?? 24),
    requestExpiryHours: String(editing?.requestExpiryHours ?? 72),
    accessDurationHours: String(editing?.accessDurationHours ?? 72),
  });
  // A grant must name something: `lv_validate_scope()` refuses an empty scope,
  // so it is chosen here rather than left for another page.
  const [scope, setScope] = useState<AccessScope>(editing?.accessScope ?? EMPTY_SCOPE);
  const catalog = useScopeCatalog(true);
  const existing = overview.data?.contacts ?? [];
  const eligible = (beneficiariesQuery.data?.items ?? []).filter(
    (b) =>
      b.status !== "INACTIVE" &&
      (!existing.some((c) => c.beneficiaryId === b.id) || editing?.beneficiaryId === b.id),
  );
  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle>
          {editing ? "Edit emergency contact" : "Designate an emergency contact"}
        </SheetTitle>
        <SheetDescription>
          They receive a designation email with their personal request link. Only active
          beneficiaries can be chosen.
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4">
        <FormField label="Beneficiary" required>
          {(props) => (
            <Select
              value={form.beneficiaryId || null}
              onValueChange={(v) => setForm({ ...form, beneficiaryId: String(v ?? "") })}
              items={eligible.map((b) => ({ value: b.id, label: b.name }))}
              disabled={Boolean(editing)}
            >
              <SelectTrigger id={props.id} className="w-full">
                <SelectValue placeholder="Choose a beneficiary" />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} · {b.relationship}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">If I do not respond</legend>
          <RadioGroup
            value={form.onTimeout}
            onValueChange={(v) => setForm({ ...form, onTimeout: v as EaOnTimeout })}
            className="space-y-2"
          >
            {TIMEOUT_RULES.map((rule) => (
              <Label
                key={rule.value}
                className="flex items-start gap-3 rounded-lg border border-border p-3 font-normal has-data-checked:border-primary/60 has-data-checked:bg-primary/5"
              >
                <RadioGroupItem value={rule.value} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{rule.label}</span>
                  <span className="block text-xs text-muted-foreground">{rule.description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        {form.onTimeout !== "WAIT" && (
          <FormField label="Timeout (hours)" hint="1–168 hours after verification.">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                max={168}
                value={form.timeoutHours}
                onChange={(e) => setForm({ ...form, timeoutHours: e.target.value })}
              />
            )}
          </FormField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Request expiry (h)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                max={720}
                value={form.requestExpiryHours}
                onChange={(e) => setForm({ ...form, requestExpiryHours: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Access duration (h)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                max={720}
                value={form.accessDurationHours}
                onChange={(e) => setForm({ ...form, accessDurationHours: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <ScopePicker grant="EMERGENCY_ACCESS" value={scope} onChange={setScope} catalog={catalog} />
      </div>
      <SheetFooter className="flex-col items-stretch gap-2 border-t border-border sm:flex-row sm:items-center sm:justify-end">
        {!form.beneficiaryId || scopeSize(scope) === 0 ? (
          <p className="flex-1 text-xs text-muted-foreground">
            Choose a beneficiary and at least one thing they may see.
          </p>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={configure.isPending || !form.beneficiaryId || scopeSize(scope) === 0}
          onClick={() => {
            void (async () => {
              try {
                await configure.mutateAsync({
                  beneficiaryId: form.beneficiaryId,
                  onTimeout: form.onTimeout,
                  timeoutHours:
                    form.onTimeout === "WAIT" ? null : Number(form.timeoutHours) || null,
                  requestExpiryHours: Number(form.requestExpiryHours) || 72,
                  accessDurationHours: Number(form.accessDurationHours) || 72,
                  accessScope: scope,
                });
                toast.success(
                  editing ? "Emergency contact updated" : "Emergency contact designated",
                );
                onClose();
              } catch (error) {
                toast.error(
                  error instanceof ApiError ? error.message : "Could not save this contact.",
                );
              }
            })();
          }}
        >
          {editing ? "Save" : "Designate"}
        </Button>
      </SheetFooter>
    </>
  );
}
