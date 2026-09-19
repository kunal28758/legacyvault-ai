import type { Metadata } from "next";

import { VideoLegacyView } from "./_components/video-legacy-view";

export const metadata: Metadata = { title: "Video Legacy" };

export default function VideoLegacyPage() {
  return <VideoLegacyView />;
}
