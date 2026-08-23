"use client";

/**
 * Re-exported from the UI layer so app code has one obvious import for
 * client-only persisted state. The implementation lives in `components/ui`
 * because primitives there (the theme toggle, portals) need it too.
 */
export {
  useHydrated,
  useStoredString as useStoredValue,
  readLocalStorage as readStoredValue,
  writeLocalStorage as writeStoredValue,
} from "@/components/ui/useHydrated";
