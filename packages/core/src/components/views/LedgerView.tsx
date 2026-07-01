"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { inr } from "@/lib/calc";
import {
  allLedger,
  accountBook,
  creditorRows,
  debtorRows,
  deleteEntry,
  deleteVendor,
  drCr,
  saveAccount,
} from "@/lib/ledger";
import { loadSampleLedger } from "@/lib/ledger-sample";
import { editVendorDialog } from "@/lib/vendor-form";
import { editCustomerDialog } from "@/lib/customer-form";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Account, Customer, LedgerEntry, Vendor } from "@/lib/types";
import VoucherForm from "./VoucherForm";

type Tab = "debtor" | "creditor" | "bank";

export default function LedgerView() {
  const { dataVersion, user } = useApp();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [tab, setTab] = useState<Tab>("debtor");
  const [selAcct, setSelAcct] = useState("");
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [showAddAcct, setShowAddAcct] = useState(false);
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctOpen, setNewAcctOpen] = useState("");

  const load = useCallback(() => {
    Promise.all([
      allRec<Customer>("customers"),
      allRec<Vendor>("vendors"),
      allRec<Account>("accounts"),
      allLedger(),
    ]).then(([c, v, a, e]) => {
      setCustomers(c);
      setVendors(v);
      setAccounts(a);
      setEntries(e);
      setSelAcct((s) => s || a[0]?.id || "");
    });
  }, []);
  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const enteredBy = user?.id || "unknown";
  const props = { customers, vendors, accounts, enteredBy, onDone: load };

  const debtors = debtorRows(customers, entries);
  const creditors = creditorRows(vendors, entries);
  const totalRecv = debtors.reduce((s, d) => s + Math.max(0, d.balance), 0);
  const totalPay = creditors.reduce((s, d) => s + Math.max(0, d.balance), 0);

  async function loadSample() {
    await loadSampleLedger(enteredBy);
    load();
    bumpData();
    toast("Sample data loaded");
  }
  async function addVendor() {
    if (await editVendorDialog()) {
      load();
      bumpData();
    }
  }
  async function addCustomer() {
    if (await editCustomerDialog()) {
      load();
      bumpData();
    }
  }
  async function removeVendor(e: React.MouseEvent, v: Vendor) {
    e.stopPropagation();
    const ok = await confirmDialog({ title: "Delete " + v.name + "?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const res = await deleteVendor(v.id);
    if (!res.ok) return toast(res.count + " entries exist — delete them first");
    load();
    bumpData();
  }
  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newAcctName.trim()) return toast("Enter an account name");
    await saveAccount({ name: newAcctName, opening: +newAcctOpen || 0 });
    setNewAcctName("");
    setNewAcctOpen("");
    setShowAddAcct(false);
    load();
    bumpData();
  }
  async function removeEntry(en: LedgerEntry) {
    const ok = await confirmDialog({ title: "Delete entry?", message: "₹" + inr(en.amount), confirmLabel: "Delete", danger: true });
    if (!ok) return;
    if (editing?.id === en.id) setEditing(null);
    await deleteEntry(en.id);
    load();
    bumpData();
  }

  const seg = (t: Tab, label: string, n?: number) => (
    <button className={"btn sm" + (tab === t ? " primary" : "")} onClick={() => { setTab(t); setEditing(null); }}>
      {label}
      {n !== undefined && <small> · {n}</small>}
    </button>
  );

  return (
    <div>
      <div className="sectitle">
        Ledger <small>— debtors, creditors &amp; bank</small>
      </div>

      <div className="rowbtns">
        {seg("debtor", "Debtors", debtors.length)}
        {seg("creditor", "Creditors", creditors.length)}
        {seg("bank", "Cash / Bank")}
        {entries.length === 0 && vendors.length === 0 && (
          <button className="btn sm" onClick={loadSample}>
            Load sample data
          </button>
        )}
      </div>

      {tab === "debtor" && (
        <PartyTab
          kind="debtor"
          rows={debtors}
          total={totalRecv}
          totalLabel="Total receivable"
          onAdd={addCustomer}
          addLabel="+ Add customer"
          form={<VoucherForm scope="debtor" {...props} />}
          onOpen={(id) => router.push("/ledger/" + id)}
        />
      )}

      {tab === "creditor" && (
        <PartyTab
          kind="creditor"
          rows={creditors}
          total={totalPay}
          totalLabel="Total payable"
          onAdd={addVendor}
          addLabel="+ Add creditor"
          onDelete={removeVendor}
          form={<VoucherForm scope="creditor" {...props} />}
          onOpen={(id) => router.push("/ledger/" + id)}
        />
      )}

      {tab === "bank" && (
        <BankTab
          accounts={accounts}
          entries={entries}
          customers={customers}
          vendors={vendors}
          selAcct={selAcct}
          setSelAcct={setSelAcct}
          showAddAcct={showAddAcct}
          setShowAddAcct={setShowAddAcct}
          newAcctName={newAcctName}
          setNewAcctName={setNewAcctName}
          newAcctOpen={newAcctOpen}
          setNewAcctOpen={setNewAcctOpen}
          addAccount={addAccount}
          form={<VoucherForm key={editing?.id || "new"} scope="bank" editing={editing} onCancelEdit={() => setEditing(null)} {...props} />}
          onEdit={setEditing}
          onDelete={removeEntry}
        />
      )}
    </div>
  );
}

