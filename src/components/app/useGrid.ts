"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAppliance, DEFAULT_APPLIANCE_ID } from "@/lib/appliances";
import { dailyBest, planWindows } from "@/lib/grid/windows";
import type { GridSnapshot, RunWindow, WindowPlan } from "@/lib/types";
import { useHydrated, useStoredValue } from "./useStoredValue";

const ZIP_KEY = "gridmap.zip.v1";
const BA_KEY = "gridmap.ba.v1";
const APPLIANCE_KEY = "gridmap.appliance.v1";

export interface GridState {
  snapshot: GridSnapshot | null;
  city?: string;
  loading: boolean;
  /** Something the user should know — usually that the match was coarse. */
  notice?: string;
  error?: string;
}

export interface UseGridResult extends GridState {
  /** True when we have no location yet and are waiting for one. */
  needsLocation: boolean;
  zip: string | null;
  /** Set when the user has manually overridden the detected region. */
  baOverride: string | null;
  applianceId: string;
  plan: WindowPlan | null;
  week: RunWindow[];
  /** False until stored preferences are readable. Gate skeletons on this. */
  ready: boolean;
  setZip: (zip: string) => void;
  setBaOverride: (ba: string | null) => void;
  setApplianceId: (id: string) => void;
  reload: () => void;
}

/**
 * Everything the Today screen needs.
 *
 * One network call fetches the whole week; appliance windows are recomputed
 * locally (`lib/grid/windows` is pure), so switching from "dishwasher" to "EV
 * charging" is instant and costs no request.
 */
export function useGrid(): UseGridResult {
  const ready = useHydrated();
  const [zip, setStoredZip] = useStoredValue(ZIP_KEY);
  const [baOverride, setStoredBa] = useStoredValue(BA_KEY);
  const [storedAppliance, setStoredAppliance] = useStoredValue(APPLIANCE_KEY);
  const applianceId = storedAppliance ?? DEFAULT_APPLIANCE_ID;

  const [state, setState] = useState<GridState>({
    snapshot: null,
    loading: true,
  });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!ready) return;
    // Nothing to show until we know where they are. Defaulting to some region
    // and captioning it "just an example" invites someone in Texas to read
    // California's numbers and act on them, so we ask first instead.
    if (!zip && !baOverride) return;
    let live = true;

    const query = baOverride
      ? `ba=${encodeURIComponent(baOverride)}`
      : `zip=${encodeURIComponent(zip!)}`;

    fetch(`/api/grid?${query}`)
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

  const setZip = useCallback(
    (next: string) => {
      const clean = next.replace(/\D/g, "").slice(0, 5);
      // A fresh ZIP supersedes any manual region pick.
      setStoredBa(null);
      setStoredZip(clean || null);
    },
    [setStoredBa, setStoredZip],
  );

  const setApplianceId = useCallback(
    (id: string) => setStoredAppliance(id),
    [setStoredAppliance],
  );

  const reload = useCallback(() => setEpoch((e) => e + 1), []);

  const appliance = useMemo(() => getAppliance(applianceId), [applianceId]);

  const plan = useMemo(
    () => (state.snapshot ? planWindows(state.snapshot, appliance) : null),
    [state.snapshot, appliance],
  );

  const week = useMemo(
    () => (state.snapshot ? dailyBest(state.snapshot, appliance) : []),
    [state.snapshot, appliance],
  );

  const needsLocation = ready && !zip && !baOverride;

  return {
    // Derived rather than pushed into state from the effect: with no location
    // there is nothing loading, and setting that in an effect would cascade.
    ...(needsLocation ? { ...state, snapshot: null, loading: false } : state),
    needsLocation,
    zip,
    baOverride,
    applianceId,
    plan,
    week,
    ready,
    setZip,
    setBaOverride: setStoredBa,
    setApplianceId,
    reload,
  };
}
