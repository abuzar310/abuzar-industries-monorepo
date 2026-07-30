"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import { partyLedger, type Party, type PartyStatement } from "@/lib/payments";
import { unwindReceiptPieces } from "@/lib/receipts";
import { useFocusFlash } from "@/lib/use-focus-flash";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Customer, Doc, Expense } from "@/lib/types";

// dd-mm-yy → yyyy-mm-dd for chronological sorting
const sortDate = (d: string) => {
  const [dd, mm, yy] = (d || "").split("-");
  if (!dd || !mm || !yy) return "";
  return `20${yy}-${mm}-${dd}`;
};

/** One row in the bank-format ledger. */
interface LedgerRow {
  date: string;
  at: string;
  particulars: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  isOpening?: boolean;
  isClosing?: boolean;
  refId?: string;
  refType?: "quote" | "payment";
  stmt?: PartyStatement;
}

function buildBankLedger(p: Party, expenses: Expense[], customers: Customer[]): LedgerRow[] {
  const rows: Omit<LedgerRow, "balance">[] = [];

  // Opening balance from the customer record (old dues before the app)
  const cust = customers.find((c) => c.id === p.custId);
  const opening = cust ? Math.max(0, +(cust.opening || 0)) : 0;

  // Each created quote is a debit (the party owes us this amount)
  for (const q of p.quotes) {
    rows.push({
      date: q.date,
      at: "",
      particulars: `To Quotation #${q.displayNumber || q.number}`,
      detail: `Bill amount`,
      debit: q.bill,
      credit: 0,
      refId: q.id,
      refType: "quote",
    });
  }

  // Direct charges (Receipts tab → "Add due") as debits
  for (const e of expenses) {
    if (e.type !== "sale" || !e.custId || !e.charge) continue;
    if (e.custId !== p.custId) continue;
    rows.push({
      date: e.date,
      at: e.createdAt || "",
      particulars: "To Charges",
      detail: e.note || "Due added",
      debit: +e.amount || 0,
      credit: 0,
      refId: e.id,
      refType: "payment",
    });
  }

  // Payments received as credits
  for (const s of p.statements) {
    const mode = s.mode === "upi" ? "UPI" : "Cash";
    const acct = s.account ? ` (${s.account})` : "";
    rows.push({
      date: s.date,
      at: s.at,
      particulars: `By ${mode}${acct}`,
      detail: [s.note, s.pieces ? `${s.pieces} receipts` : ""].filter(Boolean).join(" · "),
      debit: 0,
      credit: s.amount,
      refId: s.id,
      refType: "payment",
      stmt: s,
    });
  }

  // Sort chronologically by date, then by creation time within the same day
  rows.sort((a, b) => {
    const d = sortDate(a.date).localeCompare(sortDate(b.date));
    if (d !== 0) return d;
    return (a.at || "").localeCompare(b.at || "");
  });

  // Compute running balance
  const result: LedgerRow[] = [];
  let balance = 0;

  if (opening > 0.005) {
    balance = opening;
    result.push({
      date: "",
      at: "",
      particulars: "Opening Balance",
      detail: "",
      debit: 0,
      credit: 0,
      balance,
      isOpening: true,
    });
  }

  for (const r of rows) {
    balance += r.debit - r.credit;
    result.push({ ...r, balance });
  }

  result.push({
    date: "",
    at: "",
    particulars: "Closing Balance",
    detail: "",
    debit: 0,
    credit: 0,
    balance,
    isClosing: true,
  });

  return result;
}

