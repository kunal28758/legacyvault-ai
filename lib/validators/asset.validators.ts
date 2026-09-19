import { z } from "zod";

import type {
  DigitalAssetCategory,
  FinancialAssetCategory,
  PhysicalAssetCategory,
} from "@/lib/demo/types";

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
