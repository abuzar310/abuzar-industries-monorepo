// Compact live snapshot for AI — same Balances math, top dues only (never the full ledger).
import { isCloaked } from "./cloak";
import { listCached } from "./data";
import { getFeatures } from "./features";
import { customerFinancials } from "./customers";
import { partyLedger } from "./payments";
import { factsFromDoc } from "./ai-doc-actions";
import { chatHref, DAY_UPDATE_DRAFT } from "./staff-chat";
import type { Customer, Doc, Expense } from "./types";
import type { AiQuickAction } from "./ai-doc-actions";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

function owingParties() {
  const quotes = listCached<Doc>("quotations");
  const invoices = listCached<Doc>("invoices");
  const customers = listCached<Customer>("customers");
  const expenses = listCached<Expense>("expenses");
  if (getFeatures().simpleQuote) {
    const ledger = partyLedger(quotes, expenses, customers);
    const owing = ledger.parties.filter((p) => p.balance > 0.5);
    return {
      total: ledger.totalPending,
      owing: owing.map((p) => ({ id: p.custId, name: p.name, balance: p.balance })),
      label: "Balances",
    };
  }
  const rows = customers
    .map((c) => ({
      id: c.id,
      name: c.name,
      balance: customerFinancials(c.id, quotes, invoices, +(c.opening || 0), expenses, false).outstanding,
    }))
    .filter((p) => p.balance > 0.5)
    .sort((a, b) => b.balance - a.balance);
  return {
    total: rows.reduce((s, p) => s + p.balance, 0),
    owing: rows,
    label: "invoice outstanding",
  };
}

/** Short facts attached to every chat request for this screen. */
export function liveAiContext(pathname: string, doc: Doc | null): string {
  if (isCloaked()) {
    return "Money is hidden (cloak). Do not invent rupee amounts. Guide with tab names only.";
  }
  try {
    const { total, owing, label } = owingParties();
    const top = owing.slice(0, 12);
    const lines: string[] = [
      "LIVE SNAPSHOT from this yard (" + label + "). Use these names and amounts. Do NOT say you lack access.",
      "Total pending: " + rs(total) + " across " + owing.length + " parties.",
      top.length
        ? "Who owes the most:\n" +
          top.map((p, i) => i + 1 + ". " + (p.name || "—") + " — " + rs(p.balance) + " due").join("\n")
        : "Nobody currently has an outstanding balance.",
    ];
    if (doc) {
      const f = factsFromDoc(doc);
      lines.push(
        "Open document: " +
          (f.kind === "invoice" ? "Invoice " : "Quotation ") +
          f.number +
          " · " +
          (f.customerName || "—") +
          " · bill " +
          rs(f.bill) +
          " · paid " +
          rs(f.paid) +
          " · due " +
          rs(f.balance),
      );
    }
    const cust = pathname.match(/^\/customers\/([^/]+)/);
    if (cust) {
      const c = listCached<Customer>("customers").find((x) => x.id === decodeURIComponent(cust[1]));
      if (c) {
        const hit = owing.find((p) => p.id === c.id);
        lines.push(
          "Open customer: " +
            (c.name || "—") +
            (hit ? " · due " + rs(hit.balance) : " · no outstanding"),
        );
      }
    }
    return lines.join("\n").slice(0, 2800);
  } catch {
    return "";
  }
}

function latestPaymentHref(): string | null {
  const exp = listCached<Expense>("expenses")
    .filter((e) => e.type === "sale" && !!e.sourceId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const latest = exp[0];
  if (!latest?.sourceId) return null;
  return "/editor/" + latest.sourceId + "?pay=" + encodeURIComponent(latest.id);
}

/** If the user asked to open the latest payment quote, return that href. */
export function navIntentHref(text: string): string | null {
  const t = (text || "").toLowerCase();
  if (/ask manager|day update/.test(t)) return chatHref(DAY_UPDATE_DRAFT);
  if (/(open|go to|yard).*(chat)/.test(t)) return "/chat";
  if (/open/.test(t) && /(payment|quote|quotation)/.test(t)) return latestPaymentHref();
  return null;
}

/** Instant answers (no model call) for the biggest dues questions + in-app jumps. */
export function liveQuickActions(pathname: string): AiQuickAction[] {
  const path = (pathname || "/").split("?")[0];
  const out: AiQuickAction[] = [];

  if (path === "/" || path.startsWith("/payments") || path.startsWith("/receipts")) {
    const href = latestPaymentHref();
    if (href) {
      out.push({ id: "nav-latest-pay", label: "Open latest payment", href });
    }
  }

  if (isCloaked()) return out;

  const onMoneyTab =
    path === "/" ||
    path.startsWith("/payments") ||
    path.startsWith("/customers") ||
    path.startsWith("/receipts") ||
    path.startsWith("/quotations") ||
    path.startsWith("/invoices") ||
    path.startsWith("/reports") ||
    path.startsWith("/stock");
  if (!onMoneyTab) return out;
  try {
    const { total, owing, label } = owingParties();
    const top = owing.slice(0, 8);
    if (!top.length) {
      out.push({
        id: "live-owing-none",
        label: "Who owes us?",
        readyText: "Nobody currently has an outstanding balance (" + label + ").",
      });
      return out;
    }
    const list = top.map((p, i) => i + 1 + ". " + (p.name || "—") + " — " + rs(p.balance)).join("\n");
    out.push({
      id: "live-owing",
      label: "Who owes the most?",
      readyText:
        "Biggest dues right now (" +
        label +
        "):\n\n" +
        list +
        "\n\nTotal pending: " +
        rs(total) +
        " · " +
        owing.length +
        " parties.",
    });
  } catch {
    /* ignore */
  }
  return out;
}
