import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggedAction } from "@/lib/types";
import type { LogInput } from "./store";
import { MAX_ACTIONS, STORAGE_KEY, localStore, readActions } from "./localStore";

/* ------------------------------------------------------------------ *
 * A localStorage stub, small enough to reason about.
 * ------------------------------------------------------------------ */

interface Harness {
  raw: Map<string, string>;
  /** Set to simulate a full quota: writes longer than this throw. */
  maxBytes: number | null;
  /** Set to simulate Safari private mode, where even reading throws. */
  blocked: boolean;
  /** Pretend another tab wrote to storage. */
  emitStorage: (key: string | null) => void;
}

let harness: Harness;

function install(): Harness {
  const raw = new Map<string, string>();
  const state = { maxBytes: null as number | null, blocked: false };
  const handlers = new Set<(event: StorageEvent) => void>();

  const storage = {
    get length() {
      return raw.size;
    },
    clear: () => raw.clear(),
    getItem: (key: string) => (raw.has(key) ? raw.get(key)! : null),
    key: (index: number) => [...raw.keys()][index] ?? null,
    removeItem: (key: string) => void raw.delete(key),
    setItem: (key: string, value: string) => {
      if (state.maxBytes !== null && value.length > state.maxBytes) {
        throw new Error("QuotaExceededError");
      }
      raw.set(key, value);
    },
  };

  const fakeWindow = {
    get localStorage() {
      if (state.blocked) throw new Error("access denied");
      return storage as unknown as Storage;
    },
    addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "storage") handlers.add(handler as (event: StorageEvent) => void);
    },
    removeEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === "storage") handlers.delete(handler as (event: StorageEvent) => void);
    },
  };

  (globalThis as unknown as { window?: unknown }).window = fakeWindow;

  return {
    raw,
    get maxBytes() {
      return state.maxBytes;
    },
    set maxBytes(value: number | null) {
      state.maxBytes = value;
    },
    get blocked() {
      return state.blocked;
    },
    set blocked(value: boolean) {
      state.blocked = value;
    },
    emitStorage: (key: string | null) => {
      for (const handler of [...handlers]) handler({ key } as StorageEvent);
    },
  };
}

