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
  const lines = doc.sections
    .map((s) => {
      let cft = 0;
      s.rows.forEach((r) => (cft += cftOf(r)));
      return `• ${s.name}: ${cft.toFixed(2)} CFT @ ₹${s.rate}/CFT`;
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
 * Send the document on WhatsApp with the PDF ATTACHED (one tap, no manual download):
 * renders the sheet to a PDF and hands it to the system share sheet (phones/tablets —
 * pick WhatsApp and the PDF is attached with the message). Where the share sheet
 * doesn't exist (desktop browsers), falls back to downloading the PDF and opening
 * the WhatsApp chat with the message so it can be dropped in.
 */
export async function sendDocOnWhatsApp(
  sheet: HTMLElement,
  doc: Doc,
): Promise<"shared" | "cancelled" | "fallback"> {
  const text = quoteMessage(doc);
  const file = await generatePdfFile(sheet, doc.number || doc.id);
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.canShare?.({ files: [file] })) {
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
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  window.open(waLink(doc.phone, text), "_blank");
  return "fallback";
}
