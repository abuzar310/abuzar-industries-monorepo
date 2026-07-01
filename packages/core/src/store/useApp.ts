"use client";
import { useSyncExternalStore } from "react";
import { getState, subscribe, type AppState } from "./app-store";

/** Subscribe a component to app-wide UI state. */
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}
