"use client";
import type { Ref } from "react";
import { inr } from "@/lib/calc";

/** One passbook line — same Date / Particulars / Dr / Cr / Balance as Accounts. */
export type PassbookLine = {
  key: string;
  date: string;
  who: string;
  detail?: string;
  debit: number;
  credit: number;
  balance: number;
  open?: boolean;
  close?: boolean;
};

export type PassbookGroup = {
  label: string;
  rows: PassbookLine[];
};

/** Hidden cream passbook. generatePdf clones it (cd-print → display:block). */
export default function PassbookPrint({
  printRef,
  summary,
  rows,
  groups,
  dr = "Dr",
  cr = "Cr",
  /** Accounts & customer statements: money held / still owed is Dr. Cash & month ledger: surplus is Cr. */
  positiveIsDr = true,
}: {
  printRef?: Ref<HTMLDivElement>;
  summary: { k: string; v: string }[];
  rows?: PassbookLine[];
  groups?: PassbookGroup[];
  dr?: string;
  cr?: string;
  positiveIsDr?: boolean;
}) {
  const blocks = groups ?? [{ label: "", rows: rows || [] }];
  const due = (n: number) => (positiveIsDr ? n > 0.5 : n < -0.5);
  return (
    <div className="cd-print acct-print acct-page pdf-book" ref={printRef}>
      {summary.length > 0 && (
        <div className={"acct-print-sum" + (summary.length >= 4 ? " cols4" : " cols3")}>
          {summary.map((s) => (
            <div key={s.k}>
              <span>{s.k}</span>
              <b>{s.v}</b>
            </div>
          ))}
        </div>
      )}
      <div className="bank-ledger acct-book">
        <div className="bank-hdr acct-print-hdr">
          <span>Date</span>
          <span>Particulars</span>
          <span className="bank-amt">{dr}</span>
          <span className="bank-amt">{cr}</span>
          <span className="bank-amt">Balance</span>
        </div>
        {blocks.map((block) => (
          <div key={block.label || "one"}>
            {block.label ? (
              <div className="bank-row bank-open acct-txn">
                <span className="bank-date" />
                <span className="bank-parts">
                  <span className="acct-txn-who">{block.label}</span>
                </span>
                <span className="bank-amt" />
                <span className="bank-amt" />
                <span className="bank-amt" />
              </div>
            ) : null}
            {block.rows.map((row) => {
              const isTxn = !row.open && !row.close;
              const closeDue = !!(row.close && due(row.balance));
              return (
                <div
                  key={row.key}
                  className={
                    "bank-row acct-txn" + (row.open ? " bank-open" : "") + (row.close ? " bank-total" : "")
                  }
                >
                  <span className="bank-date">{isTxn ? row.date : ""}</span>
                  <span className="bank-parts">
                    <span className="acct-txn-who">{row.who}</span>
                    {row.detail ? <small>{row.detail}</small> : null}
                  </span>
                  <span className={"bank-amt" + (row.debit > 0 ? " dr" : "")}>{row.debit > 0 ? "₹" + inr(row.debit) : ""}</span>
                  <span className={"bank-amt" + (row.credit > 0 ? " cr" : "")}>{row.credit > 0 ? "₹" + inr(row.credit) : ""}</span>
                  <span className={"bank-amt bal" + (row.close ? (closeDue ? " due" : " ok") : "")}>
                    ₹{inr(Math.abs(row.balance))}
                    {!row.open && (
                      <span className={"bal-tag " + (due(row.balance) ? "dr" : "cr")}>{due(row.balance) ? "Dr" : "Cr"}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
