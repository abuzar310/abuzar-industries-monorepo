"use client";
import { useSyncExternalStore } from "react";

export type PdfPreviewState =
  | { status: "loading"; name: string }
  | { status: "ready"; name: string; url: string; pages: number; images: string[] }
  | null;

let state: PdfPreviewState = null;
let objectUrl = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getState = () => state;

export function usePdfPreview(): PdfPreviewState {
  return useSyncExternalStore(subscribe, getState, getState);
}

function dropUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  }
}

export function beginPdfPreview(name: string) {
  dropUrl();
  state = { status: "loading", name: name || "document" };
  emit();
}

export function finishPdfPreview(blob: Blob, name: string, images: string[]) {
  dropUrl();
  objectUrl = URL.createObjectURL(blob);
  state = {
    status: "ready",
    name: name || "document",
    url: objectUrl,
    pages: images.length,
    images,
  };
  emit();
}

export function failPdfPreview() {
  dropUrl();
  state = null;
  emit();
}

export function closePdfPreview() {
  dropUrl();
  state = null;
  emit();
}
