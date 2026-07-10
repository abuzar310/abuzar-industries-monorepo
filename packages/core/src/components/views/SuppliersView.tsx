"use client";
import { useCallback, useEffect, useState } from "react";
import { allRec, delRec } from "@/lib/db";
import { cloudDelete } from "@/lib/cloud";
import { editSupplierDialog } from "@/lib/customer-form";
import { seedSuppliersFromPurchases } from "@/lib/suppliers";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import type { Supplier } from "@/lib/types";

function applySearch(list: Supplier[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    [c.name, c.phone, c.gstin, c.address].some((v) => String(v || "").toLowerCase().includes(q)),
  );
}

export default function SuppliersView() {
  const { dataVersion, searchTerm } = useApp();
  const [list, setList] = useState<Supplier[]>([]);

  const load = useCallback(() => {
    allRec<Supplier>("suppliers").then((c) => {
      c.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setList(c);
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

  async function add() {
    const c = await editSupplierDialog();
    if (c) {
      load();
      bumpData();
      toast("Supplier " + c.name + " added");
    }
  }
  async function edit(e: React.MouseEvent, s: Supplier) {
    e.stopPropagation();
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
    await delRec("suppliers", s.id);
    await cloudDelete("suppliers", s.id);
    load();
    bumpData();
    toast("Supplier removed");
  }

  const shown = applySearch(list, searchTerm);

  return (
    <div>
      <div className="sectitle">
        Suppliers <small>— {list.length} contact{list.length === 1 ? "" : "s"} for purchases</small>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        Separate from Customers. Add suppliers here, then pick them on Purchase entry.
      </p>
      <div className="rowbtns">
        <button className="btn primary sm" onClick={add}>
          + Add supplier
        </button>
      </div>
      <div className="custgrid">
        {shown.length ? (
          shown.map((s) => (
            <div className="custcard" key={s.id}>
              <h3>{s.name}</h3>
              <div className="ph">{s.phone || "—"}</div>
              <div className="meta2">
                {s.gstin && (
                  <>
                    GSTIN: {s.gstin}
                    <br />
                  </>
                )}
                {s.address || "—"}
              </div>
              <div className="links">
                <button className="btn sm" type="button" onClick={(e) => edit(e, s)}>
                  Edit
                </button>
                <button className="btn warn sm" type="button" onClick={(e) => remove(e, s)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">{searchTerm ? "No matches." : "No suppliers yet — add one above."}</div>
        )}
      </div>
    </div>
  );
}
