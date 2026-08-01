"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { inr, qty, todayStr } from "@/lib/calc";
import { editBuyerDialog } from "@/lib/customer-form";
import {
  addFromAccount,
  allPurchases,
  cashAmount,
  deletePurchase,
  fromAccountsOf,
  lineAmount,
  normalizePurchase,
  paidTotal,
  purchaseTotals,
  rowBalance,
  savePurchase,
  totalPurchase,
} from "@/lib/purchases";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import DateField from "@/components/editor/DateField";
import type { Purchase, Supplier } from "@/lib/types";

type Seg = "ledger" | "payments" | "buyers";

const emptyBuyForm = () => ({
  date: todayStr(),
  supplierId: "",
  fromName: "",
  billNo: "",
  cft: "",
  rate: "",
  amount: "",
  gst: "",
  billAmount: "",
  note: "",
  cashPaid: "",
  bankPaid: "",
  payDate: "",
});

const emptyPayForm = () => ({
  date: todayStr(),
  supplierId: "",
  fromName: "",
  cashPaid: "",
  bankPaid: "",
  note: "",
});

const money = (n: number) => (n ? inr(n) : "—");
const vol = (n: number) => (n ? qty(n, 2) : "—");

/** Real <select> + optional custom input — datalist is unreliable in the app shell. */
function FromAccountField({
  buyerId,
  options,
  value,
  onChange,
  onSave,
}: {
  buyerId: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  const inList = options.some((o) => o === value);
  // known saved value → select it; otherwise show "+ Add new"
  const selectVal = !buyerId ? "" : inList ? value : "__custom__";

  return (
    <>
      <label className="span2">
        From name
        <select
          value={selectVal}
          disabled={!buyerId}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom__") onChange("");
            else onChange(v);
          }}
        >
          <option value="">{buyerId ? "Select from-account…" : "Pick buyer first"}</option>
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="__custom__">+ Add new from name…</option>
        </select>
      </label>
      {buyerId && selectVal === "__custom__" && (
        <label className="span2">
          New from name
          <div className="buys-from-row">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type from-account name"
              autoFocus
            />
            <button type="button" className="btn sm" onClick={onSave} disabled={!value.trim()}>
              Save
            </button>
          </div>
        </label>
      )}
    </>
  );
}

