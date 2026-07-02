"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { computeDoc, inr } from "@/lib/calc";
import { createInvoice, createQuotation } from "@/lib/create";
import { deleteExpensesBySource } from "@/lib/expenses";
import { unpostInvoice } from "@/lib/ledger-autopost";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Doc } from "@/lib/types";
import { StatusBadge } from "./DocList";

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
  return arr.filter((d) => [d.id, d.customerName, d.phone, d.site].some((v) => String(v || "").toLowerCase().includes(q)));
}

export default function DocListView({ store, title, sub, statusCol, empty, showNew }: Props) {
  const { dataVersion, searchTerm } = useApp();
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const isInv = store === "invoices";

  useEffect(() => {
    let live = true;
    allRec<Doc>(store).then((arr) => {
      arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      if (live) setDocs(arr);
    });
    return () => {
      live = false;
    };
  }, [store, dataVersion]);

  const filtered = useMemo(() => applySearch(docs, q || searchTerm), [docs, q, searchTerm]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageN = Math.min(page, pages - 1);
  const view = filtered.slice(pageN * PAGE, pageN * PAGE + PAGE);
  const allOnPage = view.length > 0 && view.every((d) => sel.has(d.id));

  useEffect(() => {
    setPage(0);
  }, [q, searchTerm]);

  const open = (id: string, suffix = "") => router.push("/editor/" + id + suffix);
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
    const d = isInv ? await createInvoice() : await createQuotation();
    toast("New " + d.id + " created");
    router.push("/editor/" + d.id);
  }
  async function bulkDelete() {
    const ids = [...sel];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Delete ${ids.length} ${isInv ? "invoice" : "quotation"}${ids.length === 1 ? "" : "s"}?`,
      message: "This removes them from this device and the cloud. This cannot be undone.",
      confirmLabel: "Delete " + ids.length,
      danger: true,
    });
    if (!ok) return;
    toast("Deleting…");
    for (const id of ids) {
      await delRec(store, id);
      await cloudDelete(store, id);
      await deleteExpensesBySource(id);
      if (isInv) await unpostInvoice(id);
    }
    setSel(new Set());
    bumpData();
    toast(ids.length + " deleted");
  }

  return (
    <>
      <div className="sectitle">
        {title} <small>— {sub}</small>
      </div>

      {showNew && (
        <div className="rowbtns">
          <button className="btn primary sm" onClick={onNew}>
            {isInv ? "+ New Custom Invoice" : "+ New Quotation"}
          </button>
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

      {sel.size > 0 && (
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
            <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on page" />
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
              open(d.id, suffix);
            };
            return (
              <div className={"lrow" + (sel.has(d.id) ? " picked" : "")} key={d.id} onClick={() => open(d.id)} style={{ cursor: "pointer" }}>
                <span className="id selcol">
                  <input
                    type="checkbox"
                    checked={sel.has(d.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(d.id)}
                    aria-label={"Select " + d.id}
                  />
                  {d.id}
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
          <button className="btn sm" disabled={pageN === 0} onClick={() => setPage(pageN - 1)}>‹ Prev</button>
          <span>Page {pageN + 1} of {pages}</span>
          <button className="btn sm" disabled={pageN >= pages - 1} onClick={() => setPage(pageN + 1)}>Next ›</button>
        </div>
      )}
    </>
  );
}
