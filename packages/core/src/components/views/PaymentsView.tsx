"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr, qty } from "@/lib/calc";
import { brandFor } from "@/lib/brand";
import { generatePdf } from "@/lib/pdf";
import { partyLedger, type Party, type PartyStatement } from "@/lib/payments";
import { useFocusFlash } from "@/lib/use-focus-flash";
import { balanceReminderMessage, sendPdfOnWhatsApp } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import PdfButtons from "@/components/PdfButtons";
import PassbookPrint, { type PassbookLine } from "@/components/PassbookPrint";
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

const STMT_PDF = {
  pageBreak: ".bank-row,.acct-print-sum,.acct-print-hdr",
  width: 700,
  marginMm: 8,
} as const;

function ledgerToPassbook(rows: LedgerRow[]): PassbookLine[] {
  return rows.map((r, i) => ({
    key: String(i) + r.particulars,
    date: r.date,
    who: r.particulars,
    detail: r.detail,
    debit: r.debit,
    credit: r.credit,
    balance: r.balance,
    open: r.isOpening,
    close: r.isClosing,
  }));
}

type PdfAct = "preview" | "download" | "forward";

export default function PaymentsView() {
  const { ready, dataVersion, cloakMoney, brandMode } = useApp();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pdfParty, setPdfParty] = useState<Party | null>(null);
  const [pdfTick, setPdfTick] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfAct = useRef<PdfAct | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const brand = brandFor(brandMode);

  const load = useCallback(() => {
    Promise.all([allRec<Doc>("quotations"), allRec<Expense>("expenses"), allRec<Customer>("customers")]).then(([qs, es, cs]) => {
      setQuotes(qs);
      setExpenses(es);
      setCustomers(cs);
    });
  }, []);
  useEffect(() => {
    load();
  }, [ready, dataVersion, load]);

  const flash = useFocusFlash();
  // panic cloak: no party rows / balances at all
  const { parties, totalBilled, totalPaid, totalPending } = partyLedger(
    cloakMoney ? [] : quotes,
    cloakMoney ? [] : expenses,
    cloakMoney ? [] : customers,
  );
  const dueCount = parties.filter((p) => p.balance > 0.5).length;
  const term = q.trim().toLowerCase();
  const shown = parties
    .filter((p) => p.balance > 0.5)
    .filter((p) => (term ? p.name.toLowerCase().includes(term) || p.phone.includes(term) : true));

  const balClass = (b: number) => (cloakMoney || b <= 0.5 ? "ok" : b < -0.5 ? "adv" : "due");
  const balText = (b: number) =>
    cloakMoney || b <= 0.5 ? "Settled" : b < -0.5 ? "₹" + inr(-b) : "₹" + inr(b);

  const printRows = useMemo(
    () => (pdfParty ? ledgerToPassbook(buildBankLedger(pdfParty, expenses, customers)) : []),
    [pdfParty, expenses, customers],
  );

  function requestPdf(p: Party, act: PdfAct) {
    if (act === "forward" && !(p.phone || "").trim()) {
      toast("No phone on this card — add it on the customer first");
      return;
    }
    pdfAct.current = act;
    setPdfBusy(true);
    setPdfParty(p);
    setPdfTick((n) => n + 1);
  }

  useEffect(() => {
    if (!pdfParty || !pdfAct.current) return;
    const act = pdfAct.current;
    pdfAct.current = null;
    const el = printRef.current;
    const who = pdfParty;
    if (!el) {
      setPdfBusy(false);
      return;
    }
    const fileBase = (who.name || "customer").replace(/\s+/g, "-").toLowerCase() + "-statement";
    const title = (brand.name || "Statement") + " — " + (who.name || "customer");
    void (async () => {
      try {
        if (act === "forward") {
          toast("Preparing PDF…");
          const how = await sendPdfOnWhatsApp({
            sheet: el,
            fileBase,
            phone: who.phone,
            text: balanceReminderMessage({
              name: who.name,
              total: who.billed,
              received: who.paid,
              balance: who.balance,
            }),
            title,
            pdfOpts: { ...STMT_PDF, title },
          });
          if (how === "shared") toast("Forwarded — pick their WhatsApp chat");
          else if (how === "direct") toast("PDF downloaded — drop it in their WhatsApp chat");
          else if (how === "fallback") toast("PDF saved — attach it in the chat that opened");
        } else {
          if (act === "download") toast("Preparing PDF…");
          await generatePdf(el, fileBase, { ...STMT_PDF, title, preview: act === "preview" });
          if (act === "download") toast("Statement PDF downloaded \u2713");
        }
      } catch {
        toast("Could not create the PDF");
      } finally {
        setPdfBusy(false);
      }
    })();
  }, [pdfParty, pdfTick, brand.name]);

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
            {qty(dueCount)} {dueCount === 1 ? "party still owes" : "parties still owe"}
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
          <div className="party-stat-sub">
            {qty(parties.length)} {parties.length === 1 ? "customer" : "customers"}
          </div>
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
        <div className="custgrid">
          {shown.map((p) => (
            <PartyCard
              key={p.custId || p.name}
              p={p}
              router={router}
              balClass={balClass}
              balText={balText}
              expenses={expenses}
              customers={customers}
              reload={load}
              busy={pdfBusy && (pdfParty?.custId || pdfParty?.name) === (p.custId || p.name)}
              onPreview={() => requestPdf(p, "preview")}
              onDownload={() => requestPdf(p, "download")}
              onForward={() => requestPdf(p, "forward")}
            />
          ))}
        </div>
      )}

      {pdfParty && (
        <PassbookPrint
          printRef={printRef}
          summary={[
            { k: "Quotes", v: String(pdfParty.quoteCount) },
            { k: "Billed", v: "₹ " + inr(pdfParty.billed) },
            { k: "Received", v: "₹ " + inr(pdfParty.paid) },
            { k: "Balance", v: "₹ " + inr(pdfParty.balance) },
          ]}
          rows={printRows}
        />
      )}
    </div>
  );
}

