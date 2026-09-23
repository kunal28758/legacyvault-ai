import type { Database } from "@/lib/types/database";

/**
 * Beneficiary view models shared by the server and the browser.
 *
 * Deliberately not in the repository or the service: both of those are
 * `server-only`, and the React Query hooks need these shapes. Keeping them here
 * means one definition describes what the API returns and what the UI renders.
 */
export type BeneficiaryStatus = Database["public"]["Enums"]["beneficiary_status"];
export type AssignmentResourceType = Database["public"]["Enums"]["assignment_resource_type"];

export interface Beneficiary {
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
  updatedAt: string;
}

export interface BeneficiaryAssignment {
  id: string;
  beneficiaryId: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  /** The resource's own name, resolved server-side; null once it is deleted. */
  resourceName: string | null;
  allocationPercentage: number | null;
  createdAt: string;
}

/** Cross-domain roles surfaced on the list (api-contracts.md § Beneficiaries). */
export interface BeneficiaryRoles {
  assignmentCount: number;
  isTrustedContact: boolean;
  isEmergencyContact: boolean;
  /** Informational aggregate only — allocations are per resource, never global. */
  averageAllocation: number;
}

export interface BeneficiaryWithRoles extends Beneficiary {
  roles: BeneficiaryRoles;
}

export interface BeneficiaryDetail extends BeneficiaryWithRoles {
  assignments: BeneficiaryAssignment[];
}

export interface BeneficiaryListResult {
  items: BeneficiaryWithRoles[];
  total: number;
  page: number;
  limit: number;
}
