"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { bgPull } from "@/lib/cloud";
import { inr } from "@/lib/calc";
import {
  acctLedger,
  addCollection,
  addHolder,
  addHolderAccount,
  deleteAccountEntry,
  deleteCollection,
  listCollections,
  listHolders,
  listPayAccounts,
  moveEntryAccount,
  removeHolder,
  removeHolderAccount,
  removePayAccount,
  renameHolder,
  type AccountCollection,
  type AcctBalance,
  type AcctStmtLine,
  type PayAccount,
  type PayHolder,
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
const lc = (s: string) => (s || "").trim().toLowerCase();

const emptyBal = (name: string): AcctBalance => ({
  name,
  received: 0,
  ownerReceived: 0,
  collected: 0,
  balance: 0,
  lines: [],
});

export default function AccountsView() {
  const { ready, dataVersion, user } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [collections, setCollections] = useState<AccountCollection[]>([]);
  const [registry, setRegistry] = useState<PayAccount[]>([]);
  const [holders, setHolders] = useState<PayHolder[]>([]);

  // expand state — everything is OPEN by default (we track what's been collapsed), so the whole
  // ledger is visible at a glance without clicking into each holder/account.
  const [collapsedHolders, setCollapsedHolders] = useState<Set<string>>(new Set());
  const [collapsedAccts, setCollapsedAccts] = useState<Set<string>>(new Set());

  // collect form — either a holder (holderId) or an ungrouped account (name)
  const [collectHolder, setCollectHolder] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [cAmt, setCAmt] = useState("");
  const [cDate, setCDate] = useState("");
  const [cNote, setCNote] = useState("");

  // move a payment to another account
  const [moveFor, setMoveFor] = useState<string | null>(null);

  // holder create / edit
  const [showAddHolder, setShowAddHolder] = useState(false);
  const [newHolder, setNewHolder] = useState("");
  const [renameForId, setRenameForId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [addAcctFor, setAddAcctFor] = useState<string | null>(null); // holderId
  const [newAcct, setNewAcct] = useState("");

  const load = useCallback(() => {
    Promise.all([
      allRec<Doc>("quotations"),
      allRec<Expense>("expenses"),
      allRec<Customer>("customers"),
      listCollections(),
      listPayAccounts(),
      listHolders(),
    ]).then(([qs, es, cs, cols, reg, hs]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
      setCollections(cols);
      setRegistry(reg);
      setHolders(hs);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // Accounts is cloud-authoritative: pull the newest cloud state every time the tab
  // opens so what you see here always matches the cloud (never a stale local copy).
  // bgPull → dataChanged → dataVersion bump → load() re-runs with fresh data.
  useEffect(() => {
    if (ready) bgPull();
  }, [ready]);

  const ledger = useMemo(
    () => acctLedger(expenses, collections, quotes, customers),
    [expenses, collections, quotes, customers],
  );

  // every named account, even ones with no activity yet (holder sub-accounts + legacy registry)
  const accounts = useMemo(() => {
    const seen = new Set(ledger.accounts.map((a) => lc(a.name)));
    const empties: AcctBalance[] = [];
    const addEmpty = (name: string) => {
      const k = lc(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      empties.push(emptyBal(name.trim()));
    };
    holders.forEach((h) => h.accounts.forEach(addEmpty));
    registry.forEach((r) => addEmpty(r.name));
    return [...ledger.accounts, ...empties];
  }, [ledger, holders, registry]);

  const byName = useMemo(() => {
    const m = new Map<string, AcctBalance>();
    accounts.forEach((a) => m.set(lc(a.name), a));
    return m;
  }, [accounts]);

  const grouped = useMemo(() => {
    const g = new Set<string>();
    holders.forEach((h) => h.accounts.forEach((n) => g.add(lc(n))));
    return g;
  }, [holders]);

  const ungrouped = useMemo(
    () => accounts.filter((a) => !grouped.has(lc(a.name))),
    [accounts, grouped],
  );

  const allNames = useMemo(() => accounts.map((a) => a.name), [accounts]);

  // Auto-file: any ungrouped account whose name STARTS WITH a holder's name lands under that
  // holder automatically (e.g. "Tabrez GPay" → Tabrez). Names that match no holder stay
  // ungrouped for manual sorting later. Longest holder-name match wins. Self-terminating:
  // once attached the name is no longer ungrouped, so this settles after one pass.
  useEffect(() => {
    if (!ready || !holders.length) return;
    const toAttach = ungrouped
      .map((a) => {
        const h = holders
          .filter((x) => x.name.trim() && lc(a.name).startsWith(lc(x.name)))
          .sort((x, y) => y.name.length - x.name.length)[0];
        return h ? { holderId: h.id, name: a.name } : null;
      })
      .filter((x): x is { holderId: string; name: string } => !!x);
    if (!toAttach.length) return;
    Promise.all(toAttach.map((t) => addHolderAccount(t.holderId, t.name))).then(() => {
      load();
      bumpData();
    });
  }, [ready, ungrouped, holders, load]);

  // holder-level hand-overs (collections keyed by holderId)
  const holderCols = useCallback(
    (id: string) => collections.filter((c) => c.holderId === id),
    [collections],
  );
  const holderColTotal = useMemo(
    () => r2(collections.filter((c) => c.holderId).reduce((s, c) => s + (+c.amount || 0), 0)),
    [collections],
  );

  const holderAccounts = (h: PayHolder) =>
    h.accounts.map((n) => byName.get(lc(n))).filter(Boolean) as AcctBalance[];

  // aggregate a holder: money in across its accounts, minus everything handed over
  const holderView = (h: PayHolder) => {
    const subs = holderAccounts(h);
    const received = r2(subs.reduce((s, a) => s + a.received, 0));
    const owner = r2(subs.reduce((s, a) => s + a.ownerReceived, 0));
    const subCollected = r2(subs.reduce((s, a) => s + a.collected, 0)); // legacy per-entry
    const cols = holderCols(h.id);
    const collected = r2(subCollected + cols.reduce((s, c) => s + (+c.amount || 0), 0));
    const balance = r2(received - collected);
    return { subs, received, owner, collected, balance, cols };
  };

  // overall totals include holder-level hand-overs
  const totalCollected = r2(ledger.totalCollected + holderColTotal);
  const totalBalance = r2(ledger.totalReceived - totalCollected);

  // ── collect flow ──────────────────────────────────────────────────────────
  function startCollect(opts: { holderId?: string; account?: string }, balance: number, openKey: string) {
    setCollectHolder(opts.holderId || null);
    setCollectFor(opts.account || null);
    setCAmt(balance > 0 ? String(r2(balance)) : "");
    setCDate("");
    setCNote("");
    if (opts.account) setCollapsedAccts((s) => { const n = new Set(s); n.delete(openKey); return n; });
  }
  function cancelCollect() {
    setCollectHolder(null);
    setCollectFor(null);
    setCAmt("");
    setCDate("");
    setCNote("");
  }
  async function submitCollect(opts: { holderId?: string; account: string }, maxBal: number) {
    const a = Math.max(0, +cAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (a > maxBal + 0.5) return toast("That's more than the balance (₹" + inr(maxBal) + ")");
    const c = await addCollection({
      account: opts.account,
      holderId: opts.holderId,
      amount: a,
      date: cDate ? toDmy(cDate) : undefined,
      by: user?.id || "unknown",
      note: cNote.trim(),
    });
    if (!c) return toast("Could not record");
    cancelCollect();
    load();
    bumpData();
    toast("₹" + inr(a) + " collected ✓");
  }
  async function delCollection(id: string) {
    const ok = await confirmDialog({
      title: "Delete this collection?",
      message: "Removes this hand-over record — the amount goes back into the balance.",
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
  async function moveEntry(id: string, to: string) {
    const okMove = await moveEntryAccount(id, to);
    setMoveFor(null);
    if (!okMove) return toast("Could not move");
    load();
    bumpData();
    toast("Moved to “" + to + "”");
  }

  // ── holder flow ───────────────────────────────────────────────────────────
  function toggleHolder(id: string) {
    setCollapsedHolders((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function createHolder() {
    const n = newHolder.trim();
    if (!n) return toast("Enter a holder name");
    const h = await addHolder(n);
    if (!h) return toast("That holder already exists");
    setNewHolder("");
    setShowAddHolder(false);
    load();
    bumpData();
    toast("Account holder “" + n + "” added");
  }
  async function submitRename(id: string) {
    const n = renameVal.trim();
    if (!n) return toast("Enter a name");
    const h = await renameHolder(id, n);
    if (!h) return toast("Couldn't rename (name in use?)");
    setRenameForId(null);
    setRenameVal("");
    load();
    bumpData();
  }
  async function delHolder(h: PayHolder) {
    const ok = await confirmDialog({
      title: "Remove “" + h.name + "”?",
      message:
        h.accounts.length > 0
          ? "The " + h.accounts.length + " account" + (h.accounts.length === 1 ? "" : "s") + " and all their payments stay — they just move to Ungrouped."
          : "This holder has no accounts yet.",
      confirmLabel: "Remove holder",
      danger: true,
    });
    if (!ok) return;
    await removeHolder(h.id);
    load();
    bumpData();
    toast("Holder removed");
  }
  async function attachAccount(holderId: string, name: string) {
    const n = name.trim();
    if (!n) return toast("Enter an account name");
    const h = await addHolderAccount(holderId, n);
    if (!h) return toast("Couldn't add account");
    setNewAcct("");
    setAddAcctFor(null);
    load();
    bumpData();
    toast("“" + n + "” added");
  }
  async function detachAccount(holderId: string, name: string) {
    await removeHolderAccount(holderId, name);
    load();
    bumpData();
    toast("“" + name + "” moved to Ungrouped");
  }
  async function removeUngrouped(a: AcctBalance) {
    if (a.received > 0 || a.collected > 0 || a.lines.length > 0) return;
    const reg = registry.find((r) => lc(r.name) === lc(a.name));
    if (!reg) return;
    await removePayAccount(reg.id);
    load();
    bumpData();
    toast("Removed “" + a.name + "”");
  }

  // ── one UPI credit / collection line ──────────────────────────────────────
  function renderLine(l: AcctStmtLine) {
    if (l.kind === "collect") {
      return (
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
      );
    }
    const moving = moveFor === l.id;
    return (
      <div key={l.id}>
        <div className={"stmt" + (l.toOwner || l.legacyCollected ? " acct-stmt-done" : "")}>
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
            <button className="pb-x" title="Move to another account" onClick={() => setMoveFor(moving ? null : l.id)}>
              ⇄
            </button>
            <button className="pb-x" title="Delete this payment" onClick={() => delEntry(l.id, l.quoteNo)}>
              ×
            </button>
          </span>
        </div>
        {moving && (
          <div className="acct-move">
            <span className="acct-move-lbl">Move to:</span>
            <div className="acct-pick" style={{ flex: 1 }}>
              {allNames.map((n) => (
                <button key={n} type="button" className="acct-chip" onClick={() => moveEntry(l.id, n)}>
                  {n}
                </button>
              ))}
              {allNames.length === 0 && <span className="stmt-sub">No other accounts yet.</span>}
            </div>
            <button className="btn sm" type="button" onClick={() => setMoveFor(null)}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  // ── one sub-account (grouped: In + log only; ungrouped: full incl. collect) ─
  function renderAccount(a: AcctBalance, holderId?: string) {
    const isOpen = !collapsedAccts.has(a.name);
    const due = a.balance > 0.5;
    const collecting = collectFor === a.name;
    const cleared = !due && a.received > 0;
    const grouped = !!holderId;
    return (
      <div className={"panel-card acct-sub" + (cleared && !grouped ? " acct-done" : "")} key={a.name}>
        <div className="pc-head acct-head">
          <span style={{ cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => setCollapsedAccts((s) => { const n = new Set(s); isOpen ? n.add(a.name) : n.delete(a.name); return n; })}>
            <span className="um-caret" style={{ marginRight: 6 }}>
              {isOpen ? "▾" : "▸"}
            </span>
            {a.name}
            {cleared && !grouped && <span className="acct-collected-badge">Cleared ✓</span>}
          </span>
          <span className="acct-head-totals">
            {a.received > 0 && <span className="acct-tag upi">In ₹{inr(a.received)}</span>}
            {a.ownerReceived > 0 && <span className="acct-tag">Owner ₹{inr(a.ownerReceived)}</span>}
            {!grouped &&
              (due ? (
                <span className="acct-tag pending">Bal ₹{inr(a.balance)}</span>
              ) : (
                a.collected > 0 && <span className="acct-tag ok">₹{inr(a.collected)}</span>
              ))}
          </span>
          {!grouped && due && !collecting && (
            <button className="btn primary sm acct-collect-btn" type="button" onClick={() => startCollect({ account: a.name }, a.balance, a.name)}>
              Collect
            </button>
          )}
          {grouped ? (
            <button className="pb-x" title="Move to Ungrouped" onClick={() => detachAccount(holderId, a.name)}>
              ×
            </button>
          ) : (
            a.received === 0 && a.collected === 0 && a.lines.length === 0 && registry.some((r) => lc(r.name) === lc(a.name)) && (
              <button className="pb-x" title="Remove saved name" onClick={() => removeUngrouped(a)}>
                ×
              </button>
            )
          )}
        </div>

        {!grouped && collecting && (
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
              <button className="btn primary sm" type="button" onClick={() => submitCollect({ account: a.name }, a.balance)}>
                Record collection
              </button>
              <button className="btn sm" type="button" onClick={cancelCollect}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {isOpen &&
          (a.lines.length ? (
            a.lines.map(renderLine)
          ) : (
            <div className="stmt-sub" style={{ padding: "8px 12px", opacity: 0.7 }}>No UPI payments to this account yet.</div>
          ))}
      </div>
    );
  }

  const ungroupedNames = ungrouped.map((a) => a.name);

  return (
    <div>
      <div className="sectitle">
        Accounts <small>— holders, their UPI accounts &amp; hand-overs</small>
      </div>

      {/* overall */}
      <div className="panel-card acct-overall">
        <div className="acct-overall-h">Overall</div>
        <div className="acct-overall-grid">
          <div className="acct-stat">
            <span className="k">To collect</span>
            <span className={"v" + (totalBalance <= 0.5 ? " ok" : " due")}>₹ {inr(totalBalance)}</span>
            <span className="sub">still in accounts</span>
          </div>
          <div className="acct-stat">
            <span className="k">Received (UPI)</span>
            <span className="v">₹ {inr(ledger.totalReceived)}</span>
            <span className="sub">{ledger.totalOwner > 0.5 ? "+ ₹" + inr(ledger.totalOwner) + " to owner" : "collectable"}</span>
          </div>
          <div className="acct-stat">
            <span className="k">Collected</span>
            <span className="v ok">₹ {inr(totalCollected)}</span>
            <span className="sub">handed over</span>
          </div>
        </div>
      </div>

      <div className="acct-day-label">
        <span>Account holders · {holders.length}</span>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setShowAddHolder((v) => !v)}>
          {showAddHolder ? "Done" : "+ Account holder"}
        </button>
      </div>

      {showAddHolder && (
        <div className="panel-card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="acct-add-row">
            <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
              <span>New holder name</span>
              <input
                type="text"
                placeholder="e.g. Tabrez"
                value={newHolder}
                onChange={(e) => setNewHolder(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createHolder()}
                autoFocus
              />
            </label>
            <button className="btn primary" type="button" onClick={createHolder} style={{ alignSelf: "flex-end" }}>
              Add
            </button>
          </div>
          <p className="note" style={{ marginTop: 8, opacity: 0.75 }}>
            A holder is a person who receives UPI on your behalf. Add their accounts inside — you collect from the holder, and the running total is what matters.
          </p>
        </div>
      )}

      {/* holders */}
      {holders.map((h) => {
        const { subs, received, owner, collected, balance, cols } = holderView(h);
        const isOpen = !collapsedHolders.has(h.id);
        const due = balance > 0.5;
        const renaming = renameForId === h.id;
        const adding = addAcctFor === h.id;
        const collecting = collectHolder === h.id;
        return (
          <div className="panel-card acct-holder" key={h.id}>
            <div className="pc-head acct-head acct-holder-head">
              {renaming ? (
                <span style={{ flex: 1, display: "flex", gap: 6 }}>
                  <input
                    className="acct-new"
                    style={{ flex: 1 }}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitRename(h.id)}
                    autoFocus
                  />
                  <button className="btn primary sm" type="button" onClick={() => submitRename(h.id)}>Save</button>
                  <button className="btn sm" type="button" onClick={() => setRenameForId(null)}>Cancel</button>
                </span>
              ) : (
                <>
                  <span style={{ cursor: "pointer", flex: 1, minWidth: 0, fontWeight: 600 }} onClick={() => toggleHolder(h.id)}>
                    <span className="um-caret" style={{ marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                    {h.name}
                    <span className="acct-holder-count"> · {subs.length} acc{subs.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className="acct-head-totals">
                    {received > 0 && <span className="acct-tag upi">In ₹{inr(received)}</span>}
                    {owner > 0 && <span className="acct-tag">Owner ₹{inr(owner)}</span>}
                    {due ? (
                      <span className="acct-tag pending">Bal ₹{inr(balance)}</span>
                    ) : (
                      received > 0 && <span className="acct-tag ok">Cleared ✓</span>
                    )}
                  </span>
                  {due && !collecting && (
                    <button className="btn primary sm acct-collect-btn" type="button" onClick={() => startCollect({ holderId: h.id }, balance, h.id)}>
                      Collect
                    </button>
                  )}
                </>
              )}
            </div>

            {collecting && (
              <div className="panel-card" style={{ padding: 12, margin: "0 0 8px" }}>
                <div className="acct-add-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                    <span>Collect ₹ <small style={{ color: "var(--ink-faint)" }}>(bal ₹{inr(balance)})</small></span>
                    <input type="number" inputMode="decimal" placeholder={inr(balance)} value={cAmt} onChange={(e) => setCAmt(e.target.value)} autoFocus />
                  </label>
                  <label className="modal-field" style={{ flex: "1 1 120px", minWidth: 0 }}>
                    <span>Date (optional)</span>
                    <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
                  </label>
                  <label className="modal-field" style={{ flex: "2 1 160px", minWidth: 0 }}>
                    <span>Note (optional)</span>
                    <input type="text" placeholder="e.g. handed to owner" value={cNote} onChange={(e) => setCNote(e.target.value)} />
                  </label>
                </div>
                <div className="rowbtns" style={{ marginTop: 10 }}>
                  <button className="btn primary sm" type="button" onClick={() => submitCollect({ holderId: h.id, account: h.name }, balance)}>
                    Record collection
                  </button>
                  <button className="btn sm" type="button" onClick={cancelCollect}>Cancel</button>
                  {balance > 0.5 && (
                    <button className="btn sm" type="button" onClick={() => setCAmt(String(r2(balance)))}>Full ₹{inr(balance)}</button>
                  )}
                </div>
              </div>
            )}

            {isOpen && (
              <div className="acct-holder-body">
                {subs.length ? (
                  subs.map((a) => renderAccount(a, h.id))
                ) : (
                  <div className="stmt-sub" style={{ padding: "6px 4px", opacity: 0.7 }}>No accounts yet — add one below.</div>
                )}

                {cols.length > 0 && (
                  <div className="acct-handovers">
                    <div className="pc-sub" style={{ borderTop: 0, padding: "2px 2px 4px" }}>Hand-overs</div>
                    {cols
                      .slice()
                      .sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""))
                      .map((c) => (
                        <div className="stmt acct-stmt-done" key={c.id}>
                          <div className="stmt-ic ok">↑</div>
                          <div className="stmt-main">
                            <div className="stmt-to">Collected / handed over{c.note ? " · " + c.note : ""}</div>
                            <div className="stmt-sub">
                              {c.date}
                              {hhmm(c.createdAt) ? " · " + hhmm(c.createdAt) : ""} · by {userName(c.by)}
                            </div>
                          </div>
                          <div className="stmt-amt" style={{ color: "var(--green)" }}>−₹{inr(c.amount)}</div>
                          <span className="pb-rowacts">
                            <button className="pb-x" title="Delete collection" onClick={() => delCollection(c.id)}>×</button>
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                {adding ? (
                  <div className="panel-card" style={{ padding: 12, margin: "6px 0 2px" }}>
                    <div className="acct-add-row">
                      <label className="modal-field" style={{ flex: 1, minWidth: 0 }}>
                        <span>Account name</span>
                        <input
                          type="text"
                          placeholder="e.g. Tabrez GPay"
                          value={newAcct}
                          onChange={(e) => setNewAcct(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && attachAccount(h.id, newAcct)}
                          autoFocus
                        />
                      </label>
                      <button className="btn primary" type="button" onClick={() => attachAccount(h.id, newAcct)} style={{ alignSelf: "flex-end" }}>
                        Add
                      </button>
                      <button className="btn" type="button" onClick={() => { setAddAcctFor(null); setNewAcct(""); }} style={{ alignSelf: "flex-end" }}>
                        Cancel
                      </button>
                    </div>
                    {ungroupedNames.length > 0 && (
                      <>
                        <div className="stmt-sub" style={{ margin: "8px 2px 4px", opacity: 0.7 }}>or move an existing account here:</div>
                        <div className="acct-pick">
                          {ungroupedNames.map((n) => (
                            <button key={n} type="button" className="acct-chip" onClick={() => attachAccount(h.id, n)}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rowbtns acct-holder-actions">
                    <button className="btn sm primary" type="button" onClick={() => { setAddAcctFor(h.id); setNewAcct(""); }}>
                      + Account
                    </button>
                    <button className="btn sm" type="button" onClick={() => { setRenameForId(h.id); setRenameVal(h.name); }}>
                      Rename
                    </button>
                    <button className="btn sm danger" type="button" onClick={() => delHolder(h)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ungrouped */}
      {ungrouped.length > 0 && (
        <>
          <div className="acct-day-label" style={{ marginTop: 14 }}>
            <span>Ungrouped · {ungrouped.length}</span>
          </div>
          <p className="note" style={{ margin: "0 0 8px", opacity: 0.7 }}>
            Accounts not under a holder yet. Open a holder and use “+ Account” to move them in.
          </p>
          {ungrouped.map((a) => renderAccount(a))}
        </>
      )}

      {holders.length === 0 && ungrouped.length === 0 && (
        <div className="panel-card">
          <div className="empty">
            No account holders yet. Add one (e.g. Tabrez), then add their UPI accounts inside.
          </div>
        </div>
      )}
    </div>
  );
}
