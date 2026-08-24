// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import "@/test/setup";
import { Select, type SelectOption } from "./Select";

type ApplianceId = "dishwasher" | "dryer" | "ev";

const OPTIONS: SelectOption<ApplianceId>[] = [
  { value: "dishwasher", label: "Dishwasher", sublabel: "1.2 kWh over 2 hours" },
  { value: "dryer", label: "Clothes dryer", sublabel: "2.5 kWh over 1.5 hours" },
  { value: "ev", label: "EV charging", sublabel: "30 kWh over 4 hours" },
];

function Harness({ onChange }: { onChange?: (v: ApplianceId) => void }) {
  const [value, setValue] = useState<ApplianceId>("dishwasher");
  return (
    <Select
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      ariaLabel="Choose an appliance"
    />
  );
}

describe("Select", () => {
  test("renders closed with the selected option as the visible label", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Choose an appliance" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Dishwasher");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("ArrowDown opens the list and Enter commits the active option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Choose an appliance" });
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Dishwasher (index 0) is already selected/active; move down twice to EV charging.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("ev");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("EV charging");
    // Focus returns to the trigger after committing.
    expect(trigger).toHaveFocus();
  });

  test("Escape closes the list without changing the selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Choose an appliance" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}"); // move active index, but don't commit
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Dishwasher");
  });

  test("typeahead jumps to the option starting with the typed letter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Choose an appliance" });
    trigger.focus();
    await user.keyboard("{ArrowDown}"); // open
    await user.keyboard("e"); // "EV charging" starts with E
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("ev");
  });

  test("clicking an option commits it and closes the list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Choose an appliance" }));
    await user.click(screen.getByRole("option", { name: /Clothes dryer/ }));
    expect(onChange).toHaveBeenCalledWith("dryer");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  test("disabled options are not committed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const optionsWithDisabled: SelectOption<ApplianceId>[] = [
      { value: "dishwasher", label: "Dishwasher" },
      { value: "dryer", label: "Clothes dryer", disabled: true },
      { value: "ev", label: "EV charging" },
    ];
    function DisabledHarness() {
      const [value, setValue] = useState<ApplianceId>("dishwasher");
      return (
        <Select
          options={optionsWithDisabled}
          value={value}
          onChange={(v) => {
            setValue(v);
            onChange(v);
          }}
          ariaLabel="Choose an appliance"
        />
      );
    }
    render(<DisabledHarness />);
    await user.click(screen.getByRole("combobox", { name: "Choose an appliance" }));
    await user.click(screen.getByRole("option", { name: /Clothes dryer/ }));
    expect(onChange).not.toHaveBeenCalled();
    // The list stays open since nothing was committed.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