// ---------- debtor / creditor party list ----------

function PartyTab({
  kind,
  rows,
  total,
  totalLabel,
  onAdd,
  addLabel,
  onDelete,
  form,
  onOpen,
}: {
  kind: "debtor" | "creditor";
  rows: { party: Customer | Vendor; balance: number }[];
  total: number;
  totalLabel: string;
  onAdd: () => void;
  addLabel: string;
  onDelete?: (e: React.MouseEvent, v: Vendor) => void;
  form: React.ReactNode;
  onOpen: (id: string) => void;
}) {
  return (
    <div>
      <div className="dash-grid" style={{ marginTop: 12, marginBottom: 4 }}>
        <div className="stat">
          <div className="k">{totalLabel}</div>
          <div className="v money">₹ {inr(total)}</div>
        </div>
        <div className="stat">
          <div className="k">Parties</div>
          <div className="v">{rows.length}</div>
        </div>
      </div>

      {form}

      <div className="rowbtns">
        <button className="btn sm" onClick={onAdd}>
          {addLabel}
        </button>
      </div>

      <div className="panel-card">
        <div className="pc-head" style={{ justifyContent: "space-between" }}>
          <span>Party</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>Closing Balance</span>
        </div>
        {rows.length ? (
          rows.map(({ party, balance }) => {
            const { abs, side } = drCr(kind, balance);
            const due = balance > 0;
            return (
              <div className="exprow led" key={party.id} onClick={() => onOpen(party.id)} style={{ cursor: "pointer" }}>
                <span className={"exptag " + (due ? "out" : "in")}>{side}</span>
                <span className="expnote">
                  {party.name}
                  <small>{party.gstin || party.phone || "—"}</small>
                </span>
                <span className={"expamt " + (due ? "out" : "in")}>₹ {inr(abs)} {side}</span>
                <span className="rowacts">
                  {onDelete && (
                    <button className="x-row" title="Delete" onClick={(e) => onDelete(e, party as Vendor)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-icon">📒</div>
            <div className="empty-title">No {kind === "debtor" ? "debtors" : "creditors"} yet</div>
            <div className="empty-note">
              {kind === "debtor"
                ? "Record a Sales or Receipt against a customer and they show up here."
                : "Add a creditor, then record Purchases and Payments."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- bank book ----------

function BankTab(p: {
  accounts: Account[];
  entries: LedgerEntry[];
  customers: Customer[];
  vendors: Vendor[];
  selAcct: string;
  setSelAcct: (s: string) => void;
  showAddAcct: boolean;
  setShowAddAcct: (b: boolean) => void;
  newAcctName: string;
  setNewAcctName: (s: string) => void;
  newAcctOpen: string;
  setNewAcctOpen: (s: string) => void;
  addAccount: (e: React.FormEvent) => void;
  form: React.ReactNode;
  onEdit: (e: LedgerEntry) => void;
  onDelete: (e: LedgerEntry) => void;
}) {
  const acct = p.accounts.find((a) => a.id === p.selAcct);
  const book = acct ? accountBook(acct.id, p.entries, acct.opening) : { rows: [], closing: 0, opening: 0 };
  const balTxt = (n: number) => inr(Math.abs(n)) + " " + (n >= 0 ? "Dr" : "Cr");
  const acctName = (id: string) => p.accounts.find((a) => a.id === id)?.name || id;
  const partyName = (e: LedgerEntry) =>
    e.partyKind === "creditor"
      ? p.vendors.find((v) => v.id === e.partyId)?.name || "Payment"
      : p.customers.find((c) => c.id === e.partyId)?.name || "Receipt";

  function label(e: LedgerEntry, inflow: boolean) {
    if (e.kind === "contra") return inflow ? "Transfer ← " + acctName(e.fromAccount) : "Transfer → " + acctName(e.account);
    return partyName(e);
  }
  const tag = (e: LedgerEntry) => (e.kind === "receipt" ? "RCPT" : e.kind === "payment" ? "PAY" : "XFER");

  return (
    <div>
      <div className="dash-grid" style={{ marginTop: 12, marginBottom: 4 }}>
        <div className="stat">
          <div className="k">{acct ? acct.name + " balance" : "Balance"}</div>
          <div className="v money">₹ {balTxt(book.closing)}</div>
        </div>
        <div className="stat">
          <div className="k">Opening</div>
          <div className="v">₹ {balTxt(book.opening)}</div>
        </div>
      </div>

      <div className="rowbtns" style={{ alignItems: "center" }}>
        {p.accounts.map((a) => (
          <button key={a.id} className={"btn sm" + (a.id === p.selAcct ? " primary" : "")} onClick={() => p.setSelAcct(a.id)}>
            {a.name}
          </button>
        ))}
        <button className="btn sm" onClick={() => p.setShowAddAcct(!p.showAddAcct)}>
          + Account
        </button>
      </div>

      {p.showAddAcct && (
        <form className="panel-card daybook-entry" onSubmit={p.addAccount}>
          <label className="modal-field">
            <span>Account name</span>
            <input placeholder="HDFC, SBI…" value={p.newAcctName} onChange={(e) => p.setNewAcctName(e.target.value)} />
          </label>
          <label className="modal-field">
            <span>Opening balance (₹)</span>
            <input type="number" inputMode="decimal" placeholder="0" value={p.newAcctOpen} onChange={(e) => p.setNewAcctOpen(e.target.value)} />
          </label>
          <button className="btn primary" type="submit">
            Add account
          </button>
        </form>
      )}

      {p.form}

      <div className="panel-card">
        <div className="pc-head" style={{ justifyContent: "space-between" }}>
          <span>{acct ? acct.name : "Bank"} — Ledger</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
            Balance ₹{balTxt(book.closing)}
          </span>
        </div>
        {book.rows.length ? (
          [...book.rows].reverse().map((r) => {
            const inflow = r.delta > 0;
            return (
              <div className="exprow led" key={r.e.id}>
                <span className={"exptag " + (inflow ? "in" : "out")}>{tag(r.e)}</span>
                <span className="expnote">
                  {label(r.e, inflow)}
                  <small>
                    {r.e.date}
                    {r.e.ref ? " · " + r.e.ref : ""} · bal ₹{balTxt(r.running)}
                  </small>
                </span>
                <span className={"expamt " + (inflow ? "in" : "out")}>
                  {inflow ? "+" : "−"}₹ {inr(r.e.amount)}
                </span>
                <span className="rowacts">
                  <button className="x-row" title="Edit" onClick={() => p.onEdit(r.e)}>
                    ✎
                  </button>
                  <button className="x-row" title="Delete" onClick={() => p.onDelete(r.e)}>
                    ×
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-icon">🏦</div>
            <div className="empty-title">No bank entries yet</div>
            <div className="empty-note">Record receipts, payments, and transfers between accounts.</div>
          </div>
        )}
      </div>
    </div>
  );
}
