import type { Database } from "@/lib/types/database";
import type { ScanInfo } from "@/lib/types/document";

/**
 * Video legacy view models (FR-K001–K006).
 *
 * `deliveryCondition` is the rule that decides which kind of access link may
 * ever play a video, and it is enforced in the database (`lv_video_allowed`),
 * not in the player.
 */
export type DeliveryCondition = Database["public"]["Enums"]["delivery_condition"];

export interface VideoAssignment {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  createdAt: string;
}

export interface VideoMessage {
  id: string;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  deliveryCondition: DeliveryCondition;
  scan: ScanInfo;
  assignments: VideoAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface VideoListResult {
  items: VideoMessage[];
  total: number;
  page: number;
  limit: number;
}
