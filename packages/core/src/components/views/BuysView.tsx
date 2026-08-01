"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { inr, qty, todayStr } from "@/lib/calc";
import { editBuyerDialog } from "@/lib/customer-form";
import {
  addDaysStr,
  addFromAccount,
  allPurchases,
  buyerDashboards,
  cashAmount,
  deletePurchase,
  dueReminders,
  fromAccountsOf,
  isRemindDue,
  lineAmount,
  normalizePurchase,
  paidTotal,
  purchaseTotals,
  rowBalance,
  savePurchase,
  setPurchaseReminder,
  totalPurchase,
} from "@/lib/purchases";
import { useApp } from "@/store/useApp";
import { bumpData, setBuysDue, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
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
  remindIn: "",
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
  const [openBuyerId, setOpenBuyerId] = useState<string | null>(null);
  const [remindOnly, setRemindOnly] = useState(false);

  const load = useCallback(() => {
    Promise.all([allRec<Supplier>("suppliers"), allPurchases()]).then(([bs, ps]) => {
      bs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setBuyers(bs);
      setRows(ps);
      setBuysDue(dueReminders(ps).length);
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
      if (remindOnly && !isRemindDue(p.remindAt)) return false;
      if (!needle) return true;
      return [p.buyerName, p.fromName, p.billNo, p.note, p.date]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [buys, buyerFilter, unpaidOnly, remindOnly, q]);

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

  const dash = useMemo(() => buyerDashboards(buyers, rows), [buyers, rows]);

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
      remindIn: "",
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
      const remindRaw = form.remindIn.trim();
      if (remindRaw === "custom") {
        toast("Enter custom reminder days");
        return;
      }
      const remindPatch: { remindAt?: string } = {};
      if (remindRaw !== "") {
        const n = Number(remindRaw);
        if (!Number.isFinite(n) || n < 0) {
          toast("Enter a valid number of days");
          return;
        }
        remindPatch.remindAt = addDaysStr(form.date || todayStr(), n);
      }
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
        ...remindPatch,
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

  async function onRemind(p: Purchase, days: string) {
    if (days === "") return;
    if (days === "off" || days === "clear") {
      await setPurchaseReminder(p.id, "");
      bumpData();
      load();
      toast("Reminder off");
      return;
    }
    let n: number;
    if (days === "custom") {
      const res = await formDialog({
        title: "Custom reminder",
        message: "Remind in how many days?",
        fields: [
          {
            name: "days",
            label: "Days",
            type: "number",
            inputMode: "numeric",
            placeholder: "e.g. 45",
            required: true,
          },
        ],
        submitLabel: "Set",
      });
      if (!res) return;
      n = Math.floor(Number(res.days));
      if (!Number.isFinite(n) || n < 0) {
        toast("Enter a valid number of days");
        return;
      }
    } else {
      n = Number(days);
      if (!Number.isFinite(n) || n < 0) return;
    }
    const next = addDaysStr(todayStr(), n);
    await setPurchaseReminder(p.id, next);
    bumpData();
    load();
    toast("Reminder " + next);
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
    const n = rows.filter((r) => r.supplierId === s.id).length;
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
              <>
                <label className="buys-check">
                  <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
                  Unpaid
                </label>
                <label className="buys-check">
                  <input type="checkbox" checked={remindOnly} onChange={(e) => setRemindOnly(e.target.checked)} />
                  Reminders
                </label>
              </>
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
        buyers.length === 0 ? (
          <div className="buys-card">
            <div className="buys-empty">
              No buyers / agents yet.
              <button type="button" className="btn primary sm" onClick={addBuyer}>
                + Add buyer
              </button>
            </div>
          </div>
        ) : (
          <div className="buys-card buys-ov">
            <div className="buys-ov-head">
              <span>Party</span>
              <span className="num">Total</span>
              <span className="num">Cash</span>
              <span className="num">Bank</span>
              <span className="num">Balance</span>
            </div>
            <ul className="buys-ov-list">
              {dash.map(({ buyer: b, totals: t, froms }) => {
                const open = openBuyerId === b.id;
                const settled = Math.abs(t.balance) <= 0.5;
                return (
                  <li key={b.id} className={"buys-ov-item" + (open ? " open" : "")}>
                    <button
                      type="button"
                      className="buys-ov-row"
                      onClick={() => setOpenBuyerId(open ? null : b.id)}
                      aria-expanded={open}
                    >
                      <span className="buys-ov-name">
                        <strong>{b.name}</strong>
                        <em>
                          {t.count} buy{t.count === 1 ? "" : "s"}
                          {froms.length ? ` · ${froms.length} from` : ""}
                        </em>
                      </span>
                      <span className="num" data-label="Total">
                        ₹{money(t.total)}
                      </span>
                      <span className="num" data-label="Cash">
                        ₹{money(t.cashAmount)}
                      </span>
                      <span className="num" data-label="Bank">
                        ₹{money(t.billAmount)}
                      </span>
                      <span className={"num bal " + (settled ? "ok" : "due")} data-label="Balance">
                        {settled ? "Settled" : "₹" + inr(Math.abs(t.balance))}
                        <i className="buys-ov-chev" aria-hidden>
                          {open ? "▾" : "›"}
                        </i>
                      </span>
                    </button>

                    {open && (
                      <div className="buys-ov-detail">
                        <div className="buys-ov-paidline">
                          Paid ₹{money(t.paid)}
                          <span>
                            cash {money(t.cashPaid)} · bank {money(t.bankPaid)}
                          </span>
                        </div>
                        {froms.length === 0 ? (
                          <p className="buys-ov-empty">No from-accounts yet.</p>
                        ) : (
                          <ul className="buys-ov-froms">
                            {froms.map((f) => {
                              const ft = f.totals;
                              const idle = ft.count === 0 && ft.paid === 0;
                              const fOk = Math.abs(ft.balance) <= 0.5;
                              return (
                                <li key={f.name} className={idle ? "idle" : undefined}>
                                  <div>
                                    <strong>{f.name}</strong>
                                    <em>
                                      {idle
                                        ? "No buys yet"
                                        : `${ft.count} buy${ft.count === 1 ? "" : "s"}${ft.cft ? ` · ${vol(ft.cft)} cft` : ""}`}
                                    </em>
                                  </div>
                                  {!idle && (
                                    <div className="buys-ov-from-nums">
                                      <span>
                                        Cash ₹{money(ft.cashAmount)}
                                      </span>
                                      <span>
                                        Bank ₹{money(ft.billAmount)}
                                      </span>
                                      <span className="paid">Paid ₹{money(ft.paid)}</span>
                                      <span className={fOk ? "ok" : "due"}>
                                        {fOk ? "Settled" : "₹" + inr(Math.abs(ft.balance))}
                                      </span>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        <div className="buys-ov-acts">
                          <button
                            type="button"
                            className="buys-link"
                            onClick={() => {
                              setBuyerFilter(b.id);
                              setSeg("ledger");
                            }}
                          >
                            Register
                          </button>
                          <button
                            type="button"
                            className="buys-link"
                            onClick={() => {
                              setBuyerFilter(b.id);
                              setSeg("payments");
                            }}
                          >
                            Payments
                          </button>
                          <button type="button" className="buys-link mute" onClick={() => void editBuyer(b)}>
                            Rename
                          </button>
                          <button type="button" className="buys-link mute" onClick={() => void removeBuyer(b)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )
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
              <div className="buys-entry-sec">
                <h4>Who</h4>
                <div className="buys-entry-grid g3">
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
                </div>
              </div>
              <div className="buys-entry-sec">
                <h4>Paid</h4>
                <div className="buys-entry-grid g3">
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
                    Bank ₹
                    <input
                      inputMode="decimal"
                      value={payForm.bankPaid}
                      onChange={(e) => setPF("bankPaid", e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label>
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
              <div className="buys-entry-sec">
                <h4>Who</h4>
                <div className="buys-entry-grid g3">
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
                </div>
              </div>
              <div className="buys-entry-sec">
                <h4>Timber</h4>
                <div className="buys-entry-grid g4">
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
                    GST
                    <input
                      inputMode="decimal"
                      value={form.gst}
                      onChange={(e) => setF("gst", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </div>
              <div className="buys-entry-sec">
                <h4>Split</h4>
                <div className="buys-entry-grid g3">
                  <label>
                    Total
                    <input readOnly value={liveTotal.total ? inr(liveTotal.total) : ""} />
                  </label>
                  <label>
                    Bank / bill
                    <input
                      inputMode="decimal"
                      value={form.billAmount}
                      onChange={(e) => setF("billAmount", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    Cash side
                    <input readOnly value={liveTotal.cash ? inr(liveTotal.cash) : liveTotal.total ? inr(0) : ""} />
                  </label>
                </div>
              </div>
              <div className="buys-entry-sec">
                <h4>Paid · remind</h4>
                <div className="buys-entry-grid g4">
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
                  <label>
                    Remind
                    <select
                      value={
                        form.remindIn === "" || ["0", "7", "15", "30"].includes(form.remindIn)
                          ? form.remindIn
                          : "custom"
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "custom") setF("remindIn", "custom");
                        else setF("remindIn", v);
                      }}
                    >
                      <option value="">Off</option>
                      <option value="0">Today</option>
                      <option value="7">In 7 days</option>
                      <option value="15">In 15 days</option>
                      <option value="30">In 30 days</option>
                      <option value="custom">Custom days…</option>
                    </select>
                  </label>
                  {(form.remindIn === "custom" ||
                    (form.remindIn !== "" && !["0", "7", "15", "30"].includes(form.remindIn))) && (
                    <label>
                      Days
                      <input
                        inputMode="numeric"
                        value={form.remindIn === "custom" ? "" : form.remindIn}
                        onChange={(e) => setF("remindIn", e.target.value.replace(/[^\d]/g, ""))}
                        placeholder="e.g. 45"
                        autoFocus
                      />
                    </label>
                  )}
                  <label className="span4">
                    Note
                    <input value={form.note} onChange={(e) => setF("note", e.target.value)} />
                  </label>
                </div>
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

          {filteredBuys.length === 0 ? (
            <div className="buys-empty">
              No buys yet.
              <button type="button" className="btn primary sm" onClick={startNew}>
                + Buy
              </button>
            </div>
          ) : (
            <>
              <ul className="buys-reg">
                {filteredBuys.map((raw) => {
                  const p = normalizePurchase(raw);
                  const tot = totalPurchase(p);
                  const bal = rowBalance(p);
                  const paid = paidTotal(p);
                  const remindDue = isRemindDue(p.remindAt);
                  return (
                    <li
                      key={p.id}
                      className={
                        "buys-reg-row" +
                        (editId === p.id ? " on" : "") +
                        (remindDue ? " remind" : "") +
                        (p.remindAt && !remindDue ? " remind-soon" : "")
                      }
                      onDoubleClick={() => startEdit(p)}
                    >
                      <div className="buys-reg-main">
                        <div className="buys-reg-who">
                          <span className="buys-reg-date">{p.date || "—"}</span>
                          <strong>
                            {remindDue ? <i className="buys-remind-dot" aria-hidden /> : null}
                            {p.buyerName || "—"}
                          </strong>
                          <span className="buys-reg-from">{p.fromName || "No from-account"}</span>
                          {p.billNo ? <span className="buys-reg-bill">Bill {p.billNo}</span> : null}
                        </div>
                        <div className={`buys-reg-bal ${Math.abs(bal) <= 0.5 ? "ok" : "due"}`}>
                          <em>Balance</em>
                          <b>{Math.abs(bal) <= 0.5 ? "Settled" : "₹" + inr(Math.abs(bal))}</b>
                        </div>
                      </div>
                      <div className="buys-reg-metrics">
                        <div>
                          <em>CFT</em>
                          <b>{vol(p.cft)}</b>
                          <span>@ {money(p.rate)}</span>
                        </div>
                        <div>
                          <em>Total</em>
                          <b>₹{money(tot)}</b>
                          <span>
                            amt {money(p.amount)}
                            {p.gst ? ` · gst ${money(p.gst)}` : ""}
                          </span>
                        </div>
                        <div>
                          <em>Split</em>
                          <b>Bank ₹{money(p.billAmount)}</b>
                          <span>Cash ₹{money(cashAmount(p))}</span>
                        </div>
                        <div>
                          <em>Paid</em>
                          <b className="paid">₹{money(paid)}</b>
                          <span>
                            cash {money(p.cashPaid)} · bank {money(p.bankPaid)}
                          </span>
                        </div>
                      </div>
                      <div className="buys-reg-acts">
                        <label className="buys-remind-pick">
                          <span className={remindDue ? "due" : undefined}>
                            {p.remindAt ? (remindDue ? "Due " : "On ") + p.remindAt : "Remind"}
                          </span>
                          <select
                            aria-label="Set reminder"
                            value=""
                            onChange={(e) => void onRemind(p, e.target.value)}
                          >
                            <option value="">Set…</option>
                            <option value="0">Today</option>
                            <option value="7">In 7 days</option>
                            <option value="15">In 15 days</option>
                            <option value="30">In 30 days</option>
                            <option value="custom">Custom days…</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                        <button type="button" className="buys-link" onClick={() => startEdit(p)}>
                          Edit
                        </button>
                        <button type="button" className="buys-link danger" onClick={() => void onDelete(p)}>
                          Del
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="buys-reg-foot">
                <span>
                  {totals.count} buy{totals.count === 1 ? "" : "s"} · {vol(totals.cft)} cft
                </span>
                <span>Total ₹{money(totals.total)}</span>
                <span className="paid">Paid ₹{money(totals.paid)}</span>
                <span className={balTone === "due" ? "due" : "ok"}>
                  {balAbs <= 0.5 ? "Settled" : "Bal ₹" + inr(balAbs)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
