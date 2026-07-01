"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/db";
import { createInvoice, createQuotation } from "@/lib/create";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import type { Doc } from "@/lib/types";
import DocList from "./DocList";

interface Props {
  store: "quotations" | "invoices";
  title: string;
  sub: string;
  statusCol: string;
  empty: string;
  showNew?: boolean;
}

function applySearch(arr: Doc[], q: string) {
  q = (q || "").trim().toLowerCase();
  if (!q) return arr;
  return arr.filter((d) =>
    [d.id, d.customerName, d.phone, d.site].some((v) => String(v || "").toLowerCase().includes(q)),
  );
}

export default function DocListView({ store, title, sub, statusCol, empty, showNew }: Props) {
  const { dataVersion, searchTerm } = useApp();
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);

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

  const isInv = store === "invoices";
  async function onNew() {
    const d = isInv ? await createInvoice() : await createQuotation();
    toast("New " + d.id + " created");
    router.push("/editor/" + d.id);
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
      <div className="listwrap">
        <div className="lhead">
          <span>No.</span>
          <span>Customer</span>
          <span>Phone / Site</span>
          <span className="col-date">Date</span>
          <span className="col-status">{statusCol}</span>
          <span style={{ textAlign: "right" }}>Total / Actions</span>
        </div>
        <DocList docs={applySearch(docs, searchTerm)} empty={empty} />
      </div>
    </>
  );
}