function PartyCard({
  p,
  router,
  balClass,
  balText,
  busy,
  onPreview,
  onDownload,
  onForward,
}: {
  p: Party;
  router: ReturnType<typeof useRouter>;
  balClass: (b: number) => string;
  balText: (b: number) => string;
  expenses: Expense[];
  customers: Customer[];
  reload: () => void;
  busy: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onForward: () => void;
}) {
  const settled = p.balance <= 0.5;
  const bc = balClass(p.balance);
  return (
    <div
      className="custcard"
      onClick={() => p.custId && router.push("/customers/" + p.custId)}
      style={{ cursor: p.custId ? "pointer" : "default" }}
    >
      <h3>{p.name}</h3>
      <div className="ph">{p.phone || "—"}</div>
      <div className="meta2">
        Paid ₹ {inr(p.paid)} of ₹ {inr(p.billed)}
        <br />
        <b>{qty(p.quoteCount)}</b> quote{p.quoteCount === 1 ? "" : "s"}
        {!settled && (
          <>
            <br />
            <span style={{ color: "var(--danger)" }}>₹ {inr(p.balance)} outstanding</span>
          </>
        )}
      </div>
      <div className={"lch-bal " + bc} style={{ marginTop: 8 }}>
        {balText(p.balance)}
        <small>{settled ? "clear" : "due"}</small>
      </div>
      <div className="links" onClick={(e) => e.stopPropagation()}>
        <PdfButtons onPreview={onPreview} onDownload={onDownload} busy={busy} />
        <button
          className="btn wa sm"
          type="button"
          disabled={busy || !(p.phone || "").trim()}
          title={p.phone ? "WhatsApp this person their due statement" : "No phone on this card"}
          onClick={onForward}
        >
          Forward
        </button>
      </div>
    </div>
  );
}
