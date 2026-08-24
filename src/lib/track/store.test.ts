import { describe, expect, it } from "vitest";
import type { LoggedAction } from "@/lib/types";
import {
  isObservable,
  materialise,
  newActionId,
  type LogInput,
  type TrackerStore,
} from "./store";
import { localStore } from "./localStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newActionId", () => {
  it("produces uuid v4 values, because that's what the Supabase primary key is", () => {
    for (let i = 0; i < 50; i += 1) expect(newActionId()).toMatch(UUID);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, newActionId));
    expect(ids.size).toBe(500);
  });
});

describe("materialise", () => {
  const base: LogInput = {
    kind: "shift",
    subjectId: "dryer",
    label: "Clothes dryer",
    gramsSaved: 420.5,
    status: "done",
  };

  it("fills in the bookkeeping fields", () => {
    const action = materialise(base);
    expect(action.id).toMatch(UUID);
    expect(Date.parse(action.loggedAt)).toBeLessThanOrEqual(Date.now());
    expect(action.gramsSaved).toBe(420.5);
  });

  it("respects a caller-supplied timestamp", () => {
    expect(materialise({ ...base, loggedAt: "2026-08-26T19:00:00.000Z" }).loggedAt).toBe(
      "2026-08-26T19:00:00.000Z",
    );
  });

  it("zeroes a decline and never lets a saving go negative", () => {
    expect(materialise({ ...base, status: "declined" }).gramsSaved).toBe(0);
    expect(materialise({ ...base, gramsSaved: -5 }).gramsSaved).toBe(0);
    expect(materialise({ ...base, gramsSaved: Number.NaN }).gramsSaved).toBe(0);
  });
});

describe("isObservable", () => {
  it("recognises the local store and plain stores alike", () => {
    expect(isObservable(localStore)).toBe(true);
    expect(isObservable(memoryStore())).toBe(false);
  });
});

/** Minimal in-memory store, standing in for Supabase. */
function memoryStore(seed: LoggedAction[] = []): TrackerStore & { rows: LoggedAction[] } {
  const rows = [...seed];
  return {
    rows,
    async list() {
      return [...rows].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
    },
    async log(input: LogInput) {
      const action = materialise(input);
      rows.push(action);
      return action;
    },
    async remove(id: string) {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async clear() {
      rows.length = 0;
    },
  };
}

function action(partial: Partial<LoggedAction>): LoggedAction {
  return {
    id: newActionId(),
    kind: "shift",
    subjectId: "dishwasher",
    label: "Dishwasher",
    loggedAt: "2026-08-26T19:00:00.000Z",
    gramsSaved: 100,
    status: "done",
    ...partial,
  };
}

