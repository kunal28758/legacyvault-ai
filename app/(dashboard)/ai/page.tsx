import type { Metadata } from "next";

import { AssistantView } from "./_components/assistant-view";

export const metadata: Metadata = { title: "AI Assistant" };

export default function AiAssistantPage() {
  return <AssistantView />;
}
