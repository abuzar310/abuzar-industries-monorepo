// Predetermined AI / WhatsApp actions for the floating assistant — especially when a quote is open.
import { inr } from "./calc";
import { activeBrand } from "./brand";
import { isCloaked } from "./cloak";
import { quoteBill } from "./payments";
import { balanceReminderMessage, quoteMessage, reminderMessage, waLink } from "./whatsapp";
import type { Doc } from "./types";

export type DocAiFacts = {
  id: string;
  kind: "quotation" | "invoice";
  number: string;
  customerName: string;
  phone: string;
  bill: number;
  paid: number;
  balance: number;
  paymentStatus: string;
  date: string;
  site: string;
};

export function factsFromDoc(d: Doc): DocAiFacts {
  const bill = quoteBill(d);
  const paid = Math.round((+d.amountPaid || 0) * 100) / 100;
  const balance = Math.round((bill - paid) * 100) / 100;
  return {
    id: d.id,
    kind: d.kind,
    number: d.number || d.displayNumber || d.id,
    customerName: (d.customerName || "").trim(),
    phone: (d.phone || "").trim(),
    bill,
    paid,
    balance: balance < 0 ? 0 : balance,
    paymentStatus: d.paymentStatus || "Pending",
    date: d.date || "",
    site: (d.site || "").trim(),
  };
}

export function thankYouMessage(d: Doc): string {
  const b = activeBrand();
  const name = (d.customerName || "").trim() || "Customer";
  const review = (b.reviewFunnelUrl || b.reviewUrl || "").trim();
  const from = b.name || "Abuzar Industries";
  const ref = d.number
    ? `Ref: ${d.kind === "invoice" ? "Invoice" : "Quotation"} ${d.number}.\n\n`
    : "";
  const reviewBlock = review ? `\n\nLoved our service? Please rate us ⭐\n${review}` : "";
  return `Dear ${name},\n\nThank you for your payment / business with ${from}.\n${ref}Warm regards,\n${from}${reviewBlock}`;
}

export type AiQuickAction = {
  id: string;
  label: string;
  /** Instant draft (accurate ₹ from the open document). */
  readyText?: string;
  /** Sent to Gemini when the action needs a rewrite / explanation. */
  prompt?: string;
  /** Navigate in-app (open a quote, tab, etc.) instead of chatting. */
  href?: string;
  /** Run an in-app job (download the screen's PDF) instead of chatting. */
  run?: "pdf";
};

function moneyLine(f: DocAiFacts): string {
  if (isCloaked()) return "Money amounts are hidden (cloak mode) — do not invent figures.";
  return [
    `Bill: ₹${inr(f.bill)}`,
    `Received: ₹${inr(f.paid)}`,
    `Balance due: ₹${inr(f.balance)}`,
    `Payment status: ${f.paymentStatus}`,
  ].join("\n");
}

/** Quick actions when a quotation/invoice editor is open. */
export function docQuickActions(d: Doc): AiQuickAction[] {
  const f = factsFromDoc(d);
  const kindLabel = f.kind === "invoice" ? "Invoice" : "Quotation";
  const ref = `${kindLabel} ${f.number}`;
  const factsBlock = [
    `Use ONLY these facts (do not invent amounts or GST):`,
    `Customer: ${f.customerName || "—"}`,
    `Phone: ${f.phone || "—"}`,
    `${ref}`,
    `Date: ${f.date || "—"}`,
    f.site ? `Site: ${f.site}` : "",
    moneyLine(f),
  ]
    .filter(Boolean)
    .join("\n");

  const actions: AiQuickAction[] = [
    {
      id: "pay-remind",
      label: "Payment reminder",
      readyText: balanceReminderMessage({
        name: f.customerName,
        ref,
        total: f.bill,
        received: f.paid,
        balance: f.balance,
      }),
    },
    {
      id: "thank-you",
      label: "Thank-you + review",
      readyText: thankYouMessage(d),
    },
    {
      id: "follow-up",
      label: "Quote follow-up",
      readyText: reminderMessage(d),
    },
    {
      id: "send-quote",
      label: "Quote WhatsApp text",
      readyText: quoteMessage(d),
    },
    {
      id: "polish-remind",
      label: "Softer reminder (AI)",
      prompt:
        factsBlock +
        "\n\nRewrite a short, polite WhatsApp payment reminder in natural Indian English. Keep numbers exactly as given. 4–7 lines. No hashtags.",
    },
    {
      id: "part-pay",
      label: "How to record part payment",
      prompt:
        factsBlock +
        "\n\nExplain how to record a part payment on THIS quotation in our Cut Size / Abuzar yard app (not Tally/Zoho). Steps: open the quotation → Payment / Accept payment → enter Cash and/or UPI → save. Mention the current balance if shown above. Be brief.",
    },
  ];

  // Hide money-heavy actions when nothing is due and cloak is off — still show thank-you / follow-up
  if (!isCloaked() && f.balance <= 0.001) {
    return actions.filter((a) => a.id !== "pay-remind" && a.id !== "polish-remind");
  }
  return actions;
}

/** Generic chips when no document is open. */
export function genericQuickActions(): AiQuickAction[] {
  const review = (activeBrand().reviewFunnelUrl || activeBrand().reviewUrl || "").trim();
  return [
    {
      id: "g-remind",
      label: "Payment reminder",
      prompt:
        "Draft a polite WhatsApp payment reminder for a timber customer. Leave blanks like [Name] and [Amount] for me to fill. 4–6 lines.",
    },
    {
      id: "g-thanks",
      label: "Thank-you + review",
      prompt:
        "Draft a short WhatsApp thank-you after payment for a timber yard in Chitradurga." +
        (review ? ` Include this review link: ${review}` : " Ask them to leave a Google review.") +
        " 3–5 lines.",
    },
    {
      id: "g-part",
      label: "Part payment help",
      prompt:
        "In our Cut Size / Abuzar yard app, how do I record a part payment on a quotation? (Cash/UPI on the quotation Payment block — not Tally.) Short steps.",
    },
  ];
}

export function openWhatsApp(phone: string, text: string) {
  const url = waLink(phone, text);
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
