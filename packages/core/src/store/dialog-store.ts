// Promise-based modal dialogs (confirm + form), replacing native prompt/confirm/alert.
// Imperative API: await confirmDialog({...}) / await formDialog({...}).
import { useSyncExternalStore } from "react";

export interface DialogField {
  name: string;
  label: string;
  type?: "text" | "number" | "tel" | "email" | "textarea" | "select" | "password" | "photo";
  placeholder?: string;
  value?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  /** for type: "select" */
  options?: { value: string; label: string }[];
}

export interface DialogState {
  title: string;
  message?: string;
  fields: DialogField[];
  submitLabel: string;
  cancelLabel: string;
  danger?: boolean;
  /** Extra left-side action (e.g. Delete). Resolves `{ __action: "delete" }`. */
  deleteLabel?: string;
  resolve: (v: Record<string, string> | null) => void;
}

let state: DialogState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getState = () => state;

export function useDialog(): DialogState | null {
  return useSyncExternalStore(subscribe, getState, getState);
}

function open(opts: Omit<DialogState, "resolve">): Promise<Record<string, string> | null> {
  // close any existing dialog first (resolve as cancelled)
  if (state) state.resolve(null);
  return new Promise((resolve) => {
    state = { ...opts, resolve };
    emit();
  });
}

export function closeDialog(result: Record<string, string> | null) {
  const r = state?.resolve;
  state = null;
  emit();
  r?.(result);
}

/** Yes/no confirmation. Resolves true if confirmed. */
export function confirmDialog(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return open({
    title: opts.title,
    message: opts.message,
    fields: [],
    submitLabel: opts.confirmLabel || "Confirm",
    cancelLabel: opts.cancelLabel || "Cancel",
    danger: opts.danger,
  }).then((r) => r !== null);
}

/** Form dialog. Resolves the field values, or null if cancelled. */
export function formDialog(opts: {
  title: string;
  message?: string;
  fields: DialogField[];
  submitLabel?: string;
  cancelLabel?: string;
  deleteLabel?: string;
}): Promise<Record<string, string> | null> {
  return open({
    title: opts.title,
    message: opts.message,
    fields: opts.fields,
    submitLabel: opts.submitLabel || "Save",
    cancelLabel: opts.cancelLabel || "Cancel",
    deleteLabel: opts.deleteLabel,
  });
}
