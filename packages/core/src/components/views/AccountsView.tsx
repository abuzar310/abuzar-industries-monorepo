"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import {
  acctLedger,
  addCollection,
  addPayAccount,
  deleteAccountEntry,
  deleteCollection,
  listCollections,
  listPayAccounts,
  removePayAccount,
  type AccountCollection,
  type AcctBalance,
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
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function AccountsView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collections, setCollections] = useState<AccountCollection[]>([]);
  const [registry, setRegistry] = useState<PayAccount[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [cAmt, setCAmt] = useState("");
  const [cDate, setCDate] = useState("");
  const [cNote, setCNote] = useState("");
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      allRec<Doc>("quotations"),
      allRec<Expense>("expenses"),
      allRec<Customer>("customers"),
      listCollections(),
      listPayAccounts(),
    ]).then(([qs, es, cs, cols, reg]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
      setCollections(cols);
      setRegistry(reg);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const ledger = acctLedger(expenses, collections, quotes, customers);
  // show every named account, even ones with no activity yet
  const known = new Set(ledger.accounts.map((a) => a.name));
  const empties: AcctBalance[] = registry
    .filter((r) => !known.has(r.name))
    .map((r) => ({ name: r.name, received: 0, ownerReceived: 0, collected: 0, balance: 0, lines: [] }));
  const accounts = [...ledger.accounts, ...empties];

  function startCollect(name: string, balance: number) {
    setCollectFor(name);
    setCAmt(balance > 0 ? String(r2(balance)) : "");
    setCDate("");
    setCNote("");
    setOpen(name);
  }
  function cancelCollect() {
    setCollectFor(null);
    setCAmt("");
    setCDate("");
    setCNote("");
  }
  async function submitCollect(name: string, maxBal: number) {
    const a = Math.max(0, +cAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (a > maxBal + 0.5) return toast("That's more than the balance (₹" + inr(maxBal) + ")");
    const c = await addCollection({ account: name, amount: a, date: cDate ? toDmy(cDate) : undefined, by: user?.id || "unknown", note: cNote.trim() });
    if (!c) return toast("Could not record");
    cancelCollect();
    load();
    bumpData();
    toast("₹" + inr(a) + " collected from " + name + " ✓");
  }
  async function delCollection(id: string) {
    const ok = await confirmDialog({
      title: "Delete this collection?",
      message: "Removes this hand-over record — the amount goes back into the account balance.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteCollection(id);
    load();
    bumpData();
    toast("Collection removed");
  }
  async function delEntry(id: string, quoteNo?: string) {
    const ok = await confirmDialog({
      title: "Delete this UPI payment?",
      message:
        "Removes it from this account" +
        (quoteNo ? " and takes ₹ back off quotation #" + quoteNo + "'s paid total" : "") +
        ". Re-enter it if it was miscategorised.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteAccountEntry(id);
    load();
    bumpData();
    toast("Payment removed");
  }

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
  async function removeAccount(id: string, name: string) {
    await removePayAccount(id);
    load();
    bumpData();
    toast("Removed “" + name + "” from saved names");
  }

  return (
    <div>
      <div className="sectitle">
        Accounts <small>— UPI accounts &amp; hand-overs</small>
      </div>

      {/* overall */}
      <div className="panel-card acct-overall">
        <div className="acct-overall-h">Overall</div>
        <div className="acct-overall-grid">
          <div className="acct-stat">
            <span className="k">To collect</span>
            <span className={"v" + (ledger.totalBalance <= 0.5 ? " ok" : " due")}>₹ {inr(ledger.totalBalance)}</span>
            <span className="sub">still in accounts</span>
          </div>
          <div className="acct-stat">
            <span className="k">Received (UPI)</span>
            <span className="v">₹ {inr(ledger.totalReceived)}</span>
            <span className="sub">{ledger.totalOwner > 0.5 ? "+ ₹" + inr(ledger.totalOwner) + " to owner" : "collectable"}</span>
          </div>
          <div className="acct-stat">
            <span className="k">Collected</span>
            <span className="v ok">₹ {inr(ledger.totalCollected)}</span>
            <span className="sub">handed over</span>
          </div>
        </div>
      </div>

      <div className="acct-day-label">
        <span>Accounts · {accounts.length}</span>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Done" : "+ Account"}
        </button>
      </div>

      {showAdd && (
        <div className="panel-card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="acct-add-row">
            <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
              <span>New account name</span>
              <input
                type="text"
                placeholder="e.g. Tabrez GPay"
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
                  <button type="button" className="acct-rm" title="Remove name" onClick={() => removeAccount(r.id, r.name)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {accounts.length ? (
        accounts.map((a) => {
          const isOpen = open === a.name;
          const due = a.balance > 0.5;
          const collecting = collectFor === a.name;
          return (
            <div className={"panel-card" + (!due && a.received > 0 ? " acct-done" : "")} key={a.name}>
              <div className="pc-head acct-head">
                <span style={{ cursor: "pointer", flex: 1 }} onClick={() => setOpen(isOpen ? null : a.name)}>
                  <span className="um-caret" style={{ marginRight: 6 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  {a.name}
                  {!due && a.received > 0 && <span className="acct-collected-badge">Cleared ✓</span>}
                </span>
                <span className="acct-head-totals">
                  {a.received > 0 && <span className="acct-tag upi">In ₹{inr(a.received)}</span>}
                  {a.ownerReceived > 0 && <span className="acct-tag">Owner ₹{inr(a.ownerReceived)}</span>}
                  {due ? (
                    <span className="acct-tag pending">Bal ₹{inr(a.balance)}</span>
                  ) : (
                    a.collected > 0 && <span className="acct-tag ok">₹{inr(a.collected)}</span>
                  )}
                </span>
                {due && !collecting && (
                  <button className="btn primary sm acct-collect-btn" type="button" onClick={() => startCollect(a.name, a.balance)}>
                    Collect
                  </button>
                )}
              </div>

              {collecting && (
                <div className="panel-card" style={{ padding: 12, margin: "0 0 4px" }}>
                  <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                    <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                      <span>Collect ₹ <small style={{ color: "var(--ink-faint)" }}>(bal ₹{inr(a.balance)})</small></span>
                      <input type="number" inputMode="decimal" placeholder={inr(a.balance)} value={cAmt} onChange={(e) => setCAmt(e.target.value)} autoFocus />
                    </label>
                    <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                      <span>Date (optional)</span>
                      <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
                    </label>
                    <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                      <span>Note (optional)</span>
                      <input type="text" placeholder="e.g. handed to Afsar" value={cNote} onChange={(e) => setCNote(e.target.value)} />
                    </label>
                  </div>
                  <div className="rowbtns" style={{ marginTop: 10 }}>
                    <button className="btn primary sm" type="button" onClick={() => submitCollect(a.name, a.balance)}>
                      Record collection
                    </button>
                    <button className="btn sm" type="button" onClick={cancelCollect}>
                      Cancel
                    </button>
                    {a.balance > 0.5 && (
                      <button className="btn sm" type="button" onClick={() => setCAmt(String(r2(a.balance)))}>
                        Full ₹{inr(a.balance)}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isOpen &&
                (a.lines.length ? (
                  a.lines.map((l) =>
                    l.kind === "collect" ? (
                      <div className="stmt acct-stmt-done" key={l.id}>
                        <div className="stmt-ic ok">↑</div>
                        <div className="stmt-main">
                          <div className="stmt-to">Collected / handed over{l.note ? " · " + l.note : ""}</div>
                          <div className="stmt-sub">
                            {l.date}
                            {hhmm(l.at) ? " · " + hhmm(l.at) : ""} · by {userName(l.by)}
                          </div>
                        </div>
                        <div className="stmt-amt" style={{ color: "var(--green)" }}>−₹{inr(l.amount)}</div>
                        <span className="pb-rowacts">
                          <button className="pb-x" title="Delete collection" onClick={() => delCollection(l.id)}>
                            ×
                          </button>
                        </span>
                      </div>
                    ) : (
                      <div className={"stmt" + (l.toOwner || l.legacyCollected ? " acct-stmt-done" : "")} key={l.id}>
                        <div className="stmt-ic upi">UPI</div>
                        <div
                          className="stmt-main"
                          style={{ cursor: l.quoteNo ? "pointer" : "default" }}
                          onClick={() => l.quoteNo && router.push("/editor/" + (quotes.find((d) => d.number === l.quoteNo)?.id || ""))}
                        >
                          <div className="stmt-to">
                            {l.customer}
                            {l.quoteNo ? " · #" + l.quoteNo : ""}
                            {l.toOwner && <span className="acct-overall-hint"> · to owner</span>}
                            {l.legacyCollected && <span className="acct-collected-badge sm"> ✓</span>}
                          </div>
                          <div className="stmt-sub">
                            UPI · {l.date}
                            {hhmm(l.at) ? " · " + hhmm(l.at) : ""} · by {userName(l.by)}
                          </div>
                        </div>
                        <div className="stmt-amt">+₹{inr(l.amount)}</div>
                        <span className="pb-rowacts">
                          <button className="pb-x" title="Delete this payment" onClick={() => delEntry(l.id, l.quoteNo)}>
                            ×
                          </button>
                        </span>
                      </div>
                    ),
                  )
                ) : (
                  <div className="stmt-sub" style={{ padding: "8px 12px", opacity: 0.7 }}>No UPI payments to this account yet.</div>
                ))}
            </div>
          );
        })
      ) : (
        <div className="panel-card">
          <div className="empty">
            No UPI accounts yet. Add one above, or record a UPI payment and pick an account.
          </div>
        </div>
      )}
    </div>
  );
}
