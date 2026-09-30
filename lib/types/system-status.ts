/**
 * System status view models (shared by the status route and the indicator).
 *
 * `not_configured` is distinct from `down`: a service this environment has
 * not been set up with is reported as such, never as working.
 */
export type ServiceId =
  "application" | "database" | "storage" | "authentication" | "malware_scanner" | "ai" | "jobs";

export type ServiceState = "operational" | "degraded" | "down" | "not_configured";

export interface ServiceStatus {
  id: ServiceId;
  label: string;
  state: ServiceState;
  /** A plain-language explanation; never a hostname, version or error text. */
  message: string;
}

export interface SystemStatus {
  overall: "operational" | "degraded" | "down";
  checkedAt: string;
  /** Present for signed-in users only. */
  services?: ServiceStatus[];
  /** Present for signed-in users only: which scanner is in use. */
  scannerProvider?: "clamav" | "noop";
}
