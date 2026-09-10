"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dateSortKey, inr, todayStr } from "@/lib/calc";
import { editCarpenterDialog, listCarpenters } from "@/lib/carpenters";
import { allRec } from "@/lib/data";
import { allExpenses } from "@/lib/expenses";
import {
  MONTH_NAMES,
  ensurePlaceRentTenants,
  findDuplicateCarpenters,
  monthCharged,
  monthFirstDay,
  pendingForTenant,
  placeRentDue,
  placeRentStatement,
  removePlaceRentTxn,
  yearFromDmy,
  yearMonthsCharged,
} from "@/lib/place-rent";
import { confirmDialog } from "@/store/dialog-store";
import { useApp } from "@/store/useApp";
import { bumpData, toast } from "@/store/app-store";
import type { Carpenter, Doc, Expense } from "@/lib/types";
import {
  HistList,
  mergeDuplicates,
  pullCarpenter,
  r2,
  rentSlots,
  type HistLine,
} from "./rent-ui";

export default function RentView() {
  const { ready, dataVersion, cloakMoney } = useApp();
  const router = useRouter();
  const [tenants, setTenants] = useState<Carpenter[]>([]);
  const [directory, setDirectory] = useState<Carpenter[]>([]);
  const [quotes, setQuotes] = useState<Doc[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const load = useCallback(() => {
    Promise.all([ensurePlaceRentTenants(), listCarpenters(), allRec<Doc>("quotations"), allExpenses()]).then(
      ([t, dir, q, e]) => {
        setTenants(cloakMoney ? [] : t);
        setDirectory(cloakMoney ? [] : dir);
        setQuotes(cloakMoney ? [] : q);
        setExpenses(cloakMoney ? [] : e);
      },
    );
  }, [cloakMoney]);

  useEffect(() => {
    if (ready) load();
  }, [ready, dataVersion, load]);

  async function onPull(current?: Carpenter) {
    const next = await pullCarpenter(current, directory);
    if (!next) return;
    bumpData();
    load();
    toast("Rent card is " + next.name);
    router.push("/rent/" + encodeURIComponent(next.id));
  }

  async function onMerge(tenant: Carpenter) {
    const next = await mergeDuplicates(tenant, directory);
    if (!next) return;
    bumpData();
    load();
    toast("Merged into " + next.name);
    router.push("/rent/" + encodeURIComponent(next.id));
  }

  async function onEdit(tenant: Carpenter) {
    const res = await editCarpenterDialog(tenant);
    if (!res) return;
    bumpData();
    load();
    if (res === "deleted") return;
    toast("Saved " + res.name);
  }

  async function removeHist(id: string) {
    const e = expenses.find((x) => x.id === id);
    if (!e) return;
    const kind =
      e.placeRentKind === "charge" ? "this month tick" : e.placeRentKind === "setoff" ? "this commission" : "this cash";
    const ok = await confirmDialog({
      title: "Remove " + kind + "?",
      message:
        "₹" +
        inr(+e.amount || 0) +
        (e.placeRentKind === "charge" ? " comes off what they owe." : " goes back on what they owe.") +
        " Comes off the books. Tick the month or take the cash again if you need it back.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await removePlaceRentTxn(e);
      bumpData();
      load();
      toast("Removed ₹" + inr(+e.amount || 0));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove");
    }
  }

  const slots = rentSlots(tenants);
  const linked = slots.filter((s) => s.tenant);
  const history: HistLine[] = tenants
    .flatMap((c) =>
      placeRentStatement(c, expenses)
        .filter((e) => e.kind !== "setoff")
        .map((e) => ({ ...e, who: c.name, href: "/rent/" + encodeURIComponent(c.id) })),
    )
    .sort((a, b) => {
      const d = (dateSortKey(b.date) || b.at || "").localeCompare(dateSortKey(a.date) || a.at || "");
      if (d) return d;
      return (b.at || "").localeCompare(a.at || "");
    });

  return (
    <div>
      <div className="sectitle">
        Rent <small>— two people. Tap a card to open the year and tick the months they owe.</small>
      </div>
      <div className="rent-hero">
        {slots.map((slot, i) =>
          slot.tenant ? (
            <HeroCard
              key={slot.tenant.id}
              tenant={slot.tenant}
              quotes={quotes}
              expenses={expenses}
              directory={directory}
              onOpen={() => router.push("/rent/" + encodeURIComponent(slot.tenant!.id))}
              onEdit={() => void onEdit(slot.tenant!)}
              onPull={() => void onPull(slot.tenant)}
              onMerge={() => void onMerge(slot.tenant!)}
            />
          ) : (
            <VacantCard key={"vacant-" + (slot.seed || i)} seed={slot.seed || "Tenant"} onPull={() => void onPull()} />
          ),
        )}
      </div>
      {!linked.length && !cloakMoney && (
        <div className="empty">
          <div className="empty-title">No tenant linked yet</div>
          <div className="empty-note">Pull Ismail or Suresha from Carpenters — use the plywood / planning names already in the directory.</div>
        </div>
      )}
      {!!linked.length && (
        <details className="sqltoggle rent-hist" open>
          <summary>Place rent history</summary>
          <HistList
            items={history}
            empty="Charge, cash received, and old balance for both people show here. Tap a card above for one person."
            resetKey={"desk-" + history.length}
            onQuote={(id) => router.push("/editor/" + id)}
            onWho={(href) => router.push(href)}
            onRemove={(id) => void removeHist(id)}
          />
        </details>
      )}
    </div>
  );
}

function VacantCard({ seed, onPull }: { seed: string; onPull: () => void }) {
  return (
    <div className="rent-pick vacant">
      <div className="rent-pick-top">
        <span className="rent-pick-name">{seed}</span>
      </div>
      <div className="rent-pick-phone">Not linked</div>
      <div className="rent-pick-k">Pull from Carpenters</div>
      <div className="rent-pick-sub">Use the person already in the directory</div>
      <div className="rent-pick-tools">
        <button type="button" className="rent-ico" onClick={onPull}>
          Pull
        </button>
      </div>
    </div>
  );
}

function HeroCard({
  tenant,
  quotes,
  expenses,
  directory,
  onOpen,
  onEdit,
  onPull,
  onMerge,
}: {
  tenant: Carpenter;
  quotes: Doc[];
  expenses: Expense[];
  directory: Carpenter[];
  onOpen: () => void;
  onEdit: () => void;
  onPull: () => void;
  onMerge: () => void;
}) {
  const due = placeRentDue(tenant, expenses);
  const pendingSum = r2(pendingForTenant(tenant, quotes, expenses).reduce((s, p) => s + p.pending, 0));
  const headline = due > 0.5 ? "They owe" : pendingSum > 0.5 ? "We owe" : "Settled";
  const headAmt = due > 0.5 ? due : pendingSum > 0.5 ? pendingSum : 0;
  const year = yearFromDmy(todayStr());
  const ticked = yearMonthsCharged(tenant, expenses, year);
  const monthly = r2(+(tenant.monthlyRent || 0) || 0);
  const dups = findDuplicateCarpenters(tenant, directory);

  return (
    <div className="rent-pick">
      <button type="button" className="rent-pick-main" onClick={onOpen}>
        <div className="rent-pick-top">
          <span className="rent-pick-name">{tenant.name}</span>
        </div>
        <div className="rent-pick-phone">{tenant.phone || "—"}</div>
        <div className="rent-pick-k">{headline}</div>
        <div className={"rent-pick-v" + (due > 0.5 ? " due" : "")}>{headAmt > 0.5 ? "₹ " + inr(headAmt) : "✓"}</div>
        <div className="rent-pick-strip" aria-hidden>
          {MONTH_NAMES.map((name, i) => (
            <span
              key={name}
              className={"rent-dot" + (monthCharged(tenant, expenses, monthFirstDay(year, i + 1)) ? " on" : "")}
              title={name}
            />
          ))}
        </div>
        <div className="rent-pick-sub">
          {ticked} of 12 months · {year}
          {monthly > 0 ? " · monthly ₹" + inr(monthly) : ""}
        </div>
      </button>
      <div className="rent-pick-tools">
        <button type="button" className="rent-ico" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="rent-ico" onClick={onPull}>
          Pull
        </button>
        {dups.length > 0 && (
          <button type="button" className="rent-ico merge" onClick={onMerge} title="Same name and number — merge">
            <span className="rent-merge-ico" aria-hidden />
            Merge
          </button>
        )}
      </div>
    </div>
  );
}
