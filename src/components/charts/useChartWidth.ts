"use client";

import * as React from "react";

/**
 * Measures the container so charts can use real pixel coordinates (text in a
 * scaled viewBox goes illegible on a phone). `fallback` is what both the server
 * render and the first client render use, so there is no hydration mismatch.
 */
export function useChartWidth<T extends HTMLElement>(
  fallback = 680,
): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width && width > 0 ? width : fallback];
}
