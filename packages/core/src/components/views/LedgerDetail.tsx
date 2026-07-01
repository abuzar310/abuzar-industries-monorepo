"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRec, allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { allLedger, partyLedger, deleteEntry, drCr } from "@/lib/ledger";
import { editCustomerDialog } from "@/lib/customer-form";
import { editVendorDialog } from "@/lib/vendor-form";
import { waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Account, Customer, LedgerEntry, Vendor, VoucherKind } from "@/lib/types";
import VoucherForm from "./VoucherForm";

const TAG: Record<VoucherKind, string> = {
  opening: "OPEN", sale: "SALE", purchase: "PUR", receipt: "RCPT", payment: "PAY", contra: "XFER",
};

export default function LedgerDetail({ id }: { id: string }) {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [party, setParty] = useState<{ rec: Customer | Vendor; kind: "debtor" | "creditor" } | null | undefined>(undefined);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const load = useCallback(() => {
    Promise.all([
      getRec<Customer>("customers", id),
      getRec<Vendor>("vendors", id),
      allLedger(),
      allRec<Account>("accounts"),
    ]).then(([c, v, e, a]) => {
      setParty(c ? { rec: c, kind: "debtor" } : v ? { rec: v, kind: "creditor" } : null);
      setEntries(e);
      setAccounts(a);
    });
  }, [id]);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  if (party === undefined) return <div className="sectitle">Ledger <small>— loading…</small></div>;
  if (party === null)
    return (
      <div className="empty">
        <div className="empty-title">Party not found</div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/ledger")}>
          ← Back to ledger
        </button>
      </div>
    );

  const { rec, kind } = party;
  const isDebtor = kind === "debtor";
  const pl = partyLedger(kind, id, entries);
  const close = drCr(kind, pl.balance);
  const stats = [
    { k: "Opening", v: "₹ " + inr(pl.opening) },
    { k: isDebtor ? "Sales" : "Purchases", v: "₹ " + inr(pl.charges), money: true },
    { k: isDebtor ? "Received" : "Paid", v: "₹ " + inr(pl.settled) },
    { k: "Closing Balance", v: "₹ " + inr(close.abs) + " " + close.side, danger: pl.balance > 0 },
  ];

  async function edit() {
    const r = isDebtor ? await editCustomerDialog(rec as Customer) : await editVendorDialog(rec as Vendor);
    if (r) {
      load();
      bumpData();
    }
  }
  function whatsapp() {
    if (rec.phone) window.open(waLink(rec.phone, ""), "_blank");
  }
  async function removeEntry(en: LedgerEntry) {
    const ok = await confirmDialog({ title: "Delete entry?", message: "₹" + inr(en.amount), confirmLabel: "Delete", danger: true });
    if (!ok) return;
    if (editing?.id === en.id) setEditing(null);
    await deleteEntry(en.id);
    load();
    bumpData();
  }

  const gstin = (rec as Customer | Vendor).gstin;
  const rows = [...pl.rows].reverse();

  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.push("/ledger")}>
        ← Ledger
      </button>

      <div className="custcard" style={{ cursor: "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: 26 }}>{rec.name}</h3>
            <div className="ph">{rec.phone || "—"} · {isDebtor ? "Debtor" : "Creditor"}</div>
            <div className="meta2">
              {gstin && <>GSTIN: {gstin}<br /></>}
              {rec.address && <>{rec.address}</>}
            </div>
          </div>
          <div className="links" style={{ marginTop: 0 }}>
            {rec.phone && <button className="btn wa sm" onClick={whatsapp}>WhatsApp</button>}
            <button className="btn sm" onClick={edit}>Edit</button>
          </div>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 16 }}>
        {stats.map((s) => (
          <div className="stat" key={s.k}>
            <div className="k">{s.k}</div>
            <div className={"v" + (s.money ? " money" : "")} style={s.danger ? { color: "var(--danger)" } : undefined}>
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <VoucherForm
        key={editing?.id || "new"}
        scope="party"
        party={{ kind, id }}
        customers={[]}
        vendors={[]}
        accounts={accounts}
        enteredBy={user?.id || "unknown"}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onDone={load}
      />

      <div className="sectitle" style={{ marginTop: 24, fontSize: 22 }}>
        Vouchers <small>— {rows.length}</small>
      </div>
      <div className="panel-card">
        {rows.length ? (
          rows.map((r) => {
            const settle = r.e.kind === "receipt" || r.e.kind === "payment";
            return (
              <div className="exprow led" key={r.e.id}>
                <span className={"exptag " + (settle ? "in" : "out")}>{TAG[r.e.kind]}</span>
                <span className="expnote">
                  {r.e.note || (isDebtor ? (r.e.kind === "sale" ? "Sale" : r.e.kind === "receipt" ? "Receipt" : "Opening") : r.e.kind === "purchase" ? "Purchase" : r.e.kind === "payment" ? "Payment" : "Opening")}
                  <small>
                    {r.e.date}
                    {r.e.gstRate ? " · GST " + r.e.gstRate + "%" : ""}
                    {r.e.ref ? " · " + r.e.ref : ""} · bal ₹{inr(drCr(kind, r.running).abs)} {drCr(kind, r.running).side}
                  </small>
                </span>
                <span className={"expamt " + (settle ? "in" : "out")}>
                  {r.delta >= 0 ? "+" : "−"}₹ {inr(r.e.amount)}
                </span>
                <span className="rowacts">
                  <button className="x-row" title="Edit" onClick={() => setEditing(r.e)}>✎</button>
                  <button className="x-row" title="Delete" onClick={() => removeEntry(r.e)}>×</button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-icon">🧾</div>
            <div className="empty-title">No transactions yet</div>
            <div className="empty-note">Add a {isDebtor ? "sale or receipt" : "purchase or payment"} above.</div>
          </div>
        )}
      </div>
    </div>
  );
}
