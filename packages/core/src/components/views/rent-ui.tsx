"use client";
import { Paged } from "@/components/Pager";
import { inr } from "@/lib/calc";
import {
  PLACE_RENT_SEEDS,
  adoptCarpenterAsTenant,
  findDuplicateCarpenters,
  mergePlaceRentTenants,
  nameHitsSeed,
  preferKeep,
  type PlaceRentStmt,
} from "@/lib/place-rent";
import type { Carpenter } from "@/lib/types";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import { toast } from "@/store/app-store";

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
                  {ev.kind === "received" ? "₹" : ev.kind === "setoff" ? "−" : ev.kind === "opening" ? "Old" : "Rent"}
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
