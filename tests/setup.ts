/**
 * Shared Vitest setup (task T015). Loaded for both projects.
 * Test data never contains real user information or production secrets
 * (constitution XVII); every value below is synthetic.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
