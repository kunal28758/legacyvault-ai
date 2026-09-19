import type { Database } from "@/lib/types/database";

/**
 * Demo-workspace view models.
 *
 * These shapes mirror `specs/001-baseline-product-spec/data-model.md` (logical
 * camelCase names) and reuse the enum types generated from the applied
 * migrations (`lib/types/database.ts`) so that the UI built against them can be
 * pointed at the real repositories/services without changing its vocabulary.
 *
 * Nothing in this module talks to the database. The demo workspace lives only in
 * the browser tab (`lib/demo/store.ts`) and is labelled as such in the UI.
 */
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];

export type BeneficiaryStatus = Enums<"beneficiary_status">;
export type FinancialAssetCategory = Enums<"financial_asset_category">;
export type PhysicalAssetCategory = Enums<"physical_asset_category">;
export type DigitalAssetCategory = Enums<"digital_asset_category">;
export type ScanStatus = Enums<"scan_status">;
export type LegacyPlanStatus = Enums<"legacy_plan_status">;
export type DeliveryCondition = Enums<"delivery_condition">;
export type DmsStatus = Enums<"dms_status">;
export type DmsEventType = Enums<"dms_event_type">;
export type EaOnTimeout = Enums<"ea_on_timeout">;
export type EaRequestStatus = Enums<"ea_request_status">;
export type AssignmentResourceType = Enums<"assignment_resource_type">;
export type AuditOutcome = Enums<"audit_outcome">;
export type NotificationChannel = Enums<"notification_channel">;
export type AccessGrantType = Enums<"access_grant_type">;

export type AssetKind = Extract<
  AssignmentResourceType,
  "FINANCIAL_ASSET" | "PHYSICAL_ASSET" | "DIGITAL_ASSET"
>;

/** Plan section keys — data-model.md § 9 (also the plan-section scope vocabulary). */
export const PLAN_SECTION_KEYS = [
  "personal-details",
  "family-information",
  "beneficiaries",
  "financial-assets",
  "physical-assets",
  "digital-assets",
  "witness-details",
  "special-wishes",
  "document-attachments",
] as const;
export type PlanSectionKey = (typeof PLAN_SECTION_KEYS)[number];

