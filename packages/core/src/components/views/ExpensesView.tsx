"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { allRec, delRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { addExpense, allExpenses, allSessions, confirmHandover, dayTotals, declineHandover, deleteSession, inDaybook, isInflow, isUpi, requestHandover, spendCategoryOf, SPEND_CATEGORIES, upiAccounts } from "@/lib/expenses";
import { markExpensesSeen, requestNotifyPermission } from "@/lib/notify";
import { isIOS, isStandalone } from "@/lib/pwa";
import { USERS } from "@/lib/local-auth";
import AccountPicker from "@/components/AccountPicker";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import type { DaybookSession, Doc, Expense, PayMode } from "@/lib/types";

const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id;

export default function ExpensesView() {
  const { dataVersion, user } = useApp();
  const isOwner = user?.role === "owner"; // Owner: reviews + can delete entries; Manager: enters only, cannot delete
  const [all, setAll] = useState<Expense[]>([]);
  const [sessions, setSessions] = useState<DaybookSession[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]); // for the customer name + phone on each statement
  const [openSes, setOpenSes] = useState<string | null>(null);
  const [notif, setNotif] = useState(""); // "" until client checks; then default/granted/denied

  // inline quick-entry form state
  const [flow, setFlow] = useState<"in" | "out">("in");
  const [spendCat, setSpendCat] = useState(SPEND_CATEGORIES[0].id);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayMode>("cash");
  const [note, setNote] = useState("");
  const [acct, setAcct] = useState(""); // UPI recipient for a manual UPI entry
  const [upiAccts, setUpiAccts] = useState<string[]>([]);
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
    upiAccounts().then(setUpiAccts);
    allRec<Doc>("quotations").then(setQuotes);
  }, []);
  // quote id → { name, phone } so each statement can show the customer + their phone
  const partyBySource = new Map(quotes.map((q) => [q.id, { name: q.customerName || "", phone: q.phone || "" }]));
  // cash daybook (current open session) = non-UPI entries not yet archived
  const list = all.filter((e) => !e.sessionId && inDaybook(e));
  // "Statements" = every payment a customer made — all UPI receipts + cash accepted against a quote.
  // A running log of who took what, kept even after cash is handed over (UPI never enters handover).
  const recvList = all.filter((e) => isUpi(e) || (e.type === "sale" && e.mode === "cash" && (!!e.sourceId || !!e.custId)));
  const recvTotal = Math.round(recvList.reduce((s, e) => s + (+e.amount || 0), 0) * 100) / 100;
  // a handover awaiting the owner's confirmation (blocks a new one) vs finalised sessions (history)
  const pending = sessions.find((s) => s.pending) || null;
  const closed = sessions.filter((s) => !s.pending); // already newest-first
  // A closed session owns every entry recorded in its window (previous close, this close].
  // UPI receipts are never sessionId-tagged (they stay out of the cash handover), so we bound by
  // time instead — that keeps them in the right day's history without mis-tagging older entries.
  // ponytail: linear scan per open session; fine at this scale (a handful of sessions).
  const sesAsc = [...closed].sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || ""));
  const sessionEntries = (id: string) => {
    const i = sesAsc.findIndex((s) => s.id === id);
    if (i < 0) return [] as Expense[];
    const from = i > 0 ? sesAsc[i - 1].closedAt || "" : "";
    const to = sesAsc[i].closedAt || "";
    return all.filter((e) => {
      const at = e.createdAt || "";
      return !!at && at <= to && (!from || at > from);
    });
  };
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
    if (flow === "in") {
      const upiEntry = mode === "upi";
      if (upiEntry && !acct.trim()) return toast("Enter the UPI account (to whom)");
      await addExpense({
        type: "sale",
        amount: amt,
        mode,
        note,
        account: acct,
        enteredBy: user?.id || "unknown",
      });
      setAmount("");
      setNote("");
      setAcct("");
      if (upiEntry && !upiAccts.includes(acct.trim())) setUpiAccts((a) => [...a, acct.trim()].sort());
      amountRef.current?.focus();
      bumpData();
      return toast(upiEntry ? "UPI entry added" : "Entry added");
    }
    const cat = SPEND_CATEGORIES.find((c) => c.id === spendCat) || SPEND_CATEGORIES[SPEND_CATEGORIES.length - 1];
    await addExpense({
      type: cat.type,
      amount: amt,
      mode: "cash",
      note,
      label: cat.label,
      enteredBy: user?.id || "unknown",
    });
    setAmount("");
    setNote("");
    amountRef.current?.focus();
    bumpData();
    toast(cat.label + " · ₹" + inr(amt) + " added");
  }

  async function remove(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete entry?",
      message: `${spendCategoryOf(e)} — ₹${inr(e.amount)}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id); // soft delete in the database — never resurrects
    load();
    bumpData();
  }

  async function handOver() {
    const res = await formDialog({
      title: "Hand over to Owner",
      message: `In hand ₹${inr(inHand)}. Enter how much you're giving — the Owner confirms it, then it closes. The rest carries to the next session.`,
      fields: [
        {
          name: "given",
          label: "Giving to Owner (₹)",
          type: "number",
          inputMode: "decimal",
          value: String(inHand),
          placeholder: "0",
        },
      ],
      submitLabel: "Send to Owner",
    });
    if (res === null) return;
    const give = Math.max(0, Math.min(inHand, +res.given || 0));
    const s = await requestHandover(user?.id || "unknown", give);
    if (!s) return toast("Nothing to hand over");
    load();
    bumpData();
    toast("₹" + inr(s.given) + " sent to Owner — waiting for confirmation");
  }

  async function onConfirm(s: DaybookSession) {
    const ok = await confirmDialog({
      title: "Confirm you received the cash?",
      message: `${userName(s.by)} handed over ₹${inr(s.given)}${(s.carried || 0) > 0 ? " (₹" + inr(s.carried || 0) + " kept back)" : ""}. Confirming closes the session.`,
      confirmLabel: "Yes, received",
    });
    if (!ok) return;
    await confirmHandover(s.id, user?.id || "unknown");
    load();
    bumpData();
    toast("Handover confirmed · ₹" + inr(s.given) + " received");
  }

  async function onDeleteSession(s: DaybookSession) {
    const ok = await confirmDialog({
      title: "Delete this session record?",
      message: `${s.date} — removes the handover record and all ${s.count} ${s.count === 1 ? "entry" : "entries"} archived in it. This can't be undone.`,
      confirmLabel: "Delete session",
      danger: true,
    });
    if (!ok) return;
    await deleteSession(s.id);
    if (openSes === s.id) setOpenSes(null);
    load();
    bumpData();
    toast("Session record deleted");
  }

  async function onDecline(s: DaybookSession) {
    const ok = await confirmDialog({
      title: isOwner ? "Decline this handover?" : "Cancel this handover?",
      message: `₹${inr(s.given)} — nothing has been archived yet. The session stays open.`,
      confirmLabel: isOwner ? "Decline" : "Cancel request",
      danger: true,
    });
    if (!ok) return;
    await declineHandover(s.id);
    load();
    bumpData();
    toast(isOwner ? "Handover declined" : "Request cancelled");
  }

  const t = dayTotals(list);
  // cash carried in from the last confirmed close = this session's opening balance
  const carryIn = Math.round((closed[0]?.carried || 0) * 100) / 100;
  const inHand = Math.round((carryIn + t.net) * 100) / 100;

  // ---- current session as a DAY-WISE STATEMENT ----
  // dd-mm-yy → sortable key; each day gets received/paid subtotals and a RUNNING
  // cash-in-hand balance (opening carry + every day so far), like a bank statement.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const dkey = (d: string) => {
    const [dd, mm, yy] = (d || "").split("-");
    return dd && mm && yy ? `20${yy}${mm}${dd}` : "";
  };
  const weekday = (d: string) => {
    const [dd, mm, yy] = (d || "").split("-");
    const dt = new Date(2000 + +yy, +mm - 1, +dd);
    return isNaN(+dt) ? "" : dt.toLocaleDateString("en-GB", { weekday: "long" });
  };
  const dayGroups = (() => {
    const map = new Map<string, Expense[]>();
    for (const e of list) {
      const arr = map.get(e.date) || [];
      arr.push(e);
      map.set(e.date, arr);
    }
    const asc = [...map.entries()].sort((a, b) => dkey(a[0]).localeCompare(dkey(b[0])));
    type SLine = { e: Expense; cin: number; cout: number; bal: number };
    type DayGroup = { date: string; lines: SLine[]; recv: number; paid: number; bal: number };
    const { rows } = asc.reduce<{ rows: DayGroup[]; bal: number }>(
      (acc, [date, entries]) => {
        // statement lines in the order the money moved (oldest first), each carrying
        // the cash balance AFTER it — then flipped so the newest shows on top
        const ordered = [...entries].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
        const { lines, bal } = ordered.reduce<{ lines: SLine[]; bal: number }>(
          (ai, e) => {
            const cin = isInflow(e.type) ? r2(+e.amount || 0) : 0;
            const cout = isInflow(e.type) ? 0 : r2(+e.amount || 0);
            const nb = r2(ai.bal + cin - cout);
            return { bal: nb, lines: [...ai.lines, { e, cin, cout, bal: nb }] };
          },
          { lines: [], bal: acc.bal },
        );
        const recv = r2(lines.reduce((s, l) => s + l.cin, 0));
        const paid = r2(lines.reduce((s, l) => s + l.cout, 0));
        return { bal, rows: [...acc.rows, { date, lines: [...lines].reverse(), recv, paid, bal }] };
      },
      { rows: [], bal: carryIn },
    );
    return rows.reverse(); // newest day first on screen
  })();

  return (
    <div>
      <div className="sectitle">
        Daybook <small>— current session</small>
      </div>

      {carryIn > 0 && (
        <div className="carry-bar">
          <span>↩ Carried over from last session</span>
          <b>₹ {inr(carryIn)}</b>
        </div>
      )}

      {pending && (
        <div className="panel-card" style={{ marginTop: 12, borderColor: "var(--ochre)" }}>
          <div className="pc-head" style={{ justifyContent: "space-between" }}>
            <span>{isOwner ? "⏳ Handover to confirm" : "⏳ Awaiting Owner confirmation"}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
              by {userName(pending.by)} · {pending.date}
            </span>
          </div>
          <div className="ses-trail">
            <div className="ses-trow">
              <span>Giving to Owner</span>
              <b style={{ color: "var(--green)" }}>₹ {inr(pending.given)}</b>
            </div>
            {(pending.carried || 0) > 0 && (
              <div className="ses-trow">
                <span>Kept back (carries over)</span>
                <b style={{ color: "var(--ochre-deep)" }}>₹ {inr(pending.carried || 0)}</b>
              </div>
            )}
          </div>
          <div className="rowbtns" style={{ padding: "10px 14px 14px", gap: 8 }}>
            {isOwner ? (
              <>
                <button className="btn primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => onConfirm(pending)}>
                  Confirm received
                </button>
                <button className="btn" style={{ justifyContent: "center" }} onClick={() => onDecline(pending)}>
                  Decline
                </button>
              </>
            ) : (
              <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => onDecline(pending)}>
                Cancel request
              </button>
            )}
          </div>
        </div>
      )}

      {isOwner && notif && notif !== "granted" && (() => {
        const iosNeedsInstall = isIOS() && !isStandalone();
        return (
          <div className="panel-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              🔔 {iosNeedsInstall
                ? "To get alerts on iPhone: tap Share → Add to Home Screen, then open the app from there."
                : notif === "denied"
                  ? "Notifications are off. Turn them on in Settings → this app → Notifications, then tap below."
                  : "Get an alert whenever the Manager records an entry or hands over cash."}
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
        <form className="panel-card db-entry" onSubmit={add}>
          <div className="db-seg">
            <button type="button" className={"seg-btn" + (flow === "in" ? " on in" : "")} onClick={() => setFlow("in")}>Money In</button>
            <button type="button" className={"seg-btn" + (flow === "out" ? " on out" : "")} onClick={() => setFlow("out")}>Money Out</button>
          </div>
          <label className="db-amt">
            <span>Amount ₹</span>
            <input ref={amountRef} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
          </label>
          {flow === "in" ? (
            <>
              <div className="db-seg sm">
                <button type="button" className={"seg-btn" + (mode === "cash" ? " on" : "")} onClick={() => setMode("cash")}>Cash</button>
                <button type="button" className={"seg-btn" + (mode === "upi" ? " on" : "")} onClick={() => setMode("upi")}>UPI</button>
              </div>
              {mode === "upi" && (
                <div className="acct-field">
                  <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>UPI to which account?</span>
                  <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
                </div>
              )}
              {mode === "cash" && (
                <div className="acct-field">
                  <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>
                    Cash held by which account? <small style={{ fontWeight: 500 }}>(optional)</small>
                  </span>
                  <AccountPicker value={acct} onChange={setAcct} accounts={upiAccts} />
                </div>
              )}
            </>
          ) : (
            <label className="db-cat">
              <span>Category</span>
              <select value={spendCat} onChange={(ev) => setSpendCat(ev.target.value)}>
                {SPEND_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="db-note">
            <span>Note</span>
            <input
              placeholder={flow === "out" ? "e.g. lunch for yard · truck #KA…" : "e.g. teak planks…"}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          </label>
          <button className="btn primary db-add" type="submit">Add entry</button>
        </form>
      )}

      <div className="dash-grid" style={{ marginTop: 8 }}>
        <div className="stat">
          <div className="k">Cash In</div>
          <div className="v money">₹ {inr(t.cashIn)}</div>
          <div className="sub">UPI tracked separately below</div>
        </div>
        <div className="stat">
          <div className="k">Spent</div>
          <div className="v" style={{ color: "var(--danger)" }}>₹ {inr(t.spent)}</div>
        </div>
        <div className="stat">
          <div className="k">In hand (to give)</div>
          <div className="v" style={{ color: inHand < 0 ? "var(--danger)" : "var(--green)" }}>₹ {inr(inHand)}</div>
          {carryIn > 0 && <div className="sub">incl ₹{inr(carryIn)} carried over</div>}
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
            <div className="empty-note">Record sales (cash / UPI) and costs. When you hand cash to the Owner, close the session below.</div>
          </div>
        </div>
      ) : (
        <div className="panel-card" style={{ marginTop: 16 }}>
          <div className="pc-head" style={{ justifyContent: "space-between" }}>
            <span>Current session · {list.length} entries</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
              day-wise statement · running balance
            </span>
          </div>
          {/* statement column headers */}
          <div className="db-srow db-shead">
            <span />
            <span>Entry</span>
            <span className="amt">Cash in ₹</span>
            <span className="amt">Cash out ₹</span>
            <span className="amt">Balance ₹</span>
            {isOwner && <span />}
          </div>
          {carryIn > 0 && (
            <div className="db-day-sum db-carry">
              <span>↩ Opening (carried from last session)</span>
              <b>₹ {inr(carryIn)}</b>
            </div>
          )}
          {dayGroups.map((g) => (
            <div className="db-day" key={g.date}>
              <div className="db-day-head">
                <span className="db-day-date">
                  {g.date} <small>· {weekday(g.date)}</small>
                </span>
                <span className="db-day-mini">{g.lines.length} entr{g.lines.length === 1 ? "y" : "ies"}</span>
              </div>
              {g.lines.map(({ e, cin, cout, bal }) => (
                <div className="db-srow" key={e.id}>
                  <span className={"exptag " + (cin > 0 ? "in" : "out")}>{spendCategoryOf(e).split(" ")[0]}</span>
                  <span className="expnote">
                    {e.note || spendCategoryOf(e)}
                    <small>
                      {userName(e.enteredBy)}
                      {cin > 0 && e.mode ? " · " + e.mode.toUpperCase() : ""}
                    </small>
                  </span>
                  <span className="amt in">{cin > 0 ? inr(cin) : "—"}</span>
                  <span className="amt out">{cout > 0 ? inr(cout) : "—"}</span>
                  <span className={"amt bal" + (bal < 0 ? " out" : "")}>{inr(bal)}</span>
                  {isOwner && (
                    <button className="x-row" title="Delete" onClick={() => remove(e)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {/* day close line: subtotals + the cash balance AFTER this day */}
              <div className="db-day-sum">
                <span className="in">In ₹{inr(g.recv)}</span>
                <span className="out">Out ₹{inr(g.paid)}</span>
                <span className={g.recv - g.paid < 0 ? "out" : "in"}>
                  Day {g.recv - g.paid < 0 ? "−" : "+"}₹{inr(Math.abs(r2(g.recv - g.paid)))}
                </span>
                <b className={g.bal < 0 ? "out" : ""}>Balance ₹{inr(g.bal)}</b>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isOwner && !pending && (list.length > 0 || carryIn > 0) && (
        <div className="rowbtns" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={handOver} style={{ width: "100%", justifyContent: "center", padding: "13px" }}>
            Hand over to Owner · ₹{inr(inHand)} in hand
          </button>
        </div>
      )}

      {recvList.length > 0 && (
        <>
          <div className="sectitle" style={{ marginTop: 28, fontSize: 22 }}>
            Statements <small>— ₹{inr(recvTotal)} received · {recvList.length}</small>
          </div>
          <p className="note" style={{ marginTop: -6 }}>
            Every payment a customer made — cash &amp; UPI — and who took it. (UPI stays out of the Manager&apos;s cash handover.)
          </p>
          <div className="panel-card">
            <div className="pc-head" style={{ justifyContent: "space-between" }}>
              <span>Customer · Phone · Date</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                Total ₹{inr(recvTotal)}
              </span>
            </div>
            {recvList.map((e) => {
              const party = e.sourceId ? partyBySource.get(e.sourceId) : undefined;
              const phone = party?.phone || "";
              return (
                <div className="exprow" key={e.id}>
                  <span className="exptag in">{e.mode === "upi" ? "UPI" : "Cash"}</span>
                  <span className="expnote">
                    {e.note || (e.mode === "upi" ? e.account || "UPI" : "Cash in hand")}
                    <small>
                      {phone ? "📞 " + phone + " · " : ""}
                      {e.date}
                      {e.mode === "upi" && e.account ? " · " + e.account : ""} · by {userName(e.enteredBy)}
                    </small>
                  </span>
                  <span className="expamt in">+₹ {inr(e.amount)}</span>
                  {isOwner && !e.sessionId && (
                    <button className="x-row" title="Delete" onClick={() => remove(e)}>
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {closed.length > 0 && (
        <>
          <div className="sectitle" style={{ marginTop: 28, fontSize: 22 }}>
            Session history <small>— {closed.length}</small>
          </div>
          <p className="note" style={{ marginTop: -6 }}>Tap a day to see every transaction in it.</p>
          {closed.map((s) => {
            const open = openSes === s.id;
            const entries = open
              ? sessionEntries(s.id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
              : [];
            const opening = s.opening || 0;
            const carried = s.carried || 0;
            // the full money trail for this closed day
            const trail: { k: string; v: number; c: string; sub?: string }[] = [];
            if (opening > 0) trail.push({ k: "Carried in", v: opening, c: "var(--ochre-deep)" });
            trail.push({
              k: "Money In",
              v: s.totalIn,
              c: "var(--ochre-deep)",
              sub: "Cash ₹" + inr(s.cashIn) + (s.upiIn > 0 ? " · UPI ₹" + inr(s.upiIn) : ""),
            });
            trail.push({ k: "Spent", v: s.spent, c: "var(--danger)" });
            trail.push({ k: "Given to Owner", v: s.given, c: "var(--green)" });
            if (carried > 0) trail.push({ k: "Carried to next session", v: carried, c: "var(--ochre-deep)" });
            return (
              <div className="panel-card" key={s.id}>
                <div
                  className="pc-head"
                  style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, cursor: "pointer" }}
                  onClick={() => setOpenSes(open ? null : s.id)}
                >
                  <span>
                    <span className="um-caret" style={{ marginRight: 6 }}>{open ? "▾" : "▸"}</span>
                    {s.date} · Given ₹{inr(s.given)}
                    {carried > 0 ? " · ₹" + inr(carried) + " carried" : ""}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 0, textTransform: "none" }}>
                    In ₹{inr(s.totalIn)} · Spent ₹{inr(s.spent)} · {s.count} entries · by {userName(s.by)}
                    {isOwner && (
                      <button
                        className="x-row"
                        title="Delete this day's record"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onDeleteSession(s);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                </div>
                {open && (
                  <>
                    <div className="ses-trail">
                      {trail.map((r) => (
                        <div className="ses-trow" key={r.k}>
                          <span>
                            {r.k}
                            {r.sub && <small>{r.sub}</small>}
                          </span>
                          <b style={{ color: r.c }}>₹ {inr(r.v)}</b>
                        </div>
                      ))}
                    </div>
                    {entries.length > 0 && <div className="pbd-lbl">Every transaction · {entries.length}</div>}
                    {entries.map((e) => (
                      <div className="exprow" key={e.id}>
                        <span className={"exptag " + (isInflow(e.type) ? "in" : "out")}>{spendCategoryOf(e).split(" ")[0]}</span>
                        <span className="expnote">
                          {e.note || spendCategoryOf(e)}
                          <small>
                            {e.date} · {userName(e.enteredBy)}
                            {isInflow(e.type) && e.mode ? " · " + e.mode.toUpperCase() : ""}
                          </small>
                        </span>
                        <span className={"expamt " + (isInflow(e.type) ? "in" : "out")}>
                          {isInflow(e.type) ? "+" : "−"}₹ {inr(e.amount)}
                        </span>
                        {isOwner && (
                          <button className="x-row" title="Delete" onClick={() => remove(e)}>
                            ×
                          </button>
                        )}
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
