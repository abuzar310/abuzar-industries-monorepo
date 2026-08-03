"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { computeDoc, dateSortKey, inr, qty } from "@/lib/calc";
import { createInvoice, createQuotation } from "@/lib/create";
import { seriesOf } from "@/lib/invoice-id";
import { trashDoc } from "@/lib/trash";
import { quoteBill } from "@/lib/payments";
import { openTab } from "@/lib/editor-tabs";
import { getFeatures } from "@/lib/features";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Doc } from "@/lib/types";
import { StatusBadge } from "./DocList";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A quote counts as money once it's Created OR money was taken against it — the ONE
 *  rule shared with Balances/Statements/Customers. A pure Draft is never counted. */
const isBillable = (d: Doc) =>
  d.status === "Created" ||
  (+(d.payCash || 0)) > 0 ||
  (+(d.payUpi || 0)) > 0 ||
  (+(d.amountPaid || 0)) > 0;

/** Month-wise report of quotations: every quotation listed under its month, with
 *  per-month subtotals (count + amount + paid) and grand totals. Pure drafts are
 *  listed for completeness but their amounts are NOT counted in any total. */
function monthlyReport(docs: Doc[]) {
  interface MGroup { key: string; label: string; docs: Doc[]; count: number; billedCount: number; billed: number; paid: number }
  const map = new Map<string, MGroup>();
  for (const d of docs) {
    const [, mm = "", yy = ""] = (d.date || "").split("-");
    const key = yy && mm ? `20${yy}-${mm}` : "0000-00";
    const label = yy && mm ? `${MONTH_NAMES[parseInt(mm, 10)] || mm} 20${yy}` : "No date";
    let g = map.get(key);
    if (!g) {
      g = { key, label, docs: [], count: 0, billedCount: 0, billed: 0, paid: 0 };
      map.set(key, g);
    }
    g.docs.push(d);
    g.count++;
    if (isBillable(d)) {
      g.billedCount++;
      g.billed += quoteBill(d);
      g.paid += +d.amountPaid || 0;
    }
  }
  const groups = [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  for (const g of groups) g.docs.sort((a, b) => (b.number || "").localeCompare(a.number || ""));
  const total = groups.reduce(
    (t, g) => ({ count: t.count + g.count, billedCount: t.billedCount + g.billedCount, billed: t.billed + g.billed, paid: t.paid + g.paid }),
    { count: 0, billedCount: 0, billed: 0, paid: 0 },
  );
  return { groups, total };
}

interface Props {
  store: "quotations" | "invoices";
  title: string;
  sub: string;
  statusCol: string;
  empty: string;
  showNew?: boolean;
}

const PAGE = 15;

function applySearch(arr: Doc[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return arr;
  return arr.filter((d) =>
    [d.id, d.number, d.supplierBillNo, d.customerName, d.phone, d.site, d.custGstin].some((v) =>
      String(v || "").toLowerCase().includes(q),
    ),
  );
}

export default function DocListView({ store, title, sub, statusCol, empty, showNew }: Props) {
  const { dataVersion, searchTerm, user, brandMode, cloakMoney } = useApp();
  // manager can delete quotations too (soft-delete → Recycle bin; owner controls restore/purge);
  // invoices stay owner-only
  const canDelete = user?.role === "owner" || store === "quotations";
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // invoices only: All / Sales / Purchases / Rented — rented invoices are their own
  // series (R-1, R-2, …), so they get their own tab and stay out of "Sales"
  const [trade, setTrade] = useState<"all" | "sell" | "buy" | "rent">("all");
  const isInv = store === "invoices";
  // quotations report (unofficial app): printable month-wise summary — count + billed + received
  const canReport = !isInv && getFeatures().simpleQuote;
  const brand = brandFor(brandMode);

  useEffect(() => {
    let live = true;
    allRec<Doc>(store).then((arr) => {
      const active = arr.filter((d) => !d.deletedAt && !d.purgedAt); // bin + archive stay out of lists
      if (store === "invoices") {
        // invoices: newest number on top (falls back to createdAt when numbers tie / are non-numeric)
        const num = (d: Doc) => {
          const m = String(d.number || d.id || "").match(/(\d+)\D*$/);
          return m ? parseInt(m[1], 10) : 0;
        };
        active.sort((a, b) => num(b) - num(a) || (b.createdAt || "").localeCompare(a.createdAt || ""));
      } else {
        // quotations: newest by their DOCUMENT date first, so a back-dated quote lands
        // in the right place. Docs whose date can't be parsed fall back to createdAt, and
        // createdAt breaks any ties between two quotes sharing the same day.
        const key = (d: Doc) => dateSortKey(d.date) || (d.createdAt || "").slice(0, 10);
        active.sort(
          (a, b) => key(b).localeCompare(key(a)) || (b.createdAt || "").localeCompare(a.createdAt || ""),
        );
      }
      if (live) setDocs(active);
    });
    return () => {
      live = false;
    };
  }, [store, dataVersion]);

  const filtered = useMemo(() => {
    // panic cloak: not a single quotation/invoice row — looks like a fresh empty app
    if (cloakMoney) return [];
    const base = isInv && trade !== "all" ? docs.filter((d) => seriesOf(d) === trade) : docs;
    return applySearch(base, q || searchTerm);
  }, [docs, q, searchTerm, isInv, trade, cloakMoney]);
  // report follows the active search, so what you export is what you see
  const report = useMemo(() => (canReport ? monthlyReport(filtered) : null), [canReport, filtered]);
  const reportRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  async function downloadReport() {
    if (!reportRef.current || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { generatePdf } = await import("@/lib/pdf");
      const d = new Date();
      const stamp = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
      await generatePdf(reportRef.current, "quotations-report-" + stamp);
      toast("Report PDF downloaded ✓");
    } catch (e) {
      toast("PDF error: " + ((e as Error)?.message || e));
    } finally {
      setPdfBusy(false);
    }
  }
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageN = Math.min(page, pages - 1);
  const view = filtered.slice(pageN * PAGE, pageN * PAGE + PAGE);
  const allOnPage = view.length > 0 && view.every((d) => sel.has(d.id));

  useEffect(() => {
    setPage(0);
    setSel(new Set()); // a search / filter change hides rows; don't keep them silently selected
  }, [q, searchTerm, trade]);

  const open = (d: Doc, suffix = "") => {
    if (isInv && d.tradeType === "buy") {
      router.push("/purchases/" + encodeURIComponent(d.id) + suffix);
      return;
    }
    const action = suffix.startsWith("?action=") ? suffix.slice(8) : undefined;
    openTab(d.id, d.number, d.displayNumber, action);
    router.push("/editor/" + d.id + suffix);
  };
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((s) => {
      const n = new Set(s);
      if (allOnPage) view.forEach((d) => n.delete(d.id));
      else view.forEach((d) => n.add(d.id));
      return n;
    });

  async function onNew() {
    // numbering is allocated atomically by the server — no pre-pull needed
    const d = isInv ? await createInvoice() : await createQuotation();
    toast("New " + d.number + " created");
    if (!isInv) openTab(d.id, d.number, d.displayNumber);
    router.push("/editor/" + d.id);
  }
  function onNewPurchase() {
    router.push("/purchases");
  }
  async function bulkDelete() {
    const ids = [...sel];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Move ${ids.length} ${isInv ? "invoice" : "quotation"}${ids.length === 1 ? "" : "s"} to Recycle bin?`,
      message: "They leave your list but aren't lost — restore anytime from Settings → Recycle bin.",
      confirmLabel: "Move " + ids.length + " to bin",
    });
    if (!ok) return;
    toast("Moving to bin…");
    // soft-delete only — nothing is hard-removed, so a mis-select is always recoverable
    for (const id of ids) await trashDoc(store, id);
    setSel(new Set());
    bumpData();
    toast(ids.length + " moved to Recycle bin");
  }

  return (
    <>
    <div>
      <div className="sectitle">
        {title} <small>— {sub}</small>
      </div>

      {showNew && (
        <div className="rowbtns">
          <button className="btn primary sm" onClick={onNew}>
            {isInv ? "+ New Sales Invoice" : "+ New Quotation"}
          </button>
          {isInv && (
            <button className="btn sm" onClick={onNewPurchase}>
              + New Purchase
            </button>
          )}
          {canReport && (
            <button
              className="btn sm"
              title="Download a month-wise quotations report as PDF"
              disabled={pdfBusy}
              onClick={downloadReport}
            >
              {pdfBusy ? "Preparing…" : "Download report PDF"}
            </button>
          )}
        </div>
      )}

      {isInv && (
        <div className="rowbtns" style={{ marginBottom: 6 }}>
          <div className="rep-seg" role="group" aria-label="Filter by trade type">
            {(["all", "sell", "buy", "rent"] as const).map((t) => (
              <button key={t} className={trade === t ? "on" : ""} onClick={() => setTrade(t)}>
                {t === "all" ? "All" : t === "sell" ? "Sales" : t === "buy" ? "Purchases" : "Rented"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="searchbar">
        <span className="s-ic" aria-hidden="true">⌕</span>
        <input
          placeholder={`Search ${isInv ? "invoices" : "quotations"} — number, customer, phone…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button className="s-clear" onClick={() => setQ("")} aria-label="Clear search">×</button>
        )}
        <span className="s-count">{qty(filtered.length)}</span>
      </div>

      {canDelete && sel.size > 0 && (
        <div className="bulkbar">
          <span>
            <b>{sel.size}</b> selected
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <button className="btn warn sm" onClick={bulkDelete}>Delete selected</button>
            <button className="btn sm" onClick={() => setSel(new Set())}>Clear</button>
          </span>
        </div>
      )}

      <div className="listwrap">
        <div className="lhead">
          <span className="selcol">
            {canDelete && <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on page" />}
            No.
          </span>
          <span>Customer</span>
          <span>Phone / Carpenter</span>
          <span className="col-date">Date</span>
          <span className="col-status">{statusCol}</span>
          <span style={{ textAlign: "right" }}>Total / Actions</span>
        </div>

        {view.length ? (
          view.map((d) => {
            const t = computeDoc(d);
            // the agreed final price when fixed (matches Balances/Customers), else the computed total
            const bill = d.kind === "invoice" ? t.grand : quoteBill(d);
            const hasFinal = Math.abs(bill - t.grand) > 0.5;
            const act = (e: React.MouseEvent, suffix: string) => {
              e.stopPropagation();
              open(d, suffix);
            };
            return (
              <div className={"lrow" + (sel.has(d.id) ? " picked" : "")} key={d.id} onClick={() => open(d)} style={{ cursor: "pointer" }}>
                <span className="id selcol">
                  {canDelete && (
                    <input
                      type="checkbox"
                      checked={sel.has(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(d.id)}
                      aria-label={"Select " + d.id}
                    />
                  )}
                  {isInv && d.tradeType === "buy" ? d.supplierBillNo || d.number || d.id : d.displayNumber || d.number || d.id}
                  {isInv && d.tradeType === "buy" ? (
                    <span className="mut" style={{ display: "block", fontSize: 11 }}>
                      Purchase{d.number ? ` · #${d.number}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className="nm">{d.customerName || "—"}</span>
                <span className="mut">
                  {d.phone}
                  <br />
                  {d.site}
                  {d.sitePhone ? <><br />{d.sitePhone}</> : null}
                </span>
                <span className="mut col-date">{d.date}</span>
                <span className="col-status">
                  <StatusBadge doc={d} />
                </span>
                <span>
                  <div className="amt">₹ {inr(bill)}</div>
                  {hasFinal && <div className="mut" style={{ fontSize: 11 }}>final · quote ₹{inr(t.grand)}</div>}
                  {(() => {
                    const paid = Math.round((+(d.amountPaid || 0)) * 100) / 100;
                    const bal = Math.round((bill - paid) * 100) / 100;
                    const owes = bal > 2;
                    return (
                      <div style={{ margin: "3px 0 4px", lineHeight: 1.3 }}>
                        {owes ? (
                          <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700, fontFamily: "var(--mono)" }}>
                            Due: ₹{inr(bal)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 700, fontFamily: "var(--mono)" }}>
                            ✓ ₹{inr(paid)} paid
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="acts">
                    <button className="btn sm" onClick={(e) => act(e, "")}>Open</button>
                    <button className="btn sm" onClick={(e) => act(e, "?action=print")}>Print</button>
                    <button className="btn wa sm" onClick={(e) => act(e, "?action=wa")}>WhatsApp</button>
                    {(() => {
                      const paid = Math.round((+(d.amountPaid || 0)) * 100) / 100;
                      const bal = Math.round((bill - paid) * 100) / 100;
                      if (bal > 2) {
                        const hasPhone = d.phone?.trim().length > 5;
                        return (
                          <button className="btn sm" style={{ color: "var(--ochre-deep)", borderColor: hasPhone ? "var(--ochre)" : "var(--line-2)", opacity: hasPhone ? 1 : 0.5 }}
                            onClick={(e) => { if (!hasPhone) return; e.stopPropagation(); act(e, "?action=remind-balance"); }}
                            title={hasPhone ? "Send payment reminder on WhatsApp" : "Add customer phone number to send reminder"}
                          >💰 Remind</button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">{q || searchTerm ? "No matches." : empty}</div>
        )}
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn sm" disabled={pageN === 0} onClick={() => { setPage(pageN - 1); setSel(new Set()); }}>‹ Prev</button>
          <span>Page {pageN + 1} of {pages}</span>
          <button className="btn sm" disabled={pageN >= pages - 1} onClick={() => { setPage(pageN + 1); setSel(new Set()); }}>Next ›</button>
        </div>
      )}
    </div>

    {/* quotations report — laid out off-screen, exported as a PDF download.
        Every quotation is listed under its month with per-month subtotals. */}
    {canReport && report && (
      <div style={{ position: "fixed", left: -10000, top: 0, width: 900, pointerEvents: "none" }} aria-hidden="true">
        <div ref={reportRef} className="rep-doc" style={{ display: "block", background: "#FAF6EF", padding: 24 }}>
          <div className="rep-head">
            <div className="rep-brand">
              <h1>{brand.name || "Quotations"}</h1>
              {brand.addr && <div>{brand.addr}</div>}
            </div>
            <div className="rep-meta">
              <div className="rep-title">Quotations report</div>
              <div className="rep-period">{q || searchTerm ? `Search: “${(q || searchTerm).trim()}”` : "All time · month-wise"}</div>
            </div>
          </div>

          <div className="rep-summary cols3">
            <div><b>{qty(report.total.count)}</b><span>Quotations</span></div>
            <div><b>₹{inr(report.total.billed)}</b><span>Billed amount</span></div>
            <div><b>₹{inr(report.total.paid)}</b><span>Received</span></div>
          </div>
          {report.total.count > report.total.billedCount && (
            <div style={{ fontSize: 12, color: "#8a7f6d", marginTop: 6 }}>
              Draft quotations with no payment are listed in (brackets) but never counted in any total.
            </div>
          )}

          {report.groups.map((g) => (
            <div key={g.key} style={{ marginTop: 14 }}>
              <div className="rep-title" style={{ marginBottom: 6 }}>
                {g.label} — {g.count} quotation{g.count === 1 ? "" : "s"} · ₹{inr(g.billed)}
              </div>
              <table className="rep-table">
                <colgroup>
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "13%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="c-n">#</th>
                    <th>Date</th>
                    <th>Quote No</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th className="amt">Amount ₹</th>
                    <th className="amt">Paid ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {g.docs.map((d, i) => (
                    <tr key={d.id} style={isBillable(d) ? undefined : { color: "#8a7f6d" }}>
                      <td className="c-n">{i + 1}</td>
                      <td className="c-date">{d.date}</td>
                      <td className="c-no">{d.displayNumber || d.number}</td>
                      <td className="c-cust">{d.customerName || "Walk-in"}</td>
                      <td>{isBillable(d) ? d.status : "Draft — not counted"}</td>
                      <td className="amt">{isBillable(d) ? inr(quoteBill(d)) : "(" + inr(quoteBill(d)) + ")"}</td>
                      <td className="amt">{inr(+d.amountPaid || 0)}</td>
                    </tr>
                  ))}
                  <tr className="rep-tot">
                    <td colSpan={5}>
                      {g.label} total — {g.billedCount} billed quotation{g.billedCount === 1 ? "" : "s"}
                      {g.count > g.billedCount ? ` (+ ${g.count - g.billedCount} draft${g.count - g.billedCount === 1 ? "" : "s"} not counted)` : ""}
                    </td>
                    <td className="amt">{inr(g.billed)}</td>
                    <td className="amt">{inr(g.paid)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          <table className="rep-table" style={{ marginTop: 14 }}>
            <tbody>
              <tr className="rep-tot">
                <td style={{ width: "74%" }}>
                  Grand total — {report.total.billedCount} billed quotation{report.total.billedCount === 1 ? "" : "s"} across {report.groups.length} month{report.groups.length === 1 ? "" : "s"}
                  {report.total.count > report.total.billedCount ? ` (+ ${report.total.count - report.total.billedCount} drafts not counted)` : ""}
                </td>
                <td className="amt" style={{ width: "13%" }}>{inr(report.total.billed)}</td>
                <td className="amt" style={{ width: "13%" }}>{inr(report.total.paid)}</td>
              </tr>
            </tbody>
          </table>

          <div className="rep-foot">Generated {new Date().toLocaleDateString("en-GB")} · {brand.name}</div>
        </div>
      </div>
    )}
    </>
  );
}
