import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BeneficiaryStatus, BeneficiaryWithRoles } from "@/lib/types/beneficiary";

/**
 * The beneficiary picker in the three assignment dialogs (documents, assets,
 * video messages).
 *
 * An empty picker used to say "No eligible beneficiaries" whatever the reason,
 * which read as "PENDING people cannot be chosen". They can — eligibility is
 * "not INACTIVE and not already assigned", decided again by
 * `assign_beneficiary()` — so these assert that a PENDING beneficiary is
 * offered, and that a failed load, an empty roster, everyone already assigned
 * and only-inactive people are each described as what they are.
 */
const state = vi.hoisted(() => ({
  beneficiaries: {} as {
    data?: { items: unknown[]; total: number; page: number; limit: number };
    isError: boolean;
    isPending: boolean;
    isFetching: boolean;
    refetch: () => void;
  },
  assignedIds: [] as string[],
  refetch: vi.fn(),
}));

vi.mock("@/hooks/use-beneficiaries", () => ({
  useBeneficiaries: () => state.beneficiaries,
}));
vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({
    data: {
      shares: state.assignedIds.map((beneficiaryId) => ({
        assignmentId: `share-${beneficiaryId}`,
        beneficiaryId,
        beneficiaryName: beneficiaryId,
        createdAt: "2026-10-05T00:00:00.000Z",
      })),
    },
  }),
  useShareDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-assets", () => ({
  useAssignBeneficiary: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-videos", () => ({
  useAssignVideo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { AssignAssetDialog } from "@/components/assets/assign-asset-dialog";
import { beneficiaryChoice } from "@/components/beneficiaries/beneficiary-choice";
import { ShareDocumentDialog } from "@/components/documents/share-document-dialog";
import { AssignVideoDialog } from "@/components/video-legacy/assign-video-dialog";

function person(id: string, status: BeneficiaryStatus): BeneficiaryWithRoles {
  return {
    id,
    name: `Person ${id}`,
    relationship: "Friend",
    email: `${id}@example.com`,
    phone: null,
    status,
    invitedAt: null,
    activatedAt: null,
    notes: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    roles: {
      assignmentCount: 0,
      isTrustedContact: false,
      isEmergencyContact: false,
      averageAllocation: 0,
    },
  };
}

function list(...items: BeneficiaryWithRoles[]) {
  return { items, total: items.length, page: 1, limit: 50 };
}

function loaded(...items: BeneficiaryWithRoles[]) {
  state.beneficiaries = {
    data: list(...items),
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: state.refetch,
  };
}

beforeEach(() => {
  state.assignedIds = [];
  state.refetch.mockReset();
  loaded();
});

describe("beneficiaryChoice", () => {
  const none = new Set<string>();

  it("offers PENDING and ACTIVE beneficiaries, never INACTIVE or already assigned ones", () => {
    const choice = beneficiaryChoice(
      {
        data: list(
          person("pending", "PENDING"),
          person("active", "ACTIVE"),
          person("inactive", "INACTIVE"),
          person("assigned", "PENDING"),
        ),
        isError: false,
      },
      new Set(["assigned"]),
    );

    expect(choice.state).toBe("ready");
    if (choice.state === "ready") {
      expect(choice.options.map((option) => option.id)).toEqual(["pending", "active"]);
    }
  });

  it("tells loading, a failed load, an empty roster, all assigned and only inactive apart", () => {
    expect(beneficiaryChoice({ isError: false }, none).state).toBe("loading");
    expect(beneficiaryChoice({ isError: true }, none).state).toBe("error");
    expect(beneficiaryChoice({ data: list(), isError: false }, none).state).toBe("none");
    expect(
      beneficiaryChoice({ data: list(person("a", "PENDING")), isError: false }, new Set(["a"]))
        .state,
    ).toBe("all-assigned");
    expect(
      beneficiaryChoice({ data: list(person("a", "INACTIVE")), isError: false }, none).state,
    ).toBe("only-inactive");
  });

  it("keeps offering the list it already has when a background refresh fails", () => {
    const choice = beneficiaryChoice(
      { data: list(person("a", "PENDING")), isError: true },
      new Set<string>(),
    );
    expect(choice.state).toBe("ready");
  });
});

const dialogs = [
  {
    name: "ShareDocumentDialog",
    resource: "document",
    render: () => render(<ShareDocumentDialog open onOpenChange={() => {}} documentId="doc-1" />),
  },
  {
    name: "AssignAssetDialog",
    resource: "asset",
    render: () =>
      render(
        <AssignAssetDialog
          open
          onOpenChange={() => {}}
          kind="FINANCIAL_ASSET"
          assetId="asset-1"
          assignments={state.assignedIds.map((beneficiaryId) => ({
            id: `assignment-${beneficiaryId}`,
            beneficiaryId,
            beneficiaryName: beneficiaryId,
            allocationPercentage: null,
            createdAt: "2026-10-05T00:00:00.000Z",
          }))}
          remainingPercentage={100}
        />,
      ),
  },
  {
    name: "AssignVideoDialog",
    resource: "message",
    render: () =>
      render(
        <AssignVideoDialog
          open
          onOpenChange={() => {}}
          videoId="video-1"
          assignments={state.assignedIds.map((beneficiaryId) => ({
            id: `assignment-${beneficiaryId}`,
            beneficiaryId,
            beneficiaryName: beneficiaryId,
            createdAt: "2026-10-05T00:00:00.000Z",
          }))}
        />,
      ),
  },
];

describe.each(dialogs)("$name beneficiary picker", ({ resource, render: renderDialog }) => {
  it("offers a PENDING beneficiary", () => {
    loaded(person("friend", "PENDING"));
    renderDialog();

    expect(screen.getByText("Choose a beneficiary")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed load as an error with Retry", () => {
    state.beneficiaries = {
      isError: true,
      isPending: false,
      isFetching: false,
      refetch: state.refetch,
    };
    renderDialog();

    expect(screen.getByText("Beneficiaries could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No eligible beneficiaries")).not.toBeInTheDocument();
  });

  it("says when there are no beneficiaries at all", () => {
    loaded();
    renderDialog();

    expect(screen.getByText("No beneficiaries yet")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You have no beneficiaries yet");
  });

  it("says when every eligible beneficiary already has it", () => {
    loaded(person("friend", "PENDING"), person("old", "INACTIVE"));
    state.assignedIds = ["friend"];
    renderDialog();

    expect(screen.getByText("Everyone eligible already has this")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      `Every active or pending beneficiary already has this ${resource}.`,
    );
  });

  it("says when the only beneficiaries are inactive", () => {
    loaded(person("old", "INACTIVE"));
    renderDialog();

    expect(screen.getByText("Only inactive beneficiaries")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reactivate one");
    expect(screen.queryByText("No eligible beneficiaries")).not.toBeInTheDocument();
  });
});
