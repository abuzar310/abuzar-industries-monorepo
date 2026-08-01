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
      // keep line amount in sync when cft/rate change (unless editing a locked override later)
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
    setForm({
      ...emptyForm(),
      supplierId: buyerFilter || "",
    });
    setShowForm(true);
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
      toast(editId ? "Buy updated" : "Buy saved");
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm());
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
      title: "Delete this buy?",
      message: `${p.fromName || "Buy"} · bill ${p.billNo || "—"} · ₹${inr(p.billAmount)}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePurchase(p.id);
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
          ? `${n} buy record${n === 1 ? "" : "s"} stay in the ledger; only this buyer contact is removed.`
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

  const balColor =
    Math.abs(totals.balance) <= 0.5 ? "var(--green)" : totals.balance > 0 ? "var(--danger)" : "var(--ochre-deep)";

  return (
    <div>
      <div className="sectitle">
        Buys <small>— timber in · purchase records</small>
      </div>

      <div className="rowbtns" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className={"btn sm" + (seg === "ledger" ? " primary" : "")}
          onClick={() => setSeg("ledger")}
        >
          Ledger
        </button>
        <button
          type="button"
          className={"btn sm" + (seg === "buyers" ? " primary" : "")}
          onClick={() => setSeg("buyers")}
        >
          Buyers
        </button>
        {seg === "ledger" && (
          <button type="button" className="btn primary sm" onClick={startNew} style={{ marginLeft: "auto" }}>
            + New buy
          </button>
        )}
        {seg === "buyers" && (
          <button type="button" className="btn primary sm" onClick={addBuyer} style={{ marginLeft: "auto" }}>
            + Buyer
          </button>
        )}
      </div>

      {/* summary */}
      <div
        className="panel-card"
        style={{
          padding: "12px 14px",
          marginBottom: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 10,
        }}
      >
        <div>
          <div className="sub" style={{ fontSize: 11 }}>
            Balance
          </div>
          <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18, color: balColor }}>
            ₹ {inr(Math.abs(totals.balance))}
          </div>
          <div className="sub" style={{ fontSize: 10 }}>
            {Math.abs(totals.balance) <= 0.5 ? "settled" : totals.balance > 0 ? "still due" : "advance"}
          </div>
        </div>
        <div>
          <div className="sub" style={{ fontSize: 11 }}>
            Total CFT
          </div>
          <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18 }}>{qty(totals.cft, 2)}</div>
        </div>
        <div>
          <div className="sub" style={{ fontSize: 11 }}>
            Bill amount
          </div>
          <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18 }}>₹ {inr(totals.billAmount)}</div>
        </div>
        <div>
          <div className="sub" style={{ fontSize: 11 }}>
            Paid
          </div>
          <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18, color: "var(--green)" }}>
            ₹ {inr(totals.paid)}
          </div>
        </div>
      </div>

      {seg === "buyers" ? (
        <div className="panel-card">
          {buyers.length === 0 ? (
            <div className="empty" style={{ padding: 28, textAlign: "center" }}>
              <div className="empty-title">No buyers yet</div>
              <div className="empty-note">Add the parties you buy timber from.</div>
              <button type="button" className="btn primary sm" style={{ marginTop: 12 }} onClick={addBuyer}>
                + Add buyer
              </button>
            </div>
          ) : (
            <div className="listwrap">
              {buyers.map((b) => (
                <div
                  key={b.id}
                  className="lrow"
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setBuyerFilter(b.id);
                    setSeg("ledger");
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{b.name}</div>
                    <div className="sub" style={{ fontSize: 11 }}>
                      {[b.phone, b.address].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {buyCount.get(b.id) || 0} buy{(buyCount.get(b.id) || 0) === 1 ? "" : "s"}
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
        <>
          <div
            className="panel-card"
            style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
          >
            <select
              value={buyerFilter}
              onChange={(e) => setBuyerFilter(e.target.value)}
              style={{ minWidth: 160, flex: "1 1 160px" }}
              aria-label="Filter buyer"
            >
              <option value="">All buyers</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" onClick={addBuyer}>
              + Buyer
            </button>
            <label className="sub" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
              Unpaid only
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bill, note…"
              aria-label="Search buys"
              style={{ flex: "2 1 160px", minWidth: 120 }}
            />
          </div>

          {showForm && (
            <div className="panel-card" style={{ padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{editId ? "Edit buy" : "New buy"}</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 10,
                }}
              >
                <label className="f">
                  <span>Date</span>
                  <DateField value={form.date} onChange={(v) => setF("date", v)} />
                </label>
                <label className="f" style={{ gridColumn: "span 2" }}>
                  <span>Buyer (from)</span>
                  <select
                    value={form.supplierId}
                    onChange={(e) => setF("supplierId", e.target.value)}
                    required
                  >
                    <option value="">Select buyer…</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="f">
                  <span>Bill no</span>
                  <input value={form.billNo} onChange={(e) => setF("billNo", e.target.value)} placeholder="—" />
                </label>
                <label className="f">
                  <span>CFT</span>
                  <input
                    inputMode="decimal"
                    value={form.cft}
                    onChange={(e) => setF("cft", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="f">
                  <span>Rate</span>
                  <input
                    inputMode="decimal"
                    value={form.rate}
                    onChange={(e) => setF("rate", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="f">
                  <span>Amount</span>
                  <input
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setF("amount", e.target.value)}
                    placeholder="CFT × rate"
                  />
                </label>
                <label className="f">
                  <span>Bill amount</span>
                  <input
                    inputMode="decimal"
                    value={form.billAmount}
                    onChange={(e) => setF("billAmount", e.target.value)}
                    placeholder="—"
                  />
                </label>
                <label className="f">
                  <span>Top amount</span>
                  <input
                    inputMode="decimal"
                    value={form.topAmount}
                    onChange={(e) => setF("topAmount", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="f">
                  <span>Bill paid</span>
                  <input
                    inputMode="decimal"
                    value={form.billPaid}
                    onChange={(e) => setF("billPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="f">
                  <span>Top paid</span>
                  <input
                    inputMode="decimal"
                    value={form.topPaid}
                    onChange={(e) => setF("topPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="f">
                  <span>Bill pay date</span>
                  <DateField value={form.billPayDate} onChange={(v) => setF("billPayDate", v)} />
                </label>
                <label className="f" style={{ gridColumn: "1 / -1" }}>
                  <span>Description</span>
                  <input value={form.note} onChange={(e) => setF("note", e.target.value)} placeholder="—" />
                </label>
                <label className="f" style={{ gridColumn: "1 / -1" }}>
                  <span>My a/c / transfer</span>
                  <input
                    value={form.accountNote}
                    onChange={(e) => setF("accountNote", e.target.value)}
                    placeholder="How paid / which account"
                  />
                </label>
              </div>
              <div className="rowbtns" style={{ marginTop: 14, gap: 8 }}>
                <button type="button" className="btn primary" disabled={saving} onClick={() => void onSave()}>
                  {saving ? "Saving…" : editId ? "Save changes" : "Save buy"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowForm(false);
                    setEditId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="panel-card">
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: 28, textAlign: "center" }}>
                <div className="empty-title">No buys yet</div>
                <div className="empty-note">
                  {buyers.length === 0
                    ? "Add a buyer, then record the first purchase."
                    : "Record CFT, rate, bill and payments here."}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  {buyers.length === 0 ? (
                    <button type="button" className="btn primary sm" onClick={addBuyer}>
                      + Add buyer
                    </button>
                  ) : (
                    <button type="button" className="btn primary sm" onClick={startNew}>
                      + New buy
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* desktop table */}
                <div className="buys-table" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                    <thead>
                      <tr style={{ background: "var(--t-cream2, #f6f0e4)", borderBottom: "1px solid var(--line)" }}>
                        {["Date", "From", "Bill", "CFT", "Rate", "Amount", "Bill amt", "Top", "Paid", "Bal", ""].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                padding: "8px 6px",
                                textAlign: h === "From" || h === "Date" || h === "Bill" ? "left" : "right",
                                fontFamily: "var(--disp)",
                                letterSpacing: ".04em",
                                fontSize: 10,
                                textTransform: "uppercase",
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const bal = rowBalance(p);
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ padding: "8px 6px", fontFamily: "var(--mono)", fontSize: 11 }}>{p.date}</td>
                            <td style={{ padding: "8px 6px", fontWeight: 600 }}>{p.fromName || "—"}</td>
                            <td style={{ padding: "8px 6px", fontFamily: "var(--mono)", fontSize: 11 }}>
                              {p.billNo || "—"}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {qty(p.cft, 2)}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {inr(p.rate)}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {inr(p.amount)}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {inr(p.billAmount)}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {inr(p.topAmount)}
                            </td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "var(--mono)", color: "var(--green)" }}>
                              {inr((+p.billPaid || 0) + (+p.topPaid || 0))}
                            </td>
                            <td
                              style={{
                                padding: "8px 6px",
                                textAlign: "right",
                                fontFamily: "var(--mono)",
                                fontWeight: 700,
                                color: Math.abs(bal) <= 0.5 ? "var(--green)" : "var(--danger)",
                              }}
                            >
                              {inr(Math.abs(bal))}
                            </td>
                            <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                              <button type="button" className="btn sm" onClick={() => startEdit(p)}>
                                Edit
                              </button>{" "}
                              <button type="button" className="btn sm" onClick={() => void onDelete(p)}>
                                Del
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                        <td colSpan={3} style={{ padding: "10px 6px" }}>
                          Totals · {filtered.length}
                        </td>
                        <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                          {qty(totals.cft, 2)}
                        </td>
                        <td />
                        <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                          {inr(totals.amount)}
                        </td>
                        <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                          {inr(totals.billAmount)}
                        </td>
                        <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--mono)" }}>
                          {inr(totals.topAmount)}
                        </td>
                        <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--mono)", color: "var(--green)" }}>
                          {inr(totals.paid)}
                        </td>
                        <td
                          style={{
                            padding: "10px 6px",
                            textAlign: "right",
                            fontFamily: "var(--mono)",
                            color: balColor,
                          }}
                        >
                          {inr(Math.abs(totals.balance))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
