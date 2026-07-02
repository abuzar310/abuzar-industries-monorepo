"use client";
import { useRouter } from "next/navigation";
import { computeDoc, inr } from "@/lib/calc";
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
  const open = (id: string, suffix = "") => router.push("/editor/" + id + suffix);
  return (
    <>
      {docs.map((d) => {
        const t = computeDoc(d);
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
              <div className="amt">₹ {inr(t.grand)}</div>
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
