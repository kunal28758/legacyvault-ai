import { z } from "zod";

import type {
  AssetTypeSlug,
  DigitalAssetCategory,
  FinancialAssetCategory,
  PhysicalAssetCategory,
} from "@/lib/types/asset";

/** Asset form schemas (task T079 shape). Sensitive fields are validated only for presence here. */

export const FINANCIAL_CATEGORIES: { value: FinancialAssetCategory; label: string }[] = [
  { value: "BANK_ACCOUNT", label: "Bank account" },
  { value: "FIXED_DEPOSIT", label: "Fixed deposit" },
  { value: "MUTUAL_FUND", label: "Mutual fund" },
  { value: "STOCK", label: "Stocks / shares" },
  { value: "INSURANCE", label: "Insurance policy" },
  { value: "RETIREMENT", label: "Retirement account" },
];

export const PHYSICAL_CATEGORIES: { value: PhysicalAssetCategory; label: string }[] = [
  { value: "REAL_ESTATE", label: "Real estate" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "GOLD_JEWELRY", label: "Gold & jewellery" },
  { value: "PERSONAL_PROPERTY", label: "Personal property" },
  { value: "BUSINESS_ASSET", label: "Business asset" },
];

export const DIGITAL_CATEGORIES: { value: DigitalAssetCategory; label: string }[] = [
  { value: "ONLINE_ACCOUNT", label: "Online account" },
  { value: "DOMAIN", label: "Domain" },
  { value: "CRYPTO_WALLET", label: "Crypto wallet" },
  { value: "SUBSCRIPTION", label: "Subscription" },
  { value: "SOCIAL_MEDIA", label: "Social media" },
  { value: "OTHER", label: "Other" },
];

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;

const money = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? Number(v.replace(/[,\s]/g, "")) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Enter a valid amount");

