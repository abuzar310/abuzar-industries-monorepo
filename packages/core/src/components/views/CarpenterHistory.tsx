"use client";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/calc";
import type { CarpenterHistoryLine } from "@/lib/carpenter-financials";

/** Commission we paid — no receipts, no other spends. */
export default function CarpenterHistory({
  lines,
  showCarpenter,
}: {
  lines: CarpenterHistoryLine[];
  showCarpenter?: boolean;
}) {
  const router = useRouter();
  if (!lines.length) {
    return (
      <div className="empty" style={{ padding: 20 }}>
        <div className="empty-title">No commission paid yet</div>
        <div className="empty-note">Only Carpenter commission payouts from Receipts show here.</div>
      </div>
    );
  }
  return (
    <div className="panel-card cs-card" style={{ marginTop: 0 }}>
      {lines.map((p) => (
        <div className="stmt" key={p.id}>
          <div className="stmt-ic cash">₹</div>
          <div className="stmt-main">
            <div className="stmt-to">
              {showCarpenter ? (
                <button
                  type="button"
                  style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", fontWeight: 600 }}
                  onClick={() => router.push(p.href)}
                >
                  {p.carpenter}
                </button>
              ) : p.partyId ? (
                <button
                  type="button"
                  style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", fontWeight: 600 }}
                  onClick={() => router.push("/customers/" + p.partyId)}
                >
                  {p.party}
                </button>
              ) : (
                p.party
              )}
              {showCarpenter ? (
                <span className="acct-overall-hint"> · {p.party}</span>
              ) : p.quoteNo ? (
                <span className="acct-overall-hint"> · Q#{p.quoteNo}</span>
              ) : null}
              {showCarpenter && p.quoteNo ? <span className="acct-overall-hint"> · Q#{p.quoteNo}</span> : null}
            </div>
            <div className="stmt-sub">
              {p.date || "—"}
              {p.note ? " · " + p.note : ""}
            </div>
          </div>
          <div className="cs-amt">
            <div className="stmt-amt">₹{inr(p.amount)}</div>
            {p.quoteId && (
              <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => router.push("/editor/" + p.quoteId)}>
                Quote
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
