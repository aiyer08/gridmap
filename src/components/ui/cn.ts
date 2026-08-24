/**
 * Tiny class-name joiner. No dependency, no tailwind-merge — components take a
 * `className` that is appended last, so it wins on equal specificity.
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v && v !== 0) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    out.push(String(v));
  };
  values.forEach(walk);
  return out.join(" ");
}

/**
 * Shared keyboard focus treatment. Pointer users never see it.
 *
 * Tailwind's outline-width/-color utilities all read a shared
 * `--tw-outline-style` custom property rather than setting `outline-style`
 * themselves (the same pattern as its ring/shadow utilities). `outline-none`
 * pins that variable to `none` unconditionally, and nothing else in this list
 * used to declare a competing value for it — so `focus-visible:outline-2` etc.
 * changed width/offset/color but the ring's `outline-style` stayed `none` and
 * it never actually painted. `focus-visible:outline-solid` is what sets the
 * variable back to `solid` for the focused state.
 */
export const focusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Focus treatment for marks drawn inside a chart (tighter offset). */
export const focusRingTight =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/**
 * The reference's own easing curve as a Framer Motion cubic-bezier array —
 * `var(--ease-editorial)` (`cubic-bezier(0.44, 0, 0.56, 1)`) can't be read by
 * Framer's `transition.ease`, which wants numbers, not a CSS custom property.
 * Reserved for reveals/hand-offs (sheets, dropdowns, tooltips, toasts) in the
 * 0.15–0.4s band; snappier spring physics elsewhere (e.g. a dragged sheet)
 * stay springs.
 */
export const EDITORIAL_EASE: [number, number, number, number] = [0.44, 0, 0.56, 1];
