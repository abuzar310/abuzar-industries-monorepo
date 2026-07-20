"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec, delRec } from "@/lib/data";
import { editSupplierDialog } from "@/lib/customer-form";
import { seedSuppliersFromPurchases } from "@/lib/suppliers";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Doc, Supplier } from "@/lib/types";

function applySearch(list: Supplier[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.name, c.phone, c.gstin, c.address].some((v) => String(v || "").toLowerCase().includes(q)),
  );
}

export default function SuppliersView() {
  const { dataVersion, searchTerm } = useApp();
  const router = useRouter();
  const [list, setList] = useState<Supplier[]>([]);
  const [buys, setBuys] = useState<Doc[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    Promise.all([allRec<Supplier>("suppliers"), allRec<Doc>("invoices")]).then(([c, invs]) => {
      c.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setList(c);
      setBuys(invs.filter((d) => d.tradeType === "buy" && !d.deletedAt && !d.purgedAt));
    });
  }, []);

  useEffect(() => {
    seedSuppliersFromPurchases()
      .then((n) => {
        if (n > 0) {
          toast(`Imported ${n} supplier${n === 1 ? "" : "s"} from purchases`);
          bumpData();
        }
      })
      .catch(() => {})
      .finally(load);
  }, [load, dataVersion]);

  const purchaseCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of buys) {
      const key = d.customerId || d.customerName?.trim().toLowerCase() || "";
      if (!key) continue;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [buys]);

  function countFor(s: Supplier) {
    return (
      (s.id ? purchaseCount.get(s.id) || 0 : 0) ||
      purchaseCount.get((s.name || "").trim().toLowerCase()) ||
      0
    );
  }

  async function add() {
    const c = await editSupplierDialog();
    if (c) {
      load();
      bumpData();
      toast("Supplier " + c.name + " added");
    }
  }
  async function edit(s: Supplier) {
    const next = await editSupplierDialog(s);
    if (next) {
      load();
      bumpData();
    }
  }
  async function remove(e: React.MouseEvent, s: Supplier) {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: "Delete " + s.name + "?",
      message: "Past purchase records are kept; only this supplier contact is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await delRec("suppliers", s.id); // soft delete — the row stays recoverable in the database
    load();
    bumpData();
    toast("Supplier removed");
  }

  const shown = applySearch(list, q || searchTerm);

  return (
    <div>
      <div className="sectitle">
        Suppliers <small>— {list.length} contact{list.length === 1 ? "" : "s"}</small>
      </div>
      <div className="rowbtns">
        <button className="btn primary sm" type="button" onClick={add}>
          + Add supplier
        </button>
        <button className="btn sm" type="button" onClick={() => router.push("/purchases")}>
          + New purchase
        </button>
      </div>

      <div className="searchbar">
        <span className="s-ic" aria-hidden>
          ⌕
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, GSTIN…"
          aria-label="Search suppliers"
        />
        {q ? (
          <button type="button" className="s-clear" onClick={() => setQ("")} aria-label="Clear">
            ×
          </button>
        ) : null}
        <span className="s-count">{shown.length}</span>
      </div>

      <div className="listwrap" style={{ marginTop: 10 }}>
        <div className="lhead sup-lhead">
          <span>Name</span>
          <span>Phone</span>
          <span>GSTIN</span>
          <span>Purchases</span>
          <span>Address</span>
          <span />
        </div>
        {shown.length ? (
          shown.map((s) => {
            const n = countFor(s);
            return (
              <div
                className="lrow sup-lrow"
                key={s.id}
                onClick={() => edit(s)}
                style={{ cursor: "pointer" }}
                title="Edit supplier"
              >
                <span className="nm">{s.name || "—"}</span>
                <span className="mut">{s.phone || "—"}</span>
                <span className="mut">{s.gstin || "—"}</span>
                <span className="amt" style={{ textAlign: "left" }}>
                  {n || "—"}
                </span>
                <span className="mut" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.address || "—"}
                </span>
                <span className="acts" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" type="button" onClick={() => edit(s)}>
                    Edit
                  </button>
                  <button className="btn warn sm" type="button" onClick={(e) => remove(e, s)}>
                    Delete
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">
            <div className="empty-title">{q || searchTerm ? "No matches" : "No suppliers yet"}</div>
            <div className="empty-note">
              {q || searchTerm
                ? "Try a different search."
                : "Add one above, or record a purchase — suppliers are saved automatically."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