export default function PaymentsView() {
  const { ready, dataVersion } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses"), allRec<Customer>("customers")]).then(([qs, es, cs]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const flash = useFocusFlash();
  const { parties, totalBilled, totalPaid, totalPending } = partyLedger(quotes, expenses, customers);
  const dueCount = parties.filter((p) => p.balance > 0.5).length;
  const term = q.trim().toLowerCase();
  const shown = parties
    .filter((p) => p.balance > 0.5)
    .filter((p) => (term ? p.name.toLowerCase().includes(term) || p.phone.includes(term) : true));

  const balClass = (b: number) => (b < -0.5 ? "adv" : b <= 0.5 ? "ok" : "due");
  const balText = (b: number) => (b < -0.5 ? "₹" + inr(-b) : b <= 0.5 ? "Settled" : "₹" + inr(b));

  return (
    <div className="ledger-page">
      <div className="sectitle">
        Balances <small>— who still owes</small>
      </div>

      {/* overview stat cards */}
      <div className="party-grid">
        <div className={"party-card hero" + flash("pending")}>
          <div className="party-stat-label">Total Pending</div>
          <div className="party-stat-value due">₹ {inr(totalPending)}</div>
          <div className="party-stat-sub">
            {dueCount} {dueCount === 1 ? "party still owes" : "parties still owe"}
          </div>
        </div>
        <div className={"party-card" + flash("received")}>
          <div className="party-stat-label">Collected</div>
          <div className="party-stat-value rec">₹ {inr(totalPaid)}</div>
          <div className="party-stat-sub">of ₹{inr(totalBilled)} billed</div>
        </div>
        <div className={"party-card" + flash("billed")}>
          <div className="party-stat-label">Billed</div>
          <div className="party-stat-value">₹ {inr(totalBilled)}</div>
          <div className="party-stat-sub">{parties.length} {parties.length === 1 ? "customer" : "customers"}</div>
        </div>
      </div>

      {dueCount > 0 && (
        <div className="searchbar" style={{ marginTop: 20 }}>
          <span className="s-ic">⌕</span>
          <input placeholder="Search a party by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="s-clear" onClick={() => setQ("")} title="Clear">
              ×
            </button>
          )}
          <span className="s-count">{shown.length}</span>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="listwrap" style={{ marginTop: 12 }}>
          <div className="empty">
            <div className="empty-icon">{!parties.length ? "💰" : dueCount ? "🔍" : "🎉"}</div>
            <div className="empty-title">{!parties.length ? "No billed quotes yet" : dueCount ? "No match" : "All settled"}</div>
            <div className="empty-note">
              {!parties.length
                ? "Create a quote and record a payment — balances show up here."
                : dueCount
                  ? "No outstanding party matches your search."
                  : "Everyone has paid up. Parties appear here only while they still owe."}
            </div>
          </div>
        </div>
      ) : (
        shown.map((p) => (
          <PartyCard
            key={p.custId || p.name}
            p={p}
            open={open}
            setOpen={setOpen}
            router={router}
            balClass={balClass}
            balText={balText}
            expenses={expenses}
            customers={customers}
            reload={load}
          />
        ))
      )}
    </div>
  );
}

