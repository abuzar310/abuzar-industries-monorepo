"use client";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/calc";
import {
  deleteCommLock,
  pendingPayHref,
  type CarpenterHistoryLine,
  type CarpenterPendingLine,
  type CarpenterQuoteLine,
} from "@/lib/carpenter-financials";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";

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

/** Locked commission still owed. Pay opens Receipts with carpenter, party, quote, amount filled. */
export function CarpenterPendingList({
  lines,
  showCarpenter,
}: {
  lines: CarpenterPendingLine[];
  showCarpenter?: boolean;
}) {
  const router = useRouter();
  async function removeLock(p: CarpenterPendingLine) {
    const ok = await confirmDialog({
      title: "Delete this lock?",
      message:
        "Remove the ₹" +
        inr(p.locked) +
        " lock on Q#" +
        (p.quoteNo || p.quoteId) +
        " for " +
        p.carpenter +
        "? The quotation stays. Money already given stays in history.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const gone = await deleteCommLock(p.quoteId);
    if (!gone) return toast("Lock already gone");
    bumpData();
    toast("Lock deleted");
  }
  if (!lines.length) {
    return (
      <div className="empty" style={{ padding: 20 }}>
        <div className="empty-title">No commission waiting</div>
        <div className="empty-note">Lock an amount on a quotation and it shows here until paid.</div>
      </div>
    );
  }
  return (
    <div className="panel-card cs-card" style={{ marginTop: 0 }}>
      {lines.map((p) => (
        <div className="stmt" key={p.quoteId}>
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
              {showCarpenter ? <span className="acct-overall-hint"> · {p.party}</span> : null}
              {p.quoteNo ? <span className="acct-overall-hint"> · Q#{p.quoteNo}</span> : null}
            </div>
            <div className="stmt-sub">
              Locked ₹{inr(p.locked)}
              {p.given > 0 ? ` · given ₹${inr(p.given)}` : ""}
            </div>
          </div>
          <div className="cs-amt">
            <div className="stmt-amt">₹{inr(p.pending)}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {p.quoteId && (
                <button type="button" className="btn sm" onClick={() => router.push("/editor/" + p.quoteId)}>
                  Quote
                </button>
              )}
              <button type="button" className="btn primary sm" onClick={() => router.push(pendingPayHref(p))}>
                Pay
              </button>
              <button type="button" className="btn warn sm" onClick={() => void removeLock(p)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CarpenterQuoteList({
  lines,
  showParty,
  empty,
}: {
  lines: CarpenterQuoteLine[];
  showParty?: boolean;
  empty: string;
}) {
  const router = useRouter();
  if (!lines.length) {
    return (
      <div className="empty" style={{ padding: 20 }}>
        <div className="empty-title">{empty}</div>
      </div>
    );
  }
  return (
    <div className="panel-card" style={{ marginTop: 0 }}>
      <table className="carp-roster">
        <thead>
          <tr>
            <th>Date</th>
            <th>Quote</th>
            {showParty ? <th>Party</th> : null}
            <th className="num">Bill</th>
            <th className="num">Paid</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((q) => (
            <tr key={q.id} onClick={() => router.push("/editor/" + q.id)} style={{ cursor: "pointer" }}>
              <td className="mut">{q.date || "—"}</td>
              <td>
                <div className="nm">#{q.number || q.id}</div>
                {q.status ? <div className="ph">{q.status}</div> : null}
              </td>
              {showParty ? <td>{q.party}</td> : null}
              <td className="num">₹ {inr(q.bill)}</td>
              <td className="paid">{q.paid > 0 ? "₹ " + inr(q.paid) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
