"use client";
import { useCallback, useEffect, useState } from "react";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import {
  accountDayLedger,
  accountOverview,
  addPayAccount,
  collectAccountDay,
  listPayAccounts,
  oldestPendingDate,
  payAccounts,
  removePayAccount,
  todayStr,
  type PayAccount,
} from "@/lib/accounts";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const hhmm = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const fromDmy = (v: string) => {
  const [d, m, y] = (v || "").split("-");
  return d && m && y ? `20${y}-${m}-${d}` : "";
};
const shiftIso = (iso: string, days: number) => {
  const d = new Date((iso || fromDmy(todayStr())) + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function AccountsView() {
  const { ready, dataVersion, user } = useApp();
  const today = todayStr();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [registry, setRegistry] = useState<PayAccount[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [pickDate, setPickDate] = useState(fromDmy(today));
  const [showAdd, setShowAdd] = useState(false);

  const viewDate = pickDate ? toDmy(pickDate) : today;
  const isToday = viewDate === today;

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses"), allRec<Customer>("customers")]).then(([qs, es, cs]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
    });
    listPayAccounts().then(setRegistry);
    payAccounts().then(setNames);
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const overview = accountOverview(expenses);
  const day = accountDayLedger(expenses, viewDate, quotes, customers);
  const oldestDue = oldestPendingDate(expenses);
  const allClearDay = day.dayTotal > 0 && day.pendingTotal <= 0.5;
  const dueAccounts = overview.byAccount.filter((a) => a.pending > 0.5);

  const goDate = (dmy: string) => setPickDate(fromDmy(dmy));

  async function addAccount() {
    const n = newName.trim();
    if (!n) return toast("Enter an account name");
    const acct = await addPayAccount(n);
    if (!acct) return toast("That account already exists");
    setNewName("");
    setShowAdd(false);
    load();
    bumpData();
    toast("Account “" + n + "” added");
  }

  async function remove(id: string, name: string) {
    await removePayAccount(id);
    load();
    bumpData();
    toast("Removed “" + name + "” from saved names");
  }

  async function collect(name: string, pending: number) {
    if (pending <= 0) return;
    const ok = await confirmDialog({
      title: "Collect from " + name + "?",
      message: `Mark ₹${inr(pending)} collected on ${viewDate}?`,
      confirmLabel: "Collected ✓",
    });
    if (!ok) return;
    const amt = await collectAccountDay(name, viewDate, user?.id || "unknown");
    if (amt <= 0) return toast("Nothing to collect");
    load();
    bumpData();
    toast("₹" + inr(amt) + " collected from " + name + " ✓");
  }

  async function collectAll() {
    const pending = day.accounts.filter((a) => a.pending > 0.5);
    if (!pending.length) return;
    const ok = await confirmDialog({
      title: "Collect all on " + viewDate + "?",
      message: `Mark ₹${inr(day.pendingTotal)} collected across ${pending.length} account${pending.length === 1 ? "" : "s"}?`,
      confirmLabel: "Collect all",
    });
    if (!ok) return;
    let sum = 0;
    for (const a of pending) sum += await collectAccountDay(a.name, viewDate, user?.id || "unknown");
    load();
    bumpData();
    toast("₹" + inr(sum) + " collected ✓");
  }

  return (
    <div>
      <div className="sectitle">
        Accounts <small>— overall & daily collect</small>
      </div>

      {/* ── OVERALL (all dates) ── */}
      <div className="panel-card acct-overall">
        <div className="acct-overall-h">Overall</div>
        <div className="acct-overall-grid">
          <div className="acct-stat">
            <span className="k">Still to collect</span>
            <span className={"v" + (overview.pendingTotal <= 0.5 ? " ok" : " due")}>₹ {inr(overview.pendingTotal)}</span>
            <span className="sub">across all dates</span>
          </div>
          <div className="acct-stat">
            <span className="k">Total received</span>
            <span className="v">₹ {inr(overview.receivedTotal)}</span>
            <span className="sub">
              UPI ₹{inr(overview.upiTotal)} · Cash ₹{inr(overview.cashTotal)}
            </span>
          </div>
          <div className="acct-stat">
            <span className="k">Already collected</span>
            <span className="v ok">₹ {inr(overview.collectedTotal)}</span>
            <span className="sub">handed over / cleared</span>
          </div>
        </div>
        {dueAccounts.length > 0 && (
          <div className="acct-due-row">
            <span className="lbl">Due by account</span>
            <div className="acct-pick">
              {dueAccounts.map((a) => (
                <button key={a.name} type="button" className="acct-chip" onClick={() => setOpen(a.name)}>
                  {a.name} · ₹{inr(a.pending)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── DATE NAV ── */}
      <div className="panel-card acct-date-nav">
        <div className="acct-date-row">
          <button className="acct-nav-btn" type="button" title="Previous day" onClick={() => setPickDate(shiftIso(pickDate, -1))}>
            ←
          </button>
          <div className="acct-date-center">
            <button className={"seg-btn sm" + (isToday ? " on" : "")} type="button" onClick={() => goDate(today)}>
              Today
            </button>
            <span className="acct-view-date">{viewDate}{isToday ? " · today" : ""}</span>
            <input className="acct-date-input" type="date" value={pickDate} onChange={(e) => setPickDate(e.target.value)} title="Pick a date" />
          </div>
          <button className="acct-nav-btn" type="button" title="Next day" onClick={() => setPickDate(shiftIso(pickDate, 1))}>
            →
          </button>
        </div>

        {overview.dates.length > 0 && (
          <div className="acct-day-strip">
            {overview.dates.slice(0, 14).map((d) => {
              const active = d.date === viewDate;
              const hasDue = d.pending > 0.5;
              return (
                <button
                  key={d.date}
                  type="button"
                  className={"acct-day-chip" + (active ? " on" : "") + (hasDue ? " due" : " ok")}
                  onClick={() => goDate(d.date)}
                >
                  <span className="d">{d.date}</span>
                  {hasDue ? <span className="amt">₹{inr(d.pending)}</span> : <span className="amt ok">✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {oldestDue && oldestDue !== viewDate && overview.pendingTotal > day.pendingTotal + 0.5 && (
          <button type="button" className="acct-jump-overdue" onClick={() => goDate(oldestDue)}>
            ↩ Older uncollected on {oldestDue} — tap to go there
          </button>
        )}
      </div>

      {/* ── THIS DAY ── */}
      <div className="acct-day-label">
        <span>This day · {viewDate}</span>
        {day.pendingTotal > 0.5 && (
          <button className="btn primary sm" type="button" onClick={collectAll}>
            Collect all · ₹{inr(day.pendingTotal)}
          </button>
        )}
        <button className="btn sm" type="button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Done" : "+ Account"}
        </button>
      </div>

      <div className="pay-hero">
        <div className="ph-main">
          <span className="ph-k">{allClearDay ? "This day collected" : "To collect this day"}</span>
          <span className={"ph-v" + (allClearDay ? " ok" : "")}>₹ {inr(day.pendingTotal)}</span>
          <span className="ph-sub">
            ₹{inr(day.dayTotal)} received · {day.accountCount} account{day.accountCount === 1 ? "" : "s"}
            {day.collectedTotal > 0 ? " · ₹" + inr(day.collectedTotal) + " already collected" : ""}
          </span>
        </div>
        <div className="ph-side">
          <div className="ph-tile rec">
            <small>UPI</small>
            <b>₹ {inr(day.accounts.reduce((s, a) => s + a.upiTotal, 0))}</b>
          </div>
          <div className="ph-tile">
            <small>Cash</small>
            <b>₹ {inr(day.accounts.reduce((s, a) => s + a.cashTotal, 0))}</b>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="panel-card" style={{ padding: 14, marginTop: 12 }}>
          <div className="acct-add-row">
            <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
              <span>New account name</span>
              <input
                type="text"
                placeholder="e.g. Tabrez · Current A"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAccount()}
              />
            </label>
            <button className="btn primary" type="button" onClick={addAccount} style={{ alignSelf: "flex-end" }}>
              Add
            </button>
          </div>
          {registry.length > 0 && (
            <div className="acct-pick" style={{ marginTop: 10 }}>
              {registry.map((r) => (
                <span key={r.id} className="acct-chip on" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {r.name}
                  <button type="button" className="acct-rm" title="Remove" onClick={() => remove(r.id, r.name)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {day.accounts.length ? (
        day.accounts.map((a) => {
          const isOpen = open === a.name;
          const done = a.pending <= 0.5 && a.total > 0;
          const overallDue = dueAccounts.find((x) => x.name === a.name)?.pending || 0;
          return (
            <div className={"panel-card" + (done ? " acct-done" : "")} key={a.name}>
              <div className="pc-head acct-head">
                <span style={{ cursor: "pointer", flex: 1 }} onClick={() => setOpen(isOpen ? null : a.name)}>
                  <span className="um-caret" style={{ marginRight: 6 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  {a.name}
                  {done && <span className="acct-collected-badge">Collected ✓</span>}
                  {overallDue > a.pending + 0.5 && (
                    <span className="acct-overall-hint" title="Total still due across all dates">
                      · ₹{inr(overallDue)} overall due
                    </span>
                  )}
                </span>
                <span className="acct-head-totals">
                  {a.upiTotal > 0 && <span className="acct-tag upi">UPI ₹{inr(a.upiTotal)}</span>}
                  {a.cashTotal > 0 && <span className="acct-tag cash">Cash ₹{inr(a.cashTotal)}</span>}
                  {a.pending > 0.5 ? (
                    <span className="acct-tag pending">Due ₹{inr(a.pending)}</span>
                  ) : (
                    a.collected > 0 && <span className="acct-tag ok">₹{inr(a.collected)}</span>
                  )}
                </span>
                {a.pending > 0.5 && (
                  <button className="btn primary sm acct-collect-btn" type="button" onClick={() => collect(a.name, a.pending)}>
                    Collect ₹{inr(a.pending)}
                  </button>
                )}
              </div>
              {isOpen &&
                a.entries.map((e) => (
                  <div className={"stmt" + (e.collected ? " acct-stmt-done" : "")} key={e.id}>
                    <div className={"stmt-ic " + (e.mode === "upi" ? "upi" : "cash")}>{e.mode === "upi" ? "UPI" : "₹"}</div>
                    <div className="stmt-main">
                      <div className="stmt-to">
                        {e.customer}
                        {e.quoteNo ? " · #" + e.quoteNo : ""}
                        {e.collected && <span className="acct-collected-badge sm"> ✓</span>}
                      </div>
                      <div className="stmt-sub">
                        {e.mode === "upi" ? "UPI" : "Cash"} · {e.date}
                        {hhmm(e.at) ? " · " + hhmm(e.at) : ""} · by {userName(e.by)}
                        {e.collected && e.collectedAt ? " · collected " + hhmm(e.collectedAt) : ""}
                      </div>
                    </div>
                    <div className={"stmt-amt" + (e.collected ? " muted" : "")}>+₹{inr(e.amount)}</div>
                  </div>
                ))}
            </div>
          );
        })
      ) : (
        <div className="panel-card">
          <div className="empty">
            No payments to any account on {viewDate}.
            {overview.dates.length > 0 ? " Pick another day above, or record a payment with an account." : " Record a payment and pick an account."}
          </div>
        </div>
      )}
    </div>
  );
}
