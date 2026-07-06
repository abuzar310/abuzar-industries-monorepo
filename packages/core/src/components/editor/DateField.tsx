"use client";
import { useRef } from "react";
import { dateSortKey, normalizeDate } from "@/lib/calc";

/** Lean date input for a quotation/invoice. You can just TYPE a loose value
 *  ("5", "5-7", "5/7/26", "today") — it normalises to `dd-mm-yy` on blur — or
 *  tap the calendar to pick a day. Keeping every doc in one real date format is
 *  what lets the lists sort quotations date-wise. */
export default function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const iso = dateSortKey(value); // dd-mm-yy → yyyy-mm-dd, for the native picker

  const openPicker = () => {
    const el = nativeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  };

  return (
    <div className="datefield">
      <input
        className="datefield-txt"
        value={value}
        placeholder="dd-mm-yy"
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normalizeDate(e.target.value))}
      />
      <button
        type="button"
        className="datefield-cal no-print"
        aria-label="Pick a date"
        title="Pick a date"
        onClick={openPicker}
      >
        📅
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="datefield-native no-print"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        onChange={(e) => onChange(e.target.value ? normalizeDate(e.target.value) : "")}
      />
    </div>
  );
}
