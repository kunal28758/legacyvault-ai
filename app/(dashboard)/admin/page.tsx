import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";

import { AdminView } from "./_components/admin-view";

export const metadata: Metadata = { title: "Administration" };

/**
 * The operator console (FR-P001, FR-P012).
 *
 * The role is checked here as well as on every endpoint the page calls, and a
 * non-operator gets a 404 rather than a 403: the existence of this route is not
 * something a regular account needs to learn.
 */
export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") notFound();
  return <AdminView />;
}
