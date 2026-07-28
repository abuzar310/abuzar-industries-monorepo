"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { delRec } from "@/lib/data";
import { dateSortKey, inr, todayStr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import {
  deductAdvance,
  fmtWeekLabel,
  getAttendanceCfg,
  listAttendance,
  listWorkers,
  markAttendance,
  nextWeek,
  payWorker,
  prevWeek,
  repayWorker,
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
  type WorkerEntry,
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
// WAGE pot convention: POSITIVE = still to pay the worker · NEGATIVE = paid over what was earned
const balWords = (bal: number) =>
  bal < -0.5
    ? { text: "−₹" + inr(-bal) + " extra taken", color: "var(--danger)" }
    : bal > 0.5
      ? { text: "to pay ₹" + inr(bal), color: "var(--green)" }
      : { text: "✓ square", color: "var(--ink-faint)" };
// statement line look, per pot
const KIND_UI = {
  wage: { label: "Wage", color: "var(--danger)", sign: "−", ic: "₹", icCls: "att-given" },
  debt: { label: "Advance given", color: "var(--ochre-deep)", sign: "−", ic: "₹", icCls: "att-debt" },
  deduct: { label: "Cut from wages → advance", color: "var(--ink-faint)", sign: "−", ic: "✂", icCls: "att-ded" },
  repaid: { label: "Repaid", color: "var(--green)", sign: "+", ic: "↑", icCls: "ok" },
} as const;

export default function AttendanceView() {
  const { ready, dataVersion, user } = useApp();
  const isOwner = user?.role === "owner";
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cfg, setCfg] = useState<AttendanceCfg>({ payday: 0 });
  const [start, setStart] = useState<Date>(() => weekStart(new Date()));

  // pay panel (the main pay path — always THIS calendar week, independent of register nav)
  const [payId, setPayId] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payDate, setPayDate] = useState(todayIso);
  const [payNote, setPayNote] = useState("");
  const [payToDebt, setPayToDebt] = useState(false);
  // whose cash actually moved — defaults to whoever is logged in, but always overridable:
  // Manager's cash → cut from the Daybook · Owner's cash → Daybook untouched
  const [payBy, setPayBy] = useState<"owner" | "manager" | null>(null);
  const [repayBy, setRepayBy] = useState<"owner" | "manager" | null>(null);
  const [showDeduct, setShowDeduct] = useState(false);
  const [dedAmt, setDedAmt] = useState("");
  const [dedNote, setDedNote] = useState("");

  // add-worker inline form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  // account card (one worker at a time) + its received-back inline form
  const [openAcct, setOpenAcct] = useState<string | null>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  /** past-weeks history inside the account card — folded to one carry line by default */
  const [histOpen, setHistOpen] = useState(false);
  const [fAmt, setFAmt] = useState("");
  const [fDate, setFDate] = useState("");
  const [fNote, setFNote] = useState("");
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
  // all-time running account per worker (wage pot + separate debt pot)
  const accounts = useMemo(() => {
    const m = new Map<string, WorkerAccount>();
    for (const w of active) m.set(w.id, workerAccount(w, marks, expenses));
    return m;
  }, [active, marks, expenses]);
  const acctOf = (id: string): WorkerAccount =>
    accounts.get(id) || {
      earnedAll: 0, wagePaidAll: 0, debtGivenAll: 0, deductedAll: 0, repaidAll: 0,
      opening: 0, wageBalance: 0, debt: 0,
    };
  // the pay panel always talks about the CURRENT calendar week
  const curDays = useMemo(() => weekDays(weekStart(new Date())), []);
  const curRows = useMemo(() => weekRollup(active, marks, expenses, curDays), [active, marks, expenses, curDays]);

  const totDays = r2(rows.reduce((s, x) => s + x.presentDays, 0));
  const totEarned = r2(rows.reduce((s, x) => s + x.earned, 0));
  const totPaid = r2(rows.reduce((s, x) => s + x.paid, 0));
  const totClosing = r2(rows.reduce((s, x) => s + x.closing, 0)); // what this week carries forward
  const totNet = r2(rows.reduce((s, x) => s + acctOf(x.worker.id).wageBalance, 0));
  // "due" = unpaid wages (the wage pot is positive)
  const due = rows.filter((x) => acctOf(x.worker.id).wageBalance > 0.5);
  const totDue = r2(due.reduce((s, x) => s + acctOf(x.worker.id).wageBalance, 0));
  // Mon..Sun column i → JS weekday (i+1)%7; matches the configured payday
  const paydayCol = (cfg.payday + 6) % 7;

  const defaultBy = (): "owner" | "manager" => (isOwner ? "owner" : "manager");
  const wentWords = (by: "owner" | "manager", dir: "out" | "in") =>
    by === "owner"
      ? "Owner's cash — Daybook untouched"
      : dir === "out"
        ? "cash goes out of the Manager's Daybook"
        : "cash comes into the Manager's Daybook";

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
        // debt-account setup is owner-only and rarely touched — kept out of everyone else's way
        ...(isOwner
          ? [{
              name: "opening",
              label: "Advance account opening ₹ (rarely used)",
              type: "number" as const,
              inputMode: "decimal" as const,
              value: String(w.opening || 0),
            }]
          : []),
      ],
    });
    if (res === null) return;
    await saveWorker({
      id: w.id,
      name: res.name,
      rate: +res.rate || 0,
      opening: isOwner ? +res.opening || 0 : undefined,
    });
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
    if (payId === w.id) setPayId(null);
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

  // ── pay panel handlers ───────────────────────────────────────────────────
  function pickPay(id: string) {
    setPayId((cur) => (cur === id ? null : id));
    setPayAmt("");
    setPayNote("");
    setPayDate(todayIso());
    setPayToDebt(false);
    setPayBy(defaultBy());
    setShowDeduct(false);
    setDedAmt("");
    setDedNote("");
  }
  /** tap a day's amount in the grid → pay panel opens for that worker, dated that day */
  function payForDay(workerId: string, iso: string) {
    if (payId !== workerId) pickPay(workerId);
    setPayDate(iso);
    document.querySelector(".att-pp")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function submitPay(w: Worker) {
    const amt = +payAmt || 0;
    if (amt <= 0) return toast("Enter an amount");
    const by = payBy ?? defaultBy();
    await payWorker({
      worker: w,
      amount: amt,
      date: toDmy(payDate),
      by: user?.id || "unknown",
      note: payNote,
      toOwner: by === "owner",
      kind: payToDebt ? "debt" : "wage",
    });
    setPayAmt("");
    setPayNote("");
    setPayDate(todayIso());
    setPayToDebt(false);
    load();
    bumpData();
    toast(
      "₹" + inr(amt) + (payToDebt ? " put on " + w.name + "'s Advance account" : " paid to " + w.name) +
        " — " + wentWords(by, "out"),
    );
  }
  async function submitDeduct(w: Worker) {
    const amt = +dedAmt || 0;
    if (amt <= 0) return toast("Enter an amount");
    await deductAdvance({ worker: w, amount: amt, by: user?.id || "unknown", note: dedNote });
    setShowDeduct(false);
    setDedAmt("");
    setDedNote("");
    load();
    bumpData();
    toast("₹" + inr(amt) + " cut from " + w.name + "'s wages against the advance — no cash moved");
  }

  function toggleAcct(id: string) {
    setOpenAcct((cur) => (cur === id ? null : id));
    setRepayOpen(false);
    setHistOpen(false); // past weeks start folded — one carry line
  }
  function startRepay() {
    setRepayOpen(true);
    setFAmt("");
    setFDate(todayIso());
    setFNote("");
    setRepayBy(defaultBy());
  }
  function cancelRepay() {
    setRepayOpen(false);
    setFAmt("");
    setFDate("");
    setFNote("");
  }
  async function submitRepay(w: Worker) {
    const amt = +fAmt || 0;
    if (amt <= 0) return toast("Enter an amount");
    const by = repayBy ?? defaultBy();
    await repayWorker({ worker: w, amount: amt, date: toDmy(fDate), by: user?.id || "unknown", note: fNote, toOwner: by === "owner" });
    toast("₹" + inr(amt) + " received back from " + w.name + " — " + wentWords(by, "in"));
    cancelRepay();
    load();
    bumpData();
  }

  async function payAllDue() {
    const ok = await confirmDialog({
      title: "Pay all due · ₹" + inr(totDue) + "?",
      message:
        due.map((x) => x.worker.name + " ₹" + inr(acctOf(x.worker.id).wageBalance)).join(" · ") +
        ". One salary entry per worker, dated today — clears each wage balance to square. Paid as " +
        (isOwner ? "the Owner (Daybook untouched)." : "the Manager (cash out of the Daybook)."),
      confirmLabel: "Pay ₹" + inr(totDue),
    });
    if (!ok) return;
    for (const x of due)
      await payWorker({
        worker: x.worker,
        amount: acctOf(x.worker.id).wageBalance,
        by: user?.id || "unknown",
        note: "week " + fmtWeekLabel(days),
        toOwner: isOwner,
      });
    load();
    bumpData();
    toast("₹" + inr(totDue) + " paid to " + due.length + " worker" + (due.length === 1 ? "" : "s") + " — " + wentWords(defaultBy(), "out"));
  }

  async function delPayment(x: WorkerEntry) {
    const ui = KIND_UI[x.kind];
    const ok = await confirmDialog({
      title: "Delete this entry? (" + ui.label + ")",
      message:
        `₹${inr(x.e.amount)} · ${x.e.date} — ` +
        (x.kind === "deduct"
          ? "no cash moved; the wages and the advance both go back up."
          : "removes it from the Daybook too; the amount goes back onto the account."),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", x.e.id);
    load();
    bumpData();
    toast(ui.label + " entry removed");
  }

  const dayNum = (iso: string) => iso.slice(8);

  // ── the top pay panel (Receipts-style card — the main pay path) ────────────
  function payPanel() {
    const w = active.find((x) => x.id === payId) || null;
    const a = w ? acctOf(w.id) : null;
    const cw = w ? curRows.find((r) => r.worker.id === w.id) : null;
    const weekBal = cw ? cw.balance : 0;
    const amt = +payAmt || 0;
    const differs = !!a && Math.abs(r2(a.wageBalance - weekBal)) > 0.5;
    const earlier = a ? r2(a.wageBalance - weekBal) : 0;
    const dAmt = +dedAmt || 0;
    return (
      <div className="panel-card att-pp">
        <div className="acct-overall-h">Pay a worker</div>
        <div className="att-pp-chips">
          {active.map((x) => (
            <button
              key={x.id}
              className={"acct-chip" + (payId === x.id ? " on" : "")}
              type="button"
              onClick={() => pickPay(x.id)}
            >
              {x.name}
            </button>
          ))}
        </div>

        {w && a && cw && (
          <>
            <div className="att-pp-sum">
              <span>
                {cw.presentDays || 0} day{cw.presentDays === 1 ? "" : "s"} this week · earned ₹{inr(cw.earned)} · paid ₹{inr(cw.paid)} ·{" "}
                <b style={{ color: balWords(weekBal).color }}>{balWords(weekBal).text}</b>
              </span>
              {differs && (
                <span className="att-pp-sub">
                  {earlier > 0 ? "+ ₹" + inr(earlier) + " from earlier weeks" : "− ₹" + inr(-earlier) + " taken extra earlier"} ·{" "}
                  <b style={{ color: balWords(a.wageBalance).color }}>
                    {a.wageBalance > 0.5 ? "total to pay ₹" + inr(a.wageBalance) : a.wageBalance < -0.5 ? "overall took extra ₹" + inr(-a.wageBalance) : "overall square ✓"}
                  </b>
                </span>
              )}
              {a.debt > 0.5 && <span className="att-debt-chip">Advance: ₹{inr(a.debt)}</span>}
            </div>

            <div className="rec-grid" style={{ marginTop: 12 }}>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPay(w)}
                />
              </label>
              <label className="modal-field">
                <span>Date</span>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Note (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. week wages"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPay(w)}
                />
              </label>
            </div>
            {(weekBal > 0.5 || a.wageBalance > 0.5) && (
              <div className="att-give-quick" style={{ marginTop: 8 }}>
                {weekBal > 0.5 && (
                  <button className="acct-chip" type="button" onClick={() => setPayAmt(String(weekBal))}>
                    This week ₹{inr(weekBal)}
                  </button>
                )}
                {a.wageBalance > 0.5 && differs && (
                  <button className="acct-chip" type="button" onClick={() => setPayAmt(String(a.wageBalance))}>
                    All due ₹{inr(a.wageBalance)}
                  </button>
                )}
              </div>
            )}

            {/* whose cash moved — explicit, so either person can record the other's payment */}
            <div className="att-paidby">
              <span className="att-paidby-lbl">Paid by</span>
              <div className="db-seg sm">
                <button
                  className={"seg-btn" + ((payBy ?? defaultBy()) === "owner" ? " on" : "")}
                  type="button"
                  title="The Owner's own cash — the Daybook is untouched"
                  onClick={() => setPayBy("owner")}
                >
                  Owner
                </button>
                <button
                  className={"seg-btn" + ((payBy ?? defaultBy()) === "manager" ? " on" : "")}
                  type="button"
                  title="The Manager's cash — cut from the Daybook"
                  onClick={() => setPayBy("manager")}
                >
                  Manager
                </button>
              </div>
              <span className="att-give-where">{wentWords(payBy ?? defaultBy(), "out")}</span>
            </div>

            <label className="att-pp-debtopt">
              <input type="checkbox" checked={payToDebt} onChange={(e) => setPayToDebt(e.target.checked)} />
              Put this on the Advance account instead (loan, not wages)
            </label>
            {a.debt > 0.5 && !showDeduct && (
              <button className="tlink att-pp-dedlink" type="button" onClick={() => setShowDeduct(true)}>
                Cut ₹ from wages against the advance…
              </button>
            )}
            {a.debt > 0.5 && showDeduct && (
              <div className="att-give" style={{ marginTop: 10 }}>
                <div className="att-give-row">
                  <label className="modal-field">
                    <span>Cut from wages ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={dedAmt}
                      onChange={(e) => setDedAmt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitDeduct(w)}
                      autoFocus
                    />
                  </label>
                  <label className="modal-field" style={{ flex: 2 }}>
                    <span>Note (optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. against the loan"
                      value={dedNote}
                      onChange={(e) => setDedNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitDeduct(w)}
                    />
                  </label>
                </div>
                {dAmt > 0 && (
                  <div className="att-give-preview" style={{ marginTop: 8 }}>
                    → wages to pay −₹{inr(dAmt)} · debt becomes ₹{inr(r2(a.debt - dAmt))} · no cash moves
                  </div>
                )}
                <div className="rowbtns" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" type="button" onClick={() => submitDeduct(w)}>
                    Cut{dAmt > 0 ? " ₹" + inr(dAmt) : ""} from wages
                  </button>
                  <button className="btn sm" type="button" onClick={() => { setShowDeduct(false); setDedAmt(""); setDedNote(""); }}>
                    Cancel
                  </button>
                  <span className="att-give-where">settles wages against the advance — no cash moves</span>
                </div>
              </div>
            )}

            <button
              className="btn primary"
              type="button"
              onClick={() => submitPay(w)}
              style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }}
            >
              Pay{amt > 0 ? " ₹" + inr(amt) : ""}{payToDebt ? " onto the Advance account" : ""}
              {" "}· by {(payBy ?? defaultBy()) === "owner" ? "Owner" : "Manager"}
            </button>
          </>
        )}
        {!w && <div className="att-pp-hint">Pick a worker to see this week&apos;s picture and pay.</div>}
      </div>
    );
  }

  // ── one worker's account card (expandable panel under their row) ────────────
  function accountCard(x: WeekRow) {
    const w = x.worker;
    const a = acctOf(w.id);
    const bw = balWords(a.wageBalance);
    // full statement, all pots, newest first
    const stmt = workerPayments(expenses, w.id).sort(
      (p, q) => (q.e.createdAt || "").localeCompare(p.e.createdAt || ""),
    );
    // split by the VIEWED week: its own entries in full, everything older folded
    // into one carry line (tap to expand), later entries likewise when browsing history
    const isoOfEntry = (x2: WorkerEntry) => dateSortKey(x2.e.date) || (x2.e.createdAt || "").slice(0, 10);
    const curStmt = stmt.filter((s) => { const i = isoOfEntry(s); return i >= days[0] && i <= days[6]; });
    const pastStmt = stmt.filter((s) => isoOfEntry(s) < days[0]);
    const laterStmt = stmt.filter((s) => isoOfEntry(s) > days[6]);
    const stmtRow = (x2: WorkerEntry) => {
      const ui = KIND_UI[x2.kind];
      return (
        <div className="stmt" key={x2.e.id}>
          <div className={"stmt-ic " + ui.icCls}>{ui.ic}</div>
          <div className="stmt-main">
            <div className="stmt-to">
              <span style={{ color: ui.color }}>{ui.label}</span>
              {extraNote(x2) ? " · " + extraNote(x2) : ""}
              {x2.kind === "deduct" ? (
                <span className="acct-overall-hint"> · no cash</span>
              ) : (
                <span className="acct-overall-hint">
                  {" "}· {x2.kind === "repaid" ? "received by" : "paid by"} {x2.e.toOwner ? "Owner" : "Manager (Daybook)"}
                </span>
              )}
            </div>
            <div className="stmt-sub">
              {x2.e.date}
              {hhmm(x2.e.createdAt) ? " · " + hhmm(x2.e.createdAt) : ""} · by {userName(x2.e.enteredBy)}
            </div>
          </div>
          <div className="stmt-amt" style={{ color: ui.color }}>
            {ui.sign}₹{inr(x2.e.amount)}
          </div>
          <span className="pb-rowacts">
            <button className="pb-x" title="Delete" onClick={() => delPayment(x2)}>×</button>
          </span>
        </div>
      );
    };
    // notes carry the worker's name ("Zameer · note") — show only the note part here
    const extraNote = (x2: WorkerEntry) => {
      const n = x2.e.note || "";
      if (x2.kind === "repaid") return n === "Repaid · " + w.name ? "" : n;
      return n === w.name ? "" : n.startsWith(w.name + " · ") ? n.slice(w.name.length + 3) : n;
    };
    // live preview while typing a repayment: what the Advance account becomes
    const amt = +fAmt || 0;
    const afterDebt = r2(a.debt - amt);
    const preview =
      amt <= 0
        ? ""
        : afterDebt > 0.5
          ? "advance becomes ₹" + inr(afterDebt)
          : afterDebt < -0.5
            ? "that's ₹" + inr(-afterDebt) + " more than the advance — it will go negative"
            : "advance clears ✓";
    return (
      <tr key={w.id + ":acct"}>
        <td colSpan={13} className="att-acct-cell">
          <div className="att-card">
            {/* wage balance headline — the one number that matters */}
            <div className="att-card-hero">
              <div className="att-hero-main">
                <span className="att-hero-k">{w.name}&apos;s wages</span>
                <b className="att-hero-bal" style={{ color: bw.color }}>{bw.text}</b>
                <span className="att-hero-sub">
                  earned ₹{inr(a.earnedAll)} all-time · paid ₹{inr(a.wagePaidAll)}
                  {a.deductedAll > 0.5 ? " · cut ₹" + inr(a.deductedAll) : ""}
                </span>
              </div>
              <div className="att-hero-acts">
                {!repayOpen && (
                  <>
                    <button
                      className="btn sm"
                      type="button"
                      title="The worker returned money — cash comes back in, reduces the Advance account"
                      onClick={startRepay}
                    >
                      Received back
                    </button>
                    <button className="btn sm" type="button" onClick={() => editWorker(w)}>Edit</button>
                  </>
                )}
              </div>
            </div>

            {/* debt pot — completely absent unless it exists */}
            {a.debt > 0.5 && (
              <div className="att-debt-line">
                <span className="att-debt-chip">
                  Advance: opening ₹{inr(a.opening)} + given ₹{inr(a.debtGivenAll)}
                  {" "}− cut ₹{inr(a.deductedAll)} − repaid ₹{inr(a.repaidAll)} = ₹{inr(a.debt)}
                </span>
              </div>
            )}

            {repayOpen && (
              <div className="att-give">
                <div className="att-give-row">
                  <label className="modal-field">
                    <span>Received back ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={fAmt}
                      onChange={(e) => setFAmt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitRepay(w)}
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
                      placeholder="e.g. returned advance"
                      value={fNote}
                      onChange={(e) => setFNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitRepay(w)}
                    />
                  </label>
                </div>
                {preview && (
                  <div className="att-give-quick">
                    <span className="att-give-preview">→ {preview}</span>
                  </div>
                )}
                <div className="att-paidby">
                  <span className="att-paidby-lbl">Received by</span>
                  <div className="db-seg sm">
                    <button
                      className={"seg-btn" + ((repayBy ?? defaultBy()) === "owner" ? " on" : "")}
                      type="button"
                      onClick={() => setRepayBy("owner")}
                    >
                      Owner
                    </button>
                    <button
                      className={"seg-btn" + ((repayBy ?? defaultBy()) === "manager" ? " on" : "")}
                      type="button"
                      onClick={() => setRepayBy("manager")}
                    >
                      Manager
                    </button>
                  </div>
                </div>
                <div className="rowbtns" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" type="button" onClick={() => submitRepay(w)}>
                    Record{amt > 0 ? " ₹" + inr(amt) : ""}
                  </button>
                  <button className="btn sm" type="button" onClick={cancelRepay}>Cancel</button>
                  <span className="att-give-where">{wentWords(repayBy ?? defaultBy(), "in")}</span>
                </div>
              </div>
            )}

            <div className="att-card-stmt">
              <div className="pbd-lbl">This week · {curStmt.length}</div>
              {curStmt.length ? (
                curStmt.map(stmtRow)
              ) : (
                <div className="stmt-sub" style={{ padding: "6px 2px", opacity: 0.7 }}>
                  Nothing given or received this week yet.
                </div>
              )}

              {/* past weeks fold into ONE carry line — tap to see every old entry */}
              {pastStmt.length > 0 && (
                <>
                  <button className="att-hist-toggle" type="button" onClick={() => setHistOpen((v) => !v)}>
                    <span className="um-caret">{histOpen ? "▾" : "▸"}</span>
                    Past weeks · {pastStmt.length} {pastStmt.length === 1 ? "entry" : "entries"}
                    <b style={{ marginLeft: "auto", color: balWords(x.carryIn).color }}>
                      {x.carryIn > 0.5
                        ? "carried in: to pay ₹" + inr(x.carryIn)
                        : x.carryIn < -0.5
                          ? "carried in: −₹" + inr(-x.carryIn) + " extra taken"
                          : "settled ✓"}
                    </b>
                  </button>
                  {histOpen && pastStmt.map(stmtRow)}
                </>
              )}
              {laterStmt.length > 0 && (
                <>
                  <button className="att-hist-toggle" type="button" onClick={() => setHistOpen((v) => !v)}>
                    <span className="um-caret">{histOpen ? "▾" : "▸"}</span>
                    After this week · {laterStmt.length} {laterStmt.length === 1 ? "entry" : "entries"}
                  </button>
                  {histOpen && laterStmt.map(stmtRow)}
                </>
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

      {active.length > 0 && payPanel()}

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
          <div className="sub">this week</div>
        </div>
        <div className="stat">
          <div className="k">Paid</div>
          <div className="v" style={{ color: "var(--green)" }}>₹ {inr(totPaid)}</div>
          <div className="sub">this week</div>
        </div>
        <div className="stat">
          <div className="k">Week closing</div>
          <div className="v" style={{ color: balWords(totClosing).color }}>₹ {inr(Math.abs(totClosing))}</div>
          <div className="sub">{totClosing > 0.5 ? "carries to next week" : totClosing < -0.5 ? "taken extra — carries" : "week settled ✓"}</div>
        </div>
        <div className="stat">
          <div className="k">Wages net</div>
          <div className="v" style={{ color: balWords(totNet).color }}>₹ {inr(Math.abs(totNet))}</div>
          <div className="sub">{totNet > 0.5 ? "to pay overall" : totNet < -0.5 ? "taken extra overall" : "all square"}</div>
        </div>
      </div>

      <div className="tsheet">
        <div className="tsheet-head">
          <span>Wage register</span>
          <small>tap a day: 1 → ½ → 0 → blank · each week closes on {PAYDAY_NAMES[cfg.payday]} — the closing carries into next week</small>
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
                  <th className="amt">Paid ₹<small className="att-th-sub">this week</small></th>
                  <th className="amt">Week closing<small className="att-th-sub">carries forward</small></th>
                  <th className="amt">Advance<small className="att-th-sub">owes us</small></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const a = acctOf(x.worker.id);
                  const bw = balWords(x.closing); // the WEEK'S closing — frozen for old weeks
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
                            {/* the Excel's AMOUNT row, live: cash he took that day, right under the mark */}
                            {(x.takenByDay[iso] || 0) > 0 ? (
                              <button
                                className="att-day-amt"
                                type="button"
                                title={"₹" + inr(x.takenByDay[iso]) + " taken this day — tap to add more / see the account"}
                                onClick={() => payForDay(x.worker.id, iso)}
                              >
                                −{inr(x.takenByDay[iso])}
                              </button>
                            ) : (
                              <button
                                className="att-day-amt att-day-amt-add"
                                type="button"
                                title={"Give " + x.worker.name + " money for " + DAY_NAMES[i]}
                                onClick={() => payForDay(x.worker.id, iso)}
                              >
                                +
                              </button>
                            )}
                          </td>
                        ))}
                        <td className="amt" style={{ fontWeight: 700 }}>{x.presentDays || ""}</td>
                        <td className="amt">{x.earned ? inr(x.earned) : ""}</td>
                        <td className="amt">{x.paid ? inr(x.paid) : ""}</td>
                        <td className="amt">
                          <button
                            className="att-bal"
                            type="button"
                            style={{ color: bw.color }}
                            title="This week's closing (carry-in + earned − paid) — carries into next week. Tap for the account."
                            onClick={() => toggleAcct(x.worker.id)}
                          >
                            {bw.text}
                          </button>
                          {Math.abs(x.carryIn) > 0.5 && (
                            <small className="att-carry">
                              {x.carryIn > 0 ? "incl. ₹" + inr(x.carryIn) + " from before" : "−₹" + inr(-x.carryIn) + " extra from before"}
                            </small>
                          )}
                        </td>
                        <td className="amt">
                          {a.debt > 0.5 ? (
                            <button
                              className="att-bal att-debt-amt"
                              type="button"
                              title="Open this worker's account — advance breakdown inside"
                              onClick={() => toggleAcct(x.worker.id)}
                            >
                              ₹{inr(a.debt)}
                            </button>
                          ) : (
                            <span className="att-debt-none">—</span>
                          )}
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
