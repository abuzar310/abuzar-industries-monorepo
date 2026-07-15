"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { delRec } from "@/lib/data";
import { inr, todayStr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import {
  fmtWeekLabel,
  getAttendanceCfg,
  listAttendance,
  listWorkers,
  markAttendance,
  nextWeek,
  payWorker,
  prevWeek,
  saveWorker,
  setAttendanceCfg,
  setWorkerActive,
  weekDays,
  weekRollup,
  weekStart,
  type AttendanceCfg,
  type AttendanceMark,
  type WeekRow,
  type Worker,
} from "@/lib/attendance";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { Expense } from "@/lib/types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAYDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id;
const r2 = (n: number) => Math.round(n * 100) / 100;
const toDmy = (isoDate: string) => {
  const [y, m, d] = (isoDate || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : todayStr();
};
const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
// blank → 1 → ½ → 0 → blank
const nextMark = (cur: number | undefined): number | null =>
  cur === undefined ? 1 : cur === 1 ? 0.5 : cur === 0.5 ? 0 : null;
const markGlyph = (v: number | undefined) => (v === 1 ? "1" : v === 0.5 ? "½" : v === 0 ? "0" : "");
const markCls = (v: number | undefined) => (v === 1 ? " f" : v === 0.5 ? " h" : v === 0 ? " a" : "");
const balColor = (bal: number) =>
  bal > 0.5 ? "var(--danger)" : bal < -0.5 ? "var(--ochre-deep)" : "var(--green)";

export default function AttendanceView() {
  const { ready, dataVersion, user } = useApp();
  const isOwner = user?.role === "owner";
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cfg, setCfg] = useState<AttendanceCfg>({ payday: 0 });
  const [start, setStart] = useState<Date>(() => weekStart(new Date()));

  // add-worker inline form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  // pay / advance inline form (one worker at a time)
  const [payFor, setPayFor] = useState<string | null>(null);
  const [pAmt, setPAmt] = useState("");
  const [pDate, setPDate] = useState("");
  const [pNote, setPNote] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(() => {
    Promise.all([listWorkers(), listAttendance(), allExpenses(), getAttendanceCfg()]).then(
      ([ws, ms, es, c]) => {
        setWorkers(ws);
        setMarks(ms);
        setExpenses(es);
        setCfg(c);
      },
    );
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const days = useMemo(() => weekDays(start), [start]);
  const active = useMemo(
    () => workers.filter((w) => w.active).sort((a, b) => a.name.localeCompare(b.name)),
    [workers],
  );
  const inactive = useMemo(() => workers.filter((w) => !w.active), [workers]);
  const rows = useMemo(() => weekRollup(active, marks, expenses, days), [active, marks, expenses, days]);

  const totDays = r2(rows.reduce((s, x) => s + x.presentDays, 0));
  const totEarned = r2(rows.reduce((s, x) => s + x.earned, 0));
  const totPaid = r2(rows.reduce((s, x) => s + x.paid, 0));
  const totBalance = r2(totEarned - totPaid);
  const due = rows.filter((x) => x.balance > 0.5);
  const totDue = r2(due.reduce((s, x) => s + x.balance, 0));
  // Mon..Sun column i → JS weekday (i+1)%7; matches the configured payday
  const paydayCol = (cfg.payday + 6) % 7;

  async function cycle(w: Worker, iso: string, cur: number | undefined) {
    await markAttendance(w.id, iso, nextMark(cur));
    load();
    bumpData();
  }

  async function changePayday(v: number) {
    const c = { ...cfg, payday: v };
    setCfg(c);
    await setAttendanceCfg(c);
    bumpData();
    toast("Payout day: " + PAYDAY_NAMES[v]);
  }

  async function addWorker() {
    const w = await saveWorker({ name: newName, rate: +newRate || 0 });
    if (!w) return toast("Enter a name");
    setNewName("");
    setNewRate("");
    setShowAdd(false);
    load();
    bumpData();
    toast("“" + w.name + "” added · ₹" + inr(w.rate) + "/day");
  }

  async function editWorker(w: Worker) {
    const res = await formDialog({
      title: "Edit worker",
      fields: [
        { name: "name", label: "Name", value: w.name, required: true },
        { name: "rate", label: "Daily rate ₹", type: "number", inputMode: "decimal", value: String(w.rate) },
      ],
    });
    if (res === null) return;
    await saveWorker({ id: w.id, name: res.name, rate: +res.rate || 0 });
    load();
    bumpData();
    toast("Saved");
  }

  async function deactivate(w: Worker) {
    const ok = await confirmDialog({
      title: "Remove “" + w.name + "” from the register?",
      message: "Their attendance and payment history stays. You can bring them back from the Inactive list.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await setWorkerActive(w.id, false);
    load();
    bumpData();
    toast("“" + w.name + "” moved to Inactive");
  }

  async function reactivate(w: Worker) {
    await setWorkerActive(w.id, true);
    load();
    bumpData();
    toast("“" + w.name + "” is back on the register");
  }

  function startPay(w: Worker, amount?: number) {
    setPayFor(w.id);
    setPAmt(amount && amount > 0 ? String(r2(amount)) : "");
    setPDate(todayIso());
    setPNote("");
  }
  function cancelPay() {
    setPayFor(null);
    setPAmt("");
    setPDate("");
    setPNote("");
  }
  async function submitPay(w: Worker) {
    const amt = +pAmt || 0;
    if (amt <= 0) return toast("Enter an amount");
    await payWorker({ worker: w, amount: amt, date: toDmy(pDate), by: user?.id || "unknown", note: pNote });
    cancelPay();
    load();
    bumpData();
    toast("₹" + inr(amt) + " paid to " + w.name + " — recorded in Daybook");
  }

  async function payAllDue() {
    const ok = await confirmDialog({
      title: "Pay all due · ₹" + inr(totDue) + "?",
      message:
        due.map((x) => x.worker.name + " ₹" + inr(x.balance)).join(" · ") +
        ". One salary entry per worker, dated today — cash goes out of the Daybook.",
      confirmLabel: "Pay ₹" + inr(totDue),
    });
    if (!ok) return;
    for (const x of due)
      await payWorker({ worker: x.worker, amount: x.balance, by: user?.id || "unknown", note: "week " + fmtWeekLabel(days) });
    load();
    bumpData();
    toast("₹" + inr(totDue) + " paid to " + due.length + " worker" + (due.length === 1 ? "" : "s") + " — recorded in Daybook");
  }

  async function delPayment(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete this payment?",
      message: `₹${inr(e.amount)} · ${e.date} — removes it from the Daybook too; the amount goes back into the balance.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id);
    load();
    bumpData();
    toast("Payment removed");
  }

  const dayNum = (iso: string) => iso.slice(8);

  function paymentsStrip(x: WeekRow) {
    const paying = payFor === x.worker.id;
    if (!paying && x.payments.length === 0) return null;
    return (
      <tr key={x.worker.id + ":pays"}>
        <td colSpan={12} className="att-pays">
          {x.payments.map((e) => (
            <span className="att-pay" key={e.id}>
              {e.date} · {e.note || "paid"} · by {userName(e.enteredBy)}
              <b>₹{inr(e.amount)}</b>
              <button className="pb-x" title="Delete payment" onClick={() => delPayment(e)}>×</button>
            </span>
          ))}
          {paying && (
            <span className="att-payform">
              <input
                type="number"
                inputMode="decimal"
                placeholder="₹"
                value={pAmt}
                onChange={(e) => setPAmt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPay(x.worker)}
                autoFocus
              />
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              <input
                type="text"
                placeholder="Note (optional)"
                value={pNote}
                onChange={(e) => setPNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPay(x.worker)}
              />
              <button className="btn primary sm" type="button" onClick={() => submitPay(x.worker)}>Pay</button>
              <button className="btn sm" type="button" onClick={cancelPay}>Cancel</button>
            </span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div className="sectitle">
        Attendance <small>— weekly wage register</small>
      </div>

      <div className="att-nav">
        <button className="btn sm" type="button" onClick={() => setStart(prevWeek(start))}>‹ Prev</button>
        <span className="att-week">Week {fmtWeekLabel(days)}</span>
        <button className="btn sm" type="button" onClick={() => setStart(nextWeek(start))}>Next ›</button>
        <button className="btn sm" type="button" onClick={() => setStart(weekStart(new Date()))}>This week</button>
        <label className="att-payday-sel">
          Payout day
          <select
            value={cfg.payday}
            disabled={!isOwner}
            title={isOwner ? "Which day wages are paid" : "Only the Owner can change the payout day"}
            onChange={(e) => changePayday(+e.target.value)}
          >
            {PAYDAY_NAMES.map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {totDue > 0.5 && (
          <button className="btn primary sm" type="button" onClick={payAllDue}>
            Pay all due · ₹{inr(totDue)}
          </button>
        )}
        <button className="btn sm" type="button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Done" : "+ Worker"}
        </button>
      </div>

      {showAdd && (
        <div className="panel-card" style={{ padding: 14, marginTop: 10 }}>
          <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
              <span>Worker name</span>
              <input
                type="text"
                placeholder="e.g. Ramu"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWorker()}
                autoFocus
              />
            </label>
            <label className="modal-field" style={{ flex: "1 1 110px", minWidth: 0 }}>
              <span>Daily rate ₹</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="600"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWorker()}
              />
            </label>
            <button className="btn primary" type="button" onClick={addWorker} style={{ alignSelf: "flex-end" }}>
              Add
            </button>
          </div>
        </div>
      )}

      <div className="dash-grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="k">Workers</div>
          <div className="v">{active.length}</div>
          {inactive.length > 0 && <div className="sub">+ {inactive.length} inactive</div>}
        </div>
        <div className="stat">
          <div className="k">Days this week</div>
          <div className="v">{totDays}</div>
        </div>
        <div className="stat">
          <div className="k">Wages earned</div>
          <div className="v money">₹ {inr(totEarned)}</div>
        </div>
        <div className="stat">
          <div className="k">Paid</div>
          <div className="v" style={{ color: "var(--green)" }}>₹ {inr(totPaid)}</div>
        </div>
        <div className="stat">
          <div className="k">Balance</div>
          <div className="v" style={{ color: balColor(totBalance) }}>₹ {inr(totBalance)}</div>
          <div className="sub">{totBalance > 0.5 ? "still to pay" : totBalance < -0.5 ? "advance given" : "settled"}</div>
        </div>
      </div>

      <div className="tsheet">
        <div className="tsheet-head">
          <span>Wage register</span>
          <small>tap a day: 1 → ½ → 0 → blank · payout {PAYDAY_NAMES[cfg.payday]}</small>
        </div>
        <div className="tsheet-body" style={{ overflowX: "auto" }}>
          {rows.length ? (
            <table className="t-table att-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {DAY_NAMES.map((n, i) => (
                    <th key={n} className={"att-day" + (i === paydayCol ? " att-payday" : "")}>
                      {n}
                      <small>{dayNum(days[i])}</small>
                    </th>
                  ))}
                  <th className="amt">Days</th>
                  <th className="amt">Total ₹</th>
                  <th className="amt">Paid ₹</th>
                  <th className="amt">Balance ₹</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <Fragment key={x.worker.id}>
                    <tr>
                      <td>
                        <button className="att-name" type="button" title="Edit name / rate" onClick={() => editWorker(x.worker)}>
                          {x.worker.name}
                        </button>
                        <small className="att-rate">₹{inr(x.worker.rate)}/day</small>
                      </td>
                      {days.map((iso, i) => (
                        <td key={iso} className={"att-day" + (i === paydayCol ? " att-payday" : "")}>
                          <button
                            className={"att-cell" + markCls(x.marks[iso])}
                            type="button"
                            onClick={() => cycle(x.worker, iso, x.marks[iso])}
                          >
                            {markGlyph(x.marks[iso])}
                          </button>
                        </td>
                      ))}
                      <td className="amt" style={{ fontWeight: 700 }}>{x.presentDays || ""}</td>
                      <td className="amt">{x.earned ? inr(x.earned) : ""}</td>
                      <td className="amt">{x.paid ? inr(x.paid) : ""}</td>
                      <td className="amt" style={{ fontWeight: 700, color: balColor(x.balance) }}>
                        {x.earned || x.paid ? inr(x.balance) : ""}
                      </td>
                      <td className="att-acts">
                        {x.balance > 0.5 && payFor !== x.worker.id && (
                          <button className="btn primary sm" type="button" onClick={() => startPay(x.worker, x.balance)}>
                            Pay ₹{inr(x.balance)}
                          </button>
                        )}
                        <button className="btn sm" type="button" title="Advance / pay any amount" onClick={() => startPay(x.worker)}>
                          + Pay
                        </button>
                        <button className="pb-x" title="Remove from register (history stays)" onClick={() => deactivate(x.worker)}>
                          ×
                        </button>
                      </td>
                    </tr>
                    {paymentsStrip(x)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="t-empty">No workers yet — add one with “+ Worker” above.</div>
          )}
        </div>
      </div>

      {inactive.length > 0 && (
        <div className="panel-card">
          <div className="pc-head" style={{ cursor: "pointer" }} onClick={() => setShowInactive((v) => !v)}>
            <span className="um-caret" style={{ marginRight: 6 }}>{showInactive ? "▾" : "▸"}</span>
            Inactive workers · {inactive.length}
          </div>
          {showInactive &&
            inactive.map((w) => (
              <div className="exprow" key={w.id}>
                <span className="expnote">
                  {w.name}
                  <small>₹{inr(w.rate)}/day</small>
                </span>
                <button className="btn sm" type="button" onClick={() => reactivate(w)}>
                  Reactivate
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