export interface DemoBeneficiary {
  id: string;
  name: string;
  relationship: string;
  email: string;
  phone: string | null;
  status: BeneficiaryStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface AssetBase {
  id: string;
  name: string;
  estimatedValue: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoFinancialAsset extends AssetBase {
  kind: "FINANCIAL_ASSET";
  category: FinancialAssetCategory;
  institution: string | null;
  /** Only a masked hint is ever held client-side; plaintext lives encrypted server-side. */
  accountNumberHint: string | null;
  policyNumberHint: string | null;
}

export interface DemoPhysicalAsset extends AssetBase {
  kind: "PHYSICAL_ASSET";
  category: PhysicalAssetCategory;
  description: string | null;
  location: string | null;
  ownershipDetails: string | null;
}

export interface DemoDigitalAsset extends AssetBase {
  kind: "DIGITAL_ASSET";
  category: DigitalAssetCategory;
  platform: string | null;
  username: string | null;
  /** Whether encrypted credentials / recovery info exist for this asset. */
  hasCredentials: boolean;
  hasRecoveryInfo: boolean;
}

export type DemoAsset = DemoFinancialAsset | DemoPhysicalAsset | DemoDigitalAsset;

/** Distributive input shape (keeps the union discriminated). */
export type DemoAssetInput = DemoAsset extends infer A
  ? A extends DemoAsset
    ? Omit<A, "id" | "createdAt" | "updatedAt">
    : never
  : never;

export interface DemoAssignment {
  id: string;
  beneficiaryId: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  allocationPercentage: number | null;
  createdAt: string;
}

export interface DemoFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface DemoDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  scanStatus: ScanStatus;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
  /** True when the row was created inside this browser tab (never uploaded anywhere). */
  demoOnly?: boolean;
}

export interface DemoVideoMessage {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number;
  sizeBytes: number;
  deliveryCondition: DeliveryCondition;
  scanStatus: ScanStatus;
  createdAt: string;
  demoOnly?: boolean;
}

export interface AccessScope {
  documents: string[];
  assets: { type: AssetKind; id: string }[];
  videos: string[];
  planSections: PlanSectionKey[];
}

export interface DemoDmsEvent {
  id: string;
  eventType: DmsEventType;
  previousState: DmsStatus;
  newState: DmsStatus;
  createdAt: string;
  note: string | null;
}

export interface DemoDeadManSwitch {
  status: DmsStatus;
  inactivityPeriodDays: number;
  checkInFrequencyDays: number;
  escalationDelayHours: number;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  currentEscalationStep: number;
  contactIds: string[];
  releaseScope: AccessScope;
  events: DemoDmsEvent[];
}

export interface DemoEmergencyContact {
  id: string;
  beneficiaryId: string;
  accessScope: AccessScope;
  onTimeout: EaOnTimeout;
  timeoutHours: number | null;
  requestExpiryHours: number;
  accessDurationHours: number;
  status: "ACTIVE" | "INACTIVE";
  lastDesignationSentAt: string | null;
}

export interface DemoEmergencyRequest {
  id: string;
  configId: string;
  requesterEmail: string;
  status: EaRequestStatus;
  createdAt: string;
  requestExpiresAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface DemoPlanVersion {
  id: string;
  versionNumber: number;
  finalizedAt: string;
  acknowledgedIncomplete: boolean;
  incompleteSections: PlanSectionKey[];
}

export interface DemoLegacyPlan {
  id: string;
  status: LegacyPlanStatus;
  version: number;
  currentStep: number;
  stepsData: Partial<Record<PlanSectionKey, Record<string, unknown>>>;
  lockVersion: number;
  finalizedAt: string | null;
  updatedAt: string;
}

export interface DemoNotification {
  id: string;
  type: string;
  category: "security" | "legacy" | "protection" | "system";
  title: string;
  content: string;
  channel: NotificationChannel;
  readAt: string | null;
  createdAt: string;
}

export interface DemoActivity {
  id: string;
  action: string;
  resourceType: string;
  outcome: AuditOutcome;
  description: string;
  createdAt: string;
}

export interface DemoSession {
  id: string;
  browser: string;
  device: string;
  location: string;
  lastActiveAt: string;
  current: boolean;
}

export interface DemoSecurity {
  emailVerified: boolean;
  mfaEnabled: boolean;
  backupCodesGenerated: boolean;
  lastSecurityReviewAt: string | null;
  sessions: DemoSession[];
}

export interface DemoPreferences {
  profile: {
    phone: string;
    dateOfBirth: string;
    city: string;
    country: string;
    alternateEmail: string;
  };
  currency: string;
  dateFormat: "DD MMM YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  compactSidebar: boolean;
  notificationPreferences: {
    email: boolean;
    securityAlerts: boolean;
    checkInReminders: boolean;
    productUpdates: boolean;
  };
  securityPreferences: {
    idleTimeoutMinutes: 15 | 30 | 60 | 240 | null;
    loginNotifications: boolean;
    securityReviewReminder: boolean;
  };
}

export interface DemoChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface DemoWorkspace {
  beneficiaries: DemoBeneficiary[];
  assets: DemoAsset[];
  assignments: DemoAssignment[];
  folders: DemoFolder[];
  documents: DemoDocument[];
  videos: DemoVideoMessage[];
  plan: DemoLegacyPlan | null;
  planVersions: DemoPlanVersion[];
  dms: DemoDeadManSwitch;
  emergencyContacts: DemoEmergencyContact[];
  emergencyRequests: DemoEmergencyRequest[];
  notifications: DemoNotification[];
  activity: DemoActivity[];
  security: DemoSecurity;
  preferences: DemoPreferences;
  chat: DemoChatMessage[];
}
