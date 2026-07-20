// Per-app feature switches. Each app sets these once from its layout (via
// AppProvider); shared components read them with getFeatures(). Static config,
// so a module var is enough — no reactivity needed.
// ponytail: module var, not React state — features never change after boot.
import type { AppFeatures } from "./types";

// Default = full/official behavior, so anything not explicitly set keeps working.
export const DEFAULT_FEATURES: AppFeatures = { invoices: true, simpleQuote: false, acceptPayment: false };

let current: AppFeatures = DEFAULT_FEATURES;

export const setFeatures = (f: AppFeatures) => {
  current = f;
};
export const getFeatures = (): AppFeatures => current;
