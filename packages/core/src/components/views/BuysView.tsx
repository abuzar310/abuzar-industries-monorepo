"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allRec, delRec } from "@/lib/data";
import { inr, qty, todayStr } from "@/lib/calc";
import { editBuyerDialog } from "@/lib/customer-form";
import {
  allPurchases,
  deletePurchase,
  lineAmount,
  purchaseTotals,
  rowBalance,
  savePurchase,
} from "@/lib/purchases";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import DateField from "@/components/editor/DateField";
import type { Purchase, Supplier } from "@/lib/types";

type Seg = "ledger" | "buyers";

const emptyForm = () => ({
  date: todayStr(),
  supplierId: "",
  billNo: "",
  cft: "",
  rate: "",
  amount: "",
  billAmount: "",
  topAmount: "",
  note: "",
  topPaid: "",
  billPaid: "",
  billPayDate: "",
  accountNote: "",
});

const COLS = [
  "Date",
  "From name",
  "Bill no",
  "CFT",
  "Rate",
  "Amount",
  "Bill amount",
  "Top amount",
  "Description",
  "Top paid",
  "Bill pay date",
  "Bill paid",
  "My a/c tra",
  "",
] as const;

export default function BuysView() {
  const { ready, dataVersion, cloakMoney } = useApp();
  const [seg, setSeg] = useState<Seg>("ledger");
  const [buyersRaw, setBuyers] = useState<Supplier[]>([]);
  const [rowsRaw, setRows] = useState<Purchase[]>([]);
  const [buyerFilter, setBuyerFilter] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([allRec<Supplier>("suppliers"), allPurchases()]).then(([bs, ps]) => {
      bs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setBuyers(bs);
      setRows(ps);
    });
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const buyers = cloakMoney ? [] : buyersRaw;
  const rows = cloakMoney ? [] : rowsRaw;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (buyerFilter && p.supplierId !== buyerFilter) return false;
      if (unpaidOnly && Math.abs(rowBalance(p)) <= 0.5) return false;
      if (!needle) return true;
      return [p.fromName, p.billNo, p.note, p.accountNote, p.date]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, buyerFilter, unpaidOnly, q]);

  const totals = useMemo(() => purchaseTotals(filtered), [filtered]);

  const buyCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of rows) {
      if (!p.supplierId) continue;
      m.set(p.supplierId, (m.get(p.supplierId) || 0) + 1);
    }
    return m;
  }, [rows]);

  function setF<K extends keyof ReturnType<typeof emptyForm>>(k: K, v: string) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "cft" || k === "rate") {
        const amt = lineAmount(+next.cft || 0, +next.rate || 0);
        next.amount = amt ? String(amt) : "";
        if (!next.billAmount || next.billAmount === prev.amount) {
          next.billAmount = next.amount;
        }
      }
      return next;
    });
  }

  function startNew() {
    setEditId(null);
    setForm({ ...emptyForm(), supplierId: buyerFilter || "" });
    setShowForm(true);
    setSeg("ledger");
  }

  function startEdit(p: Purchase) {
    setEditId(p.id);
    setForm({
      date: p.date || todayStr(),
      supplierId: p.supplierId || "",
      billNo: p.billNo || "",
      cft: p.cft ? String(p.cft) : "",
      rate: p.rate ? String(p.rate) : "",
      amount: p.amount ? String(p.amount) : "",
      billAmount: p.billAmount ? String(p.billAmount) : "",
      topAmount: p.topAmount ? String(p.topAmount) : "",
      note: p.note || "",
      topPaid: p.topPaid ? String(p.topPaid) : "",
      billPaid: p.billPaid ? String(p.billPaid) : "",
      billPayDate: p.billPayDate || "",
      accountNote: p.accountNote || "",
    });
    setShowForm(true);
    setSeg("ledger");
  }

  async function onSave() {
    const buyer = buyers.find((b) => b.id === form.supplierId);
    if (!buyer) {
      toast("Pick a buyer first");
      return;
    }
    setSaving(true);
    try {
      await savePurchase({
        id: editId || undefined,
        date: form.date,
        supplierId: buyer.id,
        fromName: buyer.name,
        billNo: form.billNo,
        cft: form.cft,
        rate: form.rate,
        amount: form.amount,
        billAmount: form.billAmount,
        topAmount: form.topAmount,
        note: form.note,
        topPaid: form.topPaid,
        billPaid: form.billPaid,
        billPayDate: form.billPayDate,
        accountNote: form.accountNote,
      });
      toast(editId ? "Updated" : "Saved");
      setEditId(null);
      setForm({ ...emptyForm(), supplierId: buyerFilter || buyer.id });
      setShowForm(true);
      bumpData();
      load();
    } catch (e) {
      toast("Save failed: " + ((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: Purchase) {
    const ok = await confirmDialog({
      title: "Delete this row?",
      message: `${p.fromName || "Buy"} · bill ${p.billNo || "—"} · ₹${inr(p.billAmount)}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePurchase(p.id);
    if (editId === p.id) {
      setEditId(null);
      setForm(emptyForm());
    }
    bumpData();
    load();
    toast("Deleted");
  }

  async function addBuyer() {
    const b = await editBuyerDialog();
    if (!b) return;
    bumpData();
    load();
    setBuyerFilter(b.id);
    setForm((f) => ({ ...f, supplierId: b.id }));
    toast("Buyer " + b.name + " added");
  }

  async function editBuyer(s: Supplier) {
    const next = await editBuyerDialog(s);
    if (!next) return;
    bumpData();
    load();
    toast("Buyer updated");
  }

  async function removeBuyer(s: Supplier) {
    const n = buyCount.get(s.id) || 0;
    const ok = await confirmDialog({
      title: "Delete " + s.name + "?",
      message:
        n > 0
          ? `${n} row${n === 1 ? "" : "s"} stay in the sheet; only this buyer is removed.`
          : "Only this buyer contact is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("suppliers", s.id);
    if (buyerFilter === s.id) setBuyerFilter("");
    bumpData();
    load();
    toast("Buyer removed");
  }

  const balAbs = Math.abs(totals.balance);
  const balColor =
    balAbs <= 0.5 ? "var(--green)" : totals.balance > 0 ? "var(--danger)" : "var(--ochre-deep)";

  return (
    <div className="buys-page">
      <div className="rowbtns" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div className="rep-seg">
          <button type="button" className={seg === "ledger" ? "on" : ""} onClick={() => setSeg("ledger")}>
            Sheet
          </button>
          <button type="button" className={seg === "buyers" ? "on" : ""} onClick={() => setSeg("buyers")}>
            Buyers
          </button>
        </div>
        {seg === "ledger" ? (
          <>
            <button type="button" className="btn primary sm" onClick={startNew} style={{ marginLeft: "auto" }}>
              + Add row
            </button>
            <button type="button" className="btn sm" onClick={addBuyer}>
              + Buyer
            </button>
          </>
        ) : (
          <button type="button" className="btn primary sm" onClick={addBuyer} style={{ marginLeft: "auto" }}>
            + Buyer
          </button>
        )}
      </div>

      {seg === "buyers" ? (
        <div className="panel-card buys-buyers">
          {buyers.length === 0 ? (
            <div className="buys-empty">
              No buyers yet. Add the parties timber comes from.
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary sm" onClick={addBuyer}>
                  + Add buyer
                </button>
              </div>
            </div>
          ) : (
            <div className="listwrap" style={{ marginTop: 0, border: "none", borderRadius: 0, boxShadow: "none" }}>
              {buyers.map((b) => (
                <div
                  key={b.id}
                  className="lrow"
                  style={{ cursor: "pointer", gridTemplateColumns: "1fr auto auto" }}
                  onClick={() => {
                    setBuyerFilter(b.id);
                    setSeg("ledger");
                  }}
                >
                  <div>
                    <div className="nm">{b.name}</div>
                    <div className="mut">
                      {[b.phone, b.address].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {buyCount.get(b.id) || 0} row{(buyCount.get(b.id) || 0) === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void editBuyer(b);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeBuyer(b);
                    }}
                  >
                    Del
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="buys-sheet">
          {/* Excel-style title + BALANCE */}
          <div className="buys-sheet-head">
            <div style={{ width: 168 }} aria-hidden />
            <h1 className="buys-sheet-title">Buys register</h1>
            <div className="buys-sheet-bal">
              <span className="lab">Balance</span>
              <span className="val" style={{ color: balColor }}>
                {balAbs <= 0.5 ? "—" : "₹ " + inr(balAbs)}
              </span>
            </div>
          </div>

          <div className="buys-toolbar">
            <select
              value={buyerFilter}
              onChange={(e) => setBuyerFilter(e.target.value)}
              aria-label="Filter buyer"
            >
              <option value="">All buyers</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <label className="sub" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
              Unpaid only
            </label>
            <input
              className="grow"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bill, name, note…"
              aria-label="Search"
            />
          </div>

          {showForm && (
            <div className="buys-entry">
              <div className="buys-entry-title">{editId ? "Edit row" : "New row"}</div>
              <div className="buys-entry-grid">
                <label>
                  Date
                  <DateField value={form.date} onChange={(v) => setF("date", v)} />
                </label>
                <label className="span2">
                  From name
                  <select value={form.supplierId} onChange={(e) => setF("supplierId", e.target.value)}>
                    <option value="">Select buyer…</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Bill no
                  <input value={form.billNo} onChange={(e) => setF("billNo", e.target.value)} placeholder="—" />
                </label>
                <label>
                  CFT
                  <input inputMode="decimal" value={form.cft} onChange={(e) => setF("cft", e.target.value)} />
                </label>
                <label>
                  Rate
                  <input inputMode="decimal" value={form.rate} onChange={(e) => setF("rate", e.target.value)} />
                </label>
                <label>
                  Amount
                  <input inputMode="decimal" value={form.amount} onChange={(e) => setF("amount", e.target.value)} />
                </label>
                <label>
                  Bill amount
                  <input
                    inputMode="decimal"
                    value={form.billAmount}
                    onChange={(e) => setF("billAmount", e.target.value)}
                  />
                </label>
                <label>
                  Top amount
                  <input
                    inputMode="decimal"
                    value={form.topAmount}
                    onChange={(e) => setF("topAmount", e.target.value)}
                  />
                </label>
                <label>
                  Top paid
                  <input inputMode="decimal" value={form.topPaid} onChange={(e) => setF("topPaid", e.target.value)} />
                </label>
                <label>
                  Bill paid
                  <input
                    inputMode="decimal"
                    value={form.billPaid}
                    onChange={(e) => setF("billPaid", e.target.value)}
                  />
                </label>
                <label>
                  Bill pay date
                  <DateField value={form.billPayDate} onChange={(v) => setF("billPayDate", v)} />
                </label>
                <label className="span3">
                  Description
                  <input value={form.note} onChange={(e) => setF("note", e.target.value)} placeholder="—" />
                </label>
                <label className="span3">
                  My a/c tra
                  <input
                    value={form.accountNote}
                    onChange={(e) => setF("accountNote", e.target.value)}
                    placeholder="Account / transfer"
                  />
                </label>
              </div>
              <div className="buys-entry-actions">
                <button type="button" className="btn primary sm" disabled={saving} onClick={() => void onSave()}>
                  {saving ? "Saving…" : editId ? "Save changes" : "Save row"}
                </button>
                {editId && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditId(null);
                      setForm({ ...emptyForm(), supplierId: buyerFilter || "" });
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                {buyers.length === 0 && (
                  <button type="button" className="btn sm" onClick={addBuyer}>
                    + Add buyer first
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="buys-scroll">
            <table className="buys-grid">
              <colgroup>
                <col style={{ width: "78px" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "72px" }} />
                <col style={{ width: "64px" }} />
                <col style={{ width: "72px" }} />
                <col style={{ width: "88px" }} />
                <col style={{ width: "92px" }} />
                <col style={{ width: "88px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "88px" }} />
                <col style={{ width: "84px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "88px" }} />
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((h) => (
                    <th key={h || "acts"} className={h && !["Date", "From name", "Bill no", "Description", "My a/c tra", "Bill pay date"].includes(h) ? "num" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={COLS.length} style={{ border: "none", padding: 0 }}>
                      <div className="buys-empty">
                        No rows yet — fill the form above and save.
                        {buyers.length === 0 ? " Add a buyer first." : ""}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr
                      key={p.id}
                      className={editId === p.id ? "on" : undefined}
                      onDoubleClick={() => startEdit(p)}
                      title="Double-click to edit"
                    >
                      <td className="muted">{p.date || "—"}</td>
                      <td className="txt">{p.fromName || "—"}</td>
                      <td className="muted">{p.billNo || "—"}</td>
                      <td className="num">{p.cft ? qty(p.cft, 2) : "—"}</td>
                      <td className="num">{p.rate ? inr(p.rate) : "—"}</td>
                      <td className="num">{p.amount ? inr(p.amount) : "—"}</td>
                      <td className="num">{p.billAmount ? inr(p.billAmount) : "—"}</td>
                      <td className="num">{p.topAmount ? inr(p.topAmount) : "—"}</td>
                      <td>{p.note || "—"}</td>
                      <td className="num">{p.topPaid ? inr(p.topPaid) : "—"}</td>
                      <td className="muted">{p.billPayDate || "—"}</td>
                      <td className="num">{p.billPaid ? inr(p.billPaid) : "—"}</td>
                      <td>{p.accountNote || "—"}</td>
                      <td className="acts">
                        <button type="button" onClick={() => startEdit(p)}>
                          Edit
                        </button>{" "}
                        <button type="button" className="danger" onClick={() => void onDelete(p)}>
                          Del
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="foot-lab">
                    Totals
                  </td>
                  <td className="num">
                    <span className="foot-lab" style={{ display: "block", marginBottom: 2 }}>
                      Total cft
                    </span>
                    {totals.cft ? qty(totals.cft, 2) : "—"}
                  </td>
                  <td />
                  <td className="num">
                    <span className="foot-lab" style={{ display: "block", marginBottom: 2 }}>
                      Total amt
                    </span>
                    {totals.amount ? "₹ " + inr(totals.amount) : "—"}
                  </td>
                  <td className="num">{totals.billAmount ? "₹ " + inr(totals.billAmount) : "—"}</td>
                  <td className="num">{totals.topAmount ? "₹ " + inr(totals.topAmount) : "—"}</td>
                  <td />
                  <td className="num" colSpan={2}>
                    <span className="foot-lab" style={{ display: "block", marginBottom: 2 }}>
                      Total paid amount
                    </span>
                    {totals.paid ? "₹ " + inr(totals.paid) : "—"}
                  </td>
                  <td className="num" style={{ color: balColor }}>
                    <span className="foot-lab" style={{ display: "block", marginBottom: 2 }}>
                      Balance
                    </span>
                    {balAbs <= 0.5 ? "—" : "₹ " + inr(balAbs)}
                  </td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
