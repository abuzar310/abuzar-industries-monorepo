"use client";
import { useEffect, useRef, useState } from "react";
import { Paged } from "@/components/Pager";
import PassbookPrint, { type PassbookLine } from "@/components/PassbookPrint";
import PdfButtons from "@/components/PdfButtons";
import { brandFor } from "@/lib/brand";
import { inr } from "@/lib/calc";
import { generatePdf } from "@/lib/pdf";
import {
  PLACE_RENT_SEEDS,
  adoptCarpenterAsTenant,
  findDuplicateCarpenters,
  mergePlaceRentTenants,
  nameHitsSeed,
  placeRentDue,
  placeRentStatement,
  preferKeep,
  type PlaceRentStmt,
} from "@/lib/place-rent";
import type { Carpenter, Expense } from "@/lib/types";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import { toast } from "@/store/app-store";
import { useApp } from "@/store/useApp";
import { TabIcon } from "@/components/Icons";

export const r2 = (n: number) => Math.round(n * 100) / 100;

export type RentSlot = { seed?: string; tenant?: Carpenter };

export type HistLine = PlaceRentStmt & { who?: string; href?: string };

export function rentSlots(tenants: Carpenter[]): RentSlot[] {
  const used = new Set<string>();
  const slots: RentSlot[] = [];
  for (const seed of PLACE_RENT_SEEDS) {
    const tenant = tenants.find((c) => !used.has(c.id) && nameHitsSeed(c.name, seed));
    if (tenant) used.add(tenant.id);
    slots.push({ seed, tenant });
  }
  for (const c of tenants) {
    if (!used.has(c.id)) slots.push({ tenant: c });
  }
  return slots;
}

export async function pullCarpenter(current: Carpenter | undefined, directory: Carpenter[]): Promise<Carpenter | null> {
  const others = directory.filter((c) => c.id !== current?.id);
  if (!others.length) {
    toast("No other carpenter in the directory");
    return null;
  }
  const res = await formDialog({
    title: current ? "Pull from carpenters" : "Link a carpenter",
    message: current
      ? "Replace this Rent card with someone already on Carpenters. History moves across."
      : "Pick the carpenter who rents this place.",
    fields: [
      {
        name: "id",
        label: "Carpenter",
        type: "select",
        required: true,
        options: [
          { value: "", label: "Choose…" },
          ...others.map((c) => ({
            value: c.id,
            label: c.name + (c.phone ? " · " + c.phone : ""),
          })),
        ],
      },
    ],
    submitLabel: "Use this carpenter",
  });
  const id = (res?.id || "").trim();
  const chosen = others.find((c) => c.id === id);
  if (!chosen) return null;
  return adoptCarpenterAsTenant(current, chosen);
}

export async function mergeDuplicates(tenant: Carpenter, directory: Carpenter[]): Promise<Carpenter | null> {
  const dups = findDuplicateCarpenters(tenant, directory);
  if (!dups.length) {
    toast("No duplicate name + number");
    return null;
  }
  let other = dups[0];
  if (dups.length > 1) {
    const res = await formDialog({
      title: "Merge duplicate",
      message: "Same name and number. Pick which card to fold into this one.",
      fields: [
        {
          name: "id",
          label: "Duplicate",
          type: "select",
          required: true,
          options: dups.map((c) => ({
            value: c.id,
            label: c.name + (c.phone ? " · " + c.phone : ""),
          })),
        },
      ],
      submitLabel: "Merge",
    });
    other = dups.find((c) => c.id === res?.id) || other;
  }
  const keep = preferKeep(tenant, other);
  const drop = keep.id === tenant.id ? other : tenant;
  const ok = await confirmDialog({
    title: "Merge into " + keep.name + "?",
    message:
      (drop.name || "Duplicate") +
      (drop.phone ? " · " + drop.phone : "") +
      " folds into " +
      keep.name +
      ". Rent history moves. The extra carpenter is removed.",
    confirmLabel: "Merge",
    danger: true,
  });
  if (!ok) return null;
  return mergePlaceRentTenants(keep, drop);
}

export function stmtTotals(stmt: PlaceRentStmt[]) {
  let charged = 0,
    opening = 0,
    received = 0,
    setoff = 0;
  for (const e of stmt) {
    const a = Math.abs(e.signed);
    if (e.kind === "charge") charged += a;
    else if (e.kind === "opening") opening += a;
    else if (e.kind === "received") received += a;
    else setoff += a;
  }
  return { charged: r2(charged), opening: r2(opening), received: r2(received), setoff: r2(setoff) };
}

