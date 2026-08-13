"use client";
// The open screen registers its Save PDF; the AI chip runs that, not a tutorial.
import { useEffect, useSyncExternalStore } from "react";

type Saver = () => void | Promise<void>;

let saver: Saver | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function bindPagePdf(fn: Saver | null) {
  saver = fn;
  emit();
  return () => {
    if (saver === fn) {
      saver = null;
      emit();
    }
  };
}

export function hasPagePdf() {
  return !!saver;
}

export async function runPagePdf(): Promise<boolean> {
  if (!saver) return false;
  await saver();
  return true;
}

export function useBindPagePdf(fn: Saver | undefined) {
  useEffect(() => {
    if (!fn) return;
    return bindPagePdf(fn);
  }, [fn]);
}

export function useHasPagePdf() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    hasPagePdf,
    () => false,
  );
}
