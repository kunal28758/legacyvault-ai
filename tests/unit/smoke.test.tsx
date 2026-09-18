import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("unit smoke", () => {
  it("renders a shadcn/ui button with the design-system classes", () => {
    render(<Button>Start your legacy plan</Button>);
    const button = screen.getByRole("button", { name: /start your legacy plan/i });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("bg-primary");
  });
});
