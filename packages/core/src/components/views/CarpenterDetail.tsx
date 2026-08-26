"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { allRec } from "@/lib/data";
import { inr } from "@/lib/calc";
import {
  carpenterCommissionHistory,
  carpenterHref,
  findCarpenterRollup,
} from "@/lib/carpenter-financials";
import { deleteCarpenter, editCarpenterDialog, listCarpenters, setCarpenterPhoto } from "@/lib/carpenters";
import { dialPhone, waLink } from "@/lib/whatsapp";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";
import CarpenterHistory, { CarpenterPendingList } from "./CarpenterHistory";
import PhotoField from "../PhotoField";
import type { Carpenter, Customer, Doc, Expense } from "@/lib/types";

export default function CarpenterDetail({ id }: { id: string }) {
  const { ready, dataVersion, cloakMoney } = useApp();
  const router = useRouter();
  const [directory, setDirectory] = useState<Carpenter[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      listCarpenters(),
      allRec<Customer>("customers"),
      allRec<Doc>("quotations"),
      allRec<Expense>("expenses"),
    ]).then(([carp, c, q, e]) => {
      setDirectory(carp);
      setCustomers(c);
      setQuotes(q);
      setExpenses(e);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  const rollup = cloakMoney ? null : findCarpenterRollup(directory, customers, quotes, expenses, id);

  if (!loaded) return <div className="sectitle">Carpenter <small>— loading…</small></div>;
  if (!rollup) {
    return (
      <div className="empty">
        <div className="empty-title">{cloakMoney ? "Hidden" : "Carpenter not found"}</div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => router.push("/carpenters")}>
          ← Back to carpenters
        </button>
      </div>
    );
  }

  const history = carpenterCommissionHistory([rollup]);

  async function saveContact() {
    const next = await editCarpenterDialog(
      rollup!.record ||
        ({
          name: rollup!.name,
          phone: rollup!.phone,
          phoneAlt: rollup!.phoneAlt,
          village: rollup!.village,
          city: rollup!.city,
          notes: rollup!.notes,
          photo: rollup!.photo,
        } as Carpenter),
    );
    if (!next) return;
    load();
    bumpData();
    if (!rollup!.record) router.replace(carpenterHref(rollup!.key, next.id));
  }
  async function savePhoto(photo: string) {
    const next = await setCarpenterPhoto(rollup!, photo);
    load();
    bumpData();
    toast(photo ? "Photo saved" : "Photo removed");
    if (!rollup!.record) router.replace(carpenterHref(rollup!.key, next.id));
  }
  function whatsapp(phone?: string) {
    const n = (phone || "").trim();
    if (!n) return;
    window.open(waLink(n, "Hello " + (rollup!.name || "")), "_blank");
  }
  function call(phone?: string) {
    const n = (phone || "").trim();
    if (!n) return;
    dialPhone(n);
  }
  function recordCommission() {
    const q = new URLSearchParams({ paid: "carpenter", carpenter: rollup!.name });
    router.push("/receipts?" + q.toString());
  }
  async function remove() {
    if (!rollup!.record) return;
    const ok = await confirmDialog({
      title: "Delete " + rollup!.name + "?",
      message: "Removes this carpenter contact only. Customers and commission payouts stay.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteCarpenter(rollup!.record.id);
    toast("Carpenter deleted");
    router.push("/carpenters");
  }

  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={() => router.push("/carpenters")}>
        ← Carpenters
      </button>

      <div className="custcard" style={{ cursor: "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="carp-card-top" style={{ flex: "1 1 220px" }}>
            <PhotoField
              size={96}
              name={rollup.name}
              value={rollup.photo || rollup.record?.photo || ""}
              onChange={(url) => void savePhoto(url)}
            />
            <div className="carp-who">
            <h3 style={{ fontSize: 26 }}>{rollup.name}</h3>
            <div className="ph">{rollup.phone || "—"}</div>
            {rollup.phoneAlt ? <div className="ph">Alt {rollup.phoneAlt}</div> : null}
            <div className="meta2">
              {(rollup.village || rollup.city) && (
                <>
                  {[rollup.village, rollup.city].filter(Boolean).join(", ")}
                  <br />
                </>
              )}
              {rollup.notes && <>Note: {rollup.notes}</>}
            </div>
            </div>
          </div>
          <div className="links" style={{ marginTop: 0 }}>
            <button className="btn primary sm" onClick={recordCommission}>
              Record commission
            </button>
            {rollup.phone && (
              <>
                <button className="btn call sm" onClick={() => call(rollup.phone)}>
                  Call
                </button>
                <button className="btn wa sm" onClick={() => whatsapp(rollup.phone)}>
                  WhatsApp
                </button>
              </>
            )}
            {rollup.phoneAlt && rollup.phoneAlt !== rollup.phone && (
              <>
                <button className="btn call sm" onClick={() => call(rollup.phoneAlt)}>
                  Call alt
                </button>
                <button className="btn wa sm" onClick={() => whatsapp(rollup.phoneAlt)}>
                  Alt WhatsApp
                </button>
              </>
            )}
            <button className="btn sm" onClick={saveContact}>
              {rollup.record ? "Edit" : "Save contact"}
            </button>
            {rollup.record && (
              <button className="btn warn sm" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 16 }}>
        <div className="stat">
          <div className="k">Customers</div>
          <div className="v">{rollup.customerCount}</div>
        </div>
        <div className="stat">
          <div className="k">Paid them</div>
          <div className="v money">₹ {inr(rollup.commissionTotal)}</div>
          <div className="sub">{rollup.payoutCount} payout{rollup.payoutCount === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="k">Pending</div>
          <div className="v money">₹ {inr(rollup.pendingTotal)}</div>
          <div className="sub">{rollup.pendingCount} locked</div>
        </div>
        <div className="stat">
          <div className="k">Last payout</div>
          <div className="v" style={{ fontSize: 22 }}>{rollup.lastPaid || "—"}</div>
        </div>
      </div>

      <div className="dash-section" style={{ marginTop: 22 }}>
        Customers <span>· {rollup.customerCount}</span>
      </div>
      {rollup.customers.length ? (
        <div className="panel-card" style={{ marginTop: 0 }}>
          <table className="carp-roster">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="col-phone">Phone</th>
                <th className="num">Quotes</th>
              </tr>
            </thead>
            <tbody>
              {rollup.customers.map((c) => (
                <tr
                  key={c.id || c.name}
                  onClick={c.id ? () => router.push("/customers/" + c.id) : undefined}
                  style={{ cursor: c.id ? "pointer" : "default" }}
                >
                  <td>
                    <div className="nm">{c.name}</div>
                  </td>
                  <td className="col-phone">
                    <div className="ph">{c.phone || "—"}</div>
                  </td>
                  <td className="num">{c.quoteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-title">No customers yet</div>
          <div className="empty-note">They show here when a customer or quotation names this carpenter.</div>
        </div>
      )}

      {rollup.pendingCount > 0 && (
        <>
          <div className="dash-section" style={{ marginTop: 22 }}>
            Pending
            <span>· locked, not yet given</span>
          </div>
          <CarpenterPendingList
            lines={rollup.pending.map((p) => ({
              ...p,
              href: carpenterHref(rollup.key, rollup.record?.id),
            }))}
          />
        </>
      )}

      <div className="dash-section" style={{ marginTop: 22 }}>
        Transaction history
        <span>· commission we paid</span>
      </div>
      {history.length ? (
        <CarpenterHistory lines={history} />
      ) : (
        <div className="empty">
          <div className="empty-title">No commission yet</div>
          <div className="empty-note">Only Carpenter commission payouts show here.</div>
          <button className="btn primary sm" style={{ marginTop: 12 }} onClick={recordCommission}>
            Record commission
          </button>
        </div>
      )}
    </div>
  );
}
