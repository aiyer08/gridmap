// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import "@/test/setup";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const toast = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast.toast({ title: "No problem", description: "Nothing lost." })
        }
      >
        Fire toast
      </button>
      <button
        type="button"
        onClick={() => toast.celebrate("Nice — that's counted", "42 g avoided.")}
      >
        Fire celebration
      </button>
      <button
        type="button"
        onClick={() =>
          toast.toast({ title: "Persistent", description: "Stays put.", duration: 0 })
        }
      >
        Fire persistent
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
}

describe("Toast", () => {
  test("renders a toast with title and description in a polite live region", async () => {
    const user = renderWithProvider() && userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fire toast" }));

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("No problem")).toBeInTheDocument();
    expect(screen.getByText("Nothing lost.")).toBeInTheDocument();
  });

  test("celebrate() is a success-toned shorthand", async () => {
    renderWithProvider();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fire celebration" }));
    expect(screen.getByText("Nice — that's counted")).toBeInTheDocument();
    expect(screen.getByText("42 g avoided.")).toBeInTheDocument();
  });

  test("dismiss button removes the toast", async () => {
    renderWithProvider();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fire persistent" }));
    expect(screen.getByText("Persistent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Persistent")).not.toBeInTheDocument());
  });

  test("a duration: 0 toast does not auto-dismiss", async () => {
    renderWithProvider();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fire persistent" }));
    expect(screen.getByText("Persistent")).toBeInTheDocument();
    // Give any stray timers a chance to fire — there should be none for duration: 0.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Persistent")).toBeInTheDocument();
  });

  test("useToast throws outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });

  test("only the newest `max` toasts are kept", async () => {
    render(
      <ToastProvider max={2}>
        <Trigger />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const fire = screen.getByRole("button", { name: "Fire toast" });
    await user.click(fire);
    await user.click(fire);
    await user.click(fire);
    // The oldest toast's DOM node may still be mid exit-animation; wait for
    // the list to settle at `max`.
    await waitFor(() => expect(screen.getAllByText("No problem")).toHaveLength(2));
  });
});
