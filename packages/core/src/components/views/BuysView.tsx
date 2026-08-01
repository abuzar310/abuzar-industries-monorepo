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

const money = (n: number) => (n ? inr(n) : "—");
const vol = (n: number) => (n ? qty(n, 2) : "—");

export default function BuysView() {
  const { ready, dataVersion, cloakMoney } = useApp();
  const [seg, setSeg] = useState<Seg>("ledger");
  const [buyersRaw, setBuyers] = useState<Supplier[]>([]);
  const [rowsRaw, setRows] = useState<Purchase[]>([]);
  const [buyerFilter, setBuyerFilter] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
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
        if (!next.billAmount || next.billAmount === prev.amount) next.billAmount = next.amount;
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

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
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
      closeForm();
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
      message: `${p.fromName || "Buy"} · ${p.billNo || "no bill"} · ₹${inr(p.billAmount)}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePurchase(p.id);
    if (editId === p.id) closeForm();
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
          ? `${n} row${n === 1 ? "" : "s"} stay on the sheet; only this buyer is removed.`
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
  const balTone = balAbs <= 0.5 ? "ok" : totals.balance > 0 ? "due" : "adv";

  return (
    <div className="buys-page">
      <div className="buys-top">
        <div>
          <h1 className="buys-h1">Buys</h1>
          <p className="buys-sub">Timber in · purchase register</p>
        </div>
        <div className={`buys-bal buys-bal-${balTone}`} title={balTone === "due" ? "Still unpaid" : balTone === "adv" ? "Advance / overpaid" : "All clear"}>
          <span>Balance</span>
          <b>{balAbs <= 0.5 ? "Settled" : "₹" + inr(balAbs)}</b>
        </div>
      </div>

      <div className="buys-bar">
        <div className="rep-seg">
          <button type="button" className={seg === "ledger" ? "on" : ""} onClick={() => setSeg("ledger")}>
            Register
          </button>
          <button type="button" className={seg === "buyers" ? "on" : ""} onClick={() => setSeg("buyers")}>
            Buyers
          </button>
        </div>

        {seg === "ledger" && (
          <>
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
            <label className="buys-check">
              <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
              Unpaid
            </label>
            <input
              className="buys-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              aria-label="Search"
            />
            <button type="button" className="btn sm" onClick={addBuyer}>
              + Buyer
            </button>
            <button type="button" className="btn primary sm" onClick={startNew}>
              + Row
            </button>
          </>
        )}

        {seg === "buyers" && (
          <button type="button" className="btn primary sm" onClick={addBuyer} style={{ marginLeft: "auto" }}>
            + Buyer
          </button>
        )}
      </div>

      {seg === "buyers" ? (
        <div className="buys-card">
          {buyers.length === 0 ? (
            <div className="buys-empty">
              No buyers yet.
              <button type="button" className="btn primary sm" onClick={addBuyer}>
                + Add buyer
              </button>
            </div>
          ) : (
            <ul className="buys-buyer-list">
              {buyers.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="buys-buyer-main"
                    onClick={() => {
                      setBuyerFilter(b.id);
                      setSeg("ledger");
                    }}
                  >
                    <strong>{b.name}</strong>
                    <span>
                      {[b.phone, b.address].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {buyCount.get(b.id) || 0} row{(buyCount.get(b.id) || 0) === 1 ? "" : "s"}
                    </span>
                  </button>
                  <div className="buys-buyer-acts">
                    <button type="button" onClick={() => void editBuyer(b)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void removeBuyer(b)}>
                      Del
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="buys-card">
          {showForm && (
            <div className="buys-entry">
              <div className="buys-entry-head">
                <span>{editId ? "Edit row" : "New row"}</span>
                <button type="button" className="buys-link" onClick={closeForm}>
                  Close
                </button>
              </div>
              <div className="buys-entry-grid">
                <label>
                  Date
                  <DateField value={form.date} onChange={(v) => setF("date", v)} />
                </label>
                <label className="span2">
                  From
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
                  <input value={form.billNo} onChange={(e) => setF("billNo", e.target.value)} />
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
                  Bill amt
                  <input
                    inputMode="decimal"
                    value={form.billAmount}
                    onChange={(e) => setF("billAmount", e.target.value)}
                  />
                </label>
                <label>
                  Top amt
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
                  Pay date
                  <DateField value={form.billPayDate} onChange={(v) => setF("billPayDate", v)} />
                </label>
                <label className="span3">
                  Note
                  <input value={form.note} onChange={(e) => setF("note", e.target.value)} />
                </label>
                <label className="span3">
                  A/c tra
                  <input value={form.accountNote} onChange={(e) => setF("accountNote", e.target.value)} />
                </label>
              </div>
              <div className="buys-entry-actions">
                <button type="button" className="btn primary sm" disabled={saving} onClick={() => void onSave()}>
                  {saving ? "Saving…" : "Save"}
                </button>
                {buyers.length === 0 && (
                  <button type="button" className="btn sm" onClick={addBuyer}>
                    + Buyer first
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="buys-scroll">
            <table className="buys-grid">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="l">From</th>
                  <th>Bill</th>
                  <th className="num">CFT</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                  <th className="num">Bill</th>
                  <th className="num">Top</th>
                  <th className="l">Note</th>
                  <th className="num">Top paid</th>
                  <th>Pay date</th>
                  <th className="num">Bill paid</th>
                  <th className="l">A/c</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={14}>
                      <div className="buys-empty">
                        No rows yet.
                        <button type="button" className="btn primary sm" onClick={startNew}>
                          + Add row
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id} className={editId === p.id ? "on" : undefined} onDoubleClick={() => startEdit(p)}>
                      <td className="mono">{p.date || "—"}</td>
                      <td className="l name">{p.fromName || "—"}</td>
                      <td className="mono">{p.billNo || "—"}</td>
                      <td className="num">{vol(p.cft)}</td>
                      <td className="num">{money(p.rate)}</td>
                      <td className="num">{money(p.amount)}</td>
                      <td className="num">{money(p.billAmount)}</td>
                      <td className="num">{money(p.topAmount)}</td>
                      <td className="l note">{p.note || "—"}</td>
                      <td className="num paid">{money(p.topPaid)}</td>
                      <td className="mono">{p.billPayDate || "—"}</td>
                      <td className="num paid">{money(p.billPaid)}</td>
                      <td className="l note">{p.accountNote || "—"}</td>
                      <td className="acts">
                        <button type="button" className="buys-link" onClick={() => startEdit(p)}>
                          Edit
                        </button>
                        <button type="button" className="buys-link danger" onClick={() => void onDelete(p)}>
                          Del
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} className="l">
                      {filtered.length} row{filtered.length === 1 ? "" : "s"}
                    </td>
                    <td className="num">{vol(totals.cft)}</td>
                    <td />
                    <td className="num">{money(totals.amount)}</td>
                    <td className="num">{money(totals.billAmount)}</td>
                    <td className="num">{money(totals.topAmount)}</td>
                    <td />
                    <td className="num paid" colSpan={2}>
                      Paid {money(totals.paid)}
                    </td>
                    <td className={`num bal-${balTone}`} colSpan={2}>
                      {balAbs <= 0.5 ? "Settled" : "₹ " + inr(balAbs)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
