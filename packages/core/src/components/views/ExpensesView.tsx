"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { delRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import { addExpense, allSessions, closeSession, dayTotals, ENTRY_TYPES, isInflow, openExpenses, typeLabel } from "@/lib/expenses";
import { markExpensesSeen } from "@/lib/notify";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { DaybookSession, EntryType, Expense, PayMode } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id;

export default function ExpensesView() {
  const { dataVersion, user } = useApp();
  const isOwner = user?.role === "owner"; // Afsar: clean read-only view
  const [list, setList] = useState<Expense[]>([]);
  const [sessions, setSessions] = useState<DaybookSession[]>([]);

  // inline quick-entry form state
  const [type, setType] = useState<EntryType>("sale");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayMode>("cash");
  const [note, setNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    openExpenses().then((arr) => {
      arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setList(arr);
    });
    allSessions().then((arr) => {
      arr.sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
      setSessions(arr);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  useEffect(() => {
    if (!isOwner) amountRef.current?.focus();
  }, [isOwner]);

  // owner: opening the daybook clears the unseen badge
  useEffect(() => {
    if (isOwner) markExpensesSeen();
  }, [isOwner, dataVersion]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const amt = +amount || 0;
    if (amt <= 0) {
      amountRef.current?.focus();
      return toast("Enter an amount");
    }
    await addExpense({ type, amount: amt, mode, note, label: type === "custom" ? note : "", enteredBy: user?.id || "unknown" });
    setAmount("");
    setNote("");
    amountRef.current?.focus();
    bumpData();
    toast("Entry added");
  }

  async function remove(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete entry?",
      message: `${typeLabel(e.type)} — ₹${inr(e.amount)}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id);
    load();
    bumpData();
  }

  async function handOver() {
    const ok = await confirmDialog({
      title: "Hand over to Afsar?",
      message: `Give ₹${inr(t.net)} to Afsar and close this session. All entries move to history and a fresh session starts.`,
      confirmLabel: "Give & close",
    });
    if (!ok) return;
    const s = await closeSession(user?.id || "unknown");
    if (!s) return toast("Nothing to hand over");
    load();
    bumpData();
    toast("Session closed · ₹" + inr(s.given) + " given to Afsar");
  }

  const t = dayTotals(list);

  return (
    <div>
      <div className="sectitle">
        Daybook <small>— current session</small>
      </div>

      {!isOwner && (
        <form className="panel-card daybook-entry" onSubmit={add}>
          <label className="modal-field">
            <span>Type</span>
            <select value={type} onChange={(ev) => setType(ev.target.value as EntryType)}>
              {ENTRY_TYPES.map((et) => (
                <option key={et.value} value={et.value}>
                  {et.label}
                </option>
              ))}
            </select>
          </label>
          <label className="modal-field">
            <span>Amount (₹)</span>
            <input ref={amountRef} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
          </label>
          {isInflow(type) && (
            <label className="modal-field">
              <span>Paid via</span>
              <select value={mode} onChange={(ev) => setMode(ev.target.value as PayMode)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </label>
          )}
          <label className="modal-field note">
            <span>Note / label</span>
            <input placeholder="e.g. teak planks, helper salary…" value={note} onChange={(ev) => setNote(ev.target.value)} />
          </label>
          <button className="btn primary" type="submit">
            Add entry
          </button>
        </form>
      )}

      <div className="dash-grid" style={{ marginTop: 8 }}>
        <div className="stat">
          <div className="k">Money In</div>
          <div className="v money">₹ {inr(t.totalIn)}</div>
          <div className="sub">Cash ₹{inr(t.cashIn)} · UPI ₹{inr(t.upiIn)}</div>
        </div>
        <div className="stat">
          <div className="k">Spent</div>
          <div className="v" style={{ color: "var(--danger)" }}>₹ {inr(t.spent)}</div>
        </div>
        <div className="stat">
          <div className="k">In hand (to give)</div>
          <div className="v" style={{ color: t.net < 0 ? "var(--danger)" : "var(--green)" }}>₹ {inr(t.net)}</div>
        </div>
        <div className="stat">
          <div className="k">Entries</div>
          <div className="v">{t.count}</div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="listwrap" style={{ marginTop: 16 }}>
          <div className="empty">
            <div className="empty-icon">📒</div>
            <div className="empty-title">Fresh session</div>
            <div className="empty-note">Record sales (cash / UPI) and costs. When you hand cash to Afsar, close the session below.</div>
          </div>
        </div>
      ) : (
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head">Current session · {list.length} entries</div>
          {list.map((e) => (
            <div className="exprow" key={e.id}>
              <span className={"exptag " + (isInflow(e.type) ? "in" : "out")}>{typeLabel(e.type).split(" ")[0]}</span>
              <span className="expnote">
                {e.note || typeLabel(e.type)}
                <small>
                  {e.date} · {userName(e.enteredBy)}
                  {isInflow(e.type) && e.mode ? " · " + e.mode.toUpperCase() : ""}
                </small>
              </span>
              <span className={"expamt " + (isInflow(e.type) ? "in" : "out")}>
                {isInflow(e.type) ? "+" : "−"}₹ {inr(e.amount)}
              </span>
              {!isOwner && (
                <button className="x-row" title="Delete" onClick={() => remove(e)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isOwner && list.length > 0 && (
        <div className="rowbtns" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={handOver} style={{ width: "100%", justifyContent: "center", padding: "13px" }}>
            Give ₹{inr(t.net)} to Afsar &amp; start new session
          </button>
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <div className="sectitle" style={{ marginTop: 28, fontSize: 22 }}>
            Session history <small>— {sessions.length}</small>
          </div>
          {sessions.map((s) => (
            <div className="panel-card" key={s.id}>
              <div className="pc-head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span>
                  {s.date} · Given ₹{inr(s.given)} to Afsar
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 0, textTransform: "none" }}>
                  In ₹{inr(s.totalIn)} · Spent ₹{inr(s.spent)} · {s.count} entries · by {userName(s.by)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