function uninstall(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

let seq = 0;
function input(partial: Partial<LogInput> = {}): LogInput {
  seq += 1;
  return {
    kind: "shift",
    subjectId: "dishwasher",
    label: "Dishwasher",
    gramsSaved: 100,
    status: "done",
    loggedAt: `2026-08-26T${String(seq % 24).padStart(2, "0")}:00:00.000Z`,
    ...partial,
  };
}

function stored(partial: Partial<LoggedAction> = {}): LoggedAction {
  seq += 1;
  return {
    id: `id-${seq}`,
    kind: "shift",
    subjectId: "dishwasher",
    label: "Dishwasher",
    loggedAt: "2026-08-26T12:00:00.000Z",
    gramsSaved: 100,
    status: "done",
    ...partial,
  };
}

function seed(actions: unknown): void {
  harness.raw.set(STORAGE_KEY, JSON.stringify(actions));
}

function rawList(): LoggedAction[] {
  return JSON.parse(harness.raw.get(STORAGE_KEY) ?? "[]");
}

beforeEach(() => {
  harness = install();
});

afterEach(() => {
  uninstall();
});

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("round trip", () => {
  it("stores a logged action and reads it back", async () => {
    const action = await localStore.log(input({ gramsSaved: 240 }));
    expect(action.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await localStore.list()).toEqual([action]);
  });

  it("defaults loggedAt to now when the caller doesn't supply one", async () => {
    const before = Date.now();
    const action = await localStore.log(input({ loggedAt: undefined }));
    expect(Date.parse(action.loggedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(action.loggedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("returns newest first", async () => {
    await localStore.log(input({ loggedAt: "2026-08-24T10:00:00.000Z", label: "old" }));
    await localStore.log(input({ loggedAt: "2026-08-26T10:00:00.000Z", label: "new" }));
    expect((await localStore.list()).map((a) => a.label)).toEqual(["new", "old"]);
  });

  it("forces a decline to zero grams however it was called", async () => {
    // Declining is free. Storing a number here would be a bug with a tone.
    const action = await localStore.log(input({ status: "declined", gramsSaved: 500 }));
    expect(action.gramsSaved).toBe(0);
    expect((await localStore.list())[0].gramsSaved).toBe(0);
  });

  it("never stores a negative saving", async () => {
    const action = await localStore.log(input({ gramsSaved: -300 }));
    expect(action.gramsSaved).toBe(0);
  });

  it("removes one action by id and leaves the rest", async () => {
    const keep = await localStore.log(input({ label: "keep" }));
    const drop = await localStore.log(input({ label: "drop" }));
    await localStore.remove(drop.id);
    expect((await localStore.list()).map((a) => a.id)).toEqual([keep.id]);
  });

  it("ignores a remove for an id that isn't there", async () => {
    const kept = await localStore.log(input());
    await localStore.remove("nope");
    expect(await localStore.list()).toEqual([kept]);
  });

  it("clears everything", async () => {
    await localStore.log(input());
    await localStore.clear();
    expect(await localStore.list()).toEqual([]);
    expect(harness.raw.has(STORAGE_KEY)).toBe(false);
  });
});

describe("corrupt or missing data", () => {
  it("returns an empty list when nothing has been stored", async () => {
    expect(await localStore.list()).toEqual([]);
  });

  it("recovers from unparseable JSON instead of throwing", async () => {
    harness.raw.set(STORAGE_KEY, "{not json at all");
    expect(await localStore.list()).toEqual([]);
    // Non-destructive: the bad bytes are still there to debug, not silently wiped.
    expect(harness.raw.get(STORAGE_KEY)).toBe("{not json at all");
  });

  it("recovers when the stored value isn't an array", async () => {
    seed({ nope: true });
    expect(await localStore.list()).toEqual([]);
  });

  it("recovers from an empty string", async () => {
    harness.raw.set(STORAGE_KEY, "");
    expect(await localStore.list()).toEqual([]);
  });

  it("reads a wrapped { actions: [...] } payload", async () => {
    const action = stored();
    seed({ actions: [action] });
    expect(await localStore.list()).toEqual([action]);
  });

  it("drops unrecognisable entries and keeps the good ones", async () => {
    const good = stored({ id: "good" });
    seed([
      good,
      null,
      "a string",
      42,
      { id: "no-kind", subjectId: "x", loggedAt: good.loggedAt, status: "done" },
      { ...stored(), kind: "teleportation" },
      { ...stored(), status: "smug" },
      { ...stored(), loggedAt: "whenever" },
      { ...stored(), id: 7 },
    ]);
    expect((await localStore.list()).map((a) => a.id)).toEqual(["good"]);
  });

  it("repairs recoverable fields rather than dropping the row", async () => {
    seed([
      {
        id: "patchy",
        kind: "habit",
        subjectId: "air-dry",
        loggedAt: "2026-08-26T12:00:00.000Z",
        status: "done",
        gramsSaved: "lots", // wrong type
        // label missing
      },
    ]);
    const [action] = await localStore.list();
    expect(action).toMatchObject({ id: "patchy", label: "air-dry", gramsSaved: 0 });
  });

  it("clamps a negative stored grams value to zero", async () => {
    seed([stored({ gramsSaved: -900 })]);
    expect((await localStore.list())[0].gramsSaved).toBe(0);
  });

  it("keeps working after a corrupt read by overwriting on the next write", async () => {
    harness.raw.set(STORAGE_KEY, "garbage");
    const action = await localStore.log(input());
    expect(await localStore.list()).toEqual([action]);
  });

  it("returns an empty list when storage access itself throws", async () => {
    harness.blocked = true;
    expect(await localStore.list()).toEqual([]);
    // And a write is a no-op rather than an exception in the middle of a tap.
    await expect(localStore.log(input())).resolves.toBeTruthy();
  });
});

describe("history cap", () => {
  it("caps what it reads", async () => {
    seed(
      Array.from({ length: MAX_ACTIONS + 50 }, (_, i) =>
        stored({ id: `id-${i}`, loggedAt: new Date(1_700_000_000_000 + i * 60_000).toISOString() }),
      ),
    );
    const list = await localStore.list();
    expect(list).toHaveLength(MAX_ACTIONS);
    // The newest survive; the oldest are the ones dropped.
    expect(list[0].id).toBe(`id-${MAX_ACTIONS + 49}`);
  });

  it("caps what it writes, dropping the oldest", async () => {
    seed(
      Array.from({ length: MAX_ACTIONS }, (_, i) =>
        stored({ id: `id-${i}`, loggedAt: new Date(1_700_000_000_000 + i * 60_000).toISOString() }),
      ),
    );
    const newest = await localStore.log(input({ loggedAt: "2030-01-01T00:00:00.000Z" }));
    const written = rawList();
    expect(written).toHaveLength(MAX_ACTIONS);
    expect(written[0].id).toBe(newest.id);
    expect(written.some((a) => a.id === "id-0")).toBe(false);
  });

  it("keeps recent history rather than losing the write when the quota is full", async () => {
    seed(
      Array.from({ length: 300 }, (_, i) =>
        stored({ id: `id-${i}`, loggedAt: new Date(1_700_000_000_000 + i * 60_000).toISOString() }),
      ),
    );
    harness.maxBytes = 30_000; // roughly 150 rows' worth
    const newest = await localStore.log(input({ loggedAt: "2030-01-01T00:00:00.000Z" }));
    const written = rawList();
    expect(written).toHaveLength(100);
    expect(written[0].id).toBe(newest.id);
  });
});

describe("change notification", () => {
  it("tells subscribers about every mutation", async () => {
    const listener = vi.fn();
    const unsubscribe = localStore.subscribe(listener);

    const action = await localStore.log(input());
    expect(listener).toHaveBeenCalledTimes(1);
    await localStore.remove(action.id);
    expect(listener).toHaveBeenCalledTimes(2);
    await localStore.clear();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await localStore.log(input());
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps several subscribers in sync", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = localStore.subscribe(a);
    const unsubB = localStore.subscribe(b);
    await localStore.log(input());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it("survives a subscriber that throws", async () => {
    const broken = vi.fn(() => {
      throw new Error("bad consumer");
    });
    const healthy = vi.fn();
    const unsubA = localStore.subscribe(broken);
    const unsubB = localStore.subscribe(healthy);
    await expect(localStore.log(input())).resolves.toBeTruthy();
    expect(healthy).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it("reacts to another tab writing our key", () => {
    const listener = vi.fn();
    const unsubscribe = localStore.subscribe(listener);
    harness.emitStorage(STORAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("reacts to another tab clearing all storage", () => {
    const listener = vi.fn();
    const unsubscribe = localStore.subscribe(listener);
    harness.emitStorage(null); // localStorage.clear() in another tab
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores other keys in the same origin", () => {
    const listener = vi.fn();
    const unsubscribe = localStore.subscribe(listener);
    harness.emitStorage("some.other.app.key");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("server-side rendering", () => {
  // Kept last on purpose: it removes the fake window the other tests rely on.
  it("reads and writes as no-ops when there is no window", async () => {
    uninstall();
    expect(readActions()).toEqual([]);
    expect(await localStore.list()).toEqual([]);
    const action = await localStore.log(input());
    expect(action.id).toBeTruthy(); // caller still gets a usable object
    await expect(localStore.remove("x")).resolves.toBeUndefined();
    await expect(localStore.clear()).resolves.toBeUndefined();
  });
});
