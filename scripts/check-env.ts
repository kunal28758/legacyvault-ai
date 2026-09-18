/**
 * `pnpm env:check` — validates .env.local / process.env against the T007 schema
 * without starting the app. Prints variable NAMES and messages only, never values.
 */
import { loadEnvConfig } from "@next/env";

import { describeIssues, validatePublicEnv, validateServerEnv } from "../lib/config/env.schema";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const server = validateServerEnv(process.env);
const client = validatePublicEnv(process.env);

let failed = false;
if (server.ok) {
  console.log("✔ server environment valid");
} else {
  failed = true;
  console.error("✖ server environment invalid:\n" + describeIssues(server.issues));
}
if (client.ok) {
  console.log("✔ public environment valid");
} else {
  failed = true;
  console.error("✖ public environment invalid:\n" + describeIssues(client.issues));
}
process.exit(failed ? 1 : 0);