export default function BuysView() {
  const { ready, dataVersion, cloakMoney, user } = useApp();
  const router = useRouter();
  const [seg, setSeg] = useState<Seg>("ledger");
  const [buyersRaw, setBuyers] = useState<Supplier[]>([]);
  const [rowsRaw, setRows] = useState<Purchase[]>([]);
  const [buyerFilter, setBuyerFilter] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyBuyForm);
  const [payForm, setPayForm] = useState(emptyPayForm);
  const [showPayForm, setShowPayForm] = useState(false);
  const [editPayId, setEditPayId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([allRec<Supplier>("suppliers"), allPurchases()]).then(([bs, ps]) => {
      bs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setBuyers(bs);
      setRows(ps);
    });
  }, []);

  useEffect(() => {
    if (user && user.role !== "owner") router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (ready && user?.role === "owner") load();
  }, [ready, dataVersion, load, user?.role]);

  const buyers = cloakMoney ? [] : buyersRaw;
  const rows = cloakMoney ? [] : rowsRaw;

  const buys = useMemo(() => rows.filter((r) => (r.kind || "buy") === "buy"), [rows]);
  const pays = useMemo(() => rows.filter((r) => r.kind === "pay"), [rows]);

  const filteredBuys = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return buys.filter((p) => {
      if (buyerFilter && p.supplierId !== buyerFilter) return false;
      if (unpaidOnly && Math.abs(rowBalance(p)) <= 0.5) return false;
      if (!needle) return true;
      return [p.buyerName, p.fromName, p.billNo, p.note, p.date]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [buys, buyerFilter, unpaidOnly, q]);

  const filteredPays = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pays.filter((p) => {
      if (buyerFilter && p.supplierId !== buyerFilter) return false;
      if (!needle) return true;
      return [p.buyerName, p.fromName, p.note, p.date].join(" ").toLowerCase().includes(needle);
    });
  }, [pays, buyerFilter, q]);

  const totals = useMemo(() => purchaseTotals([...filteredBuys, ...filteredPays]), [filteredBuys, filteredPays]);

  const selectedBuyer = buyers.find((b) => b.id === form.supplierId);
  const fromOpts = useMemo(
    () => fromAccountsOf(selectedBuyer, rows),
    [selectedBuyer, rows],
  );
  const payBuyer = buyers.find((b) => b.id === payForm.supplierId);
  const payFromOpts = useMemo(() => fromAccountsOf(payBuyer, rows), [payBuyer, rows]);

  const buyCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of buys) {
      if (!p.supplierId) continue;
      m.set(p.supplierId, (m.get(p.supplierId) || 0) + 1);
    }
    return m;
  }, [buys]);

  const liveTotal = useMemo(() => {
    const amount = form.amount !== "" ? +form.amount || 0 : lineAmount(+form.cft || 0, +form.rate || 0);
    const gst = +form.gst || 0;
    const bill = +form.billAmount || 0;
    const total = Math.round((amount + gst) * 100) / 100;
    const cash = Math.round(Math.max(0, total - bill) * 100) / 100;
    return { amount, gst, total, bill, cash };
  }, [form.amount, form.cft, form.rate, form.gst, form.billAmount]);

  function setF<K extends keyof ReturnType<typeof emptyBuyForm>>(k: K, v: string) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "cft" || k === "rate") {
        const amt = lineAmount(+next.cft || 0, +next.rate || 0);
        next.amount = amt ? String(amt) : "";
      }
      if (k === "supplierId") next.fromName = "";
      return next;
    });
  }

  function setPF<K extends keyof ReturnType<typeof emptyPayForm>>(k: K, v: string) {
    setPayForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "supplierId") next.fromName = "";
      return next;
    });
  }

  function startNew() {
    setEditId(null);
    setForm({ ...emptyBuyForm(), supplierId: buyerFilter || "" });
    setShowForm(true);
    setSeg("ledger");
  }

  function startEdit(raw: Purchase) {
    const p = normalizePurchase(raw);
    setEditId(p.id);
    setForm({
      date: p.date || todayStr(),
      supplierId: p.supplierId || "",
      fromName: p.fromName || "",
      billNo: p.billNo || "",
      cft: p.cft ? String(p.cft) : "",
      rate: p.rate ? String(p.rate) : "",
      amount: p.amount ? String(p.amount) : "",
      gst: p.gst ? String(p.gst) : "",
      billAmount: p.billAmount ? String(p.billAmount) : "",
      note: p.note || "",
      cashPaid: p.cashPaid ? String(p.cashPaid) : "",
      bankPaid: p.bankPaid ? String(p.bankPaid) : "",
      payDate: p.payDate || "",
    });
    setShowForm(true);
    setSeg("ledger");
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm(emptyBuyForm());
  }

  function startNewPay() {
    setEditPayId(null);
    setPayForm({ ...emptyPayForm(), supplierId: buyerFilter || "" });
    setShowPayForm(true);
    setSeg("payments");
  }

  function startEditPay(raw: Purchase) {
    const p = normalizePurchase(raw);
    setEditPayId(p.id);
    setPayForm({
      date: p.date || todayStr(),
      supplierId: p.supplierId || "",
      fromName: p.fromName || "",
      cashPaid: p.cashPaid ? String(p.cashPaid) : "",
      bankPaid: p.bankPaid ? String(p.bankPaid) : "",
      note: p.note || "",
    });
    setShowPayForm(true);
    setSeg("payments");
  }

  async function saveFromAccount() {
    if (!form.supplierId || !form.fromName.trim()) {
      toast("Pick buyer and type a from name");
      return;
    }
    await addFromAccount(form.supplierId, form.fromName);
    bumpData();
    load();
    toast("From account saved under buyer");
  }

  async function savePayFromAccount() {
    if (!payForm.supplierId || !payForm.fromName.trim()) {
      toast("Pick buyer and type a from name");
      return;
    }
    await addFromAccount(payForm.supplierId, payForm.fromName);
    bumpData();
    load();
    toast("From account saved under buyer");
  }

  async function onSave() {
    const buyer = buyers.find((b) => b.id === form.supplierId);
    if (!buyer) {
      toast("Pick a buyer / agent");
      return;
    }
    if (!form.fromName.trim()) {
      toast("Enter from name");
      return;
    }
    setSaving(true);
    try {
      await addFromAccount(buyer.id, form.fromName);
      await savePurchase({
        id: editId || undefined,
        kind: "buy",
        date: form.date,
        supplierId: buyer.id,
        buyerName: buyer.name,
        fromName: form.fromName,
        billNo: form.billNo,
        cft: form.cft,
        rate: form.rate,
        amount: form.amount,
        gst: form.gst,
        billAmount: form.billAmount,
        note: form.note,
        cashPaid: form.cashPaid,
        bankPaid: form.bankPaid,
        payDate: form.payDate,
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

  async function onSavePay() {
    const buyer = buyers.find((b) => b.id === payForm.supplierId);
    if (!buyer) {
      toast("Pick a buyer / agent");
      return;
    }
    if (!payForm.fromName.trim()) {
      toast("Enter from name");
      return;
    }
    const cash = +payForm.cashPaid || 0;
    const bank = +payForm.bankPaid || 0;
    if (cash + bank <= 0) {
      toast("Enter cash and/or bank amount");
      return;
    }
    setSaving(true);
    try {
      await addFromAccount(buyer.id, payForm.fromName);
      await savePurchase({
        id: editPayId || undefined,
        kind: "pay",
        date: payForm.date,
        supplierId: buyer.id,
        buyerName: buyer.name,
        fromName: payForm.fromName,
        cashPaid: payForm.cashPaid,
        bankPaid: payForm.bankPaid,
        note: payForm.note,
        payDate: payForm.date,
      });
      toast(editPayId ? "Payment updated" : "Payment saved");
      setShowPayForm(false);
      setEditPayId(null);
      setPayForm(emptyPayForm());
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
      title: p.kind === "pay" ? "Delete this payment?" : "Delete this buy?",
      message: `${p.buyerName || "Buyer"} · ${p.fromName || "—"} · ₹${inr(p.kind === "pay" ? paidTotal(p) : totalPurchase(p))}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deletePurchase(p.id);
    if (editId === p.id) closeForm();
    if (editPayId === p.id) {
      setShowPayForm(false);
      setEditPayId(null);
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
    setPayForm((f) => ({ ...f, supplierId: b.id }));
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
          : "Only this buyer / agent is removed.",
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
          <p className="buys-sub">Timber in · agent buyers & from-accounts</p>
        </div>
        <div className={`buys-bal buys-bal-${balTone}`}>
          <span>Balance</span>
          <b>{balAbs <= 0.5 ? "Settled" : "₹" + inr(balAbs)}</b>
        </div>
      </div>

      <div className="buys-bar">
        <div className="rep-seg">
          <button type="button" className={seg === "ledger" ? "on" : ""} onClick={() => setSeg("ledger")}>
            Register
          </button>
          <button type="button" className={seg === "payments" ? "on" : ""} onClick={() => setSeg("payments")}>
            Payments
          </button>
          <button type="button" className={seg === "buyers" ? "on" : ""} onClick={() => setSeg("buyers")}>
            Buyers
          </button>
        </div>

        {(seg === "ledger" || seg === "payments") && (
          <>
            <select value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)} aria-label="Filter buyer">
              <option value="">All buyers</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {seg === "ledger" && (
              <label className="buys-check">
                <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
                Unpaid
              </label>
            )}
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
            {seg === "ledger" ? (
              <button type="button" className="btn primary sm" onClick={startNew}>
                + Buy
              </button>
            ) : (
              <button type="button" className="btn primary sm" onClick={startNewPay}>
                + Payment
              </button>
            )}
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
              No buyers / agents yet.
              <button type="button" className="btn primary sm" onClick={addBuyer}>
                + Add buyer
              </button>
            </div>
          ) : (
            <ul className="buys-buyer-list">
              {buyers.map((b) => {
                const froms = fromAccountsOf(b, rows);
                return (
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
                        {froms.length
                          ? froms.slice(0, 4).join(" · ") + (froms.length > 4 ? ` · +${froms.length - 4}` : "")
                          : "No from-accounts yet"}
                        {" · "}
                        {buyCount.get(b.id) || 0} buy{(buyCount.get(b.id) || 0) === 1 ? "" : "s"}
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
                );
              })}
            </ul>
          )}
        </div>
      ) : seg === "payments" ? (
        <div className="buys-card">
          {showPayForm && (
            <div className="buys-entry">
              <div className="buys-entry-head">
                <span>{editPayId ? "Edit payment" : "New payment"}</span>
                <button
                  type="button"
                  className="buys-link"
                  onClick={() => {
                    setShowPayForm(false);
                    setEditPayId(null);
                  }}
                >
                  Close
                </button>
              </div>
              <div className="buys-entry-grid">
                <label>
                  Date
                  <DateField value={payForm.date} onChange={(v) => setPF("date", v)} />
                </label>
                <label className="span2">
                  Buyer / agent
                  <select value={payForm.supplierId} onChange={(e) => setPF("supplierId", e.target.value)}>
                    <option value="">Select buyer…</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <FromAccountField
                  buyerId={payForm.supplierId}
                  options={payFromOpts}
                  value={payForm.fromName}
                  onChange={(v) => setPF("fromName", v)}
                  onSave={() => void savePayFromAccount()}
                />
                <label>
                  Cash ₹
                  <input
                    inputMode="decimal"
                    value={payForm.cashPaid}
                    onChange={(e) => setPF("cashPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label>
                  Bank transfer ₹
                  <input
                    inputMode="decimal"
                    value={payForm.bankPaid}
                    onChange={(e) => setPF("bankPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="span2">
                  Total
                  <input
                    readOnly
                    value={
                      (+payForm.cashPaid || 0) + (+payForm.bankPaid || 0)
                        ? inr((+payForm.cashPaid || 0) + (+payForm.bankPaid || 0))
                        : ""
                    }
                  />
                </label>
                <label className="span3">
                  Note
                  <input value={payForm.note} onChange={(e) => setPF("note", e.target.value)} />
                </label>
              </div>
              <div className="buys-entry-actions">
                <button type="button" className="btn primary sm" disabled={saving} onClick={() => void onSavePay()}>
                  {saving ? "Saving…" : "Save payment"}
                </button>
              </div>
            </div>
          )}

          <div className="buys-scroll">
            <table className="buys-grid">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="l">Buyer</th>
                  <th className="l">From</th>
                  <th className="num">Cash</th>
                  <th className="num">Bank</th>
                  <th className="num">Total</th>
                  <th className="l">Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredPays.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="buys-empty">
                        No payments yet.
                        <button type="button" className="btn primary sm" onClick={startNewPay}>
                          + Payment
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredPays.map((p) => (
                    <tr key={p.id} onDoubleClick={() => startEditPay(p)}>
                      <td className="mono">{p.date || "—"}</td>
                      <td className="l name">{p.buyerName || "—"}</td>
                      <td className="l">{p.fromName || "—"}</td>
                      <td className="num paid">{money(p.cashPaid)}</td>
                      <td className="num paid">{money(p.bankPaid)}</td>
                      <td className="num paid">{money(paidTotal(p))}</td>
                      <td className="l note">{p.note || "—"}</td>
                      <td className="acts">
                        <button type="button" className="buys-link" onClick={() => startEditPay(p)}>
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
            </table>
          </div>
        </div>
      ) : (
        <div className="buys-card">
          {showForm && (
            <div className="buys-entry">
              <div className="buys-entry-head">
                <span>{editId ? "Edit buy" : "New buy"}</span>
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
                  Buyer / agent
                  <select value={form.supplierId} onChange={(e) => setF("supplierId", e.target.value)}>
                    <option value="">Select buyer…</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <FromAccountField
                  buyerId={form.supplierId}
                  options={fromOpts}
                  value={form.fromName}
                  onChange={(v) => setF("fromName", v)}
                  onSave={() => void saveFromAccount()}
                />
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
                  GST (optional)
                  <input
                    inputMode="decimal"
                    value={form.gst}
                    onChange={(e) => setF("gst", e.target.value)}
                    placeholder="Leave empty"
                  />
                </label>
                <label>
                  Total purchase
                  <input readOnly value={liveTotal.total ? inr(liveTotal.total) : ""} />
                </label>
                <label>
                  Bill amt
                  <input
                    inputMode="decimal"
                    value={form.billAmount}
                    onChange={(e) => setF("billAmount", e.target.value)}
                    placeholder="Leave empty"
                  />
                </label>
                <label>
                  Cash amount
                  <input readOnly value={liveTotal.cash ? inr(liveTotal.cash) : liveTotal.total ? inr(0) : ""} />
                </label>
                <label>
                  Cash paid
                  <input
                    inputMode="decimal"
                    value={form.cashPaid}
                    onChange={(e) => setF("cashPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label>
                  Bank paid
                  <input
                    inputMode="decimal"
                    value={form.bankPaid}
                    onChange={(e) => setF("bankPaid", e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label>
                  Pay date
                  <DateField value={form.payDate} onChange={(v) => setF("payDate", v)} />
                </label>
                <label className="span3">
                  Note
                  <input value={form.note} onChange={(e) => setF("note", e.target.value)} />
                </label>
              </div>
              <div className="buys-calc-hint">
                Total = Amount + GST · Cash amount = Total − Bill amt · Balance = Total − Cash paid − Bank paid
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
            <table className="buys-grid buys-grid-reg">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="l">Buyer / from</th>
                  <th>Bill</th>
                  <th className="num">CFT · rate</th>
                  <th className="num">Purchase</th>
                  <th className="num">Split</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredBuys.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="buys-empty">
                        No buys yet.
                        <button type="button" className="btn primary sm" onClick={startNew}>
                          + Buy
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredBuys.map((raw) => {
                    const p = normalizePurchase(raw);
                    const tot = totalPurchase(p);
                    const bal = rowBalance(p);
                    const paid = paidTotal(p);
                    return (
                      <tr
                        key={p.id}
                        className={editId === p.id ? "on" : undefined}
                        onDoubleClick={() => startEdit(p)}
                      >
                        <td className="mono buys-td-date">{p.date || "—"}</td>
                        <td className="l">
                          <div className="buys-cell-stack">
                            <strong>{p.buyerName || "—"}</strong>
                            <span>{p.fromName || "—"}</span>
                          </div>
                        </td>
                        <td className="mono">{p.billNo || "—"}</td>
                        <td className="num">
                          <div className="buys-cell-stack end">
                            <strong>{vol(p.cft)} cft</strong>
                            <span>@ {money(p.rate)}</span>
                          </div>
                        </td>
                        <td className="num">
                          <div className="buys-cell-stack end">
                            <strong>{money(tot)}</strong>
                            <span>
                              amt {money(p.amount)}
                              {p.gst ? ` · gst ${money(p.gst)}` : ""}
                            </span>
                          </div>
                        </td>
                        <td className="num">
                          <div className="buys-cell-stack end">
                            <strong>Bill {money(p.billAmount)}</strong>
                            <span>Cash {money(cashAmount(p))}</span>
                          </div>
                        </td>
                        <td className="num paid">
                          <div className="buys-cell-stack end">
                            <strong>{money(paid)}</strong>
                            <span>
                              cash {money(p.cashPaid)} · bank {money(p.bankPaid)}
                            </span>
                          </div>
                        </td>
                        <td className={`num ${Math.abs(bal) <= 0.5 ? "bal-ok" : "bal-due"}`}>
                          <strong>{Math.abs(bal) <= 0.5 ? "Settled" : "₹" + inr(Math.abs(bal))}</strong>
                        </td>
                        <td className="acts">
                          <button type="button" className="buys-link" onClick={() => startEdit(p)}>
                            Edit
                          </button>
                          <button type="button" className="buys-link danger" onClick={() => void onDelete(p)}>
                            Del
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredBuys.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} className="l">
                      {totals.count} buy{totals.count === 1 ? "" : "s"}
                    </td>
                    <td className="num">{vol(totals.cft)} cft</td>
                    <td className="num">{money(totals.total)}</td>
                    <td className="num">
                      Bill {money(totals.billAmount)}
                      <div className="buys-foot-sub">Cash {money(totals.cashAmount)}</div>
                    </td>
                    <td className="num paid">{money(totals.paid)}</td>
                    <td className={`num bal-${balTone}`}>
                      {balAbs <= 0.5 ? "Settled" : "₹" + inr(balAbs)}
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
