import type { Database } from "@/lib/types/database";

/** In-app notifications (FR-L001–L006). */
export type NotificationChannel = Database["public"]["Enums"]["notification_channel"];
export type NotificationDeliveryStatus =
  Database["public"]["Enums"]["notification_delivery_status"];

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  channel: NotificationChannel;
  deliveryStatus: NotificationDeliveryStatus;
  readAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationItem[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}
