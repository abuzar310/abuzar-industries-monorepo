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
  workerAccount,
  workerPayments,
  type AttendanceCfg,
  type AttendanceMark,
  type WeekRow,
  type Worker,
  type WorkerAccount,
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
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
// blank → 1 → ½ → 0 → blank
const nextMark = (cur: number | undefined): number | null =>
  cur === undefined ? 1 : cur === 1 ? 0.5 : cur === 0.5 ? 0 : null;
const markGlyph = (v: number | undefined) => (v === 1 ? "1" : v === 0.5 ? "½" : v === 0 ? "0" : "");
const markCls = (v: number | undefined) => (v === 1 ? " f" : v === 0.5 ? " h" : v === 0 ? " a" : "");
// account convention: NEGATIVE = worker owes the company · POSITIVE = company owes the worker
const balWords = (bal: number) =>
  bal < -0.5
    ? { text: "owes us ₹" + inr(-bal), color: "var(--danger)" }
    : bal > 0.5
      ? { text: "to pay ₹" + inr(bal), color: "var(--green)" }
      : { text: "✓ square", color: "var(--ink-faint)" };

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
  const [newOpening, setNewOpening] = useState("");
  // account card (one worker at a time) + its give-money inline form
  const [openAcct, setOpenAcct] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [fAmt, setFAmt] = useState("");
  const [fDate, setFDate] = useState("");
  const [fNote, setFNote] = useState("");
  // owner: inline opening-credit edit inside the card
  const [editOpening, setEditOpening] = useState(false);
  const [openingVal, setOpeningVal] = useState("");
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
  // all-time running account per worker (this is what the owner tracks in his Excel)
  const accounts = useMemo(() => {
    const m = new Map<string, WorkerAccount>();
    for (const w of active) m.set(w.id, workerAccount(w, marks, expenses));
    return m;
  }, [active, marks, expenses]);
  const acctOf = (id: string): WorkerAccount =>
    accounts.get(id) || { earnedAll: 0, givenAll: 0, opening: 0, balance: 0 };

  const totDays = r2(rows.reduce((s, x) => s + x.presentDays, 0));
  const totEarned = r2(rows.reduce((s, x) => s + x.earned, 0));
  const totPaid = r2(rows.reduce((s, x) => s + x.paid, 0));
  const totNet = r2(rows.reduce((s, x) => s + acctOf(x.worker.id).balance, 0));
  // "due" = company owes the worker (all-time account balance is positive)
  const due = rows.filter((x) => acctOf(x.worker.id).balance > 0.5);
  const totDue = r2(due.reduce((s, x) => s + acctOf(x.worker.id).balance, 0));
  // Mon..Sun column i → JS weekday (i+1)%7; matches the configured payday
  const paydayCol = (cfg.payday + 6) % 7;

  const whereMoneyWent = () =>
    isOwner ? "recorded (owner's cash — not in Daybook)" : "recorded · cut from Daybook";

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
    const w = await saveWorker({ name: newName, rate: +newRate || 0, opening: +newOpening || 0 });
    if (!w) return toast("Enter a name");
    setNewName("");
    setNewRate("");
    setNewOpening("");
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
        {
          name: "opening",
          label: "Opening credit ₹ (they owe us)",
          type: "number",
          inputMode: "decimal",
          value: String(w.opening || 0),
        },
      ],
    });
    if (res === null) return;
    await saveWorker({ id: w.id, name: res.name, rate: +res.rate || 0, opening: +res.opening || 0 });
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

  function toggleAcct(id: string) {
    setOpenAcct((cur) => (cur === id ? null : id));
    setGiving(false);
    setEditOpening(false);
  }
  function startGive(prefill?: number) {
    setGiving(true);
    setFAmt(prefill && prefill > 0 ? String(r2(prefill)) : "");
    setFDate(todayIso());
    setFNote("");
  }
  function cancelGive() {
    setGiving(false);
    setFAmt("");
    setFDate("");
    setFNote("");
  }
  async function submitGive(w: Worker) {
    const amt = +fAmt || 0;
    if (amt <= 0) return toast("Enter an amount");
    await payWorker({ worker: w, amount: amt, date: toDmy(fDate), by: user?.id || "unknown", note: fNote, toOwner: isOwner });
    toast("₹" + inr(amt) + " given to " + w.name + " — " + whereMoneyWent());
    cancelGive();
    load();
    bumpData();
  }

  async function submitOpening(w: Worker) {
    await saveWorker({ id: w.id, name: w.name, rate: w.rate, opening: +openingVal || 0 });
    setEditOpening(false);
    setOpeningVal("");
    load();
    bumpData();
    toast("Opening credit saved");
  }

  async function payAllDue() {
    const ok = await confirmDialog({
      title: "Pay all due · ₹" + inr(totDue) + "?",
      message:
        due.map((x) => x.worker.name + " ₹" + inr(acctOf(x.worker.id).balance)).join(" · ") +
        ". One salary entry per worker, dated today — clears each account to square. " +
        (isOwner ? "Paid from the owner's cash (not the Daybook)." : "Cash goes out of the Daybook."),
      confirmLabel: "Pay ₹" + inr(totDue),
    });
    if (!ok) return;
    for (const x of due)
      await payWorker({
        worker: x.worker,
        amount: acctOf(x.worker.id).balance,
        by: user?.id || "unknown",
        note: "week " + fmtWeekLabel(days),
        toOwner: isOwner,
      });
    load();
    bumpData();
    toast("₹" + inr(totDue) + " paid to " + due.length + " worker" + (due.length === 1 ? "" : "s") + " — " + whereMoneyWent());
  }

  async function delPayment(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete this payment?",
      message: `₹${inr(e.amount)} · ${e.date} — removes it from the Daybook too; the amount goes back onto the account.`,
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

  // ── one worker's account card (expandable panel under their row) ────────────
  function accountCard(x: WeekRow) {
    const w = x.worker;
    const a = acctOf(w.id);
    const bw = balWords(a.balance);
    const stmt = workerPayments(expenses, w.id).sort(
      (p, q) => (q.createdAt || "").localeCompare(p.createdAt || ""),
    );
    const weekUnpaid = r2(x.earned - x.paid);
    // the payment note carries the worker's name ("Zameer · note") — show only the note part here
    const extraNote = (e: Expense) => {
      const n = e.note || "";
      return n === w.name ? "" : n.startsWith(w.name + " · ") ? n.slice(w.name.length + 3) : n;
    };
    // live preview while typing an amount: what the account becomes after this payment
    const amt = +fAmt || 0;
    const after = r2(a.balance - amt);
    const preview =
      amt <= 0
        ? ""
        : after > 0.5
          ? "after this we'll still owe " + w.name + " ₹" + inr(after)
          : after < -0.5
            ? "after this " + w.name + " will owe us ₹" + inr(-after)
            : "account becomes square ✓";
    return (
      <tr key={w.id + ":acct"}>
        <td colSpan={12} className="att-acct-cell">
          <div className="att-card">
            {/* balance headline — the one number that matters */}
            <div className="att-card-hero">
              <div className="att-hero-main">
                <span className="att-hero-k">{w.name}&apos;s account</span>
                <b className="att-hero-bal" style={{ color: bw.color }}>{bw.text}</b>
                <span className="att-hero-sub">
                  earned ₹{inr(a.earnedAll)} all-time · given ₹{inr(a.givenAll)}
                  {a.opening > 0.5 ? " · started owing ₹" + inr(a.opening) : ""}
                </span>
              </div>
              <div className="att-hero-acts">
                {!giving && (
                  <>
                    <button
                      className="btn primary sm"
                      type="button"
                      title="Hand money to the worker — any amount, any day; whatever isn't covered by wages stays on the account"
                      onClick={() => startGive(a.balance > 0.5 ? a.balance : weekUnpaid)}
                    >
                      Give money
                    </button>
                    <button className="btn sm" type="button" onClick={() => editWorker(w)}>Edit</button>
                  </>
                )}
              </div>
            </div>

            {giving && (
              <div className="att-give">
                <div className="att-give-row">
                  <label className="modal-field">
                    <span>Give ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={fAmt}
                      onChange={(e) => setFAmt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitGive(w)}
                      autoFocus
                    />
                  </label>
                  <label className="modal-field">
                    <span>Date</span>
                    <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
                  </label>
                  <label className="modal-field" style={{ flex: 2 }}>
                    <span>Note (optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. advance"
                      value={fNote}
                      onChange={(e) => setFNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitGive(w)}
                    />
                  </label>
                </div>
                <div className="att-give-quick">
                  {a.balance > 0.5 && (
                    <button className="acct-chip" type="button" onClick={() => setFAmt(String(a.balance))}>
                      Full due ₹{inr(a.balance)}
                    </button>
                  )}
                  {weekUnpaid > 0.5 && r2(weekUnpaid) !== r2(a.balance) && (
                    <button className="acct-chip" type="button" onClick={() => setFAmt(String(weekUnpaid))}>
                      This week ₹{inr(weekUnpaid)}
                    </button>
                  )}
                  {preview && <span className="att-give-preview">→ {preview}</span>}
                </div>
                <div className="rowbtns" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" type="button" onClick={() => submitGive(w)}>
                    Give{amt > 0 ? " ₹" + inr(amt) : ""}
                  </button>
                  <button className="btn sm" type="button" onClick={cancelGive}>Cancel</button>
                  <span className="att-give-where">{isOwner ? "from the owner's cash (not the Daybook)" : "cash goes out of the Daybook"}</span>
                </div>
              </div>
            )}

            {/* owner: opening credit (₹ the worker owed before the register started) */}
            <div className="att-opening">
              {editOpening && isOwner ? (
                <span className="att-opening-edit">
                  Opening credit ₹
                  <input
                    type="number"
                    inputMode="decimal"
                    value={openingVal}
                    onChange={(e) => setOpeningVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitOpening(w)}
                    autoFocus
                  />
                  <button className="btn primary sm" type="button" onClick={() => submitOpening(w)}>Save</button>
                  <button className="btn sm" type="button" onClick={() => setEditOpening(false)}>Cancel</button>
                </span>
              ) : (
                <button
                  className="tlink"
                  type="button"
                  disabled={!isOwner}
                  title={isOwner ? "Money they already owed when the register started" : "Only the Owner can change this"}
                  onClick={() => {
                    setEditOpening(true);
                    setOpeningVal(a.opening ? String(a.opening) : "");
                  }}
                >
                  Opening credit: ₹{inr(a.opening)}{isOwner ? " — edit" : ""}
                </button>
              )}
            </div>

            <div className="att-card-stmt">
              <div className="pbd-lbl">Money given · {stmt.length}</div>
              {stmt.length ? (
                stmt.map((e) => (
                  <div className="stmt" key={e.id}>
                    <div className="stmt-ic att-given">₹</div>
                    <div className="stmt-main">
                      <div className="stmt-to">
                        {extraNote(e) || "Given"}
                        {e.toOwner && <span className="acct-overall-hint"> · owner&apos;s cash</span>}
                      </div>
                      <div className="stmt-sub">
                        {e.date}
                        {hhmm(e.createdAt) ? " · " + hhmm(e.createdAt) : ""} · by {userName(e.enteredBy)}
                      </div>
                    </div>
                    <div className="stmt-amt" style={{ color: "var(--danger)" }}>−₹{inr(e.amount)}</div>
                    <span className="pb-rowacts">
                      <button className="pb-x" title="Delete this payment" onClick={() => delPayment(e)}>×</button>
                    </span>
                  </div>
                ))
              ) : (
                <div className="stmt-sub" style={{ padding: "6px 2px", opacity: 0.7 }}>
                  Nothing given yet{a.opening > 0.5 ? " — the account only has attendance and the opening credit" : ""}.
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div className="sectitle">
        Attendance <small>— weekly wage register &amp; worker accounts</small>
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
            <label className="modal-field" style={{ flex: "1 1 150px", minWidth: 0 }}>
              <span>Opening credit ₹ (they owe us)</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={newOpening}
                onChange={(e) => setNewOpening(e.target.value)}
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
          <div className="sub">this week</div>
        </div>
        <div className="stat">
          <div className="k">Given</div>
          <div className="v" style={{ color: "var(--green)" }}>₹ {inr(totPaid)}</div>
          <div className="sub">this week</div>
        </div>
        <div className="stat">
          <div className="k">Accounts net</div>
          <div className="v" style={{ color: balWords(totNet).color }}>₹ {inr(Math.abs(totNet))}</div>
          <div className="sub">{totNet > 0.5 ? "to pay overall" : totNet < -0.5 ? "workers owe us" : "all square"}</div>
        </div>
      </div>

      <div className="tsheet">
        <div className="tsheet-head">
          <span>Wage register</span>
          <small>tap a day: 1 → ½ → 0 → blank · tap a name or balance for the account · payout {PAYDAY_NAMES[cfg.payday]}</small>
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
                  <th className="amt">Earned ₹<small className="att-th-sub">this week</small></th>
                  <th className="amt">Account balance<small className="att-th-sub">all-time</small></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const a = acctOf(x.worker.id);
                  const bw = balWords(a.balance);
                  const open = openAcct === x.worker.id;
                  return (
                    <Fragment key={x.worker.id}>
                      <tr>
                        <td>
                          <button
                            className="att-name"
                            type="button"
                            title="Open this worker's account"
                            onClick={() => toggleAcct(x.worker.id)}
                          >
                            <span className="um-caret" style={{ marginRight: 4 }}>{open ? "▾" : "▸"}</span>
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
                        <td className="amt">
                          <button
                            className="att-bal"
                            type="button"
                            style={{ color: bw.color }}
                            title="Open this worker's account"
                            onClick={() => toggleAcct(x.worker.id)}
                          >
                            {bw.text}
                          </button>
                        </td>
                        <td className="att-acts">
                          <button className="pb-x" title="Remove from register (history stays)" onClick={() => deactivate(x.worker)}>
                            ×
                          </button>
                        </td>
                      </tr>
                      {open && accountCard(x)}
                    </Fragment>
                  );
                })}
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
