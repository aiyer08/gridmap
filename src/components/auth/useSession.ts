"use client";

import { useEffect, useState } from "react";
import {
  getSession,
  isSupabaseConfigured,
  onAuthStateChange,
  type TrackerSession,
} from "@/lib/track/supabaseClient";

export interface SessionState {
  session: TrackerSession | null;
  /** False until we've checked, so we never flash the wrong state. */
  ready: boolean;
  /** False on deployments with no Supabase env — accounts simply don't exist. */
  available: boolean;
}

/**
 * Auth state for the UI. Deliberately tolerant: on a deployment with no
 * Supabase credentials this resolves immediately to "no accounts here", and the
 * app carries on saving to the browser.
 */
export function useSession(): SessionState {
  const available = isSupabaseConfigured();
  const [session, setSession] = useState<TrackerSession | null>(null);
  const [ready, setReady] = useState(!available);

  useEffect(() => {
    if (!available) return;
    let live = true;
    void getSession().then((s) => {
      if (!live) return;
      setSession(s);
      setReady(true);
    });
    const unsubscribe = onAuthStateChange((s) => {
      if (!live) return;
      setSession(s);
      setReady(true);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [available]);

  return { session, ready, available };
}
