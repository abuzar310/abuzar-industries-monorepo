"use client";
// Vouchers (official app): RECEIPT vouchers — every payment received (against invoices,
// or as customer ADVANCES that auto-clear onto future invoices) — and PAYMENT vouchers —
// money paid out by cash or bank. Filterable date-wise books + a printable table.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { dateSortKey, inr, todayStr } from "@/lib/calc";
import { allExpenses } from "@/lib/expenses";
import { brandFor } from "@/lib/brand";
import { generatePdf, printOrSavePdf } from "@/lib/pdf";
import {
  addBankAccount,
  addLoanType,
  CASH_DAY_LIMIT,
  cashTakenFromCustomerOn,
  contraDir,
  getBankAccounts,
  getLoanTypes,
  isContra,
  isDrawing,
  isJournal,
  isLoan,
  isLoanTaken,
  isPaymentVoucher,
  loanParticulars,
  recordAdvanceCashSplit,
  recordAdvanceReceipt,
  recordContra,
  recordDrawing,
  recordJournal,
  recordLoanRepay,
  recordLoanTaken,
  recordPaymentVoucher,
  removeBankAccount,
  removeLoanType,
  liveInvoices,
  type LoanKind,
} from "@/lib/vouchers";
import { USERS } from "@/lib/local-auth";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import CustomerPicker from "@/components/editor/CustomerPicker";
import PdfButtons from "@/components/PdfButtons";
import type { Customer, Doc, Expense } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const userName = (id: string) => USERS.find((u) => u.id === id)?.name || id || "—";
const toDmy = (v: string) => {
  const [y, m, d] = (v || "").split("-");
  return d && m && y ? `${d}-${m}-${y.slice(2)}` : "";
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

interface DayGroup {
  date: string;
  total: number;
  entries: Expense[];
}

/** newest day first; entries inside newest first */
function groupByDay(list: Expense[]): DayGroup[] {
  const m = new Map<string, Expense[]>();
  for (const e of list) {
    const arr = m.get(e.date) || [];
    arr.push(e);
    m.set(e.date, arr);
  }
  return [...m.entries()]
    .map(([date, entries]) => ({
      date,
      total: r2(entries.reduce((s, e) => s + (+e.amount || 0), 0)),
      entries: entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    }))
    .sort((a, b) => (dateSortKey(b.date) || "").localeCompare(dateSortKey(a.date) || ""));
}

export default function VouchersView() {
  const { ready, dataVersion, user, brandMode } = useApp();
  const router = useRouter();
  const [seg, setSeg] = useState<"receipts" | "payments" | "contra" | "journal" | "loans" | "drawings">("receipts");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Doc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [banks, setBanks] = useState<string[]>([]);
  // ---- filters (shared by the screen books and the printable table) ----
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viaF, setViaF] = useState<"all" | "cash" | "bank">("all");
  const [bankF, setBankF] = useState("");
  const [q, setQ] = useState("");
  // ---- payment-voucher form ----
  const [payee, setPayee] = useState("");
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState<"cash" | "bank">("cash");
  const [bank, setBank] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [newBank, setNewBank] = useState("");
  // ---- contra form (cash ⇄ bank) ----
  const [cvDir, setCvDir] = useState<"dep" | "wd">("dep");
  const [cvBank, setCvBank] = useState("");
  const [cvAmt, setCvAmt] = useState("");
  const [cvDate, setCvDate] = useState("");
  const [cvNote, setCvNote] = useState("");
  // ---- journal form (bank → bank) ----
  const [jvFrom, setJvFrom] = useState("");
  const [jvTo, setJvTo] = useState("");
  const [jvAmt, setJvAmt] = useState("");
  const [jvDate, setJvDate] = useState("");
  const [jvNote, setJvNote] = useState("");
  // ---- advance-receipt form (Receipts tab) ----
  const [advName, setAdvName] = useState("");
  const [advCust, setAdvCust] = useState<Customer | null>(null);
  const [advAmt, setAdvAmt] = useState("");
  const [advVia, setAdvVia] = useState<"cash" | "bank">("cash");
  const [advBank, setAdvBank] = useState("");
  const [advDate, setAdvDate] = useState("");
  const [advNote, setAdvNote] = useState("");
  const [advTaken, setAdvTaken] = useState(0);
  /** big cash split mode: book ₹10k/day automatically from the chosen date forward */
  const [advSplit, setAdvSplit] = useState(false);
  /** after a cash receipt — offer one-tap “add more next day” with the same customer */
  const [nextDay, setNextDay] = useState<{
    cust: Customer;
    amount: number;
    lastIso: string;
    note: string;
  } | null>(null);
  // ---- loans form ----
  const [loanTypes, setLoanTypes] = useState<string[]>([]);
  const [lnType, setLnType] = useState("");
  const [newLoanType, setNewLoanType] = useState("");
  const [lnKind, setLnKind] = useState<LoanKind>("secured");
  const [lnDir, setLnDir] = useState<"taken" | "repay">("taken");
  const [lnLender, setLnLender] = useState("");
  const [lnAmt, setLnAmt] = useState("");
  const [lnVia, setLnVia] = useState<"cash" | "bank">("bank");
  const [lnBank, setLnBank] = useState("");
  const [lnDate, setLnDate] = useState("");
  const [lnNote, setLnNote] = useState("");
  // ---- personal drawings form ----
  const [drAmt, setDrAmt] = useState("");
  const [drVia, setDrVia] = useState<"cash" | "bank">("cash");
  const [drBank, setDrBank] = useState("");
  const [drDate, setDrDate] = useState("");
  const [drNote, setDrNote] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([
      allExpenses(),
      allRec<Doc>("invoices"),
      allRec<Customer>("customers"),
      getBankAccounts(),
      getLoanTypes(),
    ]).then(([es, is, cs, bs, lts]) => {
      setExpenses(es);
      setInvoices(is);
      setCustomers(cs);
      setBanks(bs);
      setLoanTypes(lts);
      setLnType((cur) => (cur && lts.includes(cur) ? cur : lts[0] || ""));
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  // structural cash cap on the advance form — same rule as the invoice block
  const advDateStr = advDate ? toDmy(advDate) : todayStr();
  useEffect(() => {
    let alive = true;
    if (!advCust) return;
    cashTakenFromCustomerOn(advCust.id, advDateStr, expenses).then((taken) => {
      if (alive) setAdvTaken(taken);
    });
    return () => {
      alive = false;
    };
  }, [advCust, advDateStr, expenses]);
  const advRoom = advCust ? Math.max(0, r2(CASH_DAY_LIMIT - advTaken)) : CASH_DAY_LIMIT;
  function onAdvAmt(v: string) {
    const n = +v || 0;
    // split mode lifts the clamp — the amount gets booked as ₹10k/day automatically
    if (advVia === "cash" && !advSplit && n > advRoom) {
      setAdvAmt(String(advRoom));
      toast("Cash cap: only ₹" + inr(advRoom) + " more allowed from this customer on " + advDateStr + " — split across days or take bank");
      return;
    }
    setAdvAmt(v);
  }

  // trashed invoices drop out — their payments hide with them (and return on restore)
  const invById = useMemo(() => new Map(liveInvoices(invoices).map((d) => [d.id, d] as const)), [invoices]);
  const custName = (id?: string) => customers.find((c) => c.id === id)?.name || "—";

  // ---- filter machinery ----
  const inRange = (e: Expense) => {
    const k = dateSortKey(e.date) || "";
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  };
  const viaOk = (e: Expense) =>
    viaF === "all" ? true : viaF === "cash" ? e.mode !== "upi" && !e.account : e.mode === "upi" || !!e.account;
  const bankOk = (e: Expense) => !bankF || (e.account || "") === bankF;
  const textOf = (e: Expense, kind: "in" | "out") => {
    const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
    return kind === "in"
      ? [inv?.customerName, inv?.number, e.custId ? custName(e.custId) : "", e.account, e.label].filter(Boolean).join(" ")
      : [e.label, e.account, e.note].filter(Boolean).join(" ");
  };
  const qOk = (e: Expense, kind: "in" | "out") => !q.trim() || textOf(e, kind).toLowerCase().includes(q.trim().toLowerCase());

  // receipts: invoice payments + customer advances (custId, not yet absorbed)
  const receipts = expenses.filter(
    (e) =>
      e.type === "sale" && !e.charge &&
      ((!!e.sourceId && invById.has(e.sourceId)) || !!e.custId) &&
      inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "in"),
  );
  const pvs = expenses.filter((e) => isPaymentVoucher(e) && inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "out"));
  const qTextOk = (e: Expense, txt: string) => !q.trim() || txt.toLowerCase().includes(q.trim().toLowerCase());
  const cvs = expenses.filter(
    (e) => isContra(e) && inRange(e) && bankOk(e) && qTextOk(e, [e.label, e.account, e.note].filter(Boolean).join(" ")),
  );
  const jvs = expenses.filter(
    (e) =>
      isJournal(e) && inRange(e) && (!bankF || e.account === bankF || e.account2 === bankF) &&
      qTextOk(e, [e.account, e.account2, e.note].filter(Boolean).join(" ")),
  );
  const lns = expenses.filter(
    (e) => isLoan(e) && inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "out"),
  );
  const drws = expenses.filter(
    (e) => isDrawing(e) && inRange(e) && viaOk(e) && bankOk(e) && qOk(e, "out"),
  );
  const rGroups = groupByDay(receipts);
  const pGroups = groupByDay(pvs);
  const cGroups = groupByDay(cvs);
  const jGroups = groupByDay(jvs);
  const lnGroups = groupByDay(lns);
  const drGroups = groupByDay(drws);
  const rTotal = r2(receipts.reduce((s, e) => s + (+e.amount || 0), 0));
  const pTotal = r2(pvs.reduce((s, e) => s + (+e.amount || 0), 0));
  const cTotal = r2(cvs.reduce((s, e) => s + (+e.amount || 0), 0));
  const jTotal = r2(jvs.reduce((s, e) => s + (+e.amount || 0), 0));
  const lnTotal = r2(lns.reduce((s, e) => s + (+e.amount || 0), 0));
  const drTotal = r2(drws.reduce((s, e) => s + (+e.amount || 0), 0));

  const shown =
    seg === "receipts" ? receipts
    : seg === "payments" ? pvs
    : seg === "contra" ? cvs
    : seg === "journal" ? jvs
    : seg === "loans" ? lns
    : drws;
  const segTotal =
    seg === "receipts" ? rTotal
    : seg === "payments" ? pTotal
    : seg === "contra" ? cTotal
    : seg === "journal" ? jTotal
    : seg === "loans" ? lnTotal
    : drTotal;
  // the movement text for a contra / journal row (books + print)
  const moveText = (e: Expense) =>
    isJournal(e)
      ? (e.account || "?") + " → " + (e.account2 || "?")
      : contraDir(e) === "dep"
        ? "Cash → " + (e.account || "bank")
        : (e.account || "bank") + " → Cash";
  const shownOldestFirst = [...shown].sort(
    (a, b) =>
      (dateSortKey(a.date) || "").localeCompare(dateSortKey(b.date) || "") ||
      (a.createdAt || "").localeCompare(b.createdAt || ""),
  );

  function preset(p: "thisMonth" | "lastMonth" | "fy" | "all") {
    const now = new Date();
    if (p === "all") {
      setFrom("");
      setTo("");
    } else if (p === "thisMonth") {
      setFrom(isoOf(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(isoOf(now));
    } else if (p === "lastMonth") {
      setFrom(isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setTo(isoOf(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setFrom(isoOf(new Date(fyStart, 3, 1)));
      setTo(isoOf(now));
    }
  }
  const periodLabel = from || to ? (from ? toDmy(from) : "start") + " — " + (to ? toDmy(to) : "today") : "All time";
  const brand = brandFor(brandMode);
  const today = new Date();
  const genOn = `${pad2(today.getDate())}-${pad2(today.getMonth() + 1)}-${today.getFullYear()}`;

  // ---- bank accounts ----
  async function addBank() {
    const next = await addBankAccount(newBank);
    setBanks(next);
    const n = newBank.trim();
    if (n) setBank(next.find((x) => x.toLowerCase() === n.toLowerCase()) || n);
    setNewBank("");
    bumpData();
  }

  // ---- record: advance receipt (single, or split into ₹10k/day cash entries) ----
  async function recordAdvance() {
    if (!advCust) return toast("Pick an existing customer");
    const a = Math.max(0, +advAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (advVia === "bank" && !advBank.trim()) return toast("Pick the bank account");

    if (advVia === "cash" && advSplit && a > CASH_DAY_LIMIT) {
      // split mode: book ₹10k/day starting from the chosen date, instantly
      const fromIso = advDate || isoOf(new Date());
      const made = await recordAdvanceCashSplit({
        custId: advCust.id,
        custName: advCust.name,
        amount: a,
        fromIso,
        note: advNote.trim(),
        by: user?.id || "unknown",
        expenses,
      });
      setAdvAmt("");
      setAdvNote("");
      setAdvDate("");
      setNextDay(null);
      load();
      bumpData();
      const total = r2(made.reduce((s, m) => s + m.amount, 0));
      return toast(
        "₹" + inr(total) + " booked as " + made.length + " daily cash entries (" +
          (made[0]?.date || "—") + " → " + (made[made.length - 1]?.date || "—") + ")",
      );
    }

    if (advVia === "cash") {
      const taken = await cashTakenFromCustomerOn(advCust.id, advDateStr, expenses);
      if (taken + a > CASH_DAY_LIMIT + 0.005)
        return toast("Cash limit — max ₹" + inr(CASH_DAY_LIMIT) + " from one customer per day");
    }
    const bookedIso = advDate || isoOf(new Date());
    await recordAdvanceReceipt({
      custId: advCust.id,
      custName: advCust.name,
      amount: a,
      via: advVia,
      bank: advBank,
      date: advDate ? toDmy(advDate) : undefined,
      note: advNote,
      by: user?.id || "unknown",
    });
    const keptNote = advNote.trim();
    setAdvAmt("");
    setAdvNote("");
    setAdvDate("");
    // cash receipts: offer “add more next day” (same customer, next calendar day)
    if (advVia === "cash") {
      setNextDay({ cust: advCust, amount: a, lastIso: bookedIso, note: keptNote });
    } else {
      setNextDay(null);
    }
    load();
    bumpData();
    toast("₹" + inr(a) + " advance from " + advCust.name + " — it will clear onto their next invoice");
  }

  /** Prefill the receipt form for the day after the last cash booking. */
  async function addMoreNextDay() {
    if (!nextDay) return;
    const d = new Date(nextDay.lastIso + "T00:00:00");
    if (isNaN(+d)) return;
    d.setDate(d.getDate() + 1);
    const nextIso = isoOf(d);
    const nextDmy = toDmy(nextIso);
    const taken = await cashTakenFromCustomerOn(nextDay.cust.id, nextDmy, expenses);
    const room = Math.max(0, r2(CASH_DAY_LIMIT - taken));
    if (room <= 0.5) {
      // that day is already full — skip forward one more and try again (up to a week)
      let iso = nextIso;
      let found = 0;
      for (let i = 0; i < 7; i++) {
        const dd = new Date(iso + "T00:00:00");
        dd.setDate(dd.getDate() + 1);
        iso = isoOf(dd);
        const t = await cashTakenFromCustomerOn(nextDay.cust.id, toDmy(iso), expenses);
        found = Math.max(0, r2(CASH_DAY_LIMIT - t));
        if (found > 0.5) break;
      }
      if (found <= 0.5) return toast("No cash room in the next week for " + nextDay.cust.name);
      setAdvCust(nextDay.cust);
      setAdvName(nextDay.cust.name);
      setAdvVia("cash");
      setAdvSplit(false);
      setAdvBank("");
      setAdvDate(iso);
      setAdvNote(nextDay.note);
      setAdvAmt(String(Math.min(nextDay.amount, found, CASH_DAY_LIMIT)));
      return toast("Jumped to " + toDmy(iso) + " — cash room ₹" + inr(found));
    }
    setAdvCust(nextDay.cust);
    setAdvName(nextDay.cust.name);
    setAdvVia("cash");
    setAdvSplit(false);
    setAdvBank("");
    setAdvDate(nextIso);
    setAdvNote(nextDay.note);
    setAdvAmt(String(Math.min(nextDay.amount, room, CASH_DAY_LIMIT)));
  }

  // ---- record: payment voucher ----
  async function recordPv() {
    const a = Math.max(0, +amt || 0);
    if (!payee.trim()) return toast("Who was paid?");
    if (a <= 0) return toast("Enter an amount");
    if (via === "bank" && !bank.trim()) return toast("Pick the bank account");
    await recordPaymentVoucher({
      payee: payee.trim(),
      amount: a,
      via,
      bank,
      date: date ? toDmy(date) : undefined,
      note: note.trim(),
      by: user?.id || "unknown",
    });
    setPayee("");
    setAmt("");
    setNote("");
    setDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + " paid to " + payee.trim() + " · " + (via === "cash" ? "Cash" : bank));
  }

  async function removePv(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete payment voucher?",
      message: (e.label || "—") + " — ₹" + inr(e.amount) + " · " + (e.account || "Cash"),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id); // soft delete
    load();
    bumpData();
    toast("Voucher removed");
  }

  // ---- record: contra (cash ⇄ bank) ----
  async function recordCv() {
    const a = Math.max(0, +cvAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (!cvBank.trim()) return toast("Pick the bank account");
    await recordContra({
      dir: cvDir,
      bank: cvBank,
      amount: a,
      date: cvDate ? toDmy(cvDate) : undefined,
      note: cvNote.trim(),
      by: user?.id || "unknown",
    });
    setCvAmt("");
    setCvNote("");
    setCvDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + (cvDir === "dep" ? " deposited: Cash → " + cvBank : " withdrawn: " + cvBank + " → Cash"));
  }

  // ---- record: journal (bank → bank) ----
  async function recordJv() {
    const a = Math.max(0, +jvAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (!jvFrom.trim() || !jvTo.trim()) return toast("Pick both bank accounts");
    if (jvFrom === jvTo) return toast("From and To must be different banks");
    await recordJournal({
      from: jvFrom,
      to: jvTo,
      amount: a,
      date: jvDate ? toDmy(jvDate) : undefined,
      note: jvNote.trim(),
      by: user?.id || "unknown",
    });
    setJvAmt("");
    setJvNote("");
    setJvDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + " transferred: " + jvFrom + " → " + jvTo);
  }

  async function addLnType() {
    const next = await addLoanType(newLoanType);
    setLoanTypes(next);
    const n = newLoanType.trim();
    if (n) setLnType(next.find((x) => x.toLowerCase() === n.toLowerCase()) || n);
    setNewLoanType("");
    bumpData();
  }

  // ---- record: loan taken / repaid ----
  async function recordLn() {
    const a = Math.max(0, +lnAmt || 0);
    if (!lnType.trim()) return toast("Pick or add a loan type (Car, Home, …)");
    if (!lnLender.trim()) return toast(lnKind === "secured" ? "Which bank lent it?" : "Who lent the money?");
    if (a <= 0) return toast("Enter an amount");
    if (lnVia === "bank" && !lnBank.trim()) return toast("Pick which of our accounts this hits");
    const f = {
      loanType: lnType.trim(),
      kind: lnKind,
      lender: lnLender.trim(),
      amount: a,
      via: lnVia,
      bank: lnBank,
      date: lnDate ? toDmy(lnDate) : undefined,
      note: lnNote.trim(),
      by: user?.id || "unknown",
    };
    if (lnDir === "taken") await recordLoanTaken(f);
    else await recordLoanRepay(f);
    setLnAmt("");
    setLnNote("");
    setLnDate("");
    load();
    bumpData();
    const where = lnVia === "cash" ? "Cash" : lnBank;
    toast(
      lnDir === "taken"
        ? lnType.trim() + " loan ₹" + inr(a) + " into " + where
        : "Repaid ₹" + inr(a) + " (" + lnType.trim() + ") from " + where,
    );
  }

  // ---- record: personal drawings ----
  async function recordDr() {
    const a = Math.max(0, +drAmt || 0);
    if (a <= 0) return toast("Enter an amount");
    if (drVia === "bank" && !drBank.trim()) return toast("Pick which bank this comes from");
    await recordDrawing({
      amount: a,
      via: drVia,
      bank: drBank,
      date: drDate ? toDmy(drDate) : undefined,
      note: drNote.trim(),
      by: user?.id || "unknown",
    });
    setDrAmt("");
    setDrNote("");
    setDrDate("");
    load();
    bumpData();
    toast("₹" + inr(a) + " personal drawings from " + (drVia === "cash" ? "Cash" : drBank));
  }

  async function removeCustom(e: Expense, title: string) {
    const ok = await confirmDialog({
      title: "Delete " + title + "?",
      message: (e.label || "—") + " — ₹" + inr(e.amount) + " · " + (e.account || "Cash"),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id); // soft delete
    load();
    bumpData();
    toast("Removed");
  }

  async function removeMove(e: Expense) {
    const ok = await confirmDialog({
      title: "Delete " + (isJournal(e) ? "journal" : "contra") + " voucher?",
      message: moveText(e) + " — ₹" + inr(e.amount),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("expenses", e.id); // soft delete
    load();
    bumpData();
    toast("Voucher removed");
  }

  /** contra / journal book: one movement row per entry */
  const moveDayBlock = (g: DayGroup) => (
    <div className="db-day" key={g.date}>
      <div className="db-day-head">
        <span className="db-day-date">{g.date}</span>
        <span className="db-day-mini">
          {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} · moved ₹{inr(g.total)}
        </span>
      </div>
      {g.entries.map((e) => (
        <div className="stmt" key={e.id}>
          <div className="stmt-ic upi">⇄</div>
          <div className="stmt-main">
            <div className="stmt-to">{moveText(e)}</div>
            <div className="stmt-sub">
              {e.note ? e.note + " · " : ""}by {userName(e.enteredBy)}
            </div>
          </div>
          <div className="stmt-amt">₹{inr(e.amount)}</div>
          <span className="pb-rowacts">
            <button className="pb-x" title="Delete voucher" onClick={() => removeMove(e)}>×</button>
          </span>
        </div>
      ))}
    </div>
  );

  const dayBlock = (g: DayGroup, kind: "in" | "out") => (
    <div className="db-day" key={g.date}>
      <div className="db-day-head">
        <span className="db-day-date">{g.date}</span>
        <span className="db-day-mini">
          {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} · {kind === "in" ? "received" : "paid"} ₹{inr(g.total)}
        </span>
      </div>
      {g.entries.map((e) => {
        const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
        const isAdvance = kind === "in" && !inv && !!e.custId;
        return (
          <div
            className="stmt"
            key={e.id}
            style={kind === "in" && inv ? { cursor: "pointer" } : undefined}
            onClick={kind === "in" && inv ? () => router.push("/editor/" + inv.id) : undefined}
            title={kind === "in" && inv ? "Open invoice #" + inv.number : undefined}
          >
            <div className={"stmt-ic " + (kind === "out" ? "due" : e.mode === "upi" ? "upi" : "cash")}>
              {kind === "out" ? (isDrawing(e) ? "DR" : "PV") : e.mode === "upi" ? "Bank" : "₹"}
            </div>
            <div className="stmt-main">
              <div className="stmt-to">
                {kind === "in"
                  ? isAdvance
                    ? (e.note || custName(e.custId)) + " · Advance"
                    : (inv?.customerName || "Walk-in") + " · #" + (inv?.number || "—")
                  : e.label || "—"}
                <span className="acct-overall-hint"> · {e.account || "Cash"}</span>
                {isAdvance && <span className="acct-overall-hint"> · clears onto their next invoice</span>}
              </div>
              <div className="stmt-sub">
                {(kind === "in" ? e.label : e.note) ? (kind === "in" ? e.label : e.note) + " · " : ""}
                by {userName(e.enteredBy)}
              </div>
            </div>
            <div className={"stmt-amt" + (kind === "out" ? " due" : "")}>
              {kind === "in" ? "+" : "−"}₹{inr(e.amount)}
            </div>
            {(kind === "out" || isAdvance) && (
              <span className="pb-rowacts">
                <button
                  className="pb-x"
                  title={kind === "out" ? "Delete voucher" : "Delete advance"}
                  onClick={async (ev) => {
                    ev.stopPropagation();
                    if (kind === "out") return isDrawing(e) ? removeCustom(e, "drawing") : removePv(e);
                    const ok = await confirmDialog({
                      title: "Delete advance?",
                      message: (e.note || "—") + " — ₹" + inr(e.amount),
                      confirmLabel: "Delete",
                      danger: true,
                    });
                    if (!ok) return;
                    await delRec("expenses", e.id);
                    load();
                    bumpData();
                    toast("Advance removed");
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="cd-screen">
      <div className="sectitle" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>Vouchers <small>— receipt &amp; payment books</small></span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className="btn primary sm"
            onClick={async () => {
              if ((await printOrSavePdf(printRef.current, seg + "-vouchers-" + genOn)) === "pdf") toast("PDF downloaded ✓");
            }}
          >
            Print
          </button>
          <PdfButtons
            onPreview={() =>
              void generatePdf(printRef.current!, seg + "-vouchers-" + genOn, { preview: true }).catch(() =>
                toast("Could not create the PDF"),
              )
            }
            onDownload={async () => {
              toast("Preparing PDF…");
              await generatePdf(printRef.current!, seg + "-vouchers-" + genOn);
              toast("PDF downloaded ✓");
            }}
            downloadLabel="Save PDF"
          />
        </div>
      </div>

      <div className="db-seg" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button className={"seg-btn" + (seg === "receipts" ? " on" : "")} type="button" onClick={() => setSeg("receipts")}>
          Receipts · ₹{inr(rTotal)}
        </button>
        <button className={"seg-btn" + (seg === "payments" ? " on" : "")} type="button" onClick={() => setSeg("payments")}>
          Payments · ₹{inr(pTotal)}
        </button>
        <button className={"seg-btn" + (seg === "contra" ? " on" : "")} type="button" onClick={() => setSeg("contra")} title="Cash ⇄ bank: deposits and withdrawals">
          Contra · ₹{inr(cTotal)}
        </button>
        <button className={"seg-btn" + (seg === "journal" ? " on" : "")} type="button" onClick={() => setSeg("journal")} title="Bank → bank transfers between our own accounts">
          Journal · ₹{inr(jTotal)}
        </button>
        <button className={"seg-btn" + (seg === "loans" ? " on" : "")} type="button" onClick={() => setSeg("loans")} title="Secured bank loans & unsecured loans from individuals — land on cash/bank statements">
          Loans · ₹{inr(lnTotal)}
        </button>
        <button className={"seg-btn" + (seg === "drawings" ? " on" : "")} type="button" onClick={() => setSeg("drawings")} title="Personal drawings — money taken for own use from cash or a bank">
          Drawings · ₹{inr(drTotal)}
        </button>
      </div>

      {/* filters — same controls as Reports */}
      <div className="rep-controls">
        <div className="rep-presets">
          <button className="btn sm" onClick={() => preset("thisMonth")}>This month</button>
          <button className="btn sm" onClick={() => preset("lastMonth")}>Last month</button>
          <button className="btn sm" onClick={() => preset("fy")}>This FY</button>
          <button className="btn sm" onClick={() => preset("all")}>All time</button>
        </div>
        <div className="rep-range">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>
            Via
            <select value={viaF} onChange={(e) => { setViaF(e.target.value as "all" | "cash" | "bank"); if (e.target.value !== "bank") setBankF(""); }}>
              <option value="all">All</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </label>
          {viaF === "bank" && (
            <label>
              Bank
              <select value={bankF} onChange={(e) => setBankF(e.target.value)}>
                <option value="">All banks</option>
                {banks.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Search
            <input type="text" placeholder={seg === "receipts" ? "customer / invoice no…" : "payee / note…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </div>

      {seg === "receipts" ? (
        <>
          {/* direct advance receipt — no invoice yet; clears onto their next invoice */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Receive from a customer
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                advance — auto-clears when their next invoice is made
              </small>
            </div>
            <div className="rec-grid">
              <label className="modal-field" style={{ gridColumn: "1 / -1" }}>
                <span>Customer</span>
                <CustomerPicker
                  value={advName}
                  customers={customers}
                  onType={(v) => { setAdvName(v); setAdvCust(null); }}
                  onPick={(c) => { setAdvCust(c); setAdvName(c.name); }}
                  placeholder="Search an existing customer…"
                />
              </label>
              <label className="modal-field">
                <span>
                  Amount ₹{" "}
                  {advVia === "cash" && advCust && !advSplit ? (
                    <small style={{ color: advRoom <= 0 ? "var(--danger)" : "var(--ink-faint)" }}>(cash room ₹{inr(advRoom)} today)</small>
                  ) : null}
                </span>
                <input type="number" inputMode="decimal" placeholder="0" value={advAmt} onChange={(e) => onAdvAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>{advVia === "cash" && advSplit ? "From date" : "Date (optional)"}</span>
                <input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Note (optional)</span>
                <input type="text" placeholder="e.g. advance for teak order" value={advNote} onChange={(e) => setAdvNote(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">Via</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (advVia === "cash" ? " on" : "")} type="button" onClick={() => setAdvVia("cash")}>Cash</button>
                <button className={"seg-btn" + (advVia === "bank" ? " on" : "")} type="button" onClick={() => setAdvVia("bank")}>Bank</button>
              </div>
              {advVia === "bank" && (
                <select className="pb-sel" value={advBank} onChange={(e) => setAdvBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            {advVia === "cash" && (
              <label className="fp-print-opt" style={{ marginTop: 10 }} title="Big cash gets booked as ₹10,000-per-day entries automatically, walking forward from the chosen date">
                <input type="checkbox" checked={advSplit} onChange={(e) => setAdvSplit(e.target.checked)} />
                Split across days — ₹{inr(CASH_DAY_LIMIT)}/day booked automatically from the date
                {advSplit && +advAmt > CASH_DAY_LIMIT && (
                  <small>
                    {" "}→ ₹{inr(+advAmt || 0)} ≈ {Math.ceil((+advAmt || 0) / CASH_DAY_LIMIT)} daily entries
                  </small>
                )}
              </label>
            )}
            <button className="btn primary" type="button" onClick={recordAdvance} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              {advVia === "cash" && advSplit && +advAmt > CASH_DAY_LIMIT
                ? "Record " + Math.ceil((+advAmt || 0) / CASH_DAY_LIMIT) + " daily receipts"
                : "Record receipt"}
            </button>
            {nextDay && (
              <div className="acct-add-row" style={{ marginTop: 10, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button className="btn sm" type="button" onClick={addMoreNextDay} style={{ flex: "1 1 auto" }}>
                  Add ₹{inr(Math.min(nextDay.amount, CASH_DAY_LIMIT))} more next day
                  <small style={{ marginLeft: 6, opacity: 0.75 }}>
                    {nextDay.cust.name} · after {toDmy(nextDay.lastIso)}
                  </small>
                </button>
                <button className="btn sm" type="button" onClick={() => setNextDay(null)} title="Dismiss">
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {rGroups.length ? (
              rGroups.map((g) => dayBlock(g, "in"))
            ) : (
              <div className="empty">
                <div className="empty-title">No receipts{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Payments recorded inside invoices — and advances taken above — show here date-wise.</div>
              </div>
            )}
          </div>
        </>
      ) : seg === "payments" ? (
        <>
          {/* bank accounts — managed HERE, one clean place */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Bank accounts
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                used for payment vouchers and invoice receipts
              </small>
            </div>
            {banks.length > 0 && (
              <div className="vch-banks">
                {banks.map((b) => (
                  <span className="vch-bank" key={b}>
                    {b}
                    <button
                      className="pb-x"
                      type="button"
                      title={"Remove " + b + " from the pick list (old vouchers keep it)"}
                      onClick={async () => {
                        setBanks(await removeBankAccount(b));
                        if (bank === b) setBank("");
                        bumpData();
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="acct-add-row" style={{ alignItems: "flex-end", marginTop: banks.length ? 10 : 4 }}>
              <label className="modal-field" style={{ flex: "2 1 220px" }}>
                <span>Add a bank account</span>
                <input
                  type="text"
                  placeholder="e.g. HDFC Chitradurga · 50200006429458"
                  value={newBank}
                  onChange={(e) => setNewBank(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBank()}
                />
              </label>
              <button className="btn primary sm" type="button" onClick={addBank} disabled={!newBank.trim()}>
                Add bank
              </button>
            </div>
          </div>

          <div className="panel-card" style={{ padding: 14, marginTop: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>New payment voucher</div>
            <div className="rec-grid">
              <label className="modal-field">
                <span>Paid to</span>
                <input type="text" placeholder="e.g. KSRTC transport" value={payee} onChange={(e) => setPayee(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">Via</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (via === "cash" ? " on" : "")} type="button" onClick={() => setVia("cash")}>
                  Cash
                </button>
                <button className={"seg-btn" + (via === "bank" ? " on" : "")} type="button" onClick={() => setVia("bank")}>
                  Bank
                </button>
              </div>
              {via === "bank" && (
                <select className="pb-sel" value={bank} onChange={(e) => setBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. lorry freight for teak load" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary" type="button" onClick={recordPv} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              Record payment voucher
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {pGroups.length ? (
              pGroups.map((g) => dayBlock(g, "out"))
            ) : (
              <div className="empty">
                <div className="empty-title">No payment vouchers{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Money you pay out — freight, labour, purchases — recorded cash or bank.</div>
              </div>
            )}
          </div>
        </>
      ) : seg === "loans" ? (
        <>
          {/* loan types — add Car / Home / whatever once, then pick every time */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Loan types
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                Car, Home, or anything you add — shown clearly on every entry
              </small>
            </div>
            {loanTypes.length > 0 && (
              <div className="vch-banks">
                {loanTypes.map((t) => (
                  <span className="vch-bank" key={t}>
                    {t}
                    <button
                      className="pb-x"
                      type="button"
                      title={"Remove " + t + " from the list (old vouchers keep it)"}
                      onClick={async () => {
                        const next = await removeLoanType(t);
                        setLoanTypes(next);
                        if (lnType === t) setLnType(next[0] || "");
                        bumpData();
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="acct-add-row" style={{ alignItems: "flex-end", marginTop: loanTypes.length ? 10 : 4 }}>
              <label className="modal-field" style={{ flex: "2 1 220px" }}>
                <span>Add a loan type</span>
                <input
                  type="text"
                  placeholder="e.g. Car, Home, Tractor, Shop…"
                  value={newLoanType}
                  onChange={(e) => setNewLoanType(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addLnType()}
                />
              </label>
              <button className="btn primary sm" type="button" onClick={addLnType} disabled={!newLoanType.trim()}>
                Add type
              </button>
            </div>
          </div>

          <div className="panel-card" style={{ padding: 14, marginTop: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              New loan entry
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                full details — type, who lent it, and which of our books it hits
              </small>
            </div>
            <div className="rec-grid">
              <label className="modal-field">
                <span>What kind of loan</span>
                <select value={lnType} onChange={(e) => setLnType(e.target.value)}>
                  <option value="">— pick type —</option>
                  {loanTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={lnAmt} onChange={(e) => setLnAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={lnDate} onChange={(e) => setLnDate(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">Lent by</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (lnKind === "secured" ? " on" : "")} type="button" onClick={() => setLnKind("secured")}>
                  A bank
                </button>
                <button className={"seg-btn" + (lnKind === "unsecured" ? " on" : "")} type="button" onClick={() => setLnKind("unsecured")}>
                  A person
                </button>
              </div>
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>{lnKind === "secured" ? "Which bank" : "Who (name)"}</span>
              <input
                type="text"
                placeholder={lnKind === "secured" ? "e.g. Canara Bank Chitradurga" : "e.g. Abdul Rahman"}
                value={lnLender}
                onChange={(e) => setLnLender(e.target.value)}
              />
            </label>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">This is</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (lnDir === "taken" ? " on" : "")} type="button" onClick={() => setLnDir("taken")}>
                  Taking the loan (money in)
                </button>
                <button className={"seg-btn" + (lnDir === "repay" ? " on" : "")} type="button" onClick={() => setLnDir("repay")}>
                  Repaying (money out)
                </button>
              </div>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">{lnDir === "taken" ? "Money into" : "Money from"}</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (lnVia === "cash" ? " on" : "")} type="button" onClick={() => setLnVia("cash")}>Cash</button>
                <button className={"seg-btn" + (lnVia === "bank" ? " on" : "")} type="button" onClick={() => setLnVia("bank")}>Our bank</button>
              </div>
              {lnVia === "bank" && (
                <select className="pb-sel" value={lnBank} onChange={(e) => setLnBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— our bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. EMI 1 · account no…" value={lnNote} onChange={(e) => setLnNote(e.target.value)} />
            </label>
            <button className="btn primary" type="button" onClick={recordLn} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              {lnDir === "taken" ? "Record loan taken" : "Record repayment"}
              {lnType ? " — " + lnType : ""}
              {lnVia === "bank" && lnBank ? " → " + lnBank : lnVia === "cash" ? " → Cash" : ""}
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {lnGroups.length ? (
              lnGroups.map((g) => (
                <div className="db-day" key={g.date}>
                  <div className="db-day-head">
                    <span className="db-day-date">{g.date}</span>
                    <span className="db-day-mini">
                      {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"} · ₹{inr(g.total)}
                    </span>
                  </div>
                  {g.entries.map((e) => {
                    const taken = isLoanTaken(e);
                    return (
                      <div className="stmt" key={e.id}>
                        <div className={"stmt-ic " + (taken ? "cash" : "due")}>{taken ? "IN" : "OUT"}</div>
                        <div className="stmt-main">
                          <div className="stmt-to">
                            {(taken ? "Taken · " : "Repaid · ") + loanParticulars(e)}
                            <span className="acct-overall-hint">{" · "}{e.account || "Cash"}</span>
                          </div>
                          <div className="stmt-sub">
                            {e.note ? e.note + " · " : ""}by {userName(e.enteredBy)}
                          </div>
                        </div>
                        <div className={"stmt-amt" + (taken ? "" : " due")}>
                          {taken ? "+" : "−"}₹{inr(e.amount)}
                        </div>
                        <span className="pb-rowacts">
                          <button className="pb-x" title="Delete" onClick={() => removeCustom(e, "loan voucher")}>×</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="empty">
                <div className="empty-title">No loan vouchers{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Add a type (Car, Home…), then record taken or repaid — it shows on the Accounts cash/bank you pick.</div>
              </div>
            )}
          </div>
        </>
      ) : seg === "drawings" ? (
        <>
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              Personal drawings
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                money taken for personal use — reduces the cash or bank statement you pick
              </small>
            </div>
            <div className="rec-grid">
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={drAmt} onChange={(e) => setDrAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={drDate} onChange={(e) => setDrDate(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Note (optional)</span>
                <input type="text" placeholder="e.g. house expense" value={drNote} onChange={(e) => setDrNote(e.target.value)} />
              </label>
            </div>
            <div className="att-paidby" style={{ marginTop: 10 }}>
              <span className="att-paidby-lbl">From</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (drVia === "cash" ? " on" : "")} type="button" onClick={() => setDrVia("cash")}>Cash</button>
                <button className={"seg-btn" + (drVia === "bank" ? " on" : "")} type="button" onClick={() => setDrVia("bank")}>Bank</button>
              </div>
              {drVia === "bank" && (
                <select className="pb-sel" value={drBank} onChange={(e) => setDrBank(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">— bank account —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              )}
            </div>
            <button className="btn primary" type="button" onClick={recordDr} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              Record personal drawings{drVia === "bank" && drBank ? " — " + drBank : " — Cash"}
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {drGroups.length ? (
              drGroups.map((g) => dayBlock(g, "out"))
            ) : (
              <div className="empty">
                <div className="empty-title">No drawings{from || to || q || viaF !== "all" ? " in this filter" : " yet"}</div>
                <div className="empty-note">Personal drawings show as OUT on the Accounts cash book or the bank you chose.</div>
              </div>
            )}
          </div>
        </>
      ) : seg === "contra" ? (
        <>
          {/* contra: cash ⇄ bank — one entry lands in BOTH books automatically */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              New contra entry
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                cash deposited into a bank, or withdrawn back to cash — recorded in both books
              </small>
            </div>
            <div className="att-paidby" style={{ marginTop: 4 }}>
              <span className="att-paidby-lbl">Direction</span>
              <div className="db-seg sm">
                <button className={"seg-btn" + (cvDir === "dep" ? " on" : "")} type="button" onClick={() => setCvDir("dep")}>
                  Cash → Bank (deposit)
                </button>
                <button className={"seg-btn" + (cvDir === "wd" ? " on" : "")} type="button" onClick={() => setCvDir("wd")}>
                  Bank → Cash (withdraw)
                </button>
              </div>
            </div>
            <div className="rec-grid" style={{ marginTop: 10 }}>
              <label className="modal-field">
                <span>Bank account</span>
                <select value={cvBank} onChange={(e) => setCvBank(e.target.value)}>
                  <option value="">— pick —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={cvAmt} onChange={(e) => setCvAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={cvDate} onChange={(e) => setCvDate(e.target.value)} />
              </label>
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. week's cash banked" value={cvNote} onChange={(e) => setCvNote(e.target.value)} />
            </label>
            <button className="btn primary" type="button" onClick={recordCv} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              {cvDir === "dep" ? "Record deposit — Cash → " + (cvBank || "bank") : "Record withdrawal — " + (cvBank || "bank") + " → Cash"}
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {cGroups.length ? (
              cGroups.map(moveDayBlock)
            ) : (
              <div className="empty">
                <div className="empty-title">No contra entries{from || to || q ? " in this filter" : " yet"}</div>
                <div className="empty-note">Deposits and withdrawals show in the Cash book AND the bank&apos;s statement automatically.</div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* journal: our bank → our bank */}
          <div className="panel-card" style={{ padding: 14 }}>
            <div className="pc-head" style={{ paddingLeft: 0 }}>
              New journal entry
              <small style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                move money between our own banks — recorded on both statements
              </small>
            </div>
            <div className="rec-grid" style={{ marginTop: 4 }}>
              <label className="modal-field">
                <span>From bank</span>
                <select value={jvFrom} onChange={(e) => setJvFrom(e.target.value)}>
                  <option value="">— pick —</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span>To bank</span>
                <select value={jvTo} onChange={(e) => setJvTo(e.target.value)}>
                  <option value="">— pick —</option>
                  {banks
                    .filter((b) => b !== jvFrom)
                    .map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                </select>
              </label>
              <label className="modal-field">
                <span>Amount ₹</span>
                <input type="number" inputMode="decimal" placeholder="0" value={jvAmt} onChange={(e) => setJvAmt(e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Date (optional)</span>
                <input type="date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
              </label>
            </div>
            <label className="modal-field" style={{ marginTop: 10, width: "100%" }}>
              <span>Note (optional)</span>
              <input type="text" placeholder="e.g. moved for supplier NEFT" value={jvNote} onChange={(e) => setJvNote(e.target.value)} />
            </label>
            <button className="btn primary" type="button" onClick={recordJv} style={{ width: "100%", justifyContent: "center", marginTop: 12, padding: 12 }}>
              Record transfer{jvFrom && jvTo ? " — " + jvFrom + " → " + jvTo : ""}
            </button>
          </div>

          <div className="panel-card" style={{ padding: "0 0 4px", marginTop: 14 }}>
            {jGroups.length ? (
              jGroups.map(moveDayBlock)
            ) : (
              <div className="empty">
                <div className="empty-title">No journal entries{from || to || q ? " in this filter" : " yet"}</div>
                <div className="empty-note">Bank-to-bank transfers show on BOTH banks&apos; statements automatically.</div>
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* ---- printable voucher register (matches the active tab + filters) ---- */}
      <div className="cd-print rep-doc" ref={printRef}>
        <div className="rep-head">
          <div className="rep-brand">
            <h1>{brand.name || "Vouchers"}</h1>
            {brand.addr && <div>{brand.addr}</div>}
            {brand.gstin && <div>GSTIN: {brand.gstin}</div>}
          </div>
          <div className="rep-meta">
            <div className="rep-title">
              {seg === "receipts" ? "Receipt Vouchers"
                : seg === "payments" ? "Payment Vouchers"
                : seg === "contra" ? "Contra Vouchers"
                : seg === "journal" ? "Journal Vouchers"
                : seg === "loans" ? "Loan Vouchers"
                : "Personal Drawings"}
            </div>
            <div className="rep-period">
              {periodLabel}
              {viaF !== "all" ? " · " + (viaF === "cash" ? "Cash only" : bankF || "Bank only") : ""}
            </div>
          </div>
        </div>

        <div className="rep-summary cols3">
          <div><b>{shownOldestFirst.length}</b><span>Vouchers</span></div>
          <div><b>₹{inr(segTotal)}</b><span>{seg === "receipts" ? "Received" : seg === "payments" || seg === "drawings" ? "Paid" : seg === "loans" ? "Amount" : "Moved"}</span></div>
          <div><b>{periodLabel}</b><span>Period</span></div>
        </div>

        <table className="rep-table">
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="c-n">#</th>
              <th>Date</th>
              <th>
                {seg === "receipts" ? "Customer · Invoice"
                  : seg === "payments" ? "Paid to"
                  : seg === "loans" ? "Lender · Direction"
                  : seg === "drawings" ? "Drawings"
                  : "Movement"}
              </th>
              <th>Via</th>
              <th>Note</th>
              <th className="amt">Amount ₹</th>
            </tr>
          </thead>
          <tbody>
            {shownOldestFirst.map((e, i) => {
              const inv = e.sourceId ? invById.get(e.sourceId) : undefined;
              const who =
                seg === "receipts"
                  ? inv
                    ? (inv.customerName || "Walk-in") + " · #" + inv.number
                    : (e.note || custName(e.custId)) + " · Advance"
                  : seg === "payments" || seg === "drawings"
                    ? e.label || "—"
                    : seg === "loans"
                      ? (isLoanTaken(e) ? "Taken · " : "Repaid · ") + loanParticulars(e)
                      : moveText(e);
              const viaTxt =
                seg === "contra" || seg === "journal" ? (isJournal(e) ? "Transfer" : contraDir(e) === "dep" ? "Deposit" : "Withdrawal") : e.account || "Cash";
              return (
                <tr key={e.id}>
                  <td className="c-n">{i + 1}</td>
                  <td className="c-date">{e.date}</td>
                  <td className="c-cust">{who}</td>
                  <td>{viaTxt}</td>
                  <td className="c-cust">{(seg === "receipts" ? e.label : e.note) || "—"}</td>
                  <td className="amt">{inr(e.amount)}</td>
                </tr>
              );
            })}
            <tr className="rep-tot">
              <td colSpan={5}>Total — {shownOldestFirst.length} voucher{shownOldestFirst.length === 1 ? "" : "s"}</td>
              <td className="amt">{inr(segTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="rep-foot">Generated {genOn} · {brand.name}</div>
      </div>
    </div>
  );
}
