/**
 * Shared setup for component tests. Files that need a DOM opt in per-file with
 *   // @vitest-environment jsdom
 * so the fast node-environment unit tests stay fast.
 */
import "@testing-library/jest-dom/vitest";
