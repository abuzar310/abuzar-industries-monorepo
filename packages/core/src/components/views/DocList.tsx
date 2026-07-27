"use client";
import { useRouter } from "next/navigation";
import { computeDoc, docVolumeCft, inr } from "@/lib/calc";
import { quoteBill } from "@/lib/payments";
import { openTab } from "@/lib/editor-tabs";
import type { Doc } from "@/lib/types";

const STATUS_BADGE: Record<string, string> = {
  Draft: "b-draft",
  Sent: "b-sent",
  "Follow-up Pending": "b-follow",
  Confirmed: "b-confirm",
  Rejected: "b-reject",
  "Converted to Invoice": "b-conv",
};

export function StatusBadge({ doc }: { doc: Doc }) {
  if (doc.kind === "invoice") return <span className="badge b-conv">Invoice</span>;
  return <span className={"badge " + (STATUS_BADGE[doc.status] || "b-draft")}>{doc.status}</span>;
}

export default function DocList({ docs, empty }: { docs: Doc[]; empty: string }) {
  const router = useRouter();
  if (!docs.length) return <div className="empty">{empty}</div>;
  const open = (id: string, suffix = "") => {
    openTab(id, "", suffix.startsWith("?action=") ? suffix.slice(8) : undefined);
    router.push("/editor");
  };
  return (
    <>
      {docs.map((d) => {
        const t = computeDoc(d);
        const cft = docVolumeCft(d);
        // what the row shows: the agreed final price when one is fixed (same as Balances), else the computed total
        const bill = d.kind === "invoice" ? t.grand : quoteBill(d);
        const hasFinal = Math.abs(bill - t.grand) > 0.5;
        const act = (e: React.MouseEvent, suffix: string) => {
          e.stopPropagation();
          open(d.id, suffix);
        };
        return (
          <div className="lrow" key={d.id} onClick={() => open(d.id)} style={{ cursor: "pointer" }}>
            <span className="id">{d.id}</span>
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
              <div className="amt">₹ {inr(bill)}</div>
              {hasFinal && <div className="mut" style={{ fontSize: 11 }}>final · quote ₹{inr(t.grand)}</div>}
              {cft > 0 && <div className="mut" style={{ fontSize: 12 }}>{inr(cft)} CFT</div>}
              <div className="acts">
                <button className="btn sm" onClick={(e) => act(e, "")}>
                  Open
                </button>
                <button className="btn sm" onClick={(e) => act(e, "?action=print")}>
                  Print
                </button>
                <button className="btn wa sm" onClick={(e) => act(e, "?action=wa")}>
                  WhatsApp
                </button>
              </div>
            </span>
          </div>
        );
      })}
    </>
  );
}
