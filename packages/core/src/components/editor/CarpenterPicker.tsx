"use client";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Customer, Doc } from "@/lib/types";

export type CarpenterHit = { name: string; phone: string };

/** Unique carpenter names + phones from customer cards (and optional quotations). */
export function knownCarpenters(customers: Customer[], quotes: Doc[] = []): CarpenterHit[] {
  const map = new Map<string, CarpenterHit>();
  const add = (name: string, phone: string) => {
    const n = (name || "").trim();
    if (!n) return;
    const key = n.toLowerCase();
    const p = (phone || "").trim();
    const cur = map.get(key);
    if (!cur) map.set(key, { name: n, phone: p });
    else if (!cur.phone && p) cur.phone = p;
  };
  for (const c of customers) add(c.site || "", c.sitePhone || "");
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
      (c) => c.name.toLowerCase().includes(term) || (c.phone || "").includes(term),
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
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
