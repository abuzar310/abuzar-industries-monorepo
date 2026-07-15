"use client";
// Dashboard cards navigate with "?focus=<key>"; the destination page flashes the
// element holding that exact figure, so it's obvious where the number lives.
// Reads window.location directly (not useSearchParams) so static pages need no
// Suspense boundary; the param is stripped after the flash so refreshes stay calm.
import { useEffect, useState } from "react";

export function useFocusFlash(): (key: string) => string {
  const [on, setOn] = useState<string | null>(null);
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("focus");
    if (!f) return;
    // defer the state flip out of the effect body (rule: no sync setState in effects);
    // the flash starts on the next frame, which is also when the page has painted
    const start = requestAnimationFrame(() => setOn(f));
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    const t = setTimeout(() => setOn(null), 3400);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(t);
    };
  }, []);
  return (key) => (on === key ? " focus-flash" : "");
}
