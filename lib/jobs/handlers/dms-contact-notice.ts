import "server-only";

import { audit } from "@/lib/audit/audit.service";
import { sendDmsContactNoticeEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * Tells one trusted contact that the owner's emergency release workflow has
 * started (queued by `dms_transition()` when escalation begins).
 *
 * Everything is re-read at run time: if the owner checked in, disabled the
 * switch or removed this contact since the job was queued, the notice would be
 * false, so nothing is sent. A failed send throws and the queue retries it; the
 * switch's own timeline never waits on this message.
 */
const STILL_RUNNING = new Set(["ESCALATING", "RELEASING", "RELEASED"]);

export const dmsContactNoticeHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const switchId = requireString(payload, "switchId");
  const beneficiaryId = requireString(payload, "beneficiaryId");
  const eventId = requireString(payload, "eventId");

  const { data: dms, error } = await db
    .from("dead_man_switches")
    .select("user_id, status")
    .eq("id", switchId)
    .maybeSingle();
  if (error) throw error;
  if (!dms || !STILL_RUNNING.has(dms.status)) {
    logger.info({ jobId: job.id }, "contact notice skipped: workflow no longer running");
    return;
  }

  const [{ data: contact, error: contactError }, { data: owner, error: ownerError }] =
    await Promise.all([
      db
        .from("dead_man_switch_contacts")
        .select("beneficiaries!inner(name, email, status, user_id, deleted_at)")
        .eq("dead_man_switch_id", switchId)
        .eq("beneficiary_id", beneficiaryId)
        .maybeSingle(),
      db.from("users").select("name").eq("id", dms.user_id).maybeSingle(),
    ]);
  if (contactError) throw contactError;
  if (ownerError) throw ownerError;
  const person = contact?.beneficiaries as unknown as {
    name: string;
    email: string;
    status: string;
    user_id: string;
    deleted_at: string | null;
  } | null;
  if (!person || !owner || person.user_id !== dms.user_id) {
    logger.info({ jobId: job.id }, "contact notice skipped: no longer a trusted contact");
    return;
  }
  if (person.deleted_at || person.status === "INACTIVE") {
    logger.info({ jobId: job.id }, "contact notice skipped: contact is not eligible");
    return;
  }

  const sent = await sendDmsContactNoticeEmail({
    to: person.email,
    beneficiaryName: person.name,
    ownerName: owner.name,
    idempotencyKey: `dms-contact-notice:${eventId}:${beneficiaryId}`,
  });

  await audit.log({
    actorId: null,
    action: "dms.contact_notified",
    resourceType: "dead_man_switch",
    resourceId: switchId,
    outcome: "SUCCESS",
    metadata: {
      ownerUserId: dms.user_id,
      beneficiaryId,
      eventId,
      providerMessageId: sent.providerMessageId,
    },
  });
};
