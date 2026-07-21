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

export function customerFollowupMessage(name: string): string {
  return `${greet(name)}\nThis is ${activeBrand().name}. Following up on your timber enquiry — please let us know if you would like to proceed. Thank you.`;
}

/**
 * Send the document on WhatsApp. Priority #1 is the RIGHT RECIPIENT:
 *  - PHONE (mobile/tablet) + customer number → open the WhatsApp chat IMMEDIATELY
 *    (number auto-selected, message prefilled). No PDF here: phone browsers hijack a
 *    blob "download" by opening the PDF viewer instead — which used to swallow the
 *    whole send — and an async pause before opening the chat trips popup blockers.
 *  - PHONE without a number → system share sheet with the PDF attached; pick the contact.
 *  - DESKTOP → save the PDF (a real download) and open the chat with the message,
 *    so the file is ready to drop in. (WhatsApp links can't carry attachments —
 *    platform limit — so number-first is the closest to one-tap.)
 */
export async function sendDocOnWhatsApp(
  sheet: HTMLElement,
  doc: Doc,
): Promise<"direct" | "shared" | "cancelled"> {
  const text = quoteMessage(doc);
  const hasPhone = (doc.phone || "").replace(/\D/g, "").length >= 10;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const mobile = !!nav && /Android|iPhone|iPad|iPod/i.test(nav.userAgent);

  // phone + number: straight into the chat, synchronously (inside the tap gesture)
  if (mobile && hasPhone) {
    window.open(waLink(doc.phone, text), "_blank");
    return "direct";
  }

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
      // share failed for another reason — fall through to the download path
    }
  }

  // desktop: save the PDF (lands in Downloads), then open the chat
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  window.open(waLink(doc.phone, text), "_blank");
  return "direct";
}
