// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import "@/test/setup";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";

type Horizon = "24h" | "3d" | "7d";

const OPTIONS: SegmentedOption<Horizon>[] = [
  { value: "24h", label: "Next 24 hours" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "Full week" },
];

function Harness({ initial = "24h" as Horizon }: { initial?: Horizon }) {
  const [value, setValue] = useState<Horizon>(initial);
  return (
    <SegmentedControl
      options={OPTIONS}
      value={value}
      onChange={setValue}
      ariaLabel="How far ahead to show"
    />
  );
}

describe("SegmentedControl", () => {
  test("renders a radiogroup with the current value checked", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: /How\ far\ ahead\ to\ show/ });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Next\ 24\ hours/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /3\ days/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("ArrowRight moves selection to the next option and moves focus with it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("radio", { name: /Next\ 24\ hours/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /3\ days/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /3\ days/ })).toHaveFocus();
  });

  test("ArrowLeft wraps from the first option to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("radio", { name: /Next\ 24\ hours/ }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveFocus();
  });

  test("Home and End jump to the first and last option", async () => {
    const user = userEvent.setup();
    render(<Harness initial="3d" />);
    screen.getByRole("radio", { name: /3\ days/ }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: /Next\ 24\ hours/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("only the selected option is in the tab sequence", () => {
    render(<Harness initial="3d" />);
    expect(screen.getByRole("radio", { name: /Next\ 24\ hours/ })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("radio", { name: /3\ days/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  test("clicking an option selects it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /Full\ week/ }));
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("disabled options are skipped when navigating", async () => {
    const user = userEvent.setup();
    function DisabledHarness() {
      const [value, setValue] = useState<Horizon>("24h");
      const options: SegmentedOption<Horizon>[] = [
        { value: "24h", label: "Next 24 hours" },
        { value: "3d", label: "3 days", disabled: true },
        { value: "7d", label: "Full week" },
      ];
      return (
        <SegmentedControl
          options={options}
          value={value}
          onChange={setValue}
          ariaLabel="How far ahead to show"
        />
      );
    }
    render(<DisabledHarness />);
    screen.getByRole("radio", { name: /Next\ 24\ hours/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Full\ week/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
