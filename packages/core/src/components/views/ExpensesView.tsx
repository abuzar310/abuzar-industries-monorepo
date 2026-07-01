"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { delRec } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { inr } from "@/lib/calc";
import { addExpense, allExpenses, allSessions, closeSession, dayTotals, ENTRY_TYPES, isInflow, typeLabel } from "@/lib/expenses";
import { markExpensesSeen, requestNotifyPermission } from "@/lib/notify";
import { isIOS, isStandalone } from "@/lib/pwa";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { DaybookSession, EntryType, Expense, PayMode } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id;

export default function ExpensesView() {
  const { dataVersion, user } = useApp();
  const isOwner = user?.role === "owner"; // Afsar: clean read-only view
  const [all, setAll] = useState<Expense[]>([]);
  const [sessions, setSessions] = useState<DaybookSession[]>([]);
  const [openSes, setOpenSes] = useState<string | null>(null);
  const [notif, setNotif] = useState(""); // "" until client checks; then default/granted/denied

  // inline quick-entry form state
  const [type, setType] = useState<EntryType>("sale");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayMode>("cash");
  const [note, setNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    allExpenses().then((arr) => {
      arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setAll(arr);
    });
    allSessions().then((arr) => {
      arr.sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
      setSessions(arr);
    });
  }, []);
  // current open session = entries not yet archived into a closed session
  const list = all.filter((e) => !e.sessionId);
  const sessionEntries = (id: string) => all.filter((e) => e.sessionId === id);
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

  // owner: reflect the current notification permission (client-only, avoids hydration mismatch)
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotif(Notification.permission);
  }, [dataVersion]);

  async function enableNotifications() {
    const p = await requestNotifyPermission();
    setNotif(p);
    toast(p === "granted" ? "Notifications on — you'll get alerts here" : "Notifications not enabled");
  }

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
    await cloudDelete("expenses", e.id); // propagate the delete to the cloud so it doesn't re-sync back
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

      {isOwner && notif && notif !== "granted" && (() => {
        const iosNeedsInstall = isIOS() && !isStandalone();
        return (
          <div className="panel-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              🔔 {iosNeedsInstall
                ? "To get alerts on iPhone: tap Share → Add to Home Screen, then open the app from there."
                : notif === "denied"
                  ? "Notifications are off. Turn them on in Settings → this app → Notifications, then tap below."
                  : "Get an alert whenever Ajju records an entry or hands over cash."}
            </span>
            {!iosNeedsInstall && (
              <button className="btn primary sm" onClick={enableNotifications}>
                {notif === "denied" ? "Try again" : "Turn on notifications"}
              </button>
            )}
          </div>
        );
      })()}

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
          <p className="note" style={{ marginTop: -6 }}>Tap a day to see every transaction in it.</p>
          {sessions.map((s) => {
            const open = openSes === s.id;
            const entries = open
              ? sessionEntries(s.id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
              : [];
            return (
              <div className="panel-card" key={s.id}>
                <div
                  className="pc-head"
                  style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, cursor: "pointer" }}
                  onClick={() => setOpenSes(open ? null : s.id)}
                >
                  <span>
                    <span className="um-caret" style={{ marginRight: 6 }}>{open ? "▾" : "▸"}</span>
                    {s.date} · Given ₹{inr(s.given)} to Afsar
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 0, textTransform: "none" }}>
                    In ₹{inr(s.totalIn)} · Spent ₹{inr(s.spent)} · {s.count} entries · by {userName(s.by)}
                  </span>
                </div>
                {open && (
                  <>
                    <div className="dash-grid g3" style={{ margin: "10px 14px" }}>
                      <div className="stat">
                        <div className="k">Money In</div>
                        <div className="v money">₹ {inr(s.totalIn)}</div>
                        <div className="sub">Cash ₹{inr(s.cashIn)} · UPI ₹{inr(s.upiIn)}</div>
                      </div>
                      <div className="stat">
                        <div className="k">Spent</div>
                        <div className="v" style={{ color: "var(--danger)" }}>₹ {inr(s.spent)}</div>
                      </div>
                      <div className="stat">
                        <div className="k">Given to Afsar</div>
                        <div className="v" style={{ color: "var(--green)" }}>₹ {inr(s.given)}</div>
                      </div>
                    </div>
                    {entries.map((e) => (
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
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
