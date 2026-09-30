import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownText, parseBlocks } from "@/components/ai/markdown-text";

/**
 * AI answers can echo document text, so rendering them must never interpret
 * markup. These pin the supported subset and the XSS boundary.
 */
describe("markdown subset", () => {
  it("groups lists and paragraphs", () => {
    expect(
      parseBlocks("## Next steps\n- Add a witness\n- Assign assets\n\n1. First\n2. Second\nDone."),
    ).toEqual([
      { kind: "heading", level: 2, text: "Next steps" },
      { kind: "ul", items: ["Add a witness", "Assign assets"] },
      { kind: "ol", items: ["First", "Second"] },
      { kind: "p", text: "Done." },
    ]);
  });

  it("renders emphasis and code as elements", () => {
    const { container } = render(<MarkdownText text="This is **important** and `code`." />);
    expect(container.querySelector("strong")?.textContent).toBe("important");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("never turns text into live markup or links", () => {
    const hostile =
      '<img src=x onerror="alert(1)"> <script>alert(1)</script> [click](javascript:alert(1))';
    const { container } = render(<MarkdownText text={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });
});
