"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAppliance } from "@/lib/appliances";
import { planWindows, dailyBest } from "@/lib/grid/windows";
import type { GridSnapshot, WindowPlan, RunWindow } from "@/lib/types";

const ZIP_KEY = "gridmap.zip.v1";
const BA_KEY = "gridmap.ba.v1";
const APPLIANCE_KEY = "gridmap.appliance.v1";

export interface GridState {
  snapshot: GridSnapshot | null;
  city?: string;
  /** Loading the first snapshot, or reloading after a location change. */
  loading: boolean;
  /** Something the user should know — a coarse match, or a failure. */
  notice?: string;
  error?: string;
}

export interface UseGridResult extends GridState {
  zip: string | null;
  /** Set when the user has manually overridden the detected region. */
  baOverride: string | null;
  applianceId: string;
  plan: WindowPlan | null;
  week: RunWindow[];
  /** True until we've read the saved location — avoids a hydration mismatch. */
  ready: boolean;
  setZip: (zip: string) => void;
  setBaOverride: (ba: string | null) => void;
  setApplianceId: (id: string) => void;
  reload: () => void;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private browsing. Losing the saved ZIP is survivable.
  }
}

/**
 * Everything the Today screen needs.
 *
 * One network call fetches the whole week; the appliance windows are recomputed
 * locally, so flipping between "dishwasher" and "EV charging" is instant.
 */
export function useGrid(): UseGridResult {
  const [ready, setReady] = useState(false);
  const [zip, setZipState] = useState<string | null>(null);
  const [baOverride, setBaOverrideState] = useState<string | null>(null);
  const [applianceId, setApplianceIdState] = useState("dishwasher");
  const [state, setState] = useState<GridState>({
    snapshot: null,
    loading: true,
  });
  const [epoch, setEpoch] = useState(0);

  // Restore the saved location once, on the client only.
  useEffect(() => {
    setZipState(readStored(ZIP_KEY));
    setBaOverrideState(readStored(BA_KEY));
    const savedAppliance = readStored(APPLIANCE_KEY);
    if (savedAppliance) setApplianceIdState(savedAppliance);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));

    const query = baOverride
      ? `ba=${encodeURIComponent(baOverride)}`
      : zip
        ? `zip=${encodeURIComponent(zip)}`
        : "";

    fetch(`/api/grid${query ? `?${query}` : ""}`)
      .then(async (response) => {
        const body = await response.json();
        if (!live) return;
        if (!response.ok || !body.snapshot) {
          setState({
            snapshot: null,
            loading: false,
            error:
              body.reason ??
              "We couldn't load your grid forecast. Try again in a moment.",
          });
          return;
        }
        setState({
          snapshot: body.snapshot as GridSnapshot,
          city: body.city,
          loading: false,
          notice: body.ok ? undefined : body.reason,
        });
      })
      .catch(() => {
        if (!live) return;
        setState({
          snapshot: null,
          loading: false,
          error:
            "We couldn't reach the grid data. Check your connection and try again.",
        });
      });

    return () => {
      live = false;
    };
  }, [ready, zip, baOverride, epoch]);

  const setZip = useCallback((next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 5);
    writeStored(ZIP_KEY, clean || null);
    // A fresh ZIP supersedes any manual region pick.
    writeStored(BA_KEY, null);
    setBaOverrideState(null);
    setZipState(clean || null);
  }, []);

  const setBaOverride = useCallback((next: string | null) => {
    writeStored(BA_KEY, next);
    setBaOverrideState(next);
  }, []);

  const setApplianceId = useCallback((id: string) => {
    writeStored(APPLIANCE_KEY, id);
    setApplianceIdState(id);
  }, []);

  const reload = useCallback(() => setEpoch((e) => e + 1), []);

  const appliance = useMemo(() => getAppliance(applianceId), [applianceId]);

  const plan = useMemo(() => {
    if (!state.snapshot) return null;
    return planWindows(state.snapshot, appliance);
  }, [state.snapshot, appliance]);

  const week = useMemo(() => {
    if (!state.snapshot) return [];
    return dailyBest(state.snapshot, appliance);
  }, [state.snapshot, appliance]);

  return {
    ...state,
    zip,
    baOverride,
    applianceId,
    plan,
    week,
    ready,
    setZip,
    setBaOverride,
    setApplianceId,
    reload,
  };
}
