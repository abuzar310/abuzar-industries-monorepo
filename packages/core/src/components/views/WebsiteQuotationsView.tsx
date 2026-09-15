"use client";
// Landing-site quote inbox — Pending → Import to Quotation (new FY number) / Delete.
import { useCallback, useEffect, useMemo, useState } from "react";
import { TabIcon } from "../Icons";
import { useRouter } from "next/navigation";
import { allRec, delRec, put } from "@/lib/data";
import { createQuotation } from "@/lib/create";
import { inr, nowIso, qty } from "@/lib/calc";
import { useApp } from "@/store/useApp";
import { bumpData, setWebsitePending, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import Pager, { PAGE, usePager } from "@/components/Pager";
import type { WebsiteQuotation } from "@/lib/types";

type Filter = "pending" | "imported" | "all";

function fmtWhen(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yy} ${hh}:${mi}`;
}

export default function WebsiteQuotationsView() {
  const { ready, dataVersion, cloakMoney } = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<WebsiteQuotation[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    allRec<WebsiteQuotation>("websiteQuotations").then((list) => {
      list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setRows(list);
      setWebsitePending(list.filter((w) => w.status === "Pending").length);
    });
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const shown = useMemo(() => {
    if (cloakMoney) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((w) => {
      if (filter === "pending" && w.status !== "Pending") return false;
      if (filter === "imported" && w.status !== "Imported") return false;
      if (!needle) return true;
      return [w.customerName, w.phone, w.woodType, w.id, w.importedNumber]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, filter, q, cloakMoney]);

  const wqPg = usePager(shown, PAGE, filter + "\0" + q);
  const pendingN = rows.filter((w) => w.status === "Pending").length;

  async function onImport(w: WebsiteQuotation) {
    if (busyId) return;
    setBusyId(w.id);
    try {
      const secs =
        w.sections && w.sections.length
          ? w.sections.map((s) => ({
              name: s.woodType || "Teak Wood",
              rate: s.rate && s.rate > 0 ? String(s.rate) : "",
              calcMode: "cft" as const,
              rows: (s.rows || []).map((r) => ({
                l: String(r.l),
                w: String(r.w),
                t: String(r.t),
                pcs: String(r.pcs),
              })),
            }))
          : [
              {
                name: w.woodType || "Teak Wood",
                rate: "",
                calcMode: "cft" as const,
                rows: (w.rows || []).map((r) => ({
                  l: String(r.l),
                  w: String(r.w),
                  t: String(r.t),
                  pcs: String(r.pcs),
                })),
              },
            ];
      const doc = await createQuotation({
        customerName: w.customerName || "",
        phone: w.phone || "",
        sections: secs,
        notes: "From website · " + w.id,
        status: "Draft",
      });
      const next: WebsiteQuotation = {
        ...w,
        status: "Imported",
        importedQuotationId: doc.id,
        importedNumber: doc.number,
        updatedAt: nowIso(),
      };
      await put("websiteQuotations", next);
      setWebsitePending(rows.filter((x) => x.id !== w.id && x.status === "Pending").length);
      bumpData();
      toast("Imported as " + (doc.number || "quotation") + " ✓");
      router.push("/editor/" + doc.id);
    } catch {
      toast("Could not import quotation");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(w: WebsiteQuotation) {
    if (busyId) return;
    const ok = await confirmDialog({
      title: "Delete website quotation?",
      message: (w.customerName || "This submission") + " will be removed from the list (soft-delete — recoverable in DB).",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusyId(w.id);
    try {
      await delRec("websiteQuotations", w.id);
      bumpData();
      toast("Deleted");
    } catch {
      toast("Could not delete");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="wq-page ph-kit">
      <div className="wq-head">
        <div>
          <h1 className="wq-title"><span className="phone-ico ph-only"><TabIcon icon="file-text" size={18} /></span>Website Quotations</h1>
          <p className="wq-sub">
            Quotes sent from the website. Review first — Import creates a real numbered quotation.
          </p>
        </div>
        <div className="wq-kpis">
          <div className="wq-kpi">
            <span>Pending</span>
            <strong>{qty(pendingN)}</strong>
          </div>
          <div className="wq-kpi">
            <span>Total</span>
            <strong>{qty(rows.length)}</strong>
          </div>
        </div>
      </div>

      <div className="wq-toolbar">
        <div className="db-seg">
          {(
            [
              ["pending", "Pending"],
              ["imported", "Imported"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={"seg-btn" + (filter === id ? " on" : "")}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === "pending" && pendingN > 0 ? ` (${pendingN})` : ""}
            </button>
          ))}
        </div>
        <input
          className="wq-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / phone / wood…"
        />
      </div>

      {!shown.length ? (
        <div className="empty">
          <div className="empty-title">
            {cloakMoney ? "Hidden" : filter === "pending" ? "No pending website quotes" : "Nothing here"}
          </div>
          <div className="empty-note">
            {cloakMoney
              ? "Money cloak is on."
              : "When someone uses Send to us on the website, it shows up here."}
          </div>
        </div>
      ) : (
        <>
        <ul className="wq-list">
          {wqPg.view.map((w) => {
            const open = openId === w.id;
            return (
              <li key={w.id} className={"wq-card" + (w.status === "Imported" ? " imported" : "")}>
                <button
                  type="button"
                  className="wq-card-main"
                  onClick={() => setOpenId(open ? null : w.id)}
                >
                  <div className="wq-card-top">
                    <strong>{w.customerName || "—"}</strong>
                    <span className={"wq-status " + (w.status === "Pending" ? "pend" : "done")}>
                      {w.status}
                    </span>
                  </div>
                  <div className="wq-card-meta">
                    <span>{w.phone || "no phone"}</span>
                    <span>{w.woodType || "—"}</span>
                    <span>{qty(w.totalCft, 2)} CFT</span>
                    <span>est. ₹{inr(w.estimate)}</span>
                    <span>{fmtWhen(w.createdAt)}</span>
                  </div>
                </button>

                {open && (
                  <div className="wq-detail">
                    {w.sections && w.sections.length > 1 ? (
                      w.sections.map((sec, si) => (
                        <div key={si} className="wq-sec">
                          <div className="wq-sec-title">
                            {sec.woodType}
                            {sec.rate ? ` · ₹${inr(sec.rate)}/CFT` : ""}
                            {" · "}
                            {qty(sec.totalCft, 2)} CFT
                          </div>
                          <table className="wq-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>L (ft)</th>
                                <th>W (in)</th>
                                <th>T (in)</th>
                                <th>Pcs</th>
                                <th>CFT</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(sec.rows || []).map((r, i) => (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td>{r.l}</td>
                                  <td>{r.w}</td>
                                  <td>{r.t}</td>
                                  <td>{r.pcs}</td>
                                  <td>{qty(r.cft, 2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))
                    ) : (
                      <table className="wq-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>L (ft)</th>
                            <th>W (in)</th>
                            <th>T (in)</th>
                            <th>Pcs</th>
                            <th>CFT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(w.rows || []).map((r, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{r.l}</td>
                              <td>{r.w}</td>
                              <td>{r.t}</td>
                              <td>{r.pcs}</td>
                              <td>{qty(r.cft, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="wq-actions">
                      {w.status === "Pending" ? (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={busyId === w.id}
                          onClick={() => onImport(w)}
                        >
                          {busyId === w.id ? "Importing…" : "Import to Quotation"}
                        </button>
                      ) : w.importedQuotationId ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => router.push("/editor/" + w.importedQuotationId)}
                        >
                          Open {w.importedNumber || "quotation"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busyId === w.id}
                        onClick={() => onDelete(w)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <Pager page={wqPg.page} pages={wqPg.pages} total={wqPg.total} onPage={wqPg.setPage} />
        </>
      )}
    </div>
  );
}
