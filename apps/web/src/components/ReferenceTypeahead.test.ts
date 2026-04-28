import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { ReferenceTypeahead, type ReferenceOption } from "./ReferenceTypeahead";

const OPTIONS: ReferenceOption[] = [
  { id: "user-1", label: "Specora Admin", sublabel: "admin@specora.org" },
  { id: "user-2", label: "Discovery Operator", sublabel: "discovery@specora.org" },
];

function Harness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return React.createElement(ReferenceTypeahead, {
    referenceClass: "User",
    value,
    options: OPTIONS,
    onChange: setValue,
  });
}

describe("ReferenceTypeahead", () => {
  it("filters options and stores the selected reference id", () => {
    render(React.createElement(Harness));

    const input = screen.getByPlaceholderText("Search User");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "disc" } });
    fireEvent.click(screen.getByRole("button", { name: /Discovery Operator/i }));

    expect((input as HTMLInputElement).value).toBe("Discovery Operator");
  });

  it("clears the current reference without selecting a replacement", () => {
    render(React.createElement(Harness, { initialValue: "user-1" }));

    expect((screen.getByPlaceholderText("Search User") as HTMLInputElement).value).toBe("Specora Admin");
    fireEvent.click(screen.getByLabelText("Clear reference"));

    expect((screen.getByPlaceholderText("Search User") as HTMLInputElement).value).toBe("");
  });
});
