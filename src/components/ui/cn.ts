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

/** Shared keyboard focus treatment. Pointer users never see it. */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Focus treatment for marks drawn inside a chart (tighter offset). */
export const focusRingTight =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
