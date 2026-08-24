// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import "@/test/setup";
import { Sheet } from "./Sheet";

function Harness({
  onClose,
  footer,
}: {
  onClose?: () => void;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        title="Pick your grid"
        footer={footer}
      >
        <button type="button">First field</button>
        <button type="button">Second field</button>
      </Sheet>
    </div>
  );
}

describe("Sheet", () => {
  test("is not rendered until opened, then shows as a dialog with focus inside it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open sheet" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Pick your grid" })).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  test("Escape closes it and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open sheet" });
    await user.click(opener);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  test("Tab is trapped: it cycles from the last focusable element back to the first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await screen.findByRole("dialog");

    const closeButton = screen.getByRole("button", { name: "Close" });
    const first = screen.getByRole("button", { name: "First field" });
    const second = screen.getByRole("button", { name: "Second field" });

    // Focus starts on the first focusable element in the panel (the close button).
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    // Tabbing past the last item wraps back to the first (the close button).
    await user.tab();
    expect(closeButton).toHaveFocus();
    // Shift+Tab from the first item wraps to the last.
    await user.tab({ shift: true });
    expect(second).toHaveFocus();
  });

  test("clicking the scrim closes the sheet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await screen.findByRole("dialog");

    const scrim = document.querySelector('[aria-hidden="true"].bg-ink\\/35') as HTMLElement;
    expect(scrim).toBeTruthy();
    await user.click(scrim);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("locks page scroll while open and restores it on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).not.toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.body.style.overflow).not.toBe("hidden"));
  });
});
