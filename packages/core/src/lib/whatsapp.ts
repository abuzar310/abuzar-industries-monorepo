import { activeBrand } from "./brand";
import { cftOf, computeDoc, inr } from "./calc";
import { generatePdfFile } from "./pdf";
import type { Doc } from "./types";

export function waLink(phone: string, text: string): string {
  let p = (phone || "").replace(/[^0-9]/g, "");
  if (p.length === 10) p = "91" + p;
  return "https://wa.me/" + p + "?text=" + encodeURIComponent(text);
}

/** Neutral, professional greeting with the customer's name. */
const greet = (name?: string) => `Dear ${(name || "").trim() || "Customer"},`;

/** "Rate us on Google" footer — only for brands with a review page configured. */
function reviewFooter(): string {
  const url = activeBrand().reviewUrl;
  return url ? `\n\nLoved our service? Please rate us on Google ⭐\n${url}` : "";
}

export function quoteMessage(doc: Doc): string {
  const b = activeBrand();
  const t = computeDoc(doc);
  // per-section quantity from the SAME math the sheet uses (secCft handles every entry
  // mode — by-size, direct CFT, CBM, per-piece, running feet — not just L×W×T rows)
  const unitOf = (m?: string) => (m === "cbm" ? "CBM" : m === "rft" ? "RFT" : m === "pcs" ? "pc" : "CFT");
  const lines = doc.rented
    ? `• ${doc.rentDesc || "Rent"}: ₹${inr(doc.rentAmount || 0)}`
    : doc.sections
        .map((s, i) => {
          const qty = t.secCft[i] ?? s.rows.reduce((c, r) => c + cftOf(r), 0);
          const u = unitOf(s.calcMode);
          return `• ${s.name}: ${qty.toFixed(2)} ${u} @ ₹${s.rate}/${u}`;
        })
        .join("\n");
  const kind = doc.kind === "invoice" ? "Invoice" : "Quotation";
  const sign = [b.name, [b.phone, b.web].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  return `${greet(doc.customerName)}
Please find your ${kind.toLowerCase()} ${doc.number} from ${b.name}.

${lines}

Sub-total: ₹${inr(t.sub)}
GST (${doc.gst}%): ₹${inr(t.gstAmt)}
Grand Total: ₹${inr(t.grand)}

Thank you for your business,
${sign}${reviewFooter()}`;
}

export function reminderMessage(doc: Doc): string {
  const b = activeBrand();
  return `${greet(doc.customerName)}
This is ${b.name}.
Regarding your timber enquiry and quotation ${doc.number}, we wanted to follow up. Please let us know if you would like to proceed. Thank you.`;
}

/** Bare-bones balance reminder — just the figures, no fluff. */
export function balanceReminderMessage(doc: Doc, total: number, received: number, balance: number): string {
  const kind = doc.kind === "invoice" ? "Invoice" : "Quotation";
  return `${greet(doc.customerName)}
${kind} ${doc.number} — Total: ₹${inr(total)}${received > 0.5 ? `\nReceived: ₹${inr(received)}` : ""}
Balance pending: ₹${inr(balance)}
— ${activeBrand().name}`;
}

export function customerFollowupMessage(name: string): string {
  return `${greet(name)}\nThis is ${activeBrand().name}. Following up on your timber enquiry — please let us know if you would like to proceed. Thank you.`;
}

/**
 * Send the document on WhatsApp — the PDF must actually go with the message.
 * WhatsApp links (wa.me) are a platform dead end here: they can ONLY carry text,
 * never a file. So on phones the real path is the system share sheet:
 *  - PHONE → build the PDF, share it (message attached as the caption/text) via
 *    navigator.share; the user taps WhatsApp and picks the customer's chat.
 *    File + text go together.
 *  - PHONE where sharing is unavailable/blocked → download the PDF AND open the
 *    customer's chat with the message, so the file is one attach away ("fallback").
 *  - DESKTOP → save the PDF (a real download) and open the chat with the message,
 *    so the file is ready to drop in ("direct").
 */
export async function sendDocOnWhatsApp(
  sheet: HTMLElement,
  doc: Doc,
): Promise<"direct" | "shared" | "cancelled" | "fallback"> {
  const text = quoteMessage(doc);
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const mobile = !!nav && /Android|iPhone|iPad|iPod/i.test(nav.userAgent);

  const file = await generatePdfFile(sheet, doc.number || doc.id);

  if (mobile && nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: activeBrand().name + " " + (doc.kind === "invoice" ? "Invoice" : "Quotation") + " " + doc.number,
        text,
      });
      return "shared";
    } catch (e) {
      // user closed the share sheet — do nothing (no duplicate sends)
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // share blocked (e.g. the tap "expired" while the PDF rendered) — fall through
    }
  }

  // save the PDF (lands in Downloads), then open the chat with the message prefilled
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  window.open(waLink(doc.phone, text), "_blank");
  return mobile ? "fallback" : "direct";
}