const base = {
  name: z.string().trim().min(1, "Name is required").max(120),
  estimatedValue: money,
  currency: z.enum(CURRENCIES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
};

export const financialAssetSchema = z.object({
  ...base,
  category: z.enum(
    FINANCIAL_CATEGORIES.map((c) => c.value) as [
      FinancialAssetCategory,
      ...FinancialAssetCategory[],
    ],
    { error: "Choose a category" },
  ),
  institution: z.string().trim().max(120).optional().or(z.literal("")),
  /** Entered once, encrypted server-side; the form only keeps a last-4 hint. */
  accountNumber: z.string().trim().max(40).optional().or(z.literal("")),
  policyNumber: z.string().trim().max(40).optional().or(z.literal("")),
});

export const physicalAssetSchema = z.object({
  ...base,
  category: z.enum(
    PHYSICAL_CATEGORIES.map((c) => c.value) as [PhysicalAssetCategory, ...PhysicalAssetCategory[]],
    { error: "Choose a category" },
  ),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  location: z.string().trim().max(160).optional().or(z.literal("")),
  ownershipDetails: z.string().trim().max(300).optional().or(z.literal("")),
});

export const digitalAssetSchema = z.object({
  ...base,
  category: z.enum(
    DIGITAL_CATEGORIES.map((c) => c.value) as [DigitalAssetCategory, ...DigitalAssetCategory[]],
    { error: "Choose a category" },
  ),
  platform: z.string().trim().max(120).optional().or(z.literal("")),
  username: z.string().trim().max(120).optional().or(z.literal("")),
  credentials: z.string().trim().max(500).optional().or(z.literal("")),
  recoveryInfo: z.string().trim().max(500).optional().or(z.literal("")),
});

export type FinancialAssetInput = z.infer<typeof financialAssetSchema>;
export type PhysicalAssetInput = z.infer<typeof physicalAssetSchema>;
export type DigitalAssetInput = z.infer<typeof digitalAssetSchema>;

/** Masks a sensitive number to a display hint (`•••• 4821`); the value itself is discarded client-side. */
export function maskHint(value: string | undefined | null): string | null {
  const digits = (value ?? "").replace(/\s/g, "");
  if (!digits) return null;
  return `•••• ${digits.slice(-4)}`;
}

/* ── API request shapes ───────────────────────────────────────────────────── */

export const ASSET_TYPE_SLUGS = ["financial", "physical", "digital"] as const;

export const assetTypeParamSchema = z.object({
  type: z.enum(ASSET_TYPE_SLUGS, { error: "Unknown asset type." }),
});

export const assetIdParamSchema = z.object({
  type: z.enum(ASSET_TYPE_SLUGS, { error: "Unknown asset type." }),
  id: z.uuid("Unknown asset."),
});

export const assetAssignmentParamSchema = z.object({
  type: z.enum(ASSET_TYPE_SLUGS, { error: "Unknown asset type." }),
  id: z.uuid("Unknown asset."),
  assignmentId: z.uuid("Unknown assignment."),
});

const listWindow = {
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
};

/**
 * The category filter is an enum column, so it is checked against the class it
 * belongs to. Without that, an arbitrary string reaches PostgREST and Postgres
 * rejects the cast — a database error for what is plainly bad input.
 */
export const assetListQuerySchemas = {
  financial: z.object({
    ...listWindow,
    category: z.enum(FINANCIAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).optional(),
  }),
  physical: z.object({
    ...listWindow,
    category: z.enum(PHYSICAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).optional(),
  }),
  digital: z.object({
    ...listWindow,
    category: z.enum(DIGITAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).optional(),
  }),
} as const;

/** Shape shared by all three, for callers that do not know the class yet. */
export const assetListQuerySchema = z.object({ ...listWindow, category: z.string().optional() });

export function assetListQuerySchemaFor(slug: AssetTypeSlug): z.ZodType<AssetListQuery> {
  return assetListQuerySchemas[slug] as unknown as z.ZodType<AssetListQuery>;
}

/**
 * Server-side value shapes. The browser form parses strings; the API takes the
 * already-typed values, and `create_asset()` re-validates the allow-list, the
 * currency pattern and the encryption envelopes a third time inside the
 * transaction.
 */
const serverName = z.string().trim().min(1, "Name is required").max(120);
const serverMoney = z
  .number({ error: "Enter a valid amount" })
  .nonnegative("Enter a valid amount")
  .max(1e15)
  .nullable();
const serverCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
const serverNotes = z.string().trim().max(500).nullable();
/** Never logged, never echoed back, written only through the guarded functions. */
const secret = z.string().trim().min(1).max(500).nullable();

const financialShape = {
  name: serverName,
  category: z.enum(
    ["BANK_ACCOUNT", "FIXED_DEPOSIT", "MUTUAL_FUND", "STOCK", "INSURANCE", "RETIREMENT"],
    {
      error: "Choose a category",
    },
  ),
  institution: z.string().trim().max(120).nullable(),
  estimatedValue: serverMoney,
  currency: serverCurrency,
  notes: serverNotes,
  accountNumber: secret,
  policyNumber: secret,
};

const physicalShape = {
  name: serverName,
  category: z.enum(
    ["REAL_ESTATE", "VEHICLE", "GOLD_JEWELRY", "PERSONAL_PROPERTY", "BUSINESS_ASSET"],
    {
      error: "Choose a category",
    },
  ),
  description: z.string().trim().max(500).nullable(),
  location: z.string().trim().max(160).nullable(),
  ownershipDetails: z.string().trim().max(300).nullable(),
  estimatedValue: serverMoney,
  currency: serverCurrency,
  notes: serverNotes,
};

const digitalShape = {
  name: serverName,
  category: z.enum(
    ["CRYPTO_WALLET", "ONLINE_ACCOUNT", "DOMAIN", "SUBSCRIPTION", "SOCIAL_MEDIA", "OTHER"],
    {
      error: "Choose a category",
    },
  ),
  platform: z.string().trim().max(120).nullable(),
  username: z.string().trim().max(120).nullable(),
  estimatedValue: serverMoney,
  currency: serverCurrency,
  notes: serverNotes,
  credentials: secret,
  recoveryInfo: secret,
};

function optionalShape<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).optional()]),
  ) as unknown as { [K in keyof T]: z.ZodOptional<T[K]> };
}

