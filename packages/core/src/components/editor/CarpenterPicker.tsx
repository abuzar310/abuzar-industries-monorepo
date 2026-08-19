"use client";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Carpenter, Customer, Doc } from "@/lib/types";

export type CarpenterHit = { name: string; phone: string; village?: string; city?: string };

/** Unique carpenter names from standalone carpenters + customer cards (+ optional quotes). */
export function knownCarpenters(
  customers: Customer[],
  quotes: Doc[] = [],
  directory: Carpenter[] = [],
): CarpenterHit[] {
  const map = new Map<string, CarpenterHit>();
  const add = (name: string, phone: string, village = "", city = "") => {
    const n = (name || "").trim();
    if (!n) return;
    const key = n.toLowerCase();
    const p = (phone || "").trim();
    const v = (village || "").trim();
    const cityN = (city || "").trim();
    const cur = map.get(key);
    if (!cur) map.set(key, { name: n, phone: p, village: v || undefined, city: cityN || undefined });
    else {
      if (!cur.phone && p) cur.phone = p;
      if (!cur.village && v) cur.village = v;
      if (!cur.city && cityN) cur.city = cityN;
    }
  };
  for (const c of directory) add(c.name || "", c.phone || "", c.village || "", c.city || "");
  for (const c of customers) add(c.site || "", c.sitePhone || "", c.siteVillage || "", c.siteCity || "");
  for (const d of quotes) {
    if (d.deletedAt || d.purgedAt) continue;
    add(d.site || "", d.sitePhone || "");
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Searchable carpenter field — pick a known name to fill carpenter phone (same idea as CustomerPicker). */
export default function CarpenterPicker({
  value,
  carpenters,
  onType,
  onPick,
  placeholder,
  maxResults = 8,
}: {
  value: string;
  carpenters: CarpenterHit[];
  onType: (v: string) => void;
  onPick: (c: CarpenterHit) => void;
  placeholder?: string;
  maxResults?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const term = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return carpenters;
    return carpenters.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone || "").includes(term) ||
        (c.village || "").toLowerCase().includes(term) ||
        (c.city || "").toLowerCase().includes(term),
    );
  }, [carpenters, term]);
  const matches = maxResults > 0 ? filtered.slice(0, maxResults) : filtered;
  const exact = !!term && matches.length === 1 && matches[0].name.toLowerCase() === term;
  const show = open && !exact && matches.length > 0;
  const r = show && ref.current ? ref.current.getBoundingClientRect() : null;

  return (
    <div className="custpick">
      <input
        ref={ref}
        placeholder={placeholder || "—"}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {r &&
        createPortal(
          <div
            className="custpick-list no-print"
            style={{ position: "fixed", top: r.bottom + 3, left: r.left, width: r.width }}
          >
            {matches.map((c) => (
              <button
                key={c.name.toLowerCase()}
                type="button"
                className="custpick-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
              >
                <b>{c.name}</b>
                {c.phone ? <small> · {c.phone}</small> : null}
                {(c.village || c.city) && (
                  <small> · {[c.village, c.city].filter(Boolean).join(", ")}</small>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
