import { connection } from "next/server";

import { Hero } from "./_components/hero";
import {
  Capabilities,
  CtaSection,
  Faq,
  FeatureShowcase,
  HowItWorks,
  SecurityLayers,
  TrustStrip,
} from "./_components/sections";

/**
 * Public landing page (task T169; supersedes the T002 page). Rendered dynamically
 * so the per-request CSP nonce from proxy.ts applies (Next.js CSP guide).
 */
export default async function HomePage() {
  await connection();

  return (
    <>
      <Hero />
      <TrustStrip />
      <Capabilities />
      <HowItWorks />
      <FeatureShowcase />
      <SecurityLayers />
      <Faq />
      <CtaSection />
    </>
  );
}