function PartyCard({
  p,
  open,
  setOpen,
  router,
  balClass,
  balText,
  expenses,
  customers,
  reload,
}: {
  p: Party;
  open: string | null;
  setOpen: (v: string | null) => void;
  router: ReturnType<typeof useRouter>;
  balClass: (b: number) => string;
  balText: (b: number) => string;
  expenses: Expense[];
  customers: Customer[];
  reload: () => void;
}) {
  const pid = p.custId || p.name;
  const isOpen = open === pid;
  const settled = p.balance <= 0.5;
  const bc = balClass(p.balance);

  const ledgerRows = useMemo(() => buildBankLedger(p, expenses, customers), [p, expenses, customers]);

  const piecesOf = (s: PartyStatement): Expense[] =>
    s.pieces ? expenses.filter((e) => e.rcptId === s.id) : expenses.filter((e) => e.id === s.id);

  function editStatement(s: PartyStatement) {
    const rid = s.pieces ? s.id : s.rcptId;
    if (rid) return router.push("/receipts?edit=" + encodeURIComponent(rid));
    const exp = expenses.find((e) => e.id === s.id);
    if (exp?.custId) return router.push("/receipts?edit=" + encodeURIComponent(exp.id));
    if (exp?.sourceId) return router.push("/editor/" + exp.sourceId + "?pay=" + encodeURIComponent(s.id));
  }

  async function deleteStatement(s: PartyStatement) {
    const pieces = piecesOf(s);
    if (!pieces.length) return toast("This line comes from the quote's own record — open the quote to change it");
    const nQuotes = pieces.filter((x) => !!x.sourceId).length;
    const ok = await confirmDialog({
      title: "Delete payment?",
      message:
        p.name +
        " — ₹" +
        inr(s.amount) +
        (nQuotes > 0 ? "\nIt was applied on " + nQuotes + " quotation" + (nQuotes === 1 ? "" : "s") + " — they go back to due." : ""),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await unwindReceiptPieces(pieces);
    reload();
    bumpData();
    toast("Payment removed — balances updated");
  }

  const closingBalanceClass = ledgerRows.length > 0 ? (ledgerRows[ledgerRows.length - 1].balance <= 0.5 ? "ok" : "due") : "";

  return (
    <div className="ledger-card">
      <button className={"ledger-card-header" + (isOpen ? " on" : "")} onClick={() => setOpen(isOpen ? null : pid)}>
        <div className={"pty-av" + (settled ? " ok" : "")}>{(p.name || "?").charAt(0).toUpperCase()}</div>
        <div className="lch-main">
          <div className="lch-name">
            {p.name}
            {p.phone && <small>{p.phone}</small>}
          </div>
          <div className="lch-meta">
            Paid ₹{inr(p.paid)} of ₹{inr(p.billed)} · {p.quoteCount} {p.quoteCount === 1 ? "quote" : "quotes"}
          </div>
        </div>
        <div className={"lch-bal " + bc}>
          {balText(p.balance)}
          <small>{settled ? "✓ clear" : "due"}</small>
        </div>
      </button>

      {isOpen && (
        <div className="ledger-card-body">
          <div className="party-stats">
            <div className="party-stat">
              <div className="party-stat-label">Billed</div>
              <div className="party-stat-value">₹{inr(p.billed)}</div>
            </div>
            <div className="party-stat">
              <div className="party-stat-label">Paid</div>
              <div className="party-stat-value rec">₹{inr(p.paid)}</div>
              <div className="party-stat-sub">Cash ₹{inr(p.cashPaid)} · UPI ₹{inr(p.upiPaid)}</div>
            </div>
            <div className="party-stat">
              <div className="party-stat-label">Balance</div>
              <div className={"party-stat-value " + (settled ? "ok" : "due")}>₹{inr(p.balance)}</div>
            </div>
          </div>

          {/* ── Bank-format ledger ── */}
          <div className="bank-ledger">
            <div className="bank-hdr">
              <span>Date</span>
              <span>Particulars</span>
              <span className="bank-amt">Dr ₹</span>
              <span className="bank-amt">Cr ₹</span>
              <span className="bank-amt">Balance</span>
            </div>

            {ledgerRows.map((row, i) => {
              const isPayment = !row.isOpening && !row.isClosing && row.refType === "payment";
              const rowClass = [
                "bank-row",
                row.isOpening ? "bank-open" : "",
                row.isClosing ? "bank-total" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={i}
                  className={rowClass}
                  onClick={() => {
                    if (row.isOpening || row.isClosing) return;
                    if (row.refType === "quote" && row.refId) router.push("/editor/" + row.refId);
                    if (row.refType === "payment" && row.stmt) editStatement(row.stmt);
                  }}
                  style={{ cursor: row.isOpening || row.isClosing ? "default" : "pointer" }}
                >
                  <span className="bank-date">{row.date}</span>
                  <span className="bank-parts">
                    {row.particulars}
                    {row.detail && <small>{row.detail}</small>}
                    {isPayment && row.stmt && row.stmt.synthetic && (
                      <small style={{ fontStyle: "italic" }}>from quote record</small>
                    )}
                    {isPayment && row.stmt && !row.stmt.synthetic && (
                      <span className="bl-acts">
                        <button
                          className="bl-btn"
                          title="Edit"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            editStatement(row.stmt!);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="bl-btn danger"
                          title="Delete"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteStatement(row.stmt!);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </span>
                  <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>
                    {row.debit > 0 ? "₹" + inr(row.debit) : ""}
                  </span>
                  <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>
                    {row.credit > 0 ? "₹" + inr(row.credit) : ""}
                  </span>
                  <span
                    className={
                      "bank-amt bal" +
                      (row.isClosing ? (closingBalanceClass === "due" ? " due" : " ok") : "")
                    }
                  >
                    ₹{inr(Math.abs(row.balance))}
                    {!row.isOpening && (
                      <span className={"bal-tag " + (row.balance > 0.5 ? "dr" : "cr")}>
                        {row.balance > 0.5 ? "Dr" : "Cr"}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