/** Same cream passbook as Accounts / customer statement, with rent words. */
export function rentPassbook(tenant: Carpenter, expenses: Expense[]): {
  summary: { k: string; v: string }[];
  rows: PassbookLine[];
} {
  const stmt = placeRentStatement(tenant, expenses);
  const tot = stmtTotals(stmt);
  const due = placeRentDue(tenant, expenses);
  const monthly = r2(+(tenant.monthlyRent || 0) || 0);
  const added = r2(tot.opening + tot.charged);
  const paid = r2(tot.received + tot.setoff);
  const rows: PassbookLine[] = stmt.map((e) => ({
    key: e.id,
    date: e.date,
    who:
      e.kind === "opening"
        ? "Old balance — already owed"
        : e.kind === "charge"
          ? "Rent added"
          : e.kind === "received"
            ? "They paid"
            : "Commission put on rent",
    detail: e.sub,
    debit: e.signed > 0 ? Math.abs(e.signed) : 0,
    credit: e.signed < 0 ? Math.abs(e.signed) : 0,
    balance: e.bal,
    open: e.kind === "opening",
  }));
  rows.push({
    key: tenant.id + "-close",
    date: "",
    who: due > 0.5 ? "They still owe" : "Settled",
    debit: 0,
    credit: 0,
    balance: due,
    close: true,
  });
  return {
    summary: [
      { k: "Usual month", v: monthly > 0.5 ? "₹ " + inr(monthly) : "—" },
      { k: "Rent added", v: "₹ " + inr(added) },
      { k: "They paid", v: "₹ " + inr(paid) },
      { k: "They still owe", v: due > 0.5 ? "₹ " + inr(due) : "Settled" },
    ],
    rows,
  };
}

export function RentPdfButtons({ tenant, expenses }: { tenant: Carpenter; expenses: Expense[] }) {
  const printRef = useRef<HTMLDivElement>(null);
  const { brandMode } = useApp();
  const brand = brandFor(brandMode);
  const [job, setJob] = useState<{ preview: boolean } | null>(null);
  const book = rentPassbook(tenant, expenses);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const el = printRef.current;
      if (!el) {
        setJob(null);
        return;
      }
      const fileBase = (tenant.name || "rent").replace(/\s+/g, "-").toLowerCase() + "-place-rent";
      try {
        if (!job.preview) toast("Preparing PDF…");
        await generatePdf(el, fileBase, {
          pageBreak: ".bank-row,.acct-print-sum,.acct-print-hdr",
          width: 700,
          title: (brand.name || "Place rent") + " — " + (tenant.name || "tenant"),
          marginMm: 8,
          preview: job.preview,
        });
        if (!cancelled && !job.preview) toast("Rent PDF downloaded");
      } catch {
        if (!cancelled) toast("Could not create the PDF");
      }
      if (!cancelled) setJob(null);
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [job, tenant.name, brand.name]);

  return (
    <>
      <PdfButtons onPreview={() => setJob({ preview: true })} onDownload={() => setJob({ preview: false })} />
      <PassbookPrint printRef={printRef} summary={book.summary} rows={book.rows} dr="They owe" cr="They paid" />
    </>
  );
}

export function HistList({
  items,
  empty,
  resetKey,
  onWho,
  onRemove,
}: {
  items: HistLine[];
  empty: string;
  resetKey: string;
  onQuote?: (id: string) => void;
  onWho?: (href: string) => void;
  onRemove?: (id: string) => void;
}) {
  if (!items.length) return <div className="empty-note" style={{ padding: "8px 0 4px" }}>{empty}</div>;
  return (
    <Paged items={items} resetKey={resetKey}>
      {(view) => (
        <div className="cs-card rent-hist-list">
          {view.map((ev) => {
            const canRemove = !!(onRemove && ev.kind !== "opening" && ev.id.startsWith("EXP-"));
            const goWho = !canRemove && !!(ev.href && onWho);
            const onRow = canRemove ? () => onRemove!(ev.id) : goWho ? () => onWho!(ev.href!) : undefined;
            const body = (
              <>
                <div className={"stmt-ic " + (ev.kind === "received" ? "cash" : ev.kind === "setoff" ? "upi" : "due")}>
                  <span className="desk-only">{ev.kind === "received" ? "₹" : ev.kind === "setoff" ? "−" : ev.kind === "opening" ? "Old" : "Rent"}</span>
                  <TabIcon icon={ev.kind === "received" ? "wallet" : ev.kind === "setoff" ? "scale" : ev.kind === "opening" ? "ledger" : "building"} size={16} className="ph-only" />
                </div>
                <div className="stmt-main">
                  <div className="stmt-to">{ev.label}</div>
                  <div className="stmt-sub">{[ev.who, ev.date, ev.sub].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="cs-amt">
                  <div className={"stmt-amt" + (ev.signed > 0 ? " due" : "")}>
                    {ev.signed > 0 ? "+" : "−"}₹{inr(Math.abs(ev.signed))}
                  </div>
                  <small className="cs-runbal">due ₹{inr(ev.bal)}</small>
                </div>
                {canRemove && <span className="rent-hist-act">Remove</span>}
              </>
            );
            return onRow ? (
              <button type="button" className={"stmt" + (canRemove ? " rent-hist-link" : "")} key={ev.id} onClick={onRow}>
                {body}
              </button>
            ) : (
              <div className="stmt" key={ev.id}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </Paged>
  );
}
