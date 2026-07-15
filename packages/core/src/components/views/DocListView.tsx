"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { computeDoc, dateSortKey, inr } from "@/lib/calc";
import { createInvoice, createQuotation } from "@/lib/create";
import { seriesOf } from "@/lib/invoice-id";
import { trashDoc } from "@/lib/trash";
import { quoteBill } from "@/lib/payments";
import { getFeatures } from "@/lib/features";
import { brandFor } from "@/lib/brand";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Doc } from "@/lib/types";
import { StatusBadge } from "./DocList";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Month-wise rollup of quotations for the printable report (dd-mm-yy → per-month rows). */
function monthlyReport(docs: Doc[]) {
  interface MRow { key: string; label: string; count: number; created: number; billed: number; paid: number }
  const map = new Map<string, MRow>();
  for (const d of docs) {
    const [, mm = "", yy = ""] = (d.date || "").split("-");
    const key = yy && mm ? `20${yy}-${mm}` : "unknown";
    const label = yy && mm ? `${MONTH_NAMES[parseInt(mm, 10)] || mm} 20${yy}` : "No date";
    let r = map.get(key);
    if (!r) {
      r = { key, label, count: 0, created: 0, billed: 0, paid: 0 };
      map.set(key, r);
    }
    r.count++;
    const isCreated = d.status !== "Draft";
    if (isCreated) {
      r.created++;
      r.billed += quoteBill(d);
    }
    r.paid += +d.amountPaid || 0;
  }
  const rows = [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  const total = rows.reduce(
    (t, r) => ({ count: t.count + r.count, created: t.created + r.created, billed: t.billed + r.billed, paid: t.paid + r.paid }),
    { count: 0, created: 0, billed: 0, paid: 0 },
  );
  return { rows, total };
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
  const { dataVersion, searchTerm, user, brandMode } = useApp();
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
    const base = isInv && trade !== "all" ? docs.filter((d) => seriesOf(d) === trade) : docs;
    return applySearch(base, q || searchTerm);
  }, [docs, q, searchTerm, isInv, trade]);
  // report follows the active search, so what you print is what you see
  const report = useMemo(() => (canReport ? monthlyReport(filtered) : null), [canReport, filtered]);
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
    <div className={canReport ? "cd-screen" : undefined}>
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
            <button className="btn sm" title="Month-wise totals — print or save as PDF" onClick={() => window.print()}>
              Report / PDF
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
        <span className="s-count">{filtered.length}</span>
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
                  {isInv && d.tradeType === "buy" ? d.supplierBillNo || d.number || d.id : d.number || d.id}
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
                </span>
                <span className="mut col-date">{d.date}</span>
                <span className="col-status">
                  <StatusBadge doc={d} />
                </span>
                <span>
                  <div className="amt">₹ {inr(t.grand)}</div>
                  <div className="acts">
                    <button className="btn sm" onClick={(e) => act(e, "")}>Open</button>
                    <button className="btn sm" onClick={(e) => act(e, "?action=print")}>Print</button>
                    <button className="btn wa sm" onClick={(e) => act(e, "?action=wa")}>WhatsApp</button>
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

    {/* printable quotations report — rendered only on print (Report / PDF button) */}
    {canReport && report && (
      <div className="cd-print rep-doc">
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
          <div><b>{report.total.count}</b><span>Quotations</span></div>
          <div><b>₹{inr(report.total.billed)}</b><span>Billed (created)</span></div>
          <div><b>₹{inr(report.total.paid)}</b><span>Received</span></div>
        </div>

        <table className="rep-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "17%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Month</th>
              <th className="amt">Quotes</th>
              <th className="amt">Created</th>
              <th className="amt">Billed ₹</th>
              <th className="amt">Received ₹</th>
              <th className="amt">Balance ₹</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="amt">{r.count}</td>
                <td className="amt">{r.created}</td>
                <td className="amt">{inr(r.billed)}</td>
                <td className="amt">{inr(r.paid)}</td>
                <td className="amt">{inr(Math.max(0, r.billed - r.paid))}</td>
              </tr>
            ))}
            <tr className="rep-tot">
              <td>Total — {report.rows.length} month{report.rows.length === 1 ? "" : "s"}</td>
              <td className="amt">{report.total.count}</td>
              <td className="amt">{report.total.created}</td>
              <td className="amt">{inr(report.total.billed)}</td>
              <td className="amt">{inr(report.total.paid)}</td>
              <td className="amt">{inr(Math.max(0, report.total.billed - report.total.paid))}</td>
            </tr>
          </tbody>
        </table>

        <div className="rep-foot">Generated {new Date().toLocaleDateString("en-GB")} · {brand.name}</div>
      </div>
    )}
    </>
  );
}
