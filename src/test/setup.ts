/**
 * Shared setup for component tests. Files that need a DOM opt in per-file with
 *   // @vitest-environment jsdom
 * so the fast node-environment unit tests stay fast.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement scrollIntoView (used by Select to keep the active
// option in view) — a no-op is all a component test needs.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom never computes layout, so `offsetParent` is always null — real
// browsers only return null for genuinely hidden/detached elements. Several
// components (e.g. Sheet's focus trap) use `offsetParent !== null` as an
// "is this actually visible" check, which would treat every element as
// hidden under jsdom and break otherwise-correct behavior. Approximate the
// real check instead of stubbing it away entirely.
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      const isHidden = (node: HTMLElement) =>
        node.style?.display === "none" || node.hidden;
      if (isHidden(this)) return null;
      for (let el = this.parentElement; el; el = el.parentElement) {
        if (isHidden(el)) return null;
      }
      return this.ownerDocument?.body ?? null;
    },
  });
}

// Vitest doesn't expose `afterEach` as a global (we don't set `test.globals`),
// so @testing-library/react's own auto-cleanup detection never fires. Without
// this, one test's rendered tree (and any portals it made) leaks into the
// next, causing "found multiple elements" failures.
afterEach(() => {
  cleanup();
});