export const financialAssetCreateSchema = z.object({
  ...optionalShape(financialShape),
  name: financialShape.name,
  category: financialShape.category,
});
export const physicalAssetCreateSchema = z.object({
  ...optionalShape(physicalShape),
  name: physicalShape.name,
  category: physicalShape.category,
});
export const digitalAssetCreateSchema = z.object({
  ...optionalShape(digitalShape),
  name: digitalShape.name,
  category: digitalShape.category,
});

const requireSomething = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: "custom", path: ["_"], message: "Provide at least one field to update." });
  }
};

export const financialAssetUpdateSchema = z
  .object(optionalShape(financialShape))
  .superRefine(requireSomething);
export const physicalAssetUpdateSchema = z
  .object(optionalShape(physicalShape))
  .superRefine(requireSomething);
export const digitalAssetUpdateSchema = z
  .object(optionalShape(digitalShape))
  .superRefine(requireSomething);

export const assetCreateSchemas = {
  financial: financialAssetCreateSchema,
  physical: physicalAssetCreateSchema,
  digital: digitalAssetCreateSchema,
} as const;

export const assetUpdateSchemas = {
  financial: financialAssetUpdateSchema,
  physical: physicalAssetUpdateSchema,
  digital: digitalAssetUpdateSchema,
} as const;

/**
 * Assignment creation (FR-D005). `assign_beneficiary()` re-checks ownership of
 * both sides, the beneficiary's status and the Σ ≤ 100 invariant while holding
 * a lock on the resource row, so this is the outer of three checks.
 */
export const assetAssignBodySchema = z.object({
  beneficiaryId: z.uuid("Choose a beneficiary"),
  allocationPercentage: z
    .number({ error: "Enter a percentage" })
    .min(0, "Cannot be negative")
    .max(100, "Cannot exceed 100%")
    .nullable()
    .optional(),
  confirmed: z.literal(true, { error: "Confirm this assignment to continue." }),
});

export const assetDeleteBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this deletion to continue." }),
});

export type AssetListQuery = z.infer<typeof assetListQuerySchema>;
export type FinancialAssetCreateBody = z.infer<typeof financialAssetCreateSchema>;
export type PhysicalAssetCreateBody = z.infer<typeof physicalAssetCreateSchema>;
export type DigitalAssetCreateBody = z.infer<typeof digitalAssetCreateSchema>;
export type AssetCreateBody =
  FinancialAssetCreateBody | PhysicalAssetCreateBody | DigitalAssetCreateBody;
/** A union, not an intersection: the three classes have disjoint categories. */
export type AssetUpdateBody =
  | Partial<FinancialAssetCreateBody>
  | Partial<PhysicalAssetCreateBody>
  | Partial<DigitalAssetCreateBody>;
/**
 * The three classes have different allow-lists, so the schema is chosen from
 * the validated `:type` slug. The cast is confined to these two helpers: each
 * per-class schema really does produce one member of the union, but TypeScript
 * cannot see that through an index signature.
 */
export function assetCreateSchemaFor(slug: AssetTypeSlug): z.ZodType<AssetCreateBody> {
  return assetCreateSchemas[slug] as unknown as z.ZodType<AssetCreateBody>;
}

export function assetUpdateSchemaFor(slug: AssetTypeSlug): z.ZodType<AssetUpdateBody> {
  return assetUpdateSchemas[slug] as unknown as z.ZodType<AssetUpdateBody>;
}

export type AssetAssignBody = z.infer<typeof assetAssignBodySchema>;
export type AssetDeleteBody = z.infer<typeof assetDeleteBodySchema>;
