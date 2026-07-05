"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Customer } from "@/lib/types";

/** Searchable customer name field — type to filter existing customers and pick one (links the doc to
 *  that customer, avoiding duplicates), or type a brand-new name to start a fresh customer.
 *  The dropdown is portalled to <body> so the masthead's overflow:hidden can't clip it. */
export default function CustomerPicker({
  value,
  customers,
  onType,
  onPick,
  placeholder,
}: {
  value: string;
  customers: Customer[];
  onType: (v: string) => void;
  onPick: (c: Customer) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const term = value.trim().toLowerCase();
  const matches = (
    term ? customers.filter((c) => (c.name || "").toLowerCase().includes(term) || (c.phone || "").includes(term)) : customers
  ).slice(0, 8);
  // hide once the typed value already exactly names one customer (nothing left to choose)
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
        onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on a suggestion land first
      />
      {r &&
        createPortal(
          <div
            className="custpick-list no-print"
            style={{ position: "fixed", top: r.bottom + 3, left: r.left, width: r.width }}
          >
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                className="custpick-item"
                onMouseDown={(e) => e.preventDefault()} // keep the input focused so the click lands
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
              >
                <b>{c.name}</b>
                {c.phone ? <small> · {c.phone}</small> : null}
                {c.opening ? <span className="cp-due">dues ₹{Math.round(c.opening)}</span> : null}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
